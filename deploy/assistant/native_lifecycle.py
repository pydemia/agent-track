"""Frozen Assistant image transition and boot adoption; no database restore path.

The integration owner supplies the current private plan and immutable Docker
primitives. This module never creates containers, credentials, networks or volumes.
"""

import argparse
from copy import deepcopy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.parse import quote


SCHEMA = "assistant-native-lifecycle-v1"
APP_NAME = "pydemia-persona-assistant-public-428cb10"
UNIT = "persona-apps.service"
LIBRARY_SHA = "659ae788e62ec621c496f5aec48e4e6aed0d1d2e3e4c1b3c183331f16f99d914"
HEX = re.compile(r"[a-f0-9]{64}")
IDENTIFIER = re.compile(r"[a-f0-9]{64}")
SAFE_PATH = re.compile(r"/[A-Za-z0-9_./-]+")


class LifecycleError(RuntimeError):
    """A static diagnostic without input values or exception chains."""


def require(value, code):
    if not value:
        raise LifecycleError(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def validate(plan):
    require(type(plan) is dict and plan.get("schema") == SCHEMA, "plan_schema")
    require(plan.get("librarySha256") == LIBRARY_SHA, "library_binding")
    require([row["role"] for row in plan["bootRoles"]] == ["budget", "avatar"],
            "boot_role_order")
    require(len(plan["protectedComponents"]) == 13, "protected_scope")
    require(len({(row["engine"], row["id"])
                 for row in plan["protectedComponents"]}) == 13,
            "duplicate_protected_component")
    require(all(HEX.fullmatch(row["rawContractSha256"])
                for row in plan["protectedComponents"]), "protected_raw_binding")
    require(plan["assistant"]["id"] != plan["candidate"]["id"], "same_candidate")
    for row in [plan["assistant"], plan["candidate"], plan["renderer"],
                *plan["bootRoles"]]:
        require(IDENTIFIER.fullmatch(row["id"]) is not None, "container_identity")
        require(re.fullmatch(r"sha256:[a-f0-9]{64}", row["image"]) is not None,
                "image_identity")
        require(set(row["contract"]) == {"config", "host", "mounts", "networks"}
                and all(HEX.fullmatch(value) for value in row["contract"].values()),
                "container_contract")
    for name in [plan["assistant"]["retainedName"], plan["candidate"]["stagedName"]]:
        require(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{1,254}", name),
                "lifecycle_name")
    require(len({APP_NAME, plan["assistant"]["retainedName"],
                 plan["candidate"]["stagedName"]}) == 3, "lifecycle_name_collision")
    require(re.fullmatch(r"persona-report-renderer-[a-z0-9-]+\.service",
                        plan["renderer"]["unitName"]), "renderer_unit")
    for key in ["operatorPath", "libraryPath", "planPath", "markerPath"]:
        path = plan[key]
        require(SAFE_PATH.fullmatch(path) and ".." not in Path(path).parts,
                "plan_path")
    require(HEX.fullmatch(plan["operatorSha256"]), "operator_binding")
    require(HEX.fullmatch(plan["canonical"]["execStopSha256"]), "execstop_binding")
    require(set(plan["evidence"]) == {"stage", "inventory", "recovery", "preview", "baseline"},
            "evidence_scope")
    for row in plan["evidence"].values():
        require(SAFE_PATH.fullmatch(row["path"]) and ".." not in Path(row["path"]).parts
                and HEX.fullmatch(row["sha256"]), "evidence_binding")
    require(bool(plan["frozenFiles"]), "empty_frozen_scope")
    for row in [plan["renderer"], *plan["bootRoles"]]:
        probe = row["readiness"]
        require(type(probe["port"]) is int and 1 <= probe["port"] <= 65535
                and probe["path"] in ["/api/health", "/health"]
                and probe["status"] in [200, 404], "readiness_probe")
    require(plan["recovery"]["restoredAndVerified"] is True
            and plan["preview"]["phase"] == "full-candidate-boot-copy-verified"
            and plan["preview"]["sourceRevision"] == plan["candidate"]["sourceCommit"],
            "recovery_preview_required")


def guard_bytes(plan, plan_sha, renderer=False):
    require(HEX.fullmatch(plan_sha), "plan_digest")
    action = "renderer-resume" if renderer else "resume"
    dependency = "" if renderer else (
        "[Unit]\nWants=" + plan["renderer"]["unitName"]
        + "\nAfter=" + plan["renderer"]["unitName"] + "\n\n"
    )
    return (dependency + "[Service]\nExecStart=\nExecStart=/usr/bin/python3 -B "
            + plan["operatorPath"] + " " + action + " --plan " + plan["planPath"]
            + " --plan-sha " + plan_sha + " --execute\n").encode()


class NativeLifecycle:
    def __init__(self, plan, engines, base, shell, *, plan_sha, read_bytes=None, now=None):
        validate(plan)
        self.plan = deepcopy(plan)
        self.engines, self.engine, self.base = engines, engines["rootless"], base
        self.shell, self.plan_sha = shell, plan_sha
        self.read_bytes = read_bytes or (lambda path: Path(path).read_bytes())
        self.now = now or time.time

    def check_files(self):
        for row in self.plan["frozenFiles"]:
            require(sha(self.read_bytes(row["path"])) == row["sha256"],
                    "frozen_file_changed")
        require(sha(self.read_bytes(self.plan["operatorPath"]))
                == self.plan["operatorSha256"], "operator_changed")
        actual = self.shell(["systemctl", "--user", "show", UNIT,
                             "--value", "--property=ExecStop"]).strip()
        require(sha(actual.encode()) == self.plan["canonical"]["execStopSha256"],
                "execstop_changed")
        properties = self.shell(["systemctl", "--user", "show", UNIT,
                                 "--property=Restart,RestartUSec,StartLimitIntervalUSec,StartLimitBurst,Type,RemainAfterExit"])
        values = dict(line.split("=", 1) for line in properties.splitlines() if "=" in line)
        require(values == self.plan["canonical"]["restartProperties"],
                "restart_policy_changed")
        self.check_evidence()

    def check_evidence(self):
        proofs = {}
        for name, row in self.plan["evidence"].items():
            raw = self.read_bytes(row["path"])
            require(sha(raw) == row["sha256"], "evidence_file_changed")
            proofs[name] = json.loads(raw)
        stage, inventory = proofs["stage"], proofs["inventory"]
        require(stage.get("phase") == "strict-inactive-candidate-verified"
                and stage.get("candidateId") == self.plan["candidate"]["id"]
                and stage.get("candidateImage") == self.plan["candidate"]["image"]
                and inventory.get("stateVolume") == self.plan["state"]["name"]
                and inventory.get("assistant", {}).get("id") == self.plan["assistant"]["id"],
                "evidence_source_identity")
        recovery, preview, baseline = (proofs[key] for key in ["recovery", "preview", "baseline"])
        require(recovery.get("phase") == "encrypted-backup-restored-and-verified"
                and recovery.get("volume") == self.plan["recovery"]["volume"]
                and len(recovery.get("records", [])) == 2
                and {row.get("database") for row in recovery["records"]} == {"work", "runtime"}
                and all(row.get("restoreVerified") is True for row in recovery["records"]),
                "recovery_evidence")
        require(preview.get("phase") == "full-candidate-boot-copy-verified"
                and preview.get("sourceRevision") == self.plan["candidate"]["sourceCommit"]
                and preview.get("helperRemoved") is True
                and preview.get("protectedProcessesAndContractsUnchanged") == 13,
                "preview_evidence")
        require(baseline.get("phase") == "fresh-idle-baseline-verified"
                and baseline.get("oldBusinessRowsMatchVerifiedBackup") is True
                and baseline.get("reportPinsPreserved") is True
                and baseline.get("capturedAt") == self.plan["precutover"]["capturedAt"],
                "baseline_evidence")

    def container(self, row, *, name=None):
        actual = self.engine.inspect(row["id"])
        require(actual["Id"] == row["id"] and actual["Image"] == row["image"]
                and self.base.contract(actual) == row["contract"],
                "container_contract_changed")
        if name is not None:
            require(actual["Name"] == "/" + name, "container_name_changed")
        self.base.Rollout.network_identity(self, actual, row["networkIds"])
        return actual

    def network_identity(self, value, expected):
        self.base.Rollout.network_identity(self, value, expected)

    def role_contracts(self, boot=False):
        for row in self.plan["bootRoles"]:
            actual = self.container(row)
            require(boot or actual["State"]["Running"], "boot_role_not_running")
            require(not any(self.mount_can_write_state(mount) for mount in actual["Mounts"]),
                    "boot_role_state_overlap")

    def _start(self, identifier):
        self.engine.request("POST", "/containers/" + identifier + "/start")

    def roles(self):
        self.role_contracts(boot=True)
        result = []
        for row in self.plan["bootRoles"]:
            before = self.container(row)
            running = before["State"]["Running"]
            if not running:
                self._start(row["id"])
            self.readiness(row)
            after = self.container(row)
            require(after["State"]["Running"], "boot_role_start_failed")
            if running:
                require(self.base.process_projection(before) == self.base.process_projection(after),
                        "running_boot_role_changed")
            result.append({"role": row["role"], "id": row["id"], "alreadyRunning": running})
        return result

    def readiness(self, row):
        probe = row["readiness"]
        url = "http://127.0.0.1:" + str(probe["port"]) + probe["path"]
        program = ("let status=0;try{const r=await fetch(" + json.dumps(url)
                   + ",{signal:AbortSignal.timeout(2000)});status=r.status;await r.body?.cancel();}catch{}"
                   + "console.log(JSON.stringify({ready:status===" + str(probe["status"])
                   + ",status}));")
        for _ in range(45):
            actual = self.container(row)
            require(actual["State"]["Running"], "dependency_not_running")
            health = actual["State"].get("Health", {}).get("Status")
            require(health != "unhealthy", "dependency_unhealthy")
            try:
                result = self.engine.exec_readonly(row["id"], program)
                if result.get("ready") is True and result.get("status") == probe["status"]:
                    return
            except Exception:
                pass
            time.sleep(1)
        raise LifecycleError("dependency_readiness_failed")

    def protected(self, include_assistant=True):
        for row in self.plan["protectedComponents"]:
            if not include_assistant and row["id"] == self.plan["assistant"]["id"]:
                continue
            value = self.engines[row["engine"]].inspect(row["id"])
            current = {"engine": row["engine"], **self.base.process_projection(value)}
            require(current == row["process"], "protected_component_changed")
            raw = {**{key: value[key] for key in ["Config", "HostConfig", "NetworkSettings"]},
                   "Mounts": sorted(value["Mounts"], key=lambda mount: mount["Destination"])}
            require(sha(canonical(raw)) == row["rawContractSha256"],
                    "protected_raw_network_changed")

    def renderer(self, *, boot=False):
        row = self.plan["renderer"]
        value = self.container(row)
        if not boot:
            require(value["State"]["Running"]
                    and self.base.process_projection(value) == row["process"],
                    "renderer_process_changed")
        network = self.engine.request("GET", "/networks/" + row["network"]["name"])
        allowed = {row["id"], self.plan["assistant"]["id"], self.plan["candidate"]["id"]}
        require(network["Id"] == row["network"]["id"]
                and network["Internal"] is True and network["Driver"] == "bridge"
                and set((network.get("Containers") or {}).keys()) <= allowed,
                "renderer_network_changed")
        require(not value["State"]["Running"]
                or row["id"] in (network.get("Containers") or {}),
                "renderer_peer_missing")
        return value

    def mount_can_write_state(self, mount, engine="rootless"):
        source = self.plan["state"]["source"].rstrip("/") or "/"
        other = mount.get("Source", "")
        other = (other.rstrip("/") or "/") if other else ""
        overlap = other and (source == "/" or other == "/" or other == source
                             or other.startswith(source + "/") or source.startswith(other + "/"))
        same_volume = (engine == "rootless" and mount.get("Type") == "volume"
                       and mount.get("Name") == self.plan["state"]["name"])
        if overlap or same_volume:
            require(type(mount.get("RW")) is bool, "unknown_state_writer")
            return mount["RW"]
        return False

    def state_writers(self):
        found = set()
        for name, engine in self.engines.items():
            for item in engine.request("GET", "/containers/json?all=0"):
                actual = engine.inspect(item["Id"])
                if not actual["State"]["Running"]:
                    continue
                for mount in actual["Mounts"]:
                    if self.mount_can_write_state(mount, name):
                        found.add((name, actual["Id"]))
        return sorted(found)

    def guard_effective(self, renderer=False):
        unit = self.plan["renderer"]["unitName"] if renderer else UNIT
        path = self.plan["canonical"]["rendererGuardPath" if renderer else "guardPath"]
        content = guard_bytes(self.plan, self.plan_sha, renderer)
        require(self.read_bytes(path) == content, "guard_file_changed")
        actual = self.shell(["systemctl", "--user", "show", unit,
                             "--value", "--property=ExecStart"])
        command = next(line[len("ExecStart="):] for line in content.decode().splitlines()
                       if line.startswith("ExecStart=") and line != "ExecStart=")
        require("argv[]=" in actual and actual.count("argv[]=") == 1
                and actual.count("path=") == 1
                and actual.split("path=", 1)[1].split(" ;", 1)[0] == "/usr/bin/python3"
                and actual.split("argv[]=", 1)[1].split(" ;", 1)[0] == command,
                "guard_not_effective")

    def preflight(self):
        self.check_files()
        self.protected()
        original = self.container(self.plan["assistant"], name=APP_NAME)
        candidate = self.container(self.plan["candidate"],
                                   name=self.plan["candidate"]["stagedName"])
        require(original["State"]["Running"] and not candidate["State"]["Running"],
                "preflight_lifecycle")
        self.role_contracts()
        self.renderer()
        require(self.state_writers() == [("rootless", original["Id"])],
                "foreign_state_writer")
        return {"ok": True, "phase": "native-preflight", "mutations": 0}

    def cutover(self):
        self.preflight()
        self.guard_effective()
        self.guard_effective(True)
        jobs = self.shell(["systemctl", "--user", "list-jobs", "--no-legend", "--no-pager"])
        require(not any(UNIT in line.split() or self.plan["renderer"]["unitName"] in line.split()
                        for line in jobs.splitlines()), "pending_start_job")
        require(not Path(self.plan["markerPath"]).exists(), "cutover_already_consumed")
        original, candidate = self.plan["assistant"], self.plan["candidate"]
        require(0 <= self.now() - self.plan["precutover"]["capturedAt"] <= 900
                and self.plan["precutover"]["phase"] == "fresh-idle-baseline-verified",
                "fresh_baseline_required")
        existing = self.engine.request("GET", "/containers/json?all=1")
        require(all("/" + original["retainedName"] not in row.get("Names", [])
                    for row in existing), "retained_name_exists")
        idle_script = r'''import{DatabaseSync}from'node:sqlite';const counts=[];
for(const[name,path]of[['runtime','/state/app/persona.sqlite'],['work','/state/app/workbench/assistant-work.sqlite']]){
 const db=new DatabaseSync(path,{readOnly:true,timeout:1000});try{db.exec('PRAGMA query_only=ON;BEGIN;');
 if(name==='runtime')counts.push(db.prepare("SELECT count(*)AS n FROM persona_tasks WHERE state IN('queued','awaiting_connection','awaiting_runtime','preparing','starting','running')").get().n);
 else{counts.push(db.prepare("SELECT count(*)AS n FROM work_executions WHERE state NOT IN('completed','failed','cancelled')").get().n);counts.push(db.prepare("SELECT count(*)AS n FROM work_reports WHERE json_extract(document,'$.state')IN('queued','generating','uploading','publishing')").get().n);counts.push(db.prepare("SELECT count(*)AS n FROM work_storage_imports WHERE state!='completed'").get().n);}
 counts.push(db.prepare('SELECT total_changes()AS n').get().n);db.exec('ROLLBACK;');}finally{db.close();}}
console.log(JSON.stringify({counts}));'''
        idle = self.engine.exec_readonly(original["id"], idle_script)
        require(type(idle.get("counts")) is list and len(idle["counts"]) == 6
                and all(type(value) is int and value == 0 for value in idle["counts"]),
                "active_work_before_stop")
        # This action is deliberately one-shot. Partial outcomes are journaled by
        # its caller; boot only adopts the exact renamed candidate, never retries
        # a cutover or restores an old image/database automatically.
        self.engine.request("POST", "/containers/" + original["id"] + "/stop?t=30")
        actual = self.container(original, name=APP_NAME)
        require(not actual["State"]["Running"] and not self.state_writers(),
                "writer_after_stop")
        self.protected(False)
        self.engine.request("POST", "/containers/" + original["id"]
                            + "/rename?name=" + quote(original["retainedName"], safe=""))
        self.engine.request("POST", "/containers/" + candidate["id"]
                            + "/rename?name=" + quote(APP_NAME, safe=""))
        self.container(original, name=original["retainedName"])
        self.container(candidate, name=APP_NAME)
        value = {"schema": SCHEMA, "planSha256": self.plan_sha,
                 "candidateId": candidate["id"], "originalId": original["id"],
                 "phase": "switched-stopped", "dataRestored": False,
                 "credentialsRestored": False}
        publish(self.plan["markerPath"], value)
        return value

    def resume(self):
        self.check_files()
        self.guard_effective()
        self.guard_effective(True)
        marker = json.loads(self.read_bytes(self.plan["markerPath"]))
        require(marker.get("schema") == SCHEMA
                and marker.get("planSha256") == self.plan_sha
                and marker.get("phase") == "switched-stopped"
                and marker.get("candidateId") == self.plan["candidate"]["id"]
                and marker.get("originalId") == self.plan["assistant"]["id"],
                "cutover_marker_changed")
        old = self.container(self.plan["assistant"], name=self.plan["assistant"]["retainedName"])
        require(not old["State"]["Running"], "original_restarted")
        renderer = self.renderer_resume()
        value = self.container(self.plan["candidate"], name=APP_NAME)
        running = value["State"]["Running"]
        require(self.state_writers() == ([("rootless", value["Id"])] if running else []),
                "boot_writer_conflict")
        roles = self.roles()
        require(self.state_writers() == ([("rootless", value["Id"])] if running else []),
                "writer_after_boot_roles")
        if not running:
            self._start(value["Id"])
        self.base.Rollout.health(self)
        current = self.container(self.plan["candidate"], name=APP_NAME)
        require(current["State"]["Running"] and self.state_writers()
                == [("rootless", current["Id"])], "candidate_start_failed")
        if running:
            require(self.base.process_projection(current) == self.base.process_projection(value),
                    "running_candidate_changed")
        return {"ok": True, "phase": "native-running", "candidateId": current["Id"],
                "alreadyRunning": running, "bootRoles": roles,
                "renderer": renderer,
                "dataRestored": False, "credentialsRestored": False}

    def renderer_resume(self):
        self.check_files()
        self.guard_effective(True)
        value = self.renderer(boot=True)
        running = value["State"]["Running"]
        if not running:
            self._start(value["Id"])
        self.readiness(self.plan["renderer"])
        current = self.renderer(boot=True)
        require(current["State"]["Running"], "renderer_start_failed")
        if running:
            require(self.base.process_projection(current) == self.base.process_projection(value),
                    "running_renderer_changed")
        return {"ok": True, "rendererId": current["Id"], "alreadyRunning": running,
                "dataRestored": False}


def publish(path, value):
    require(os.name == "posix", "marker_posix_required")
    target = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix=".native-marker-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(canonical(value) + b"\n")
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, target, follow_symlinks=False)
        directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["inspect", "cutover", "resume", "renderer-resume"])
    parser.add_argument("--plan", required=True)
    parser.add_argument("--plan-sha", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    try:
        path = Path(args.plan)
        require(path.is_file() and not path.is_symlink(), "plan_file")
        raw = path.read_bytes()
        require(sha(raw) == args.plan_sha, "plan_file_changed")
        plan = json.loads(raw)
        validate(plan)
        require(str(Path(__file__).resolve()) == plan["operatorPath"]
                and sha(Path(__file__).read_bytes()) == plan["operatorSha256"],
                "operator_changed")
        library = Path(plan["libraryPath"])
        require(library.is_file() and not library.is_symlink()
                and sha(library.read_bytes()) == LIBRARY_SHA, "library_changed")
        spec = importlib.util.spec_from_file_location("native_frozen_docker", library)
        base = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(base)
        engines = {name: base.Engine(name) for name in ["rootless", "rootful"]}
        lifecycle = NativeLifecycle(plan, engines, base, base.Rollout._shell,
                                    plan_sha=args.plan_sha)
        if args.action == "inspect":
            result = lifecycle.preflight()
        elif not args.execute:
            result = {"action": args.action, "mode": "dry-run", "mutations": 0}
        else:
            result = {"cutover": lifecycle.cutover, "resume": lifecycle.resume,
                      "renderer-resume": lifecycle.renderer_resume}[args.action]()
        print(json.dumps(result))
    except Exception as error:
        code = str(error) if isinstance(error, LifecycleError) else "native_lifecycle_failed"
        print(json.dumps({"ok": False, "code": code}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
