"""Inspect the owned private socket; remove only a confirmed stale socket."""

import argparse
import errno
import json
import os
import socket
import stat
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("prepare", "probe"))
    args = parser.parse_args()
    parent = Path("/home/pydemia/git/projects/state").resolve()
    root = parent / ".agent-track"
    marker = root / "purpose"
    if args.action == "prepare":
        if root.exists():
            assert root.resolve() == root and marker.read_text() == (
                "agent-track-projects-context-v1\n"
            )
        else:
            root.mkdir(mode=0o700)
            marker.write_text("agent-track-projects-context-v1\n")
    if not root.exists():
        print(json.dumps({"socketState": "absent"}))
        return
    assert root.resolve() == root and root.parent == parent
    assert marker.read_text() == "agent-track-projects-context-v1\n"
    path = root / "context.sock"
    assert len(os.fsencode(path)) < 104
    if not path.exists():
        print(json.dumps({"socketState": "absent"}))
        return
    info = path.lstat()
    assert stat.S_ISSOCK(info.st_mode) and info.st_uid == os.getuid()
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(1)
        try:
            client.connect(str(path))
        except OSError as error:
            if error.errno != errno.ECONNREFUSED:
                raise
            if args.action == "prepare":
                # The resolved parent, marker, inode type, owner and failed live
                # connection are checked before removing this exact socket only.
                assert path.parent.resolve() == root
                path.unlink()
                print(json.dumps({"socketState": "stale-removed"}))
            else:
                print(json.dumps({"socketState": "stale"}))
            return
    print(json.dumps({"socketState": "active"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit(
            f"Private context socket check stopped ({type(error).__name__})"
        ) from None
