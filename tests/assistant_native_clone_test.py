"""Pure synthetic inspection tests; never contact Docker or load secrets."""

import base64
from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

# Compile directly so even discovery does not create a module bytecode file.
source = Path(__file__).resolve().parents[1] / "deploy/assistant/native_clone.py"
spec = importlib.util.spec_from_loader("native_clone", loader=None)
native = importlib.util.module_from_spec(spec)
exec(compile(source.read_text(encoding="utf-8"), str(source), "exec"),
     native.__dict__)

DEST = "/run/secrets/agent-track-demian"
CONFIG = "PERSONA_DEMIAN_RUNTIME_CONFIG_FILE"
SIGNING = "PERSONA_DEMIAN_RUNTIME_SIGNING_KEY_AGENT_TRACK"
BEARER = "PERSONA_DEMIAN_RUNTIME_BEARER_AGENT_TRACK"


def encoded(size):
    return base64.urlsafe_b64encode(b"x" * size).decode().rstrip("=")


def fixture():
    destinations = ["/run/secrets/agent-track-reader", "/account", "/state",
                    "/sys/fs/cgroup", "/Work"] + [f"/data/{i}" for i in range(7)]
    mounts = [{"Type": "bind", "Source": f"/host/{i}",
               "Destination": destination, "Mode": "ro" if i == 0 else "rw",
               "RW": i != 0, "Propagation": "rprivate"}
              for i, destination in enumerate(destinations)]
    current = {
        "Image": "sha256:" + "0" * 64,
        "Config": {
            "Image": "old-image", "Env": ["PATH=/bin", "ROLE=assistant",
                "PERSONA_TRACK_READ_CONFIG_FILE=/run/secrets/agent-track-reader/reader.json"],
            "Labels": {"custom": "retained"}, "Volumes": {"/state": {}},
            "UnknownOrdinary": {"nested": [False, 7, None]},
        },
        "HostConfig": {
            "Binds": [f"{m['Source']}:{m['Destination']}:{m['Mode']}" for m in mounts],
            "Mounts": [], "OomKillDisable": False, "Privileged": False,
            "UnknownOrdinary": [1, {"kept": True}], "Tmpfs": {},
        },
        "Mounts": mounts,
        "NetworkSettings": {"Networks": {"app": {
            "IPAMConfig": None, "Aliases": ["assistant"], "Links": [],
            "DriverOpts": {"ordinary": "value"}, "GwPriority": 2,
            "IPAddress": "172.20.0.2", "EndpointID": "old-dynamic",
        }}},
    }
    plan = {"candidate": {"image": "sha256:" + "a" * 64,
            "sourceCommit": "b" * 40, "sourceArchiveSha256": "c" * 64,
            "sourceTree": "d" * 40},
            "runtimeAddon": {"volumeName": "native-runtime",
                "volumeMountpoint": "/var/lib/docker/volumes/native-runtime/_data"}}
    return current, plan, {SIGNING: encoded(32), BEARER: "synthetic-bearer"}


def inspection(current, plan, credentials):
    # Construct expected delta independently, rather than using clone_request.
    actual = deepcopy(current)
    config = actual["Config"]
    config["Image"] = actual["Image"] = plan["candidate"]["image"]
    config["Env"] += [CONFIG + "=" + DEST + "/config.json",
                      SIGNING + "=" + credentials[SIGNING],
                      BEARER + "=" + credentials[BEARER]]
    config["Labels"].update({
        "org.opencontainers.image.revision": "b" * 40,
        "com.pydemia.source.archive": "c" * 64,
        "com.pydemia.source.tree": "d" * 40,
        "io.pydemia.agent-track-reader.archive-sha256": "c" * 64,
        "io.pydemia.agent-track-reader.source-tree": "d" * 40,
    })
    actual["HostConfig"]["Mounts"].append({
        "Type": "volume", "Source": "native-runtime", "Target": DEST,
        "ReadOnly": True, "VolumeOptions": {"NoCopy": True},
    })
    actual["Mounts"].append({"Type": "volume", "Name": "native-runtime",
        "Source": plan["runtimeAddon"]["volumeMountpoint"], "Destination": DEST,
        "Driver": "local", "Mode": "", "RW": False, "Propagation": ""})
    return actual


