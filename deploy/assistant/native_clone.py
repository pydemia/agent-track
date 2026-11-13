"""Pure Docker request construction and strict native-runtime clone verification."""

from copy import deepcopy
import base64
import math
import posixpath
import re

__all__ = ["CloneError", "clone_request", "verify_clone"]

DESTINATION = "/run/secrets/agent-track-demian"
ENV_KEY = "PERSONA_DEMIAN_RUNTIME_CONFIG_FILE"
SIGNING_KEY = "PERSONA_DEMIAN_RUNTIME_SIGNING_KEY_AGENT_TRACK"
BEARER_KEY = "PERSONA_DEMIAN_RUNTIME_BEARER_AGENT_TRACK"
ENV_KEYS = {ENV_KEY, SIGNING_KEY, BEARER_KEY}
ENV_ENTRY = ENV_KEY + "=" + DESTINATION + "/config.json"


class CloneError(ValueError):
    """A deliberately static diagnostic, never containing supplied values."""

    def __init__(self):
        super().__init__("Native clone validation failed.")


def _require(condition):
    if not condition:
        raise CloneError()


def _json(value):
    # Bound traversal before copying/comparing; cycles fail the depth budget.
    pending = [(value, 0)]
    remaining = 100000
    characters = 0
    while pending:
        item, depth = pending.pop()
        remaining -= 1
        _require(remaining >= 0 and depth <= 64)
        if type(item) is dict:
            _require(len(item) + len(pending) <= remaining)
            for key, child in item.items():
                _require(type(key) is str)
                characters += len(key)
                pending.append((child, depth + 1))
        elif type(item) is list:
            _require(len(item) + len(pending) <= remaining)
            pending.extend((child, depth + 1) for child in item)
        else:
            _require(type(item) in (str, int, float, bool, type(None)))
            if type(item) is float:
                _require(math.isfinite(item))
            if type(item) is str:
                characters += len(item)
        _require(characters <= 1048576)


def _credentials(credentials):
    _require(type(credentials) is dict)
    _json(credentials)
    _require(set(credentials) == {SIGNING_KEY, BEARER_KEY})
    signing = credentials[SIGNING_KEY]
    _require(type(signing) is str and 43 <= len(signing) <= 5462)
    _require(re.fullmatch(r"[A-Za-z0-9_-]+", signing) is not None)
    _require(len(signing) % 4 != 1)
    decoded = base64.urlsafe_b64decode(signing + "=" * (-len(signing) % 4))
    _require(32 <= len(decoded) <= 4096)
    _require(base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=")
             == signing)
    bearer = credentials[BEARER_KEY]
    _require(type(bearer) is str and 1 <= len(bearer) <= 8192)
    _require(all(33 <= ord(char) <= 126 for char in bearer))


def _same(left, right):
    if type(left) is not type(right):
        return False
    if type(left) is dict:
        return left.keys() == right.keys() and all(
            _same(left[key], right[key]) for key in left
        )
    if type(left) is list:
        return len(left) == len(right) and all(
            _same(a, b) for a, b in zip(left, right)
        )
    return left == right


def _path(value):
    _require(type(value) is str and 0 < len(value) <= 4096)
    _require(value.startswith("/") and not value.startswith("//"))
    _require(not any(ord(char) < 32 or ord(char) == 127 for char in value))
    _require("\\" not in value and ".." not in value.split("/"))
    _require(posixpath.normpath(value) == value)
    return value


def _destinations(values):
    seen = set()
    for value in values:
        path = _path(value)
        _require(path not in seen)
        seen.add(path)
        _require(
            path != DESTINATION
            and not path.startswith(DESTINATION + "/")
            and not DESTINATION.startswith(path.rstrip("/") + "/")
        )


def _env(value):
    _require(type(value) is list)
    seen = set()
    for entry in value:
        _require(type(entry) is str)
        _require(not any(char in entry for char in "\r\n\x00"))
        key, separator, _ = entry.partition("=")
        _require(bool(separator) and bool(key))
        _require(key not in seen and key not in ENV_KEYS)
        seen.add(key)


