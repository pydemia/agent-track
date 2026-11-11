"""Deployment failure regression tests; no Docker or native configuration used."""

import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "dependency_layer_policy",
    Path(__file__).resolve().parents[1] / "deploy/projects/dependency_layer_policy.py",
)
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def container(image="base", **changes):
    return {
        "Image": image,
        "Mounts": [],
        "Config": {
            "Env": ["MODE=original"],
            "Cmd": ["serve"],
            "User": "1000:1000",
            "Entrypoint": None,
            **changes,
        },
    }


class DeploymentPolicy(unittest.TestCase):
    def test_absent_replacement_still_restores_the_captured_application(self):
        live = None
        calls = []

        def run(args):
            nonlocal live
            calls.append(args)
            if args[1] == "ps":
                return b"" if live is None else b"owned-id\n"
            if args[1] == "inspect":
                return json.dumps([live]).encode()
            self.assertEqual(
                args[:6],
                ["docker", "compose", "-p", "projects", "-f", "/private/frozen.json"],
            )
            live = container()
            return b""

        restored = policy.restore_captured(
            run,
            ["docker", "compose", "-p", "projects", "-f", "/private/frozen.json"],
            container(),
            "base",
            "new",
            {"MODE": "original"},
        )
        self.assertEqual(restored["Image"], "base")
        self.assertTrue(any("up" in args for args in calls))

    def test_original_compose_mutation_does_not_change_captured_rollback(self):
        original = {
            "services": {
                "app": {
                    "image": "old-tag",
                    "environment": {"MODE": "original"},
                    "command": ["serve"],
                    "build": ".",
                }
            }
        }
        frozen = policy.frozen_rollback(original, "base")
        original["services"]["app"]["environment"]["MODE"] = "changed"
        original["services"]["app"]["command"] = ["foreign"]
        self.assertEqual(frozen["services"]["app"]["environment"], {"MODE": "original"})
        self.assertEqual(frozen["services"]["app"]["command"], ["serve"])
        self.assertNotIn("build", frozen["services"]["app"])
        self.assertEqual(frozen["services"]["app"]["image"], "base")

    def test_foreign_image_environment_command_user_or_entrypoint_is_preserved(self):
        for live in [
            container("foreign"),
            container("new", Env=["MODE=foreign"]),
            container("new", Cmd=["foreign"]),
            container("new", User="foreign"),
            container("new", Entrypoint=["foreign"]),
        ]:
            calls = []

            def run(args, current=live, observed=calls):
                observed.append(args)
                return b"foreign-id" if args[1] == "ps" else json.dumps([current]).encode()

            with self.assertRaises(AssertionError):
                policy.restore_captured(
                    run,
                    ["docker", "compose"],
                    container(),
                    "base",
                    "new",
                    {"MODE": "original"},
                )
            self.assertFalse(any("up" in args for args in calls))


if __name__ == "__main__":
    unittest.main()
