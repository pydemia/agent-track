"""Provision a separate read-only Track principal. Preserve Projects data."""

import argparse
import base64
import json
import os
import secrets
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path


def private_write(path: Path, value: str) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--username", required=True)
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    inspected = json.loads(
        subprocess.check_output(
            ["docker", "inspect", args.container],
            text=True,
        )
    )[0]
    environment = dict(
        row.split("=", 1) for row in inspected["Config"]["Env"] if "=" in row
    )
    native_path = environment.get("PROJECTS_ASSISTANT_INTEGRATION_FILE", "")
    config_path = args.config.resolve(strict=True)
    matching_mounts = [
        mount
        for mount in inspected["Mounts"]
        if str(Path(mount["Destination"]) / config_path.name) == native_path
        and Path(mount["Source"]).resolve() == config_path.parent
    ]
    if len(matching_mounts) != 1:
        raise ValueError(
            "Expected the existing directory-mounted principal configuration"
        )
    container_uid = int(
        subprocess.check_output(
            ["docker", "exec", args.container, "id", "-u"],
            text=True,
        ).strip()
    )
    if container_uid not in (0, os.getuid()):
        raise ValueError(
            "Container cannot read a private key owned by this operator"
        )
    query = """
import json
import sys
from sqlalchemy import select
from sqlalchemy.orm import Session
from projects.config import Settings
from projects.database import make_engine, Account, EntraIdentity, Project
from projects.project_access import accessible_project_ids
try:
    request = json.load(sys.stdin)
    with Session(make_engine(Settings.from_env().database_url)) as db:
        account = db.get(Account, request['accountId'])
        identity = db.scalar(select(EntraIdentity).where(
            EntraIdentity.account_id == request['accountId'],
            EntraIdentity.tenant_id == request['tenantId'],
        ))
        if (account is None or identity is None or
                account.username != request['username']):
            raise ValueError('Owner mapping unavailable')
        allowed = accessible_project_ids(db, account.id)
        projects = sorted(db.scalars(
            select(Project.id).where(Project.id.in_(allowed)),
        ))
        if not projects:
            raise ValueError('No authorized projects')
        print(json.dumps({'projectIds': projects}))
except Exception:
    raise SystemExit('Native owner/project validation failed')
"""
    result = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            args.container,
            "/app/.venv/bin/python",
            "-c",
            query,
        ],
        input=json.dumps(
            {
                "accountId": args.account_id,
                "username": args.username,
                "tenantId": args.tenant_id,
            }
        ),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise ValueError("Native owner/project validation failed")
    projects = json.loads(result.stdout)["projectIds"]
    current = json.loads(config_path.read_text(encoding="utf-8"))
    if current.get("version") != 1 or not isinstance(
        current.get("principals"), list
    ):
        raise ValueError("Unsupported native principal configuration")
    principal = {
        "id": "agent-track-reader-pydemia",
        "revision": 1,
        "enabled": True,
        "kid": "agent-track-reader-v1",
        "secretFile": "agent-track-reader-v1.key",
        "accountId": args.account_id,
        "projectIds": projects,
        "scopes": ["projects:read", "tasks:read"],
    }
    existing = [
        row
        for row in current["principals"]
        if row.get("id") == principal["id"]
        or row.get("kid") == principal["kid"]
    ]
    key_path = config_path.parent / principal["secretFile"]
    if existing:
        if existing != [principal] or not key_path.is_file():
            raise ValueError(
                "Existing Track principal differs; "
                "no automatic scope/key change"
            )
        encoded = key_path.read_text(encoding="utf-8").strip()
        key = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        if (
            len(key) != 32
            or base64.urlsafe_b64encode(key).decode().rstrip("=") != encoded
        ):
            raise ValueError("Existing Track key is invalid")
        print(
            json.dumps(
                {
                    "created": False,
                    "principalId": principal["id"],
                    "projectCount": len(projects),
                    "existingEntriesPreserved": True,
                }
            )
        )
        return
    if key_path.exists():
        raise ValueError(
            "Unregistered Track key exists; preserved without replacement"
        )
    updated = {**current, "principals": [*current["principals"], principal]}
    validation = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            args.container,
            "/app/.venv/bin/python",
            "-c",
            (
                "import sys; "
                "from projects.assistant_integration import IntegrationConfig; "
                "IntegrationConfig.model_validate_json(sys.stdin.read())"
            ),
        ],
        input=json.dumps(updated),
        text=True,
        capture_output=True,
        check=False,
    )
    if validation.returncode:
        raise ValueError(
            "Native schema rejected principal; "
            "existing configuration preserved"
        )
    if args.dry_run:
        print(
            json.dumps(
                {
                    "dryRun": True,
                    "principalId": principal["id"],
                    "projectCount": len(projects),
                    "scopes": principal["scopes"],
                    "existingEntriesPreserved": True,
                }
            )
        )
        return
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    private_write(
        config_path.with_name(f"principals.before-agent-track-{stamp}.json"),
        config_path.read_text(encoding="utf-8"),
    )
    private_write(
        key_path,
        base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
        + "\n",
    )
    descriptor, temporary = tempfile.mkstemp(
        prefix=".track-principals-", dir=config_path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(updated, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        if json.loads(config_path.read_text(encoding="utf-8")) != current:
            raise ValueError(
                "Concurrent native configuration update; preserved"
            )
        os.replace(temporary, config_path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(
        json.dumps(
            {
                "created": True,
                "principalId": principal["id"],
                "projectCount": len(projects),
                "existingEntriesPreserved": updated["principals"][:-1]
                == current["principals"],
                "scopes": principal["scopes"],
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - CLI boundary must suppress secret-bearing errors.
        raise SystemExit(
            f"Track reader provision stopped ({type(error).__name__}); "
            "private values omitted"
        ) from None
