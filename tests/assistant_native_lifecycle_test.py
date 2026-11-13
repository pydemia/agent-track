"""Synthetic safety tests for native lifecycle; never contact Docker or units."""

from copy import deepcopy
import hashlib
import importlib.util
from pathlib import Path
import unittest
import subprocess
from unittest.mock import patch

# Compile directly so discovery does not create bytecode for the frozen module.
source = Path(__file__).resolve().parents[1] / "deploy/assistant/native_lifecycle.py"
spec = importlib.util.spec_from_loader("native_lifecycle", loader=None)
native = importlib.util.module_from_spec(spec)
exec(compile(source.read_text(encoding="utf-8"), str(source), "exec"),
     native.__dict__)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def raw_contract(value):
    raw = {key: value[key] for key in ("Config", "HostConfig", "NetworkSettings")}
    raw["Mounts"] = sorted(value["Mounts"], key=lambda mount: mount["Destination"])
    return digest(native.canonical(raw))


def evidence_fixture(plan):
    values = {
        "stage": {"phase": "strict-inactive-candidate-verified",
                  "candidateId": plan["candidate"]["id"],
                  "candidateImage": plan["candidate"]["image"]},
        "inventory": {"stateVolume": plan["state"]["name"],
                      "assistant": {"id": plan["assistant"]["id"]}},
        "recovery": {"phase": "encrypted-backup-restored-and-verified",
                     "volume": "synthetic-backup", "records": [
                         {"database": "runtime", "restoreVerified": True},
                         {"database": "work", "restoreVerified": True}]},
        "preview": {"phase": "full-candidate-boot-copy-verified",
                    "sourceRevision": plan["candidate"]["sourceCommit"],
                    "helperRemoved": True, "protectedProcessesAndContractsUnchanged": 13},
        "baseline": {"phase": "fresh-idle-baseline-verified",
                     "oldBusinessRowsMatchVerifiedBackup": True,
                     "reportPinsPreserved": True,
                     "capturedAt": plan["precutover"]["capturedAt"]},
    }
    return values


def row(identifier, name, *, running=False, role=None, source=None):
    return {
        "id": identifier, "image": "sha256:" + (identifier[0] * 64),
        "contract": {key: identifier for key in ("config", "host", "mounts", "networks")},
        "networkIds": {"private-net": "network-id"},
        "name": name, "running": running, "role": role, "source": source,
    }


def plan_fixture():
    assistant = row("a" * 64, native.APP_NAME, running=True,
                    source="/state/persona.sqlite")
    assistant["retainedName"] = "assistant-retained"
    candidate = row("b" * 64, "candidate-stage")
    candidate["stagedName"] = "candidate-stage"
    candidate["sourceCommit"] = "c" * 40
    candidate["contractKind"] = native.CANDIDATE_MODE
    renderer = row("7" * 64, "renderer", running=True)
    renderer["unitName"] = "persona-report-renderer-test.service"
    renderer["process"] = {"id": renderer["id"], "name": "/renderer",
                            "image": renderer["image"], "running": True,
                            "pid": 10, "startedAt": "initial"}
    renderer["network"] = {"name": "private-net", "id": "network-id"}
    renderer["readiness"] = {"port": 8080, "path": "/health", "status": 200}
    roles = [row("e" * 64, "budget", running=True, role="budget"),
             row("f" * 64, "avatar", running=True, role="avatar")]
    for index, role in enumerate(roles):
        role["readiness"] = {"port": 8090 + index, "path": "/api/health", "status": 200}
    protected = []
    for index in range(13):
        identifier = format(index + 1, "064x")
        protected_value = {
            "Config": {"Labels": {"synthetic": str(index)}},
            "HostConfig": {"NetworkMode": "private-net"},
            "NetworkSettings": {"Networks": {"private-net": {
                "NetworkID": "network-id", "IPAddress": "172.20.0." + str(index + 2),
                **({"IPAMConfig": {"IPv4Address": "172.20.0.2"}} if index == 0 else {})}}},
            "Mounts": [{"Destination": "/protected", "Source": "/synthetic/" + str(index),
                        "Type": "bind", "RW": False}],
        }
        protected.append({"engine": "rootless", "id": identifier,
                          "contract": {key: identifier for key in
                                       ("config", "host", "mounts", "networks")},
                          "rawContractSha256": raw_contract(protected_value),
                          "raw": protected_value,
                          "process": {"engine": "rootless", "id": identifier, "name": "/protected" + str(index),
                                      "image": "synthetic", "running": True,
                                      "pid": index + 10, "startedAt": "protected"}})
    execstop = "synthetic-execstop"
    restart = {key: "synthetic" for key in
               ("Restart", "RestartUSec", "StartLimitIntervalUSec", "StartLimitBurst",
                "Type", "RemainAfterExit")}
    plan = {
        "schema": native.SCHEMA, "librarySha256": native.LIBRARY_SHA,
        "assistant": assistant, "candidate": candidate, "renderer": renderer,
        "bootRoles": roles, "protectedComponents": protected,
        "operatorPath": "/synthetic/operator.py", "libraryPath": "/synthetic/library.py",
        "planPath": "/synthetic/plan.json", "markerPath": "/synthetic/marker.json",
        "operatorSha256": digest(b"operator"),
        "frozenFiles": [{"path": "/synthetic/frozen", "sha256": digest(b"frozen")}],
        "canonical": {"execStopSha256": digest(execstop.encode()),
                      "restartProperties": restart,
                      "guardPath": "/synthetic/guard", "rendererGuardPath": "/synthetic/renderer-guard"},
        "recovery": {"restoredAndVerified": True, "volume": "synthetic-backup"},
        "preview": {"phase": "full-candidate-boot-copy-verified", "sourceRevision": "c" * 40},
        "precutover": {"capturedAt": 1000, "phase": "fresh-idle-baseline-verified"},
        "state": {"source": "/state", "name": "persona-state"},
        "evidence": {},
    }
    for name, value in evidence_fixture(plan).items():
        path = "/synthetic/evidence-" + name + ".json"
        raw = native.canonical(value) + b"\n"
        plan["evidence"][name] = {"path": path, "sha256": digest(raw)}
    return plan, execstop


