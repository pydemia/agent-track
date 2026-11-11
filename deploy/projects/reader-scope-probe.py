"""Restrict and restore only the dedicated Track reader for a scope probe."""

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path
from uuid import UUID


def atomic_json(path: Path, value: dict) -> None:
    descriptor, temporary = tempfile.mkstemp(
        prefix=".track-scope-", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("restrict", "restore"))
    parser.add_argument("operation")
    parser.add_argument("--project")
    args = parser.parse_args()
    if str(UUID(args.operation)) != args.operation:
        raise ValueError("Canonical operation ID required")
    container = json.loads(
        subprocess.check_output(
            ["docker", "inspect", "pydemia-projects-app-1"],
            text=True,
        )
    )[0]
    environment = dict(
        row.split("=", 1) for row in container["Config"]["Env"] if "=" in row
    )
    native = Path(environment["PROJECTS_ASSISTANT_INTEGRATION_FILE"])
    mounts = [
        mount
        for mount in container["Mounts"]
        if Path(mount["Destination"]) == native.parent
    ]
    if len(mounts) != 1:
        raise ValueError("Expected the known directory mount")
    config_path = Path(mounts[0]["Source"]).resolve() / native.name
    checkpoint = config_path.parent / "agent-track-reader-scope-probe.json"
    current = json.loads(config_path.read_text())
    readers = [
        row
        for row in current["principals"]
        if row["id"] == "agent-track-reader-pydemia"
    ]
    if len(readers) != 1:
        raise ValueError("Dedicated reader unavailable")
    reader = readers[0]
    if reader["scopes"] != ["projects:read", "tasks:read"]:
        raise ValueError("Expected a read-only principal")
    if args.action == "restrict":
        if not args.project or str(UUID(args.project)) != args.project:
            raise ValueError("Canonical Project ID required")
        if checkpoint.exists():
            raise ValueError(
                "An unresolved scope probe exists; restore it first"
            )
        if args.project not in reader["projectIds"]:
            raise ValueError("Project is outside the original reader scope")
        state = {
            "operation": args.operation,
            "project": args.project,
            "original": reader,
        }
        descriptor = os.open(
            checkpoint, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
        )
        with os.fdopen(descriptor, "w") as stream:
            json.dump(state, stream)
            stream.flush()
            os.fsync(stream.fileno())
        replacement = {
            **reader,
            "projectIds": [
                value
                for value in reader["projectIds"]
                if value != args.project
            ],
        }
    else:
        if not checkpoint.exists():
            print(json.dumps({"restored": True, "alreadyRestored": True}))
            return
        state = json.loads(checkpoint.read_text())
        if state["operation"] != args.operation:
            raise ValueError("Scope probe belongs to another operation")
        original = state["original"]
        restricted = {
            **original,
            "projectIds": [
                value
                for value in original["projectIds"]
                if value != state["project"]
            ],
        }
        if reader != restricted and reader != original:
            raise ValueError(
                "Reader changed independently; preserved without overwrite"
            )
        replacement = original
    updated = {
        **current,
        "principals": [
            replacement if row["id"] == reader["id"] else row
            for row in current["principals"]
        ],
    }
    if json.loads(config_path.read_text()) != current:
        raise ValueError("Concurrent configuration update; preserved")
    atomic_json(config_path, updated)
    if args.action == "restore":
        checkpoint.unlink()
    print(
        json.dumps(
            {
                "action": args.action,
                "projectCount": len(replacement["projectIds"]),
                "otherPrincipalsPreserved": all(
                    row in updated["principals"]
                    for row in current["principals"]
                    if row["id"] != reader["id"]
                ),
                "sourceDataWrites": False,
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - CLI boundary must suppress secret-bearing errors.
        raise SystemExit(
            f"Reader scope probe stopped ({type(error).__name__}); "
            "private values omitted"
        ) from None
