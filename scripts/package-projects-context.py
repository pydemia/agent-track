"""Package a Projects layer from a verified isolated baseline, never its live checkout."""

import argparse
import hashlib
import json
import shutil
import subprocess
import tarfile
from pathlib import Path


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def web_inputs(source: Path) -> dict[str, str]:
    web = source / "web"
    paths = [
        path
        for directory in ["src", "public", "scripts"]
        for path in (web / directory).rglob("*")
        if path.is_file()
    ]
    paths += [path for path in web.iterdir() if path.is_file()]
    return {
        path.relative_to(web).as_posix(): sha(path.read_bytes())
        for path in sorted(paths)
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source, output = args.source.resolve(), args.output.resolve()
    assert source == root / ".runtime/projects-context/source"
    assert (
        output.parent == root / ".runtime/projects-context"
        and not output.exists()
    )
    integration = root / "integrations/projects"
    provenance = json.loads((integration / "provenance.json").read_text())
    baseline = json.loads(
        (root / ".runtime/projects-context/baseline.json").read_text()
    )
    assert baseline["baseImage"] == provenance["baseImage"]
    for name, expected in provenance["baseFiles"].items():
        data = subprocess.check_output(
            ["git", "-C", str(source), "show", "HEAD:" + name]
        )
        assert sha(data) == expected
    patch = subprocess.check_output(
        [
            "git",
            "-C",
            str(source),
            "diff",
            "HEAD",
            "--binary",
            "--unified=0",
            "--",
            *provenance["baseFiles"],
        ]
    )
    assert patch == (integration / "native.patch").read_bytes(), (
        "Native patch changed"
    )
    changed = (
        subprocess.check_output(
            ["git", "-C", str(source), "diff", "HEAD", "--name-only"]
        )
        .decode()
        .splitlines()
    )
    assert set(changed) == set(provenance["baseFiles"]), (
        "Unexpected baseline source changes"
    )
    for path in integration.rglob("*"):
        if path.is_file() and path.parts[-1] not in {
            "provenance.json",
            "native.patch",
            "README.md",
        }:
            name = path.relative_to(integration)
            assert (source / name).read_bytes() == path.read_bytes(), str(name)
    shared = {
        "packages/context/ExecutionSummary.tsx": "web/src/agent-track-shared/context/ExecutionSummary.tsx",
        "packages/context/contracts.ts": "web/src/agent-track-shared/context/contracts.ts",
        "packages/contracts/index.ts": "web/src/agent-track-shared/contracts/index.ts",
    }
    for upstream, native in shared.items():
        text = (root / upstream).read_text(encoding="utf-8")
        if upstream.endswith("ExecutionSummary.tsx"):
            text = text.replace(
                'import React, { type ReactElement } from "react";',
                'import type { ReactElement } from "react";',
            )
        text = text.replace('"./contracts.ts"', '"./contracts"').replace(
            '"../contracts/index.ts"', '"../contracts/index"'
        )
        assert (source / native).read_text(encoding="utf-8") == text, native
    bundle = root / ".runtime/context-client/client.mjs"
    assert (
        source / "track-context/client.mjs"
    ).read_bytes() == bundle.read_bytes()
    # Never trust an existing dist directory. Bind a successful standard build to
    # the exact inputs and reject source or output changes during packaging.
    before_inputs = web_inputs(source)
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    assert npm
    subprocess.run(
        [npm, "--prefix", str(source / "web"), "run", "build"], check=True
    )
    assert web_inputs(source) == before_inputs, (
        "Frontend source changed during build"
    )
    payload = [
        source / "src/projects/api.py",
        source / "src/projects/track_context.py",
        source / "track-context/bridge.mjs",
        source / "track-context/client.mjs",
    ]
    payload += sorted(
        path for path in (source / "web/dist").rglob("*") if path.is_file()
    )
    assert len(payload) > 10
    files = {
        str(path.relative_to(source)).replace("\\", "/"): sha(
            path.read_bytes()
        )
        for path in payload
    }
    tag = sha(
        json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
    )[:16]
    output.mkdir(mode=0o700)
    with tarfile.open(output / "payload.tar.gz", "w:gz") as archive:
        for path in payload:
            archive.add(
                path,
                arcname=str(path.relative_to(source)).replace("\\", "/"),
                recursive=False,
            )
    assert web_inputs(source) == before_inputs
    assert all(
        sha((source / name).read_bytes()) == value
        for name, value in files.items()
    ), "Payload changed during packaging"
    meta = {
        "version": 1,
        "baseImage": provenance["baseImage"],
        "baseSource": provenance["baseSource"],
        "trackRevision": provenance["trackRevision"],
        "image": "pydemia-projects:track-context-" + tag,
        "payloadFiles": files,
        "payloadSha256": sha((output / "payload.tar.gz").read_bytes()),
        "webBuildInputs": before_inputs,
        "webBuildCommand": "npm --prefix web run build",
    }
    (output / "release.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(
        json.dumps(
            {
                "image": meta["image"],
                "files": len(files),
                "payloadSha256": meta["payloadSha256"],
            }
        )
    )


if __name__ == "__main__":
    main()
