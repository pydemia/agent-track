"""Runtime-first results retain signed ACL, CAS and immutable URL identity."""

from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session
from test_assistant_integration import PREFIX

from projects.assistant_result import AssistantResult
from projects.note_references import list_note_refs

pytest_plugins = ["test_assistant_integration"]


def runtime_ref():
    instruction, run = str(uuid4()), str(uuid4())
    return {
        "service": "assistant",
        "run_id": run,
        "url": f"https://assistant.pydemia.ai/#workbench/projects/{instruction}/executions/{run}",
    }


@pytest.mark.parametrize(
    "change",
    [
        "missing",
        "other-run",
        "other-host",
        "query",
        "other-service",
        "bad-instruction",
    ],
)
def test_note_free_result_requires_canonical_assistant_execution(change):
    ref = runtime_ref()
    if change == "missing":
        del ref["url"]
    elif change == "other-run":
        ref["run_id"] = str(uuid4())
    elif change == "other-host":
        ref["url"] = ref["url"].replace("assistant.", "teams.")
    elif change == "query":
        ref["url"] += "?page=other"
    elif change == "other-service":
        ref["service"] = "teams"
    else:
        ref["url"] = ref["url"].replace("/projects/", "/projects/other-")
    with pytest.raises(ValidationError):
        AssistantResult.model_validate({"runtime": ref})


def test_runtime_link_before_note_uses_result_grant_and_keeps_operation(
    assistant,
    create_item,
    engine,
):
    send, config, account = assistant
    task = create_item(kind="task", data={"workflow": "personal"})
    path = PREFIX + f"/tasks/{task['id']}/results"
    assert send("GET", PREFIX + "/capabilities").json()["resultsBeforeNote"]
    runtime = runtime_ref()
    data = {
        "operation_id": str(uuid4()),
        "expected_revision": task["revision"],
        "runtime": runtime,
        "state": "in_review",
    }
    scopes = config["principals"][0]["scopes"]
    scopes.remove("results:attach")
    assert send("POST", path, data).status_code == 403
    scopes.append("results:attach")
    assert send("POST", path, {**data, "state": "done"}).status_code == 422
    response = send("POST", path, data)
    assert response.status_code == 200, response.text
    receipt = response.json()
    result = receipt["task"]["data"]
    assert result["assistant_result"] == {"runtime": runtime, "note": None}
    assert result["result_url"] == runtime["url"]
    assert result["state"] == "in_review"
    assert send("POST", path, data).json() == receipt
    assert (
        send("POST", path, {**data, "operation_id": str(uuid4())}).status_code
        == 409
    )
    assert (
        send("GET", PREFIX + "/operations/" + data["operation_id"]).json()
        == receipt
    )

    note = {
        "workspace_id": "ws-test",
        "page_id": "page-test",
        "url": "https://note.pydemia.ai/#/w/ws-test/page/page-test",
        "revision": "a" * 64,
        "content_hash": "b" * 64,
    }
    ref_path = path + "/" + data["operation_id"] + "/note-reference"
    ref_payload = {
        "operation_id": str(uuid4()),
        "expected_revision": receipt["task"]["revision"],
        "publication_operation_id": str(uuid4()),
        "note": note,
    }
    scopes.remove("results:attach")
    assert send("POST", ref_path, ref_payload).status_code == 403
    scopes.append("results:attach")
    assert (
        send(
            "POST", path + "/" + str(uuid4()) + "/note-reference", ref_payload
        ).status_code
        == 409
    )
    assert (
        send(
            "POST",
            ref_path,
            {**ref_payload, "expected_revision": task["revision"]},
        ).status_code
        == 409
    )
    linked = send("POST", ref_path, ref_payload)
    assert linked.status_code == 200, linked.text
    saved = linked.json()
    linked_task = saved["task"]["data"]
    assert linked_task["assistant_note_reference"] == {
        "note": note,
        "result_operation_id": data["operation_id"],
        "publication_operation_id": ref_payload["publication_operation_id"],
    }
    assert linked_task["assistant_result"] == result["assistant_result"]
    assert (
        linked_task["state"] == result["state"]
        and linked_task["result_url"] == result["result_url"]
    )
    assert send("POST", ref_path, ref_payload).json() == saved
    assert (
        send(
            "POST",
            ref_path,
            {**ref_payload, "publication_operation_id": str(uuid4())},
        ).status_code
        == 409
    )
    assert (
        send(
            "POST",
            ref_path,
            {
                **ref_payload,
                "operation_id": str(uuid4()),
                "expected_revision": saved["task"]["revision"],
            },
        ).status_code
        == 409
    )
    assert (
        send(
            "GET", PREFIX + "/operations/" + ref_payload["operation_id"]
        ).json()
        == saved
    )
    assert (
        send("GET", PREFIX + "/operations/" + data["operation_id"]).json()
        == receipt
    )
    with Session(engine) as db:
        direct = list_note_refs(db, account, task["id"])
        assert (
            len(direct) == 1
            and direct[0]["url"] == note["url"]
            and direct[0]["content_hash"] == note["content_hash"]
        )
    scopes.remove("results:attach")
    assert (
        send(
            "GET", PREFIX + "/operations/" + ref_payload["operation_id"]
        ).status_code
        == 403
    )
