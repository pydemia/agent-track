"""Captured rollback configuration and ownership checks for the two-file layer."""

import copy
import json


def frozen_rollback(config, base):
    captured = copy.deepcopy(config)
    captured["services"]["app"].pop("build", None)
    captured["services"]["app"]["image"] = base
    return captured


def mounts(info):
    return sorted(
        (item["Source"], item["Destination"], item["RW"]) for item in info["Mounts"]
    )


def named_app(run):
    # A successful daemon query distinguishes absent container from daemon error.
    identifiers = (
        run(
            [
                "docker",
                "ps",
                "-aq",
                "--no-trunc",
                "--filter",
                "name=^/pydemia-projects-app-1$",
            ]
        )
        .decode()
        .split()
    )
    if not identifiers:
        return None
    assert len(identifiers) == 1
    return json.loads(run(["docker", "inspect", identifiers[0]]))[0]


def restore_captured(run, compose, before, base, replacement, environment):
    live = named_app(run)
    if live is not None:
        assert live["Image"] in {base, replacement}
        assert mounts(live) == mounts(before)
        assert (
            dict(value.split("=", 1) for value in live["Config"]["Env"]) == environment
        )
        for key in ["Cmd", "User", "Entrypoint"]:
            assert live["Config"][key] == before["Config"][key]
    # Absence after an owned failed recreation permits restoring the captured app.
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
    restored = named_app(run)
    assert restored is not None and restored["Image"] == base
    assert mounts(restored) == mounts(before)
    assert (
        dict(value.split("=", 1) for value in restored["Config"]["Env"]) == environment
    )
    for key in ["Cmd", "User", "Entrypoint"]:
        assert restored["Config"][key] == before["Config"][key]
    return restored