class FakeEngine:
    def __init__(self, label):
        self.label = label
        self.rows = {}
        self.calls = []
        self.network = {"Id": "network-id", "Internal": True, "Driver": "bridge",
                        "Containers": {}}
        self.readiness_hook = None
        self.readiness_results = {}

    def inspect(self, identifier):
        self.calls.append(("inspect", identifier))
        return deepcopy(self.rows[identifier])

    def request(self, method, path, body=None):
        self.calls.append((method, path))
        if path == "/containers/json?all=0":
            return [{"Id": value["Id"]} for value in self.rows.values()
                    if value["State"]["Running"]]
        if path == "/containers/json?all=1":
            return [{"Names": [value["Name"]]} for value in self.rows.values()]
        if path.startswith("/networks/"):
            return deepcopy(self.network)
        if path.endswith("/start"):
            identifier = path.split("/")[2]
            self.rows[identifier]["State"].update(Running=True, Pid=900,
                                                   StartedAt="started-now")
            self.network["Containers"][identifier] = {}
            return {}
        if "/stop?" in path:
            identifier = path.split("/")[2]
            self.rows[identifier]["State"].update(Running=False, Pid=0)
            return {}
        if "/rename?name=" in path:
            from urllib.parse import unquote
            identifier = path.split("/")[2]
            self.rows[identifier]["Name"] = "/" + unquote(path.split("name=", 1)[1])
            return {}
        return {}

    def exec_readonly(self, identifier, script):
        self.calls.append(("exec_readonly", identifier))
        if "fetch(" in script:
            self.calls.append(("readiness", identifier))
            if self.readiness_hook:
                self.readiness_hook(identifier)
            return self.readiness_results.get(identifier, {"ready": True, "status": 200})
        return {"counts": [0] * 6}


class FakeRollout:
    @staticmethod
    def network_identity(lifecycle, value, expected):
        if value["State"]["Running"]:
            assert expected == {"private-net": "network-id"}

    @staticmethod
    def ensure_boot_roles(lifecycle):
        results = []
        for role in lifecycle.plan["bootRoles"]:
            before = lifecycle.container(role)
            was_running = before["State"]["Running"]
            if not was_running:
                lifecycle._start(before["Id"])
            lifecycle.engine.calls.append(("role-ready", role["role"]))
            results.append({"role": role["role"], "alreadyRunning": was_running})
        return results

    @staticmethod
    def health(lifecycle):
        lifecycle.engine.calls.append(("health", lifecycle.plan["candidate"]["id"]))
        if lifecycle.health_fails:
            raise native.LifecycleError("synthetic_health_failure")


class FakeBase:
    Rollout = FakeRollout

    @staticmethod
    def contract(value):
        if value.get("RejectContract"):
            raise AssertionError("protected static IPAM must use raw preservation only")
        return value["Contract"]

    @staticmethod
    def candidate_contract(value):
        return value.get("CanonicalCandidateContract", value["Contract"])

    @staticmethod
    def process_projection(value):
        return {"id": value["Id"], "name": value["Name"], "image": value["Image"],
                "running": value["State"]["Running"], "pid": value["State"]["Pid"],
                "startedAt": value["State"]["StartedAt"]}


