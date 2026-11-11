"""Build and freeze the isolated native Demian web with optional Track context."""

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hashes(paths, base: Path) -> dict[str, str]:
    return {
        path.relative_to(base).as_posix(): sha(path.read_bytes())
        for path in sorted(paths)
        if path.is_file()
    }


def inputs(source: Path) -> dict[str, str]:
    paths = []
    for name in ["apps/web/src", "apps/web/public", "packages/protocol/src", "nodejs/src"]:
        paths.extend((source / name).rglob("*"))
    paths.extend(source / name for name in ["package-lock.json", "package.json", "apps/web/package.json", "apps/web/tsconfig.json", "apps/web/next.config.ts", "packages/protocol/package.json"])
    return hashes(paths, source)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source = root / ".runtime/demian-context/source"
    output = args.output.resolve()
    assert output.parent == root / ".runtime/demian-context" and not output.exists()
    baseline = json.loads((root / ".runtime/demian-context/baseline.json").read_text())
    native = Path("C:/Users/pydemia/git/demian")
    assert (native / "apps/web/.next/BUILD_ID").read_text().strip() == baseline["nativeBuildId"]
    for name, expected in baseline["nativeStaticFiles"].items():
        assert sha((native / "apps/web/.next" / name).read_bytes()) == expected
    # Preserve every baseline source except the three deliberately patched files.
    changed = {"apps/web/src/components/ChatClient.tsx", "apps/web/package.json", "package-lock.json"}
    for name, expected in baseline["sourceFiles"].items():
        if name not in changed:
            assert sha((source / name).read_bytes()) == expected, name
    upstream = {
        "context/client.ts": "context/client.ts",
        "context/contracts.ts": "context/contracts.ts",
        "context/ExecutionSummary.tsx": "context/ExecutionSummary.tsx",
        "contracts/index.ts": "contracts/index.ts",
    }
    for original, target in upstream.items():
        text = (root / "packages" / original).read_text(encoding="utf-8")
        if original == "contracts/index.ts":
            text = text.replace("9223372036854775807n", 'BigInt("9223372036854775807")')
        assert (source / "apps/web/src/track-shared" / target).read_text(encoding="utf-8") == text
    before = inputs(source)
    allowed_new = {
        "apps/web/src/app/track-context/sessions/[sessionId]/route.ts",
        "apps/web/src/components/TrackContextPanel.tsx", "apps/web/src/components/track-context-panel.css",
        "apps/web/src/lib/track-context-client.ts", "apps/web/src/lib/track-context-server.ts",
        *("apps/web/src/track-shared/" + name for name in upstream.values()),
    }
    assert set(before) <= set(baseline["sourceFiles"]) | allowed_new, "Unexpected native source input"
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    assert npm
    subprocess.run([npm, "run", "build", "--workspace=@demian/web"], cwd=source, check=True)
    assert inputs(source) == before, "Source changed during native build"
    build = source / "apps/web/.next"
    standalone = build / "standalone"
    assert (standalone / "apps/web/server.js").is_file()
    all_standalone = list(standalone.rglob("*"))
    assert not any(path.is_symlink() for path in all_standalone)
    frozen_standalone = hashes(all_standalone, standalone)
    frozen_static = hashes((build / "static").rglob("*"), build / "static")
    frozen_public = hashes((source / "apps/web/public").rglob("*"), source / "apps/web/public")
    output.mkdir(mode=0o700)
    shutil.copytree(standalone, output, dirs_exist_ok=True)
    shutil.copytree(build / "static", output / "apps/web/.next/static", dirs_exist_ok=True)
    shutil.copytree(source / "apps/web/public", output / "apps/web/public", dirs_exist_ok=True)
    files = hashes(output.rglob("*"), output)
    expected = {**frozen_standalone, **{"apps/web/.next/static/" + name: value for name, value in frozen_static.items()}, **{"apps/web/public/" + name: value for name, value in frozen_public.items()}}
    assert files == expected, "Mixed native build output"
    assert hashes(standalone.rglob("*"), standalone) == frozen_standalone
    assert hashes((build / "static").rglob("*"), build / "static") == frozen_static
    assert hashes((source / "apps/web/public").rglob("*"), source / "apps/web/public") == frozen_public
    assert "apps/web/server.js" in files and len(files) < 10000
    assert inputs(source) == before, "Source changed during packaging"
    manifest = {
        "version": 1,
        "nativeBaseBuildId": baseline["nativeBuildId"],
        "webBuildId": (build / "BUILD_ID").read_text().strip(),
        "sourceInputs": before,
        "payloadFiles": files,
        "buildCommand": "npm run build --workspace=@demian/web",
        "sharedAdaptations": ['int64 MAX literal uses BigInt("9223372036854775807") under native ES2017 typecheck'],
    }
    data = (json.dumps(manifest, indent=2) + "\n").encode()
    (output / "release.json").write_bytes(data)
    print(json.dumps({"webBuildId": manifest["webBuildId"], "files": len(files), "manifestSha256": sha(data)}))


if __name__ == "__main__":
    main()
