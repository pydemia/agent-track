"""Package pinned result-contract changes against operating Projects modules."""

import argparse
import hashlib
import json
import subprocess
import tarfile
import tempfile
from pathlib import Path


def sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--variant", choices=["candidate", "compatibility"], required=True
    )
    parser.add_argument("--baseline", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    runtime = (root / ".runtime/projects-results").resolve()
    assert runtime.is_relative_to(root)
    runtime.mkdir(exist_ok=True)
    output = args.output.resolve()
    assert output.parent == runtime and not output.exists()
    baseline = args.baseline or (
        root
        / ".runtime/source-availability/projects-result-contract-candidate"
        / "operating-modules"
    )
    integration = root / "integrations/projects-results"
    provenance = json.loads((integration / "provenance.json").read_text())
    variant = provenance["variants"][args.variant]
    patch = integration / variant["patch"]
    assert sha(patch.read_bytes()) == variant["patchSha256"]
    for name, expected in provenance["retainedFiles"].items():
        assert sha((baseline / Path(name).name).read_bytes()) == expected, name
    with tempfile.TemporaryDirectory(
        prefix="patch-", dir=runtime
    ) as temporary:
        working = Path(temporary).resolve()
        assert working.parent == runtime
        for name, expected in provenance["baseFiles"].items():
            source = baseline / Path(name).name
            assert source.is_file() and not source.is_symlink()
            data = source.read_bytes()
            assert sha(data) == expected, name
            target = working / name
            assert target.is_relative_to(working)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        subprocess.run(["git", "init", "--quiet", str(working)], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(working),
                "apply",
                "--unidiff-zero",
                "--check",
                str(patch),
            ],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(working), "apply", "--unidiff-zero", str(patch)],
            check=True,
        )
        for name, expected in variant["payloadFiles"].items():
            assert sha((working / name).read_bytes()) == expected, name
        output.mkdir()
        payload = output / "payload.tar.gz"
        with tarfile.open(payload, "w:gz") as archive:
            for name in sorted(variant["payloadFiles"]):
                source = working / name
                assert source.is_file() and not source.is_symlink()
                archive.add(source, arcname=name, recursive=False)
    digest = sha(payload.read_bytes())
    manifest = {
        "version": 1,
        "variant": args.variant,
        "baseImage": provenance["baseImage"],
        "baseFiles": provenance["baseFiles"],
        "retainedFiles": provenance["retainedFiles"],
        "payloadFiles": variant["payloadFiles"],
        "payloadSha256": digest,
        "image": f"pydemia-projects:results-{args.variant}-{digest[:16]}",
        "nativeSchemaMigration": False,
        "newPrincipalsOrScopes": False,
        "productionDeployed": False,
    }
    (output / "release.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf8", newline="\n"
    )
    print(json.dumps({"variant": args.variant, "files": 4, "sha256": digest}))


if __name__ == "__main__":
    main()
