import json
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from projects import track_context
from projects.database import ProjectMembership, ProjectRole


def configure(monkeypatch, tmp_path, client, project):
    path = tmp_path / "context.json"
    values = {
        "version": 1,
        "reader_id": "projects-context-qa",
        "owner_account_id": client.get("/api/session").json()["user"]["id"],
        "project_source_id": "projects-native",
        "project_ids": [project["id"]],
        "secret_file": str(tmp_path / "private.key"),
        "socket_path": str(tmp_path / "context.sock"),
        "public_origin": "https://track.example.test",
    }
    path.write_text(json.dumps(values))
    monkeypatch.setenv("PROJECTS_TRACK_CONTEXT_FILE", str(path))
    return path, values


def reply(target):
    # Native ACL tests stub the separately verified shared Node DTO client.
    return {
        "state": "connected",
        "summary": {"context": target, "counts": {"runs": 2}},
    }


def test_context_disabled_owner_scope_and_native_task_match(
    app, client, project, create_item, monkeypatch, tmp_path
):
    monkeypatch.delenv("PROJECTS_TRACK_CONTEXT_FILE", raising=False)
    route = f"/api/projects/{project['id']}/agent-track"
    assert client.get(route).json() == {"state": "disabled", "summary": None}
    _, values = configure(monkeypatch, tmp_path, client, project)
    calls = []

    def run(path, target):
        calls.append((path, target))
        return reply(target)

    monkeypatch.setattr(track_context, "run_context_client", run)
    response = client.get(route)
    assert response.status_code == 200
    assert response.json()["summary"]["context"] == {
        "kind": "project",
        "sourceId": "projects-native",
        "projectId": project["id"],
    }
    task = create_item(kind="task", title="Native QA Task")
    task_route = (
        f"/api/projects/{project['id']}/tasks/{task['id']}/agent-track"
    )
    assert (
        client.get(task_route).json()["summary"]["context"]["taskId"]
        == task["id"]
    )
    artifact = create_item()
    assert (
        client.get(
            f"/api/projects/{project['id']}/tasks/{artifact['id']}/agent-track"
        ).status_code
        == 404
    )
    with TestClient(app) as other:
        assert other.get(route).status_code == 401
        registered = other.post(
            "/api/auth/register",
            json={"username": "context-viewer", "password": "test-only-pass"},
        )
        assert registered.status_code == 201
        viewer = registered.json()["user"]["id"]
        with Session(app.state.engine) as db, db.begin():
            role = db.scalar(
                select(ProjectRole).where(
                    ProjectRole.project_id == project["id"],
                    ProjectRole.preset == "viewer",
                )
            )
            db.add(
                ProjectMembership(
                    project_id=project["id"],
                    account_id=viewer,
                    role_id=role.id,
                )
            )
        before = len(calls)
        assert other.get(route).json() == {
            "state": "forbidden",
            "summary": None,
        }
        assert len(calls) == before, (
            "owner reader is not lent to another viewer"
        )
    foreign = client.post(
        "/api/projects", json={"name": "Other", "goal": "Unconfigured"}
    ).json()
    assert (
        client.get(f"/api/projects/{foreign['id']}/agent-track").json()[
            "state"
        ]
        == "disabled"
    )
    assert values["owner_account_id"] != viewer


def test_native_revocation_during_track_wait_discards_result(
    app, client, project, monkeypatch, tmp_path
):
    _, values = configure(monkeypatch, tmp_path, client, project)

    def run(path, target):
        with Session(app.state.engine) as db, db.begin():
            db.execute(
                delete(ProjectMembership).where(
                    ProjectMembership.project_id == project["id"],
                    ProjectMembership.account_id == values["owner_account_id"],
                )
            )
        return reply(target)

    monkeypatch.setattr(track_context, "run_context_client", run)
    response = client.get(f"/api/projects/{project['id']}/agent-track")
    assert response.status_code == 404
    assert "summary" not in response.json()


def test_context_configuration_change_and_failure_never_block_task_edit(
    client, project, create_item, monkeypatch, tmp_path
):
    path, values = configure(monkeypatch, tmp_path, client, project)
    route = f"/api/projects/{project['id']}/agent-track"

    def changed(path, target):
        path.write_text(json.dumps({**values, "project_ids": [str(uuid4())]}))
        return reply(target)

    monkeypatch.setattr(track_context, "run_context_client", changed)
    assert client.get(route).json() == {
        "state": "unavailable",
        "summary": None,
    }
    path.write_text(json.dumps(values))
    monkeypatch.setattr(
        track_context,
        "run_context_client",
        lambda path, target: {"state": "unavailable", "summary": None},
    )
    assert client.get(route).json()["state"] == "unavailable"
    task = create_item(kind="task", title="Optional Track outage")
    updated = client.put(
        f"/api/items/{task['id']}",
        json={
            "expected_revision": task["revision"],
            "title": "Native editing still works",
            "body": task["body"],
            "data": task["data"],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Native editing still works"
    path.write_text("PRIVATE_CONFIG_SENTINEL")
    failed = client.get(route)
    assert failed.json() == {"state": "unavailable", "summary": None}
    assert "PRIVATE_CONFIG" not in failed.text


def test_node_failure_and_reply_identity_are_closed(monkeypatch, tmp_path):
    monkeypatch.setattr(track_context.shutil, "which", lambda name: None)
    target = {
        "kind": "project",
        "sourceId": "projects-native",
        "projectId": str(uuid4()),
    }
    assert track_context.run_context_client(Path("config.json"), target) == {
        "state": "unavailable",
        "summary": None,
    }