class NativeCloneTest(unittest.TestCase):
    def setUp(self):
        self.current, self.plan, self.credentials = fixture()
        self.actual = inspection(self.current, self.plan, self.credentials)

    def reject(self, function, *args):
        with self.assertRaises(native.CloneError) as caught:
            function(*args)
        self.assertEqual(str(caught.exception), "Native clone validation failed.")
        self.assertIsNone(caught.exception.__cause__)

    def verify(self, actual):
        native.verify_clone(actual, self.current, self.plan, self.credentials)

    def test_exact_request_and_detached_inputs(self):
        before = deepcopy((self.current, self.plan, self.credentials))
        request = native.clone_request(self.current, self.plan, self.credentials)
        expected = deepcopy(self.actual["Config"])
        expected["HostConfig"] = self.actual["HostConfig"]
        expected["NetworkingConfig"] = {"EndpointsConfig": {"app": {
            "Aliases": ["assistant"], "Links": [],
            "DriverOpts": {"ordinary": "value"}, "GwPriority": 2}}}
        self.assertEqual(request, expected)
        self.verify(self.actual)
        self.assertEqual((self.current, self.plan, self.credentials), before)
        request["Env"].clear()
        request["HostConfig"]["Binds"].clear()
        self.assertEqual((self.current, self.plan, self.credentials), before)
        self.assertEqual(len(self.current["Mounts"]), 12)

    def test_mount_order_dynamic_network_and_only_oom_normalization(self):
        self.actual["Mounts"].reverse()
        endpoint = self.actual["NetworkSettings"]["Networks"]["app"]
        endpoint.update(IPAddress="172.20.0.9", EndpointID="new-dynamic")
        for old, new in [(False, None), (None, False), (False, False), (None, None)]:
            self.current["HostConfig"]["OomKillDisable"] = old
            self.actual["HostConfig"]["OomKillDisable"] = new
            self.verify(self.actual)
        for value in [0, 1, True, "false", [], {}]:
            bad = deepcopy(self.actual)
            bad["HostConfig"]["OomKillDisable"] = value
            self.reject(native.verify_clone, bad, self.current, self.plan, self.credentials)
        del self.actual["HostConfig"]["OomKillDisable"]
        self.reject(native.verify_clone, self.actual, self.current, self.plan, self.credentials)

    def test_unrelated_config_host_and_secret_drift(self):
        mutations = [
            (("Config", "UnknownOrdinary", "nested", 0), 0),
            (("Config", "UnknownOrdinary", "nested", 1), 7.0),
            (("HostConfig", "Privileged"), True),
            (("HostConfig", "UnknownOrdinary"), None),
            (("Config", "Env", 0), "PATH=/other"),
            (("Config", "Env", 1), "ROLE=reader"),
            (("Config", "Env", -1), BEARER + "=wrong"),
            (("Config", "Env", -2), SIGNING + "=" + encoded(33)),
            (("Config", "Env", -3), CONFIG + "=/wrong"),
            (("Config", "Labels", "custom"), "changed"),
            (("Image",), "sha256:" + "f" * 64),
        ]
        for path, value in mutations:
            with self.subTest(path=path):
                bad = deepcopy(self.actual)
                target = bad
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = value
                self.reject(native.verify_clone, bad, self.current, self.plan, self.credentials)
        for section in ["Config", "HostConfig"]:
            bad = deepcopy(self.actual)
            bad[section]["extra"] = None
            self.reject(native.verify_clone, bad, self.current, self.plan, self.credentials)

    def test_mount_drift(self):
        for mode in ["", "z"]:
            self.actual["Mounts"][-1]["Mode"] = mode
            self.verify(self.actual)
        self.actual["Mounts"][-1]["Mode"] = ""
        for index in range(13):
            bad = deepcopy(self.actual)
            bad["Mounts"][index]["RW"] = not bad["Mounts"][index]["RW"]
            self.reject(native.verify_clone, bad, self.current, self.plan, self.credentials)
        for field, value in [("Mode", "ro"), ("Source", "/wrong"),
                             ("Driver", "other"), ("Name", "wrong"),
                             ("Propagation", "private"), ("extra", None)]:
            bad = deepcopy(self.actual)
            bad["Mounts"][-1][field] = value
            self.reject(native.verify_clone, bad, self.current, self.plan, self.credentials)
        for key in ["ReadOnly", "VolumeOptions"]:
            bad = deepcopy(self.actual)
            bad["HostConfig"]["Mounts"][-1][key] = False
            self.reject(native.verify_clone, bad, self.current, self.plan, self.credentials)
        for mounts in [self.actual["Mounts"][:-1], self.actual["Mounts"] * 2]:
            bad = deepcopy(self.actual)
            bad["Mounts"] = mounts
            self.reject(native.verify_clone, bad, self.current, self.plan, self.credentials)
        for mode in ["Z", "rw,z", "ro,z", None]:
            bad = deepcopy(self.actual)
            bad["Mounts"][-1]["Mode"] = mode
            self.reject(native.verify_clone, bad, self.current, self.plan, self.credentials)
        bad = deepcopy(self.actual)
        bad["Mounts"][0]["Mode"] = "z"
        self.reject(native.verify_clone, bad, self.current, self.plan, self.credentials)

    def test_network_drift_and_static_ipam(self):
        for key, value in [("Aliases", ["other"]), ("Links", ["other"]),
                           ("DriverOpts", {"ordinary": "changed"}),
                           ("GwPriority", 3), ("GwPriority", True),
                           ("IPAMConfig", {"IPv4Address": "172.20.0.2"}),
                           ("IPAMConfig", False), ("Aliases", "bad")]:
            bad = deepcopy(self.actual)
            bad["NetworkSettings"]["Networks"]["app"][key] = value
            self.reject(native.verify_clone, bad, self.current, self.plan, self.credentials)
        self.current["NetworkSettings"]["Networks"]["app"]["IPAMConfig"] = {"IPv6Address": "::1"}
        self.reject(native.clone_request, self.current, self.plan, self.credentials)

    def test_env_collisions_and_malformed_entries(self):
        for entry in [key + "=existing" for key in [CONFIG, SIGNING, BEARER]] + [
                "PATH=duplicate", "MISSING", "=empty", "A=bad\nvalue", 3]:
            bad = deepcopy(self.current)
            bad["Config"]["Env"].append(entry)
            self.reject(native.clone_request, bad, self.plan, self.credentials)

    def test_destination_conflicts_all_declarations(self):
        for destination in [DEST, "/run", "/", DEST + "/child", DEST + "/../bad"]:
            for place in ["raw", "mount", "bind", "tmpfs", "volume"]:
                bad = deepcopy(self.current)
                if place == "raw":
                    bad["Mounts"][0]["Destination"] = destination
                elif place == "mount":
                    bad["HostConfig"]["Mounts"] = [{"Target": destination}]
                elif place == "bind":
                    bad["HostConfig"]["Binds"].append("source:" + destination)
                elif place == "tmpfs":
                    bad["HostConfig"]["Tmpfs"] = {destination: "rw"}
                else:
                    bad["Config"]["Volumes"] = {destination: {}}
                self.reject(native.clone_request, bad, self.plan, self.credentials)
        self.current["Mounts"][0]["Name"] = "native-runtime"
        self.reject(native.clone_request, self.current, self.plan, self.credentials)

    def test_credential_bounds_and_canonical_encoding(self):
        for size in [32, 33, 4096]:
            self.credentials[SIGNING] = encoded(size)
            native.clone_request(self.current, self.plan, self.credentials)
        for value in [encoded(31), encoded(4097), encoded(32) + "=",
                      encoded(32)[:-1] + "h", "A" * 45, "+" * 44, None]:
            bad = dict(self.credentials, **{SIGNING: value})
            self.reject(native.clone_request, self.current, self.plan, bad)
        for value in ["", "x" * 8193, " ", " x", "x ", "a b",
                      "a\n", "a\x00", "é", 3]:
            bad = dict(self.credentials, **{BEARER: value})
            self.reject(native.clone_request, self.current, self.plan, bad)
        for bad in [{}, {SIGNING: encoded(32)}, dict(self.credentials, extra="x"), []]:
            self.reject(native.clone_request, self.current, self.plan, bad)

    def test_printable_bearer_and_existing_named_reader_mount(self):
        self.credentials[BEARER] = "x" * 8192
        reader = self.current["Mounts"][0]
        reader.update(Type="volume", Name="reader-existing", Driver="local",
                      Source="/var/lib/docker/volumes/reader-existing/_data",
                      Mode="", Propagation="")
        self.current["HostConfig"]["Binds"].pop(0)
        self.current["HostConfig"]["Mounts"].append({
            "Type": "volume", "Source": "reader-existing",
            "Target": reader["Destination"], "ReadOnly": True,
            "VolumeOptions": {"NoCopy": True},
        })
        self.actual = inspection(self.current, self.plan, self.credentials)
        self.verify(self.actual)
        request = native.clone_request(self.current, self.plan, self.credentials)
        self.assertEqual(request["HostConfig"]["Mounts"][:-1],
                         self.current["HostConfig"]["Mounts"])

    def test_missing_null_and_empty_are_not_normalized(self):
        for section, key in [("Config", "UnknownOrdinary"),
                             ("HostConfig", "Tmpfs")]:
            for value in [None, [], False]:
                bad = deepcopy(self.actual)
                bad[section][key] = value
                self.reject(native.verify_clone, bad, self.current, self.plan, self.credentials)
            bad = deepcopy(self.actual)
            del bad[section][key]
            self.reject(native.verify_clone, bad, self.current, self.plan, self.credentials)
        for key in self.actual["Config"]["Labels"]:
            bad = deepcopy(self.actual)
            bad["Config"]["Labels"][key] = "wrong"
            self.reject(native.verify_clone, bad, self.current, self.plan, self.credentials)

    def test_malformed_json_plan_and_bounded_traversal(self):
        for value in [float("nan"), float("inf"), object(), (1, 2), {1: "bad"}]:
            bad = deepcopy(self.current)
            bad["Config"]["UnknownOrdinary"] = value
            self.reject(native.clone_request, bad, self.plan, self.credentials)
        for section, key, value in [("candidate", "image", "tag:latest"),
                ("candidate", "sourceCommit", True),
                ("candidate", "extra", "x"),
                ("runtimeAddon", "volumeName", "../bad"),
                ("runtimeAddon", "volumeMountpoint", "/not/../canonical")]:
            bad = deepcopy(self.plan)
            bad[section][key] = value
            self.reject(native.clone_request, self.current, bad, self.credentials)
        cyclic = []
        cyclic.append(cyclic)
        for value in [cyclic, [None] * 100001, "x" * 1048577]:
            bad = deepcopy(self.current)
            bad["Config"]["UnknownOrdinary"] = value
            self.reject(native.clone_request, bad, self.plan, self.credentials)


if __name__ == "__main__":
    unittest.main()