def _networks(inspect):
    settings = inspect.get("NetworkSettings")
    _require(type(settings) is dict)
    networks = settings.get("Networks")
    _require(type(networks) is dict)
    result = {}
    for name, endpoint in networks.items():
        _require(bool(name) and type(endpoint) is dict)
        _require(endpoint.get("IPAMConfig") in (None, {}))
        spec = {}
        for key in ("Aliases", "Links", "DriverOpts"):
            value = endpoint.get(key)
            if value is not None:
                if key == "DriverOpts":
                    _require(type(value) is dict)
                    _require(all(type(v) is str for v in value.values()))
                else:
                    _require(type(value) is list)
                    _require(all(type(v) is str for v in value))
                spec[key] = deepcopy(value)
        priority = endpoint.get("GwPriority", 0)
        _require(type(priority) is int)
        if priority:
            spec["GwPriority"] = priority
        result[name] = spec
    return result


def _inputs(current, plan, credentials):
    _require(type(current) is dict and type(plan) is dict)
    _json(current)
    _json(plan)
    _credentials(credentials)
    _require(set(plan) == {"candidate", "runtimeAddon"})
    candidate = plan.get("candidate")
    addon = plan.get("runtimeAddon")
    _require(type(candidate) is dict and type(addon) is dict)
    _require(set(candidate) == {
        "image", "sourceCommit", "sourceArchiveSha256", "sourceTree",
    })
    _require(set(addon) == {"volumeName", "volumeMountpoint"})
    for key, pattern in (
        ("image", r"sha256:[0-9a-f]{64}"),
        ("sourceCommit", r"[0-9a-f]{40}"),
        ("sourceArchiveSha256", r"[0-9a-f]{64}"),
        ("sourceTree", r"[0-9a-f]{40}"),
    ):
        value = candidate.get(key)
        _require(type(value) is str)
        _require(re.fullmatch(pattern, value) is not None)
    name = addon["volumeName"]
    _require(type(name) is str and len(name) <= 255)
    _require(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]+", name) is not None)
    _path(addon["volumeMountpoint"])
    config = current.get("Config")
    host = current.get("HostConfig")
    mounts = current.get("Mounts")
    _require(type(config) is dict and type(host) is dict)
    _require(type(mounts) is list)
    _env(config.get("Env"))
    labels = config.get("Labels")
    _require(labels is None or type(labels) is dict)
    if labels is not None:
        _require(all(type(v) is str for v in labels.values()))
    _require("HostConfig" not in config and "NetworkingConfig" not in config)
    _require(all(type(mount) is dict for mount in mounts))
    _destinations([mount.get("Destination") for mount in mounts])
    _require(all(mount.get("Name") != name for mount in mounts))
    requested = host.get("Mounts")
    _require(requested is None or type(requested) is list)
    destinations = []
    for mount in requested or []:
        _require(type(mount) is dict)
        _require(mount.get("Source") != name)
        destinations.append(mount.get("Target"))
    binds = host.get("Binds")
    _require(binds is None or type(binds) is list)
    for bind in binds or []:
        _require(type(bind) is str)
        parts = bind.split(":")
        _require(len(parts) in (2, 3) and bool(parts[0]))
        _require(parts[0] != name)
        destinations.append(parts[1])
    tmpfs = host.get("Tmpfs")
    _require(tmpfs is None or type(tmpfs) is dict)
    destinations.extend(tmpfs or {})
    _destinations(destinations)
    volumes = config.get("Volumes")
    _require(volumes is None or type(volumes) is dict)
    _destinations(list(volumes or {}))
    if "OomKillDisable" in host:
        _require(host["OomKillDisable"] is None or
                 host["OomKillDisable"] is False)
    _networks(current)