class LifecycleHarness(unittest.TestCase):
    def setUp(self):
        self.plan, self.execstop = plan_fixture()
        self.engines = {"rootless": FakeEngine("rootless"), "rootful": FakeEngine("rootful")}
        for entry in [self.plan["assistant"], self.plan["candidate"], self.plan["renderer"],
                      *self.plan["bootRoles"]]:
            self.engines["rootless"].rows[entry["id"]] = self.container_value(entry)
        self.engines["rootless"].rows[self.plan["candidate"]["id"]]["Mounts"] = [
            {"Source": "/state/persona.sqlite", "Type": "bind", "RW": True}]
        for entry in self.plan["protectedComponents"]:
            self.engines[entry["engine"]].rows[entry["id"]] = {
                "Id": entry["id"], "Name": entry["process"]["name"], "Image": "synthetic",
                "State": {"Running": True, "Pid": entry["process"]["pid"],
                          "StartedAt": entry["process"]["startedAt"]},
                "Contract": entry["contract"], "Mounts": deepcopy(entry["raw"]["Mounts"]),
                "RejectContract": False,
                **{key: deepcopy(entry["raw"][key]) for key in
                   ("Config", "HostConfig", "NetworkSettings")}}
        self.engines["rootless"].network["Containers"] = {
            self.plan["renderer"]["id"]: {}}
        self.engines["rootless"].rows[self.plan["assistant"]["id"]]["Mounts"] = [
            {"Source": "/state/persona.sqlite", "Type": "bind", "RW": True}]
        self.files = {"/synthetic/frozen": b"frozen", "/synthetic/operator.py": b"operator"}
        for name, evidence in self.plan["evidence"].items():
            self.files[evidence["path"]] = native.canonical(evidence_fixture(self.plan)[name]) + b"\n"
        self.shell_calls = []
        self.execstart_path_override = None
        self.pending_jobs = ""
        def shell(argv):
            self.shell_calls.append(argv)
            self.engines["rootless"].calls.append(("shell", tuple(argv)))
            if "--value" in argv and any("ExecStop" in item for item in argv):
                return self.execstop
            if "--value" in argv and any("ExecStart" in item for item in argv):
                renderer = any(self.plan["renderer"]["unitName"] in item for item in argv)
                content = native.guard_bytes(self.plan, self.plan_sha, renderer).decode()
                command = next(line for line in content.splitlines() if line.startswith("ExecStart=/"))
                path = self.execstart_path_override or "/usr/bin/python3"
                return "ExecStart={ path=" + path + " ; argv[]=" + command[len("ExecStart="):] + " ; }\n"
            if "list-jobs" in argv:
                return self.pending_jobs
            return "\n".join(f"{key}={value}" for key, value in
                              self.plan["canonical"]["restartProperties"].items())
        self.plan_sha = "9" * 64
        self.files["/synthetic/guard"] = native.guard_bytes(self.plan, self.plan_sha)
        self.files["/synthetic/renderer-guard"] = native.guard_bytes(self.plan, self.plan_sha, True)
        self.lifecycle = native.NativeLifecycle(
            self.plan, self.engines, FakeBase, shell, plan_sha=self.plan_sha,
            read_bytes=lambda path: self.files[path], now=lambda: 1001)
        self.lifecycle.health_fails = False
        self.published = []

    def container_value(self, entry):
        return {"Id": entry["id"], "Name": "/" + entry["name"], "Image": entry["image"],
                "State": {"Running": entry["running"], "Pid": 10 if entry["running"] else 0,
                          "StartedAt": "initial" if entry["running"] else ""},
                "Contract": entry["contract"], "Mounts": [],
                "Config": {}, "HostConfig": {},
                "NetworkSettings": {"Networks": {"private-net": {"NetworkID": "network-id"}}}}

    def reject(self, code, action, *args, **kwargs):
        before = deepcopy((self.engines["rootless"].calls, self.engines["rootful"].calls))
        with self.assertRaises(native.LifecycleError) as caught:
            action(*args, **kwargs)
        self.assertEqual(str(caught.exception), code)
        return before

    def configure_resume_files(self):
        old = self.engines["rootless"].rows[self.plan["assistant"]["id"]]
        old["Name"] = "/" + self.plan["assistant"]["retainedName"]
        old["State"].update(Running=False, Pid=0, StartedAt="")
        candidate = self.engines["rootless"].rows[self.plan["candidate"]["id"]]
        candidate["Name"] = "/" + native.APP_NAME
        self.files["/synthetic/guard"] = native.guard_bytes(self.plan, self.plan_sha)
        self.files["/synthetic/renderer-guard"] = native.guard_bytes(self.plan, self.plan_sha, True)
        self.files["/synthetic/marker.json"] = native.canonical({
            "schema": native.SCHEMA, "planSha256": self.plan_sha,
            "candidateId": self.plan["candidate"]["id"],
            "originalId": self.plan["assistant"]["id"], "phase": "switched-stopped"})

    def replace_evidence(self, name, value):
        row = self.lifecycle.plan["evidence"][name]
        raw = native.canonical(value) + b"\n"
        self.files[row["path"]] = raw
        row["sha256"] = digest(raw)

    def publish_mock(self, path, value):
        self.published.append((path, value))


