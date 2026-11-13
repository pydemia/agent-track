"""Repeated signed results retain scoped publication evidence."""

from uuid import uuid4

from sqlalchemy.orm import Session
from test_assistant_integration import PREFIX
from test_assistant_integration import assistant as assistant

from projects.database import Item
from projects.note_references import list_note_refs


def runtime_reference():
    instruction, execution = str(uuid4()), str(uuid4())
    return {
        "service": "assistant",
        "run_id": execution,
        "url": (
            "https://assistant.pydemia.ai/#workbench/projects/"
            f"{instruction}/executions/{execution}"
        ),
    }


def attach(send, task):
    operation = str(uuid4())
    response = send(
        "POST",
        PREFIX + f"/tasks/{task['id']}/results",
        {
            "operation_id": operation,
            "expected_revision": task["revision"],
            "runtime": runtime_reference(),
            "state": "in_review",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["task"], operation


def note_reference(revision):
    return {
        "workspace_id": "workspace-a",
        "page_id": "page-a",
        "url": "https://note.pydemia.ai/#/w/workspace-a/page/page-a",
        "revision": revision * 64,
        "content_hash": revision * 64,
    }


def link(send, task, result, revision):
    response = send(
        "POST",
        PREFIX + f"/tasks/{task['id']}/results/{result}/note-reference",
        {
            "operation_id": str(uuid4()),
            "expected_revision": task["revision"],
            "publication_operation_id": str(uuid4()),
            "note": note_reference(revision),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["task"]


def test_repeated_results_preserve_scoped_note_versions(
    assistant, create_item, engine
):
    send, _, account = assistant
    original = create_item(kind="task", data={"workflow": "personal"})
    first, first_result = attach(send, original)
    first_receipt = attach_receipt_task(send, first_result)
    first = link(send, first, first_result, "a")
    second, second_result = attach(send, first)
    second = link(send, second, second_result, "b")

    with Session(engine) as db:
        references = list_note_refs(db, account, second["id"])
    assert {ref["revision"] for ref in references} == {"a" * 64, "b" * 64}
    assert len({ref["id"] for ref in references}) == 2
    assert all(ref["verification"] == "unverified" for ref in references)
    assert second["data"]["state"] == "in_review"
    assert (
        send("GET", PREFIX + f"/operations/{first_result}").json()["task"]
        == first_receipt
    )


def attach_receipt_task(send, result):
    response = send("GET", PREFIX + f"/operations/{result}")
    assert response.status_code == 200
    return response.json()["task"]


def test_history_limit_rejects_new_link_without_discarding_references(
    assistant, create_item, engine
):
    send, _, _ = assistant
    task = create_item(kind="task", data={"workflow": "personal"})
    task, first_result = attach(send, task)
    task = link(send, task, first_result, "a")
    task, second_result = attach(send, task)
    previous = task["data"]["assistant_note_reference"]
    with Session(engine) as db, db.begin():
        row = db.get(Item, task["id"])
        row.data = {
            **row.data,
            "assistant_note_reference_history": [previous] * 100,
        }
    path = (
        PREFIX + f"/tasks/{task['id']}/results/{second_result}/note-reference"
    )
    rejected = send(
        "POST",
        path,
        {
            "operation_id": str(uuid4()),
            "expected_revision": task["revision"],
            "publication_operation_id": str(uuid4()),
            "note": note_reference("b"),
        },
    )
    assert rejected.status_code == 409
    current = send("GET", PREFIX + f"/tasks/{task['id']}").json()
    assert current["revision"] == task["revision"]
    assert current["data"]["assistant_note_reference"] == previous
    assert (
        current["data"]["assistant_note_reference_history"] == [previous] * 100
    )


def test_note_link_rechecks_source_grants_and_original_principal(
    assistant, create_item
):
    send, configuration, _ = assistant
    task = create_item(kind="task", data={"workflow": "personal"})
    task, result = attach(send, task)
    path = PREFIX + f"/tasks/{task['id']}/results/{result}/note-reference"
    payload = {
        "operation_id": str(uuid4()),
        "expected_revision": task["revision"],
        "publication_operation_id": str(uuid4()),
        "note": note_reference("a"),
    }
    principal = configuration["principals"][0]
    principal["scopes"].remove("results:attach")
    assert send("POST", path, payload).status_code == 403
    principal["scopes"].append("results:attach")
    original_scope = principal["projectIds"]
    principal["projectIds"] = []
    assert send("POST", path, payload).status_code == 404
    principal["projectIds"] = original_scope
    configuration["principals"].append(
        {
            **principal,
            "id": "other-principal",
            "kid": "other-key",
        }
    )
    claims = {2: "other-key", 9: "other-principal"}
    assert send("POST", path, payload, claims=claims).status_code == 409
    assert (
        send(
            "GET", PREFIX + f"/operations/{result}", claims=claims
        ).status_code
        == 404
    )
    current = send("GET", PREFIX + f"/tasks/{task['id']}").json()
    assert current == task
    assert send("POST", path, payload).status_code == 200