def clone_request(current: dict, plan: dict, credentials: dict) -> dict:
    """Return a detached Docker create request, containing supplied credentials.

    No I/O is performed. Callers must not log or persist the returned request.
    Signing keys are unpadded canonical base64url of 32..4096 bytes; bearers
    are 1..8192 non-whitespace printable ASCII characters, matching the host loader.
    """
    _inputs(current, plan, credentials)
    candidate = plan["candidate"]
    request = deepcopy(current["Config"])
    request["Image"] = candidate["image"]
    request["Env"].extend([
        ENV_ENTRY,
        SIGNING_KEY + "=" + credentials[SIGNING_KEY],
        BEARER_KEY + "=" + credentials[BEARER_KEY],
    ])
    labels = request.get("Labels")
    if labels is None:
        labels = {}
        request["Labels"] = labels
    for label, key in (
        ("org.opencontainers.image.revision", "sourceCommit"),
        ("com.pydemia.source.archive", "sourceArchiveSha256"),
        ("com.pydemia.source.tree", "sourceTree"),
        # Refresh the installed reader's source stamps with the whole app source.
        ("io.pydemia.agent-track-reader.archive-sha256", "sourceArchiveSha256"),
        ("io.pydemia.agent-track-reader.source-tree", "sourceTree"),
    ):
        labels[label] = candidate[key]
    host = deepcopy(current["HostConfig"])
    if host.get("Mounts") is None:
        host["Mounts"] = []
    host["Mounts"].append({
        "Type": "volume",
        "Source": plan["runtimeAddon"]["volumeName"],
        "Target": DESTINATION,
        "ReadOnly": True,
        "VolumeOptions": {"NoCopy": True},
    })
    request["HostConfig"] = host
    request["NetworkingConfig"] = {"EndpointsConfig": _networks(current)}
    return request


def verify_clone(
    actual: dict, current: dict, plan: dict, credentials: dict,
) -> None:
    """Reject any inspected drift outside the explicitly allowed delta."""
    request = clone_request(current, plan, credentials)
    _require(type(actual) is dict)
    _json(actual)
    expected_host = request.pop("HostConfig")
    networks = request.pop("NetworkingConfig")["EndpointsConfig"]
    _require(_same(actual.get("Image"), request["Image"]))
    _require(_same(actual.get("Config"), request))
    host = actual.get("HostConfig")
    _require(type(host) is dict)
    host = deepcopy(host)
    for value in (host, expected_host):
        if "OomKillDisable" in value:
            _require(value["OomKillDisable"] is None or
                     value["OomKillDisable"] is False)
            value["OomKillDisable"] = None
    _require(_same(host, expected_host))
    _require(_same(_networks(actual), networks))
    mounts = actual.get("Mounts")
    _require(type(mounts) is list)
    _require(all(type(mount) is dict for mount in mounts))
    destinations = [mount.get("Destination") for mount in mounts]
    for destination in destinations:
        _path(destination)
    _require(len(set(destinations)) == len(destinations))
    addon = plan["runtimeAddon"]
    expected = deepcopy(current["Mounts"]) + [{
        "Type": "volume",
        "Name": addon["volumeName"],
        "Source": addon["volumeMountpoint"],
        "Destination": DESTINATION,
        "Driver": "local",
        "Mode": "",
        "RW": False,
        "Propagation": "",
    }]
    # This daemon reports Mode="z" for the new named Mount API entry even
    # though HostConfig is exactly the requested ReadOnly/NoCopy definition.
    # Restrict this representation allowance to the new metadata volume;
    # every pre-existing mount and every HostConfig field remains exact.
    metadata = [mount for mount in mounts
                if mount["Destination"] == DESTINATION]
    _require(len(metadata) == 1 and metadata[0].get("Mode") in ("", "z"))
    expected[-1]["Mode"] = metadata[0]["Mode"]
    _require(_same(
        sorted(mounts, key=lambda mount: mount["Destination"]),
        sorted(expected, key=lambda mount: mount["Destination"]),
    ))
