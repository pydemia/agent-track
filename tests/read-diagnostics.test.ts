import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { configSchema, type SourceConfig } from "../apps/api/config.ts";
import { ReadDiagnostics, ReadTrace, readFailureStatus, withReadOrigin } from "../apps/api/read-diagnostics.ts";
import { Sources } from "../apps/api/runner.ts";
import { createTrackServer } from "../apps/api/server.ts";
import { Store } from "../packages/storage/store.ts";

const owner = "owner@example.com", other = "other@example.com";
const source = (): SourceConfig => configSchema.parse({ database: join(tmpdir(), "unused-diagnostics.sqlite"), publicOrigin: "http://localhost", auth: { mode: "local", user: owner }, sources: [
  { id: "reader", kind: "assistant", label: "PRIVATE_LABEL", device: "test", users: [owner], baseUrl: "https://private.example" },
] }).sources[0]!;

test("read diagnostics preserve client results, errors and this binding without recording private inputs", async () => {
  const diagnostics = new ReadDiagnostics(), input = source(), trace = diagnostics.begin(input, owner, "assistant.native-evidence");
  const secret = "DO_NOT_RECORD_BODY_TOKEN_OR_ERROR", result = { token: secret };
  const failure = Object.assign(new Error(secret), { status: 403 });
  class Client {
    #value = result;
    async capabilities(_argument: unknown) { return this.#value; }
    async nativeEvidence() { throw failure; }
    credentialFence() { return () => this.#value; }
  }
  const client = trace.client(new Client());
  assert.equal(await client.capabilities(secret), result);
  assert.equal(client.credentialFence()(), result);
  await assert.rejects(client.nativeEvidence(), error => error === failure);
  trace.finish(403, false, "forbidden");
  const records = diagnostics.snapshot(owner, [input]);
  assert.deepEqual(records[0]!.steps.map(step => [step.name, step.status]), [["rpc.capabilities", 200], ["rpc.nativeEvidence", 403]]);
  assert.doesNotMatch(JSON.stringify(records), /DO_NOT_RECORD|PRIVATE_LABEL|private\.example|owner@example/);
});

test("diagnostics are bounded, copied, actor-isolated and withdrawn with current source identity or membership", () => {
  const diagnostics = new ReadDiagnostics(), input = source();
  for (let i = 0; i < 140; i++) diagnostics.begin(input, owner, "assistant.list").finish(200);
  const trace = diagnostics.begin(input, owner, "assistant.detail");
  for (let i = 0; i < 80; i++) trace.step("rpc.execution")();
  trace.finish(200);
  const records = diagnostics.snapshot(owner, [input]); assert.equal(records.length, 128);
  assert.equal(records.at(-1)!.steps.length, 64); assert.equal(records.at(-1)!.omittedSteps, 16);
  records.at(-1)!.steps.length = 0;
  assert.equal(diagnostics.snapshot(owner, [input]).at(-1)!.steps.length, 64);
  assert.deepEqual(diagnostics.snapshot(other, [input]), []);
  assert.deepEqual(diagnostics.snapshot(owner, [{ ...input, users: [] }]), []);
  assert.deepEqual(diagnostics.snapshot(owner, [{ ...input, baseUrl: "https://changed.example" }]), []);
});

test("late work cannot rewrite the timing result captured when an authority deadline won", async () => {
  const trace = new ReadTrace("reader", "assistant.native-window");
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const work = trace.measure("rpc.nativeMetadata", () => gate);
  trace.admission(1, 25); trace.finish(503, true, "disconnected");
  const finished = structuredClone(trace.observation);
  release(); await work;
  assert.deepEqual(trace.observation, finished);
  assert.equal(finished.steps[0]!.status, null); assert.equal(finished.deadlineReached, true);
  assert.equal(finished.queueDepth, 1); assert.equal(finished.remainingBudgetAtAdmissionMs, 25);
});

test("request origins cross awaits independently and never record supplied URLs or evaluate error getters", async () => {
  const diagnostics = new ReadDiagnostics(), input = source();
  const [snapshot, evidence] = await Promise.all([
    withReadOrigin("/api/snapshot?credential=SECRET", async () => { await Promise.resolve(); return diagnostics.begin(input, owner, "native.refresh"); }),
    withReadOrigin("/api/runs/PRIVATE_KEY/evidence", async () => { await Promise.resolve(); return diagnostics.begin(input, owner, "assistant.native-evidence"); }),
  ]);
  assert.equal(snapshot.observation.origin, "snapshot"); assert.equal(evidence.observation.origin, "evidence");
  assert.equal(diagnostics.begin(input, owner, "native.collect").observation.origin, "background");
  assert.doesNotMatch(JSON.stringify(diagnostics.snapshot(owner, [input])), /SECRET|PRIVATE_KEY|credential=/);
  let invoked = false;
  assert.equal(readFailureStatus({ get status() { invoked = true; throw new Error("SECRET"); } }), 503);
  assert.equal(invoked, false);
});

test("diagnostic HTTP is authenticated, read-only, actor-filtered and performs no upstream refresh", async t => {
  const temp = realpathSync(tmpdir()), root = mkdtempSync(join(temp, "track-read-diagnostics-"));
  const secret = randomBytes(32).toString("base64url"), secretFile = join(root, "proxy.key"); writeFileSync(secretFile, secret);
  const input = source(), config = configSchema.parse({ database: join(root, "track.sqlite"), publicOrigin: "http://localhost",
    auth: { mode: "proxy", users: [owner, other], secretFile }, sources: [input] });
  const store = new Store(config.database), sources = new Sources(store, () => config);
  sources.readDiagnostics.begin(input, owner, "assistant.list").finish(200);
  sources.refreshProjectGrants = async () => { throw new Error("Unexpected upstream request"); };
  const { server } = createTrackServer(store, () => config, root, sources);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string"); const url = `http://127.0.0.1:${address.port}/api/read-diagnostics`;
  t.after(async () => { sources.stop(); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); store.close();
    assert.equal(dirname(root), temp); assert(basename(root).startsWith("track-read-diagnostics-")); rmSync(root, { recursive: true }); });
  assert.equal((await fetch(url)).status, 401);
  const headers = { "x-track-proxy-key": secret, "x-forwarded-email": owner };
  const response = await fetch(url, { headers }); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json(); assert.equal(result.version, 1); assert.equal(result.operations.length, 1);
  assert.equal((await (await fetch(url, { headers: { ...headers, "x-forwarded-email": other } })).json()).operations.length, 0);
  assert.equal((await fetch(url + "?actor=" + owner, { headers })).status, 400);
  assert.equal((await fetch(url, { method: "POST", headers })).status, 405);
});
