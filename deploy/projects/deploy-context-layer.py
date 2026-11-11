"""Deploy the verified optional context layer while preserving native configuration."""

import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import tarfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

RELEASES = Path("/home/pydemia/.local/share/projects-releases")
CURRENT = (
    RELEASES / "20261109-task-status-b313610cb90a73bc/runtime.compose.json"
)
BASE = (
    "sha256:2279f9eec447e0924f79eb282bd340c02a935266dd19d7aab2269b8d7470a7d3"
)
STAGE = "preflight"


def run(args, **kwargs):
    return subprocess.run(
        args, check=True, capture_output=True, **kwargs
    ).stdout


def js(args):
    return json.loads(run(args))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def escape(value):
    if isinstance(value, str):
        return value.replace("$", "$$")
    if isinstance(value, list):
        return [escape(item) for item in value]
    if isinstance(value, dict):
        return {key: escape(item) for key, item in value.items()}
    return value


def mounts(info):
    return sorted(
        (item["Source"], item["Destination"], item["RW"])
        for item in info["Mounts"]
    )


def main():
    global STAGE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    assert args.execute
    os.umask(0o077)
    release = args.release.resolve()
    assert (
        release.parent == RELEASES
        and release != CURRENT.parent
        and not args.release.is_symlink()
    )
    assert not (release / "result.json").exists()
    release.chmod(0o700)
    meta = json.loads((release / "release.json").read_text())
    assert meta["version"] == 1 and meta["baseImage"] == BASE
    assert meta["image"].startswith("pydemia-projects:track-context-")
    assert (
        sha((release / "payload.tar.gz").read_bytes()) == meta["payloadSha256"]
    )
    context = release / "layer"
    context.mkdir(mode=0o700)
    with tarfile.open(release / "payload.tar.gz") as archive:
        members = archive.getmembers()
        assert {member.name for member in members} == set(
            meta["payloadFiles"]
        ) and len(members) == len(meta["payloadFiles"])
        for member in members:
            name = PurePosixPath(member.name)
            assert (
                member.isfile()
                and not name.is_absolute()
                and ".." not in name.parts
                and "\\" not in member.name
            )
            assert member.name in {
                "src/projects/api.py",
                "src/projects/track_context.py",
                "track-context/bridge.mjs",
                "track-context/client.mjs",
            } or member.name.startswith("web/dist/")
            data = archive.extractfile(member).read()
            assert sha(data) == meta["payloadFiles"][member.name]
            target = context / member.name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o644)
    for path in context.rglob("*"):
        if path.is_dir():
            path.chmod(0o755)
    info = js(["docker", "inspect", "pydemia-projects-app-1"])[0]
    assert info["Image"] == BASE and info["Config"]["User"] == "1000:1000"
    project = info["Config"]["Labels"]["com.docker.compose.project"]
    assert project == "pydemia-projects" and not any(
        "migrate" in part for part in info["Config"]["Cmd"]
    )
    original = ["docker", "compose", "-p", project, "-f", str(CURRENT)]
    config = js(original + ["config", "--format", "json"])
    app = config["services"]["app"]
    actual_env = dict(value.split("=", 1) for value in info["Config"]["Env"])
    assert app["environment"] == actual_env
    assert sorted(
        (row["source"], row["target"], not row.get("read_only", False))
        for row in app["volumes"]
    ) == mounts(info)
    assert (
        app["command"] == info["Config"]["Cmd"]
        and app["user"] == info["Config"]["User"]
    )
    assert "PROJECTS_TRACK_CONTEXT_FILE" not in actual_env
    assert (
        run(
            ["docker", "image", "inspect", app["image"], "--format", "{{.Id}}"]
        )
        .decode()
        .strip()
        == BASE
    )
    untouched = {
        name: run(original + ["ps", "-q", name]).decode().strip()
        for name in ["db", "edge", "oauth2-proxy"]
    }
    assert all(untouched.values())
    spec = importlib.util.spec_from_file_location(
        "native_verify", CURRENT.parent / "verify-story-release.py"
    )
    verify = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verify)
    private_hashes = {}
    for row in info["Mounts"]:
        if row["RW"]:
            continue
        source = Path(row["Source"])
        for path in [source] if source.is_file() else source.rglob("*"):
            assert not path.is_symlink()
            if path.is_file():
                private_hashes[str(path)] = sha(path.read_bytes())
    backup = release / (
        "backup-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    )
    backup.mkdir(mode=0o700)
    (backup / "container.json").write_text(json.dumps(info))
    (backup / "runtime-before.compose.json").write_bytes(CURRENT.read_bytes())
    db_info = js(["docker", "inspect", untouched["db"]])[0]
    db_env = dict(value.split("=", 1) for value in db_info["Config"]["Env"])
    STAGE = "private online backup and image build"
    with (backup / "projects.dump").open("wb") as stream:
        subprocess.run(
            [
                "docker",
                "exec",
                untouched["db"],
                "pg_dump",
                "-U",
                db_env["POSTGRES_USER"],
                "-d",
                db_env["POSTGRES_DB"],
                "-Fc",
            ],
            check=True,
            stdout=stream,
            stderr=subprocess.PIPE,
        )
    with (backup / "projects.dump").open("rb") as stream:
        run(
            ["docker", "exec", "-i", untouched["db"], "pg_restore", "--list"],
            stdin=stream,
        )
    sources = sorted(
        {row["Source"] for row in info["Mounts"] if row["Type"] == "bind"}
    )
    with tarfile.open(backup / "private-mounts.tar.gz", "w:gz") as archive:

        def exclude_socket(member):
            return member if member.isfile() or member.isdir() else None

        for index, source in enumerate(sources):
            archive.add(
                source, arcname=f"mount-{index}", filter=exclude_socket
            )
    (backup / "mount-paths.json").write_text(json.dumps(sources))
    (context / "Dockerfile").write_text(
        f'FROM {BASE}\nLABEL ai.pydemia.agent-track.context="{meta["payloadSha256"]}"\nCOPY src/ /app/src/\nCOPY track-context/ /app/track-context/\nCOPY web/dist/ /app/web/dist/\n'
    )
    run(
        [
            "docker",
            "build",
            "--pull=false",
            "--network=none",
            "-t",
            meta["image"],
            str(context),
        ]
    )
    before_snapshot = verify.app_python(original, verify.SNAPSHOT)
    assert before_snapshot["schema"] == "0016"
    (backup / "before.json").write_text(json.dumps(before_snapshot))
    app.pop("build", None)
    app["image"] = meta["image"]
    expected_env = {
        **actual_env,
        "PROJECTS_TRACK_CONTEXT_FILE": "/run/secrets/projects-assistant/track-context.json",
    }
    app["environment"] = expected_env
    runtime = release / "runtime.compose.json"
    runtime.write_text(json.dumps(escape(config)))
    compose = ["docker", "compose", "-p", project, "-f", str(runtime)]
    assert (
        js(compose + ["config", "--format", "json"])["services"]["app"][
            "environment"
        ]
        == expected_env
    )
    changed, complete = False, False
    try:
        STAGE = "recreate application only"
        live = js(["docker", "inspect", "pydemia-projects-app-1"])[0]
        assert live["Id"] == info["Id"] and live["Image"] == BASE, (
            "Native release changed during preparation"
        )
        assert (
            dict(value.split("=", 1) for value in live["Config"]["Env"])
            == actual_env
        )
        assert mounts(live) == mounts(info)
        assert all(
            sha(Path(name).read_bytes()) == value
            for name, value in private_hashes.items()
        )
        changed = True
        run(
            compose
            + [
                "up",
                "-d",
                "--no-build",
                "--no-deps",
                "--wait",
                "--wait-timeout",
                "120",
                "app",
            ]
        )
        after = js(["docker", "inspect", "pydemia-projects-app-1"])[0]
        assert mounts(after) == mounts(info)
        assert (
            dict(value.split("=", 1) for value in after["Config"]["Env"])
            == expected_env
        )
        for key in ["Cmd", "User", "Entrypoint"]:
            assert after["Config"][key] == info["Config"][key]
        assert all(
            run(compose + ["ps", "-q", name]).decode().strip() == value
            for name, value in untouched.items()
        )
        assert all(
            sha(Path(name).read_bytes()) == value
            for name, value in private_hashes.items()
        )
        STAGE = "verify native API, payload and unchanged schema"
        script = "import json,hashlib\nfrom pathlib import Path\nfrom urllib.request import urlopen\nfrom urllib.error import HTTPError\n"
        script += (
            "for name,expected in "
            + repr(meta["payloadFiles"])
            + ".items():\n assert hashlib.sha256((Path('/app')/name).read_bytes()).hexdigest()==expected\n"
        )
        script += (
            "for name,expected in "
            + repr(meta["payloadFiles"])
            + ".items():\n"
            " if not name.startswith('web/dist/'): continue\n"
            " path='/' + name.removeprefix('web/dist/')\n"
            " if path=='/index.html': path='/'\n"
            " with urlopen('http://127.0.0.1:8000'+path,timeout=10) as response:\n"
            "  assert hashlib.sha256(response.read()).hexdigest()==expected\n"
            "  mime=response.headers.get('Content-Type','').split(';')[0]\n"
            "  allowed={'.js':{'text/javascript','application/javascript'},'.css':{'text/css'},'.svg':{'image/svg+xml'},'.png':{'image/png'},'.ico':{'image/x-icon','image/vnd.microsoft.icon'},'.html':{'text/html'}}\n"
            "  if Path(name).suffix in allowed: assert mime in allowed[Path(name).suffix]\n"
        )
        script += "with urlopen('http://127.0.0.1:8000/openapi.json') as response: paths=json.load(response)['paths']\n"
        script += "assert '/api/projects/{project_id}/agent-track' in paths and '/api/projects/{project_id}/tasks/{task_id}/agent-track' in paths\n"
        script += "try:\n urlopen('http://127.0.0.1:8000/api/projects/7b0bc73a-8a1f-4111-9d7f-cc85efad3fea/agent-track')\n raise AssertionError('Anonymous context allowed')\nexcept HTTPError as error: assert error.code==401\nprint(json.dumps({'payloadMatched':True,'nativeAnonymousDenied':True}))"
        checked = verify.app_python(compose, script)
        after_snapshot = verify.app_python(compose, verify.SNAPSHOT)
        assert after_snapshot["schema"] == "0016"
        (backup / "after.json").write_text(json.dumps(after_snapshot))
        result = {
            "image": meta["image"],
            "imageId": after["Image"],
            "baseImage": BASE,
            "payloadSha256": meta["payloadSha256"],
            "schema": "0016",
            "businessSnapshotUnchanged": after_snapshot == before_snapshot,
            "mountsCommandUserPreserved": True,
            "onlyContextConfigEnvironmentAdded": True,
            "ingressAndDatabaseIdsPreserved": True,
            "privateMountsUnchanged": True,
            "backupValidated": True,
            "nativeUIVerification": "pending",
            **checked,
        }
        (release / "result.json").write_text(json.dumps(result, indent=2))
        complete = True
        print(json.dumps(result))
    finally:
        if changed and not complete:
            STAGE = "restore exact previous application"
            run(
                original
                + [
                    "up",
                    "-d",
                    "--no-build",
                    "--no-deps",
                    "--wait",
                    "--wait-timeout",
                    "120",
                    "app",
                ]
            )
            restored = js(["docker", "inspect", "pydemia-projects-app-1"])[0]
            assert restored["Image"] == BASE and mounts(restored) == mounts(
                info
            )
            (release / "rollback.json").write_text(
                json.dumps(
                    {
                        "previousApplicationRestored": True,
                        "databaseRestoredOrDowngraded": False,
                    }
                )
            )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            json.dumps(
                {
                    "deployment": "failed",
                    "stage": STAGE,
                    "errorType": type(error).__name__,
                }
            )
        )
        raise SystemExit(1) from None
