"""Optional Track summaries after native owner and current Project authorization."""

import hashlib
import json
import os
import shutil
import subprocess
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Annotated, Literal, TypedDict
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from projects.database import Account
from projects.domain import Problem
from projects.project_access import require_project_access
from projects.records import item_for_user


class TrackContextConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    version: Literal[1]
    reader_id: str = Field(pattern=r"^[a-z0-9_-]{1,80}$")
    owner_account_id: str
    project_source_id: str = Field(pattern=r"^[a-z0-9_-]{1,80}$")
    project_ids: list[str] = Field(min_length=1, max_length=100)
    secret_file: str
    socket_path: str
    public_origin: str

    @field_validator("owner_account_id")
    @classmethod
    def canonical_owner(cls, value: str) -> str:
        if str(UUID(value)) != value:
            raise ValueError("Canonical owner ID required")
        return value

    @field_validator("project_ids")
    @classmethod
    def canonical_projects(cls, values: list[str]) -> list[str]:
        if any(str(UUID(value)) != value for value in values):
            raise ValueError("Canonical Project IDs required")
        return values

    @field_validator("secret_file", "socket_path")
    @classmethod
    def absolute_path(cls, value: str) -> str:
        if not Path(value).is_absolute():
            raise ValueError("Absolute private path required")
        return value

    @field_validator("public_origin")
    @classmethod
    def root_origin(cls, value: str) -> str:
        url = urlsplit(value)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username
            or url.password
            or url.path not in {"", "/"}
            or url.query
            or url.fragment
        ):
            raise ValueError("Credential-free Track origin required")
        return value


class ContextResult(TypedDict):
    state: Literal["connected", "disabled", "forbidden", "unavailable"]
    summary: dict[str, object] | None


class NodeReply(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    state: Literal["connected", "forbidden", "unavailable"]
    summary: dict[str, object] | None


def _unavailable() -> ContextResult:
    return {"state": "unavailable", "summary": None}


def _configuration() -> tuple[TrackContextConfig, Path, str] | None:
    filename = os.getenv("PROJECTS_TRACK_CONTEXT_FILE", "")
    if not filename:
        return None
    path = Path(filename)
    if not path.is_absolute():
        raise ValueError("Absolute private configuration required")
    with path.open("rb") as stream:
        data = stream.read(16_385)
    if len(data) > 16_384:
        raise ValueError("Context configuration too large")
    config = TrackContextConfig.model_validate_json(data)
    return config, path, hashlib.sha256(data).hexdigest()


def run_context_client(
    config_file: Path, target: dict[str, str]
) -> ContextResult:
    """Node validates the shared v1 DTO; no credential enters argv or stdout."""
    node = shutil.which("node")
    if not node:
        return _unavailable()
    script = Path(__file__).resolve().parents[2] / "track-context/bridge.mjs"
    try:
        completed = subprocess.run(
            [node, str(script), str(config_file)],
            input=json.dumps(target).encode(),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=3,
            check=False,
        )
        if completed.returncode or len(completed.stdout) > 524_288:
            return _unavailable()
        result = NodeReply.model_validate_json(completed.stdout)
        if result.state == "connected":
            if not result.summary or result.summary.get("context") != target:
                return _unavailable()
            return {"state": "connected", "summary": result.summary}
        return {"state": result.state, "summary": None}
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return _unavailable()


def create_track_context_router(
    db_dependency: Callable[..., Iterator[Session]],
    user_dependency: Callable[..., Account],
) -> APIRouter:
    router = APIRouter()
    DB = Annotated[Session, Depends(db_dependency, scope="function")]
    User = Annotated[Account, Depends(user_dependency)]

    def authorize(
        db: Session, user: Account, project_id: str, task_id: str | None
    ) -> None:
        require_project_access(db, project_id, user.id)
        if task_id is not None:
            item = item_for_user(db, task_id, user.id)
            if item.project_id != project_id or item.kind != "task":
                raise Problem(404, "업무를 찾을 수 없습니다.")

    def read(
        request: Request,
        db: Session,
        user: Account,
        project_id: str,
        task_id: str | None = None,
    ) -> ContextResult:
        authorize(db, user, project_id, task_id)
        try:
            loaded = _configuration()
        except (OSError, ValueError):
            return _unavailable()
        if loaded is None:
            return {"state": "disabled", "summary": None}
        config, config_file, fingerprint = loaded
        if project_id not in config.project_ids:
            return {"state": "disabled", "summary": None}
        actor_id = user.id
        if actor_id != config.owner_account_id:
            return {"state": "forbidden", "summary": None}
        target = {
            "kind": "task" if task_id else "project",
            "sourceId": config.project_source_id,
            "projectId": project_id,
        }
        if task_id:
            target["taskId"] = task_id
        result = run_context_client(config_file, target)
        # The optional network wait grants no authority to stale native objects.
        db.expire_all()
        current_user = user_dependency(request, db)
        if current_user.id != actor_id:
            raise Problem(401, "로그인이 필요합니다.")
        authorize(db, current_user, project_id, task_id)
        try:
            confirmed = _configuration()
        except (OSError, ValueError):
            return _unavailable()
        if confirmed is None or confirmed[2] != fingerprint:
            return _unavailable()
        if current_user.id != confirmed[0].owner_account_id:
            return {"state": "forbidden", "summary": None}
        return result

    @router.get("/api/projects/{project_id}/agent-track")
    def project_summary(
        project_id: UUID, request: Request, db: DB, user: User
    ) -> ContextResult:
        return read(request, db, user, str(project_id))

    @router.get("/api/projects/{project_id}/tasks/{task_id}/agent-track")
    def task_summary(
        project_id: UUID, task_id: UUID, request: Request, db: DB, user: User
    ) -> ContextResult:
        return read(request, db, user, str(project_id), str(task_id))

    return router
