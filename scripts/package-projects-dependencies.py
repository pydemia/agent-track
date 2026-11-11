"""Freeze only the reviewed native dependency reader against the installed base."""

import argparse
import hashlib
import json
import subprocess
import tarfile
import tempfile
from pathlib import Path


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    runtime = root / ".runtime/projects-dependencies"
    source = runtime / "source"
    integration = root / "integrations/projects-dependencies"
    output = args.output.resolve()
    assert output.parent == runtime and not output.exists()
    baseline = json.loads((runtime / "baseline.json").read_text())
    provenance = json.loads((integration / "provenance.json").read_text())
    assert baseline["baseImage"] == provenance["baseImage"]
    changed = "src/projects/assistant_integration.py"
    for name, expected in baseline["sourceFiles"].items():
        if name != changed:
            assert sha((source / name).read_bytes()) == expected, name
    for name in provenance["baseFiles"]:
        assert baseline["sourceFiles"][name] == provenance["baseFiles"][name]
    for name in [
        "src/projects/task_dependencies.py",
        "tests/test_task_dependencies.py",
    ]:
        assert (source / name).read_bytes() == (integration / name).read_bytes()
    # Apply the published patch to an owned temporary baseline, then compare the
    # exact result to the independently tested source. No live checkout is used.
    with tempfile.TemporaryDirectory(prefix="patch-", dir=runtime) as temporary:
        temp = Path(temporary).resolve()
        assert temp.parent == runtime.resolve()
        target = temp / changed
        target.parent.mkdir(parents=True)
        original = root / ".runtime/projects-context/source" / changed
        target.write_bytes(original.read_bytes())
        assert sha(target.read_bytes()) == provenance["baseFiles"][changed]
        subprocess.run(["git", "init", "--quiet", str(temp)], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(temp),
                "apply",
                "--unidiff-zero",
                str(integration / "native.patch"),
            ],
            check=True,
        )
        assert target.read_bytes() == (source / changed).read_bytes()
    names = [changed, "src/projects/task_dependencies.py"]
    payload_files = {name: sha((source / name).read_bytes()) for name in names}
    output.mkdir()
    payload = output / "payload.tar.gz"
    with tarfile.open(payload, "w:gz") as archive:
        for name in names:
            path = source / name
            assert path.is_file() and not path.is_symlink()
            archive.add(path, arcname=name, recursive=False)
    assert {name: sha((source / name).read_bytes()) for name in names} == payload_files
    digest = sha(payload.read_bytes())
    manifest = {
        "version": 1,
        "baseImage": provenance["baseImage"],
        "baseFiles": provenance["baseFiles"],
        "payloadFiles": payload_files,
        "payloadSha256": digest,
        "image": "pydemia-projects:task-dependencies-" + digest[:16],
        "nativeSchemaMigration": False,
        "newPrincipalsOrScopes": False,
    }
    (output / "release.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(
        json.dumps(
            {
                "packaged": True,
                "files": len(payload_files),
                "payloadSha256": digest,
                "image": manifest["image"],
            }
        )
    )


if __name__ == "__main__":
    main()
