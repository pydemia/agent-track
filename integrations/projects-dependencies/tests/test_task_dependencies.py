"""Real PostgreSQL coverage for signed dependency metadata and every endpoint ACL."""

from uuid import uuid4

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session
from test_assistant_integration import PREFIX
from test_assistant_integration import assistant as assistant

from projects.database import Item, Link, ProjectMembership


def task(client, project_id, title="Task"):
    response = client.post(
        f"/api/projects/{project_id}/items",
        json={
            "kind": "task",
            "title": title,
            "body": "private body",
            "data": {"state": "todo"},
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def link(engine, project_id, source, target, relation="depends_on"):
    identifier = str(uuid4())
    with Session(engine) as db, db.begin():
        db.add(
            Link(
                id=identifier,
                project_id=project_id,
                source_id=source["id"],
                target_id=target["id"],
                relation=relation,
                source_revision=source["revision"],
                target_revision=target["revision"],
            )
        )
    return identifier


def test_signed_dependencies_are_allowlisted_and_do_not_mutate_tasks(
    assistant, client, project, engine
):
    send, _, _ = assistant
    first, second = (
        task(client, project["id"], "Dependent"),
        task(client, project["id"], "Prerequisite"),
    )
    identifier = link(engine, project["id"], first, second)
    response = send(
        "GET", PREFIX + f"/projects/{project['id']}/task-dependencies"
    )
    assert response.status_code == 200, response.text
    page = response.json()
    assert (
        page["version"] == 1 and not page["has_more"] and page["observed_at"]
    )
    assert page["project_id"] == project["id"] and len(page["items"]) == 1
    row = page["items"][0]
    assert row["id"] == identifier and row["relation"] == "depends_on"
    assert (
        row["source_task"]["id"] == first["id"]
        and row["target_task"]["id"] == second["id"]
    )
    assert row["source_revision"] == row["source_task"]["revision"] == 1
    assert row["source_task"]["data"]["state"] == "todo"
    assert set(row["source_task"]) == {
        "id",
        "project_id",
        "kind",
        "title",
        "revision",
        "data",
    }
    assert "private body" not in response.text
    assert (
        send("GET", PREFIX + f"/tasks/{first['id']}").json()["revision"] == 1
    )
    assert send("GET", PREFIX + "/capabilities").json()["taskDependenciesRead"]
    with Session(engine) as db, db.begin():
        current = db.get(Item, first["id"])
        assert current is not None
        current.revision = 2
        current.data = {**current.data, "state": "in_progress"}
    refreshed = send(
        "GET", PREFIX + f"/projects/{project['id']}/task-dependencies"
    ).json()["items"][0]
    assert refreshed["source_revision"] == 1
    assert refreshed["source_task"]["revision"] == 2
    assert refreshed["source_task"]["data"]["state"] == "in_progress"


@pytest.mark.parametrize("revoked", ["source", "target", "owner"])
def test_scope_owner_and_both_endpoint_projects_are_required(
    assistant, client, project, engine, revoked
):
    send, config, identity = assistant
    second_project = client.post(
        "/api/projects", json={"name": "Second"}
    ).json()
    owner_project = client.post(
        "/api/projects", json={"name": "Relation owner"}
    ).json()
    first, second = (
        task(client, project["id"]),
        task(client, second_project["id"]),
    )
    link(engine, owner_project["id"], first, second)
    path = PREFIX + f"/projects/{project['id']}/task-dependencies"
    assert send("GET", path).json()["items"] == []
    principal = config["principals"][0]
    principal["projectIds"].append(second_project["id"])
    assert send("GET", path).json()["items"] == []
    principal["projectIds"].append(owner_project["id"])
    assert len(send("GET", path).json()["items"]) == 1
    with Session(engine) as db, db.begin():
        db.execute(
            delete(ProjectMembership).where(
                ProjectMembership.project_id
                == {
                    "source": project["id"],
                    "target": second_project["id"],
                    "owner": owner_project["id"],
                }[revoked],
                ProjectMembership.account_id == identity,
            )
        )
    response = send("GET", path)
    if revoked == "source":
        assert response.status_code == 404
    else:
        assert response.status_code == 200 and response.json()["items"] == []


def test_dependency_route_requires_both_read_scopes_and_current_requested_project(
    assistant, project
):
    send, config, _ = assistant
    path = PREFIX + f"/projects/{project['id']}/task-dependencies"
    principal = config["principals"][0]
    for scope in ("tasks:read", "projects:read"):
        principal["scopes"].remove(scope)
        assert send("GET", path).status_code == 403
        assert not send("GET", PREFIX + "/capabilities").json()[
            "taskDependenciesRead"
        ]
        principal["scopes"].append(scope)
    principal["projectIds"] = []
    assert send("GET", path).status_code == 404


def test_dependency_route_rejects_unsigned_queries_and_non_dependency_relations(
    assistant, client, project, engine
):
    send, _, _ = assistant
    first, second = task(client, project["id"]), task(client, project["id"])
    link(engine, project["id"], first, second, "relates_to")
    path = PREFIX + f"/projects/{project['id']}/task-dependencies"
    assert send("GET", path).status_code == 200
    assert client.get(path).status_code == 401
    assert send("GET", path + "?limit=999").status_code == 422
    assert send("GET", path).json()["items"] == []


def test_dependency_limit_is_explicit_and_does_not_include_hidden_rows(
    assistant, client, project, engine
):
    send, _, _ = assistant
    target = task(client, project["id"])
    hidden = client.post("/api/projects", json={"name": "Hidden owner"}).json()
    with Session(engine) as db, db.begin():
        for index in range(201):
            item = Item(
                id=str(uuid4()),
                project_id=project["id"],
                kind="task",
                title=f"Task {index}",
                data={"state": "todo"},
            )
            db.add(item)
            db.flush()
            db.add(
                Link(
                    id=f"f0000000-0000-4000-8000-{index:012d}",
                    project_id=project["id"],
                    source_id=item.id,
                    target_id=target["id"],
                    relation="depends_on",
                    source_revision=1,
                    target_revision=1,
                )
            )
            hidden_item = Item(
                id=str(uuid4()),
                project_id=hidden["id"],
                kind="task",
                title="Hidden Task",
                data={"state": "todo"},
            )
            db.add(hidden_item)
            db.flush()
            db.add(
                Link(
                    id=f"00000000-0000-4000-8000-{index:012d}",
                    project_id=hidden["id"],
                    source_id=hidden_item.id,
                    target_id=target["id"],
                    relation="depends_on",
                    source_revision=1,
                    target_revision=1,
                )
            )
    page = send(
        "GET", PREFIX + f"/projects/{project['id']}/task-dependencies"
    ).json()
    assert len(page["items"]) == 200 and page["has_more"]
    assert all(row["id"].startswith("f0000000-") for row in page["items"])
    assert "Hidden Task" not in str(page)
    assert [row["id"] for row in page["items"]] == sorted(
        row["id"] for row in page["items"]
    )
