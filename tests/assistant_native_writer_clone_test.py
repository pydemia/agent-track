"""Synthetic writer clone checks; no Docker, credential or filesystem writes."""

from copy import deepcopy
import unittest

from assistant_native_clone_test import fixture, inspection, native


DEST = "/run/secrets/agent-track-writer"
ENV_KEY = "PERSONA_TRACK_COMMAND_CONFIG_FILE"
ENV_ENTRY = ENV_KEY + "=" + DEST + "/grant.json"


class WriterCloneTest(unittest.TestCase):
    def setUp(self):
        current, plan, credentials = fixture()
        self.current = inspection(current, plan, credentials)
        self.current["Config"]["Env"].append(
            "PERSONA_PROJECTS_READ_TRANSPORT_ORIGIN=http://172.25.0.1:14325"
        )
        self.candidate = plan["candidate"]
        self.addon = {
            "volumeName": "track-writer-test",
            "volumeMountpoint": "/volumes/track-writer-test/_data",
        }
        self.actual = deepcopy(self.current)
        self.actual["Config"]["Env"].append(ENV_ENTRY)
        self.actual["HostConfig"]["Mounts"].append({
            "Type": "volume", "Source": "track-writer-test",
            "Target": DEST, "ReadOnly": True,
            "VolumeOptions": {"NoCopy": True},
        })
        self.actual["Mounts"].append({
            "Type": "volume", "Name": "track-writer-test",
            "Source": "/volumes/track-writer-test/_data",
            "Destination": DEST, "Driver": "local", "Mode": "z",
            "RW": False, "Propagation": "",
        })

    def reject(self, function, *args):
        with self.assertRaises(native.CloneError) as caught:
            function(*args)
        self.assertEqual(str(caught.exception),
                         "Native clone validation failed.")
        self.assertIsNone(caught.exception.__cause__)

    def test_exact_env_and_readonly_volume_delta_without_source_change(self):
        before = deepcopy((self.current, self.candidate, self.addon))
        request = native.writer_clone_request(
            self.current, self.candidate, self.addon,
        )
        config = deepcopy(self.actual["Config"])
        config["HostConfig"] = self.actual["HostConfig"]
        # The existing image constructor already specifies the network shape.
        config["NetworkingConfig"] = native.image_clone_request(
            self.current, self.candidate,
        )["NetworkingConfig"]
        self.assertEqual(request, config)
        native.verify_writer_clone(
            self.actual, self.current, self.candidate, self.addon,
        )
        request["Env"].clear()
        self.assertEqual((self.current, self.candidate, self.addon), before)

    def test_refuses_preset_writer_even_when_value_matches(self):
        for entry in [ENV_ENTRY, ENV_KEY + "=", ENV_KEY + "=/other.json"]:
            current = deepcopy(self.current)
            current["Config"]["Env"].append(entry)
            self.reject(native.writer_clone_request, current,
                        self.candidate, self.addon)

    def test_refuses_image_or_source_stamp_change(self):
        for key, value in [("image", "sha256:" + "e" * 64),
                           ("sourceCommit", "e" * 40),
                           ("sourceArchiveSha256", "e" * 64),
                           ("sourceTree", "e" * 40)]:
            candidate = {**self.candidate, key: value}
            self.reject(native.writer_clone_request, self.current,
                        candidate, self.addon)

    def test_rejects_shadowing_in_all_mount_representations(self):
        for destination in [DEST, "/run/secrets", DEST + "/child"]:
            for location in ["actual", "mounts", "binds", "tmpfs", "volumes"]:
                with self.subTest(destination=destination, location=location):
                    current = deepcopy(self.current)
                    if location == "actual":
                        current["Mounts"].append({"Destination": destination})
                    elif location == "mounts":
                        current["HostConfig"]["Mounts"].append({
                            "Type": "bind", "Source": "/other",
                            "Target": destination,
                        })
                    elif location == "binds":
                        current["HostConfig"]["Binds"].append(
                            "/other:" + destination + ":ro"
                        )
                    elif location == "tmpfs":
                        current["HostConfig"]["Tmpfs"][destination] = "ro"
                    else:
                        current["Config"]["Volumes"][destination] = {}
                    self.reject(native.writer_clone_request, current,
                                self.candidate, self.addon)

    def test_rejects_reused_volume_name_or_source(self):
        for location in ["actual-name", "actual-source", "mount", "bind"]:
            current = deepcopy(self.current)
            if location == "actual-name":
                current["Mounts"][0]["Name"] = self.addon["volumeName"]
            elif location == "actual-source":
                current["Mounts"][0]["Source"] = self.addon["volumeMountpoint"]
            elif location == "mount":
                current["HostConfig"]["Mounts"].append({
                    "Source": self.addon["volumeName"], "Target": "/other",
                })
            else:
                current["HostConfig"]["Binds"].append(
                    self.addon["volumeName"] + ":/other:ro"
                )
            self.reject(native.writer_clone_request, current,
                        self.candidate, self.addon)

    def test_rejects_unrelated_or_writer_actual_drift(self):
        mutations = [
            lambda a: a["Config"]["Env"].append("UNRELATED=synthetic"),
            lambda a: a["Config"]["Env"].append(ENV_ENTRY),
            lambda a: a["Config"]["Env"].remove(ENV_ENTRY),
            lambda a: a["Config"]["Env"].__setitem__(-1, ENV_KEY + "=/other"),
            lambda a: a["Config"]["Labels"].update(custom="changed"),
            lambda a: a["HostConfig"].update(Privileged=True),
            lambda a: a["HostConfig"]["Mounts"][-1].update(ReadOnly=False),
            lambda a: a["HostConfig"]["Mounts"][-1].update(
                VolumeOptions={"NoCopy": False}
            ),
            lambda a: a["Mounts"][-1].update(RW=True),
            lambda a: a["Mounts"][-1].update(Mode="rw"),
            lambda a: a["Mounts"][-1].update(Name="other"),
            lambda a: a["Mounts"][-1].update(Source="/other"),
            lambda a: a["Mounts"][-1].update(Driver="other"),
            lambda a: a["Mounts"][0].update(Mode="changed"),
            lambda a: a["NetworkSettings"]["Networks"]["app"].update(
                Aliases=["changed"]
            ),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index):
                actual = deepcopy(self.actual)
                mutate(actual)
                self.reject(native.verify_writer_clone, actual,
                            self.current, self.candidate, self.addon)

    def test_null_host_mount_list_and_reordered_actual_mounts(self):
        current = deepcopy(self.current)
        current["HostConfig"]["Mounts"] = None
        actual = deepcopy(self.actual)
        actual["HostConfig"]["Mounts"] = [
            deepcopy(self.actual["HostConfig"]["Mounts"][-1])
        ]
        actual["Mounts"].reverse()
        actual["HostConfig"]["OomKillDisable"] = None
        request = native.writer_clone_request(
            current, self.candidate, self.addon,
        )
        self.assertEqual(len(request["HostConfig"]["Mounts"]), 1)
        native.verify_writer_clone(actual, current, self.candidate, self.addon)

    def test_invalid_or_unbounded_inputs_have_static_errors(self):
        for addon in [None, {}, {**self.addon, "extra": True},
                      {**self.addon, "volumeName": "../state"},
                      {**self.addon, "volumeMountpoint": "/path/../state"},
                      {**self.addon, "volumeMountpoint": "/bad\npath"}]:
            self.reject(native.writer_clone_request, self.current,
                        self.candidate, addon)
        for actual in [{"Config": object()},
                       {"Config": {"Env": [object()]}},
                       {"oversized": "x" * 1048577}]:
            self.reject(native.verify_writer_clone, actual,
                        self.current, self.candidate, self.addon)


if __name__ == "__main__":
    unittest.main()