class NativeLifecycleTest(LifecycleHarness):
    def quiet_pins(self):
        return [{"ownerSha256": "1" * 64,
                 "executionId": "11111111-1111-4111-8111-111111111111",
                 "executionRowSha256": "2" * 64,
                 "noteOperationId": "22222222-2222-4222-8222-222222222222",
                 "noteRowSha256": "3" * 64}]

    def enable_quiescent_publication(self):
        pins = self.quiet_pins()
        self.lifecycle.plan["quiescentPublications"] = pins
        baseline = evidence_fixture(self.plan)["baseline"]
        baseline["quiescentPublications"] = pins
        self.replace_evidence("baseline", baseline)
        self.engines["rootless"].exec_readonly = lambda *_: {
            "counts": [0, 0, 1, 0, 0, 0], "quiescentPublications": deepcopy(pins)}
        return pins

    def test_exact_quiescent_publication_can_survive_cutover(self):
        self.enable_quiescent_publication()
        with patch.object(native.Path, "exists", return_value=False), patch.object(native, "publish", self.publish_mock):
            self.assertEqual(self.lifecycle.cutover()["phase"], "switched-stopped")

    def test_quiescent_scope_and_frozen_baseline_are_required(self):
        for value in [None, [], self.quiet_pins() * 2,
                      [{**self.quiet_pins()[0], "unexpected": True}],
                      [{**self.quiet_pins()[0], "noteRowSha256": "bad"}],
                      [{**self.quiet_pins()[0], "executionId": "bad"}]]:
            with self.subTest(value=value), self.assertRaises(native.LifecycleError):
                native.validate({**self.plan, "quiescentPublications": value})
        self.lifecycle.plan["quiescentPublications"] = self.quiet_pins()
        self.reject("quiescent_baseline_binding", self.lifecycle.preflight)

    def test_quiescent_publication_drift_and_other_work_reject_before_stop(self):
        for changed in ["ownerSha256", "executionRowSha256", "noteRowSha256",
                        "executionId", "noteOperationId", "missing", "extra", "active"]:
            self.setUp()
            pins = self.enable_quiescent_publication()
            observed = deepcopy(pins)
            counts = [0, 0, 1, 0, 0, 0]
            if changed == "missing":
                observed = []
            elif changed == "extra":
                observed *= 2
                counts[2] = 2
            elif changed == "active":
                counts[0] = 1
            else:
                observed[0][changed] = "changed"
            self.engines["rootless"].exec_readonly = lambda *_: {
                "counts": counts, "quiescentPublications": observed}
            with self.subTest(changed=changed), patch.object(native.Path, "exists", return_value=False):
                self.reject("active_work_before_stop" if changed in ["extra", "active"]
                            else "quiescent_publication_changed", self.lifecycle.cutover)
            self.assertFalse(any(call[0] == "POST" for call in self.engines["rootless"].calls))

    def test_quiescent_sql_checks_actual_sqlite_rows_without_writes(self):
        program = native.QUIESCENT_PUBLICATIONS + r'''
import assert from'node:assert/strict';import{DatabaseSync}from'node:sqlite';
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE work_executions(owner TEXT,id TEXT,state TEXT,document TEXT,journal TEXT);
CREATE TABLE work_note_publications(owner_id TEXT,operation_id TEXT,payload TEXT,runner TEXT,runner_until INTEGER);`);
const id='11111111-1111-4111-8111-111111111111',op='22222222-2222-4222-8222-222222222222';
function seed(change=()=>{}){
 db.exec('PRAGMA query_only=OFF;DELETE FROM work_executions;DELETE FROM work_note_publications;');
 const value={state:'reconciliation_required',document:{id,state:'reconciliation_required',roles:[{id:'role-one',state:'completed'}]},
  journal:{reconcileRequested:false,cancelRequested:false,noteState:'unknown',noteOperationId:op,roles:[{id:'role-one',result:{text:'private-result'}}],projectOps:[{state:'saved'}]},
  publication:{operationId:op,status:'failed',stage:'layout',errorCode:'conflict',steps:[],receipt:null},runner:null};
 change(value);
 db.prepare('INSERT INTO work_executions VALUES(?,?,?,?,?)').run('owner-private',id,value.state,JSON.stringify(value.document),JSON.stringify(value.journal));
 db.prepare('INSERT INTO work_note_publications VALUES(?,?,?,?,0)').run('owner-private',op,JSON.stringify(value.publication),value.runner);
 db.exec('PRAGMA query_only=ON;');
 return db.prepare('SELECT total_changes() AS n').get().n;
}
let before=seed();const pins=quiescentPublicationPins(db);assert.equal(pins.length,1);
assert.equal(pins[0].executionId,id);assert.equal(pins[0].noteOperationId,op);
assert(!JSON.stringify(pins).includes('private'));assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);
for(const change of [
 v=>v.state='running',v=>v.document.state='publishing',v=>v.document.id='foreign',
 v=>v.journal.reconcileRequested=true,v=>delete v.journal.reconcileRequested,
 v=>v.journal.cancelRequested=true,v=>v.journal.noteState='dispatching',
 v=>v.document.roles=[],v=>v.document.roles[0].state='running',
 v=>v.journal.roles[0].result=null,v=>v.journal.roles[0].id='foreign-role',
 v=>v.journal.projectOps[0].state='dispatching',v=>v.journal.noteOperationId='foreign',
 v=>v.publication.status='publishing',v=>v.publication.stage='page',
 v=>v.publication.errorCode='timeout',v=>v.publication.operationId='foreign',
 v=>v.publication.steps=[{completed:false}],v=>v.publication.receipt={},v=>v.runner='active-runner'
]){
 before=seed(change);assert.throws(()=>quiescentPublicationPins(db));
 assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);
}
seed(v=>v.journal.roles[0].result.text='different-private-result');
assert.notEqual(quiescentPublicationPins(db)[0].executionRowSha256,pins[0].executionRowSha256);
seed(v=>v.publication.additional='changed');
assert.notEqual(quiescentPublicationPins(db)[0].noteRowSha256,pins[0].noteRowSha256);
db.close();console.log('Actual SQLite quiescence: valid, 20 refusal boundaries, row drift and zero observer writes.');
'''
        result = subprocess.run(["node", "--input-type=module", "-"], input=program,
                                text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_preflight_rejects_contract_protected_and_writer_drift(self):
        self.engines["rootless"].rows[self.plan["candidate"]["id"]]["Contract"]["host"] = "drift"
        self.reject("container_contract_changed", self.lifecycle.preflight)
        self.assertFalse(any(call[0] in ("POST", "exec_readonly") for call in self.engines["rootless"].calls))

        self.setUp()
        protected = self.plan["protectedComponents"][0]["id"]
        self.engines["rootless"].rows[protected]["State"]["Pid"] += 1
        self.reject("protected_component_changed", self.lifecycle.preflight)

        self.setUp()
        identifier = "8" * 64
        self.engines["rootful"].rows[identifier] = {
            "Id": identifier, "Name": "/foreign-rootful-writer", "Image": "synthetic",
            "State": {"Running": True, "Pid": 81, "StartedAt": "foreign"},
            "Mounts": [{"Source": "/state/child", "Destination": "/foreign-state",
                        "Type": "bind", "RW": True}]}
        self.reject("foreign_state_writer", self.lifecycle.preflight)
        self.assertFalse(any(call[0] == "POST" for call in self.engines["rootless"].calls))

    def test_protected_raw_network_drift_rejected_without_base_contract(self):
        protected = self.plan["protectedComponents"][0]
        actual = self.engines["rootless"].rows[protected["id"]]
        actual["NetworkSettings"]["Networks"]["private-net"]["IPAddress"] = "172.20.99.99"
        self.reject("protected_raw_network_changed", self.lifecycle.preflight)

        self.setUp()
        protected = self.plan["protectedComponents"][0]
        actual = self.engines["rootless"].rows[protected["id"]]
        actual["RejectContract"] = True
        self.assertEqual(self.lifecycle.preflight()["phase"], "native-preflight")

    def test_candidate_uses_reviewed_oom_contract_without_normalizing_other_roles(self):
        row = self.lifecycle.plan["candidate"]
        actual = self.engines["rootless"].rows[row["id"]]
        canonical = deepcopy(actual["Contract"])
        actual["CanonicalCandidateContract"] = canonical
        # Docker reports false while staged, null after start. The immutable
        # reviewed helper supplies one candidate contract for both wire forms.
        actual["Contract"]["host"] = "staged-false-wire-hash"
        actual["HostConfig"]["OomKillDisable"] = False
        self.lifecycle.container(row)
        actual["Contract"]["host"] = "started-null-wire-hash"
        actual["HostConfig"]["OomKillDisable"] = None
        self.lifecycle.container(row)
        actual["CanonicalCandidateContract"]["host"] = "other-host-change"
        self.reject("container_contract_changed", lambda: self.lifecycle.container(row))

        other = self.lifecycle.plan["assistant"]
        original = self.engines["rootless"].rows[other["id"]]
        original["CanonicalCandidateContract"] = deepcopy(original["Contract"])
        original["Contract"]["host"] = "original-host-change"
        self.reject("container_contract_changed", lambda: self.lifecycle.container(other))

    def test_evidence_candidate_backup_and_revision_mismatches_reject(self):
        proofs = evidence_fixture(self.plan)
        stage, recovery, preview = proofs["stage"], proofs["recovery"], proofs["preview"]
        cases = [
            ("stage", dict(stage, candidateId="0" * 64), "evidence_source_identity"),
            ("recovery", dict(recovery, volume="wrong-backup"), "recovery_evidence"),
            ("preview", dict(preview, sourceRevision="0" * 40), "preview_evidence"),
        ]
        for name, evidence, code in cases:
            with self.subTest(name=name):
                self.setUp()
                self.replace_evidence(name, evidence)
                self.reject(code, self.lifecycle.check_files)

    def test_preflight_rejects_contract_file_execstop_and_restart_drift(self):
        self.files["/synthetic/frozen"] = b"changed"
        self.reject("frozen_file_changed", self.lifecycle.preflight)
        self.setUp()
        self.execstop = "different"
        self.reject("execstop_changed", self.lifecycle.preflight)
        self.setUp()
        self.plan["canonical"]["restartProperties"]["Restart"] = "different"
        self.reject("restart_policy_changed", self.lifecycle.preflight)

    def test_plan_contract_protected_and_writer_validation(self):
        for change, code in [
                (lambda p: p.update(schema="wrong"), "plan_schema"),
                (lambda p: p.update(librarySha256="0" * 64), "library_binding"),
                (lambda p: p["assistant"]["contract"].update(extra="0" * 64), "container_contract"),
                (lambda p: p["protectedComponents"].pop(), "protected_scope"),
                (lambda p: p["candidate"].update(id=p["assistant"]["id"]), "same_candidate")]:
            bad = deepcopy(self.plan)
            change(bad)
            with self.subTest(code=code), self.assertRaises(native.LifecycleError) as caught:
                native.validate(bad)
            self.assertEqual(str(caught.exception), code)

    def test_cutover_stale_baseline_and_active_work_reject_before_stop(self):
        self.lifecycle.now = lambda: 2000
        with patch.object(native.Path, "exists", return_value=False):
            self.reject("fresh_baseline_required", self.lifecycle.cutover)
        self.assertFalse(any(call[0] == "POST" for call in self.engines["rootless"].calls))
        self.setUp()
        self.engines["rootless"].exec_readonly = lambda *_: {"counts": [0, 1, 0, 0, 0, 0]}
        with patch.object(native.Path, "exists", return_value=False):
            self.reject("active_work_before_stop", self.lifecycle.cutover)
        self.assertFalse(any(call == ("POST", "/containers/" + self.plan["assistant"]["id"] + "/stop?t=30")
                             for call in self.engines["rootless"].calls))

    def test_cutover_is_one_shot_stop_rename_publish(self):
        with patch.object(native.Path, "exists", return_value=False), patch.object(native, "publish", self.publish_mock):
            result = self.lifecycle.cutover()
        calls = self.engines["rootless"].calls
        stop = calls.index(("POST", "/containers/" + self.plan["assistant"]["id"] + "/stop?t=30"))
        old_rename = calls.index(("POST", "/containers/" + self.plan["assistant"]["id"]
                                  + "/rename?name=assistant-retained"))
        candidate_rename = calls.index(("POST", "/containers/" + self.plan["candidate"]["id"]
                                        + "/rename?name=" + native.APP_NAME))
        self.assertLess(stop, old_rename)
        self.assertLess(old_rename, candidate_rename)
        effective_checks = [index for index, call in enumerate(calls)
                            if call[0] == "shell" and "--property=ExecStart" in call[1]]
        jobs_check = calls.index(("shell", ("systemctl", "--user", "list-jobs",
                                               "--no-legend", "--no-pager")))
        self.assertEqual(len(effective_checks), 2)
        self.assertTrue(all(index < stop for index in effective_checks))
        self.assertLess(jobs_check, stop)
        self.assertEqual(self.published[0][0], self.plan["markerPath"])
        self.assertEqual(result["phase"], "switched-stopped")
        self.assertFalse(result["dataRestored"])

    def test_resume_health_failure_does_not_restore_or_fallback(self):
        self.configure_resume_files()
        self.lifecycle.health_fails = True
        with self.assertRaises(native.LifecycleError):
            self.lifecycle.resume()
        calls = self.engines["rootless"].calls
        self.assertTrue(any(call[0] == "POST" and call[1].endswith("/start") for call in calls))
        self.assertFalse(any("restore" in str(call).lower() or "rename" in str(call).lower()
                             for call in calls))
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/start")
                             and self.plan["assistant"]["id"] in call[1] for call in calls))

    def test_resume_rejects_wrong_marker_or_candidate_name_before_start(self):
        self.configure_resume_files()
        marker = {"schema": native.SCHEMA, "planSha256": self.plan_sha,
                  "candidateId": "0" * 64, "originalId": self.plan["assistant"]["id"],
                  "phase": "switched-stopped"}
        self.files["/synthetic/marker.json"] = native.canonical(marker)
        self.reject("cutover_marker_changed", self.lifecycle.resume)
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/start")
                             for call in self.engines["rootless"].calls))

        self.setUp()
        self.configure_resume_files()
        candidate = self.engines["rootless"].rows[self.plan["candidate"]["id"]]
        candidate["Name"] = "/unexpected-candidate"
        self.reject("container_name_changed", self.lifecycle.resume)
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/start")
                             for call in self.engines["rootless"].calls))

    def test_cutover_existing_marker_blocks_before_stop(self):
        with patch.object(native.Path, "exists", return_value=True):
            self.reject("cutover_already_consumed", self.lifecycle.cutover)
        self.assertFalse(any(call == ("POST", "/containers/" + self.plan["assistant"]["id"] + "/stop?t=30")
                             for call in self.engines["rootless"].calls))

    def test_running_renderer_roles_candidate_are_adopted_without_process_change(self):
        self.configure_resume_files()
        candidate = self.engines["rootless"].rows[self.plan["candidate"]["id"]]
        candidate["State"].update(Running=True, Pid=311, StartedAt="candidate-existing")
        candidate["Mounts"] = [{"Source": "/state/persona.sqlite", "Type": "bind", "RW": True}]
        for role in self.plan["bootRoles"]:
            self.engines["rootless"].rows[role["id"]]["State"].update(
                Running=True, Pid=role["role"] == "budget" and 201 or 202,
                StartedAt="role-existing")
        self.engines["rootless"].network["Containers"] = {self.plan["renderer"]["id"]: {}}
        before = [FakeBase.process_projection(self.engines["rootless"].rows[item["id"]])
                  for item in [self.plan["renderer"], *self.plan["bootRoles"], self.plan["candidate"]]]
        result = self.lifecycle.resume()
        after = [FakeBase.process_projection(self.engines["rootless"].rows[item["id"]])
                 for item in [self.plan["renderer"], *self.plan["bootRoles"], self.plan["candidate"]]]
        self.assertEqual(before, after)
        self.assertTrue(result["alreadyRunning"])
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/start")
                             for call in self.engines["rootless"].calls))

    def test_stopped_resume_orders_renderer_then_budget_avatar_then_candidate(self):
        self.configure_resume_files()
        engine = self.engines["rootless"]
        engine.rows[self.plan["renderer"]["id"]]["State"].update(Running=False, Pid=0, StartedAt="")
        engine.rows[self.plan["assistant"]["id"]]["State"].update(Running=False, Pid=0, StartedAt="")
        for role in self.plan["bootRoles"]:
            engine.rows[role["id"]]["State"].update(Running=False, Pid=0, StartedAt="")
        engine.rows[self.plan["candidate"]["id"]]["Mounts"] = [
            {"Source": "/state/persona.sqlite", "Type": "bind", "RW": True}]
        engine.network["Containers"] = {}
        self.lifecycle.resume()
        starts = [call[1].split("/")[2] for call in engine.calls
                  if call[0] == "POST" and call[1].endswith("/start")]
        expected = [self.plan["renderer"]["id"], self.plan["bootRoles"][0]["id"],
                    self.plan["bootRoles"][1]["id"], self.plan["candidate"]["id"]]
        self.assertEqual(starts, expected)
        events = engine.calls
        renderer_ready = events.index(("readiness", self.plan["renderer"]["id"]))
        budget_ready = events.index(("readiness", self.plan["bootRoles"][0]["id"]))
        avatar_ready = events.index(("readiness", self.plan["bootRoles"][1]["id"]))
        self.assertLess(renderer_ready, events.index(("POST", "/containers/" + expected[1] + "/start")))
        self.assertLess(budget_ready, events.index(("POST", "/containers/" + expected[2] + "/start")))
        self.assertLess(avatar_ready, events.index(("POST", "/containers/" + expected[3] + "/start")))

    def test_overlapping_stopped_boot_role_rejected_before_any_start(self):
        self.configure_resume_files()
        engine = self.engines["rootless"]
        role = self.plan["bootRoles"][0]
        value = engine.rows[role["id"]]
        value["State"].update(Running=False, Pid=0, StartedAt="")
        value["Mounts"] = [{"Source": "/state", "Destination": "/state",
                            "Type": "bind", "RW": True}]
        self.reject("boot_role_state_overlap", self.lifecycle.resume)
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/start")
                             for call in engine.calls))

    def test_writer_added_after_roles_blocks_candidate_start(self):
        self.configure_resume_files()
        engine = self.engines["rootless"]
        injected_id = "0" * 64
        def inject_after_avatar(identifier):
            if identifier == self.plan["bootRoles"][1]["id"]:
                engine.rows[injected_id] = {
                    "Id": injected_id, "Name": "/late-writer", "Image": "synthetic",
                    "State": {"Running": True, "Pid": 700, "StartedAt": "late"},
                    "Mounts": [{"Source": "/state/new.sqlite", "Destination": "/state",
                                "Type": "bind", "RW": True}]}
        engine.readiness_hook = inject_after_avatar
        self.reject("writer_after_boot_roles", self.lifecycle.resume)
        self.assertFalse(any(call == ("POST", "/containers/" + self.plan["candidate"]["id"] + "/start")
                             for call in engine.calls))

    def test_renderer_unhealthy_or_probe_failure_blocks_roles_and_candidate(self):
        for mode in ("unhealthy", "probe_failure"):
            with self.subTest(mode=mode):
                self.setUp()
                self.configure_resume_files()
                engine = self.engines["rootless"]
                renderer = engine.rows[self.plan["renderer"]["id"]]
                if mode == "unhealthy":
                    renderer["State"]["Health"] = {"Status": "unhealthy"}
                    expected = "dependency_unhealthy"
                    with patch.object(native.time, "sleep", return_value=None):
                        self.reject(expected, self.lifecycle.resume)
                else:
                    engine.readiness_results[self.plan["renderer"]["id"]] = {
                        "ready": False, "status": 503}
                    with patch.object(native.time, "sleep", return_value=None):
                        self.reject("dependency_readiness_failed", self.lifecycle.resume)
                self.assertFalse(any(call[0] == "POST" and call[1].endswith("/start")
                                     for call in engine.calls))

    def test_boot_role_readiness_failure_blocks_later_role_and_candidate(self):
        self.configure_resume_files()
        engine = self.engines["rootless"]
        first, second = self.plan["bootRoles"]
        engine.rows[first["id"]]["State"].update(Running=False, Pid=0, StartedAt="")
        engine.readiness_results[first["id"]] = {"ready": False, "status": 503}
        with patch.object(native.time, "sleep", return_value=None):
            self.reject("dependency_readiness_failed", self.lifecycle.resume)
        starts = [call[1] for call in engine.calls if call[0] == "POST" and call[1].endswith("/start")]
        self.assertEqual(starts, ["/containers/" + first["id"] + "/start"])
        self.assertFalse(any(call[0] == "POST" and call[1] == "/containers/" + second["id"] + "/start"
                             for call in engine.calls))
        self.assertFalse(any(call[0] == "POST" and call[1] == "/containers/" + self.plan["candidate"]["id"] + "/start"
                             for call in engine.calls))

    def test_guard_or_execstop_mismatch_blocks_before_any_start(self):
        self.configure_resume_files()
        self.files["/synthetic/guard"] = b"wrong guard"
        self.reject("guard_file_changed", self.lifecycle.resume)
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/start")
                             for call in self.engines["rootless"].calls))
        self.setUp()
        self.configure_resume_files()
        self.execstop = "wrong execstop"
        self.reject("execstop_changed", self.lifecycle.resume)
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/start")
                             for call in self.engines["rootless"].calls))

    def test_guard_effective_mismatch_blocks_before_roles_or_candidate_start(self):
        self.configure_resume_files()
        # Invalid effective argv is returned by the fake systemctl boundary.
        original_shell = self.lifecycle.shell
        self.lifecycle.shell = lambda argv: "ExecStart=wrong\n" if any(
            "ExecStart" in item for item in argv) else original_shell(argv)
        self.reject("guard_not_effective", self.lifecycle.resume)
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/start")
                             for call in self.engines["rootless"].calls))

    def test_missing_or_wrong_interpreter_guard_blocks_cutover_before_stop(self):
        del self.files["/synthetic/guard"]
        with self.assertRaises(KeyError):
            self.lifecycle.cutover()
        stop = ("POST", "/containers/" + self.plan["assistant"]["id"] + "/stop?t=30")
        self.assertNotIn(stop, self.engines["rootless"].calls)

        self.setUp()
        self.execstart_path_override = "/wrong/python"
        self.reject("guard_not_effective", self.lifecycle.cutover)
        self.assertNotIn(stop, self.engines["rootless"].calls)

    def test_pending_systemd_start_job_blocks_cutover_before_stop(self):
        self.pending_jobs = "17 persona-apps.service start running\n"
        self.reject("pending_start_job", self.lifecycle.cutover)
        stop = ("POST", "/containers/" + self.plan["assistant"]["id"] + "/stop?t=30")
        self.assertNotIn(stop, self.engines["rootless"].calls)

    def test_writer_conflict_blocks_before_roles_and_candidate_start(self):
        self.configure_resume_files()
        self.engines["rootless"].rows["1".zfill(64)]["Mounts"] = [
            {"Source": "/state/other.sqlite", "Type": "bind", "RW": True}]
        self.reject("boot_writer_conflict", self.lifecycle.resume)
        self.assertFalse(any(call[0] == "POST" and call[1].endswith("/start")
                             for call in self.engines["rootless"].calls))


if __name__ == "__main__":
    unittest.main()
