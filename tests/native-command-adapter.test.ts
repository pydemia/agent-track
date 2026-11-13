import assert from "node:assert/strict";
import { test } from "node:test";
import { DemianClient } from "../packages/adapters/demian/index.ts";
import { nativeCommandContextSchema, nativeCommandReceiptSchema, nativeCommandStatusSchema,
  nativeCommandWriteSchema, type NativeCommandWrite } from "../packages/contracts/native-run-commands.ts";

const source = "00000000-0000-4000-8000-000000000001", session = "00000000-0000-4000-8000-000000000002";
const successor = "00000000-0000-4000-8000-000000000003", commandId = "00000000-0000-4000-8000-000000000004";
const now = new Date().toISOString(), expires = new Date(Date.now() + 60_000).toISOString();
const command: NativeCommandWrite["command"] = { version: 1, commandId, sourceRunId: source, kind: "retry",
  expectedSessionHead: "a".repeat(64), expectedSourceStatus: "failed", expectedAuthoritySha256: "b".repeat(64), expiresAt: expires };
const context = () => ({ object: "demian.run_command_context", version: 1,
  source_run: { id: source, session_id: session, status: "failed" }, session_head_sha256: command.expectedSessionHead,
  authority_sha256: command.expectedAuthoritySha256, available_kinds: ["retry", "continue"], observed_at: now });
const receipt = () => ({ object: "demian.run_command_receipt", version: 1, command_id: commandId,
  session_id: session, source_run_id: source, kind: "retry", outcome: "accepted", rejection_code: null,
  new_run_id: successor, task_root_run_id: source, relation: "retry_of", created_at: now, expires_at: expires });
const client = (fetch: typeof globalThis.fetch) => new DemianClient({ sourceId: "ordinary-native", baseUrl: "http://native.test", fetch });

test("native command transport binds context, admission and recovery to their exact fixed routes and tuple", async () => {
  const calls: { path: string; method: string }[] = [];
  const c = client(async (url, init) => {
    const path = new URL(String(url)).pathname, method = init?.method ?? "GET";
    calls.push({ path, method }); assert.equal(init?.redirect, "error");
    if (path.endsWith("command-context")) return Response.json(context());
    if (method === "POST") { assert.deepEqual(JSON.parse(String(init?.body)), { command }); return Response.json(receipt(), { status: 202 }); }
    return Response.json({ object: "demian.run_command_status", version: 1, status: "found", receipt: receipt() });
  });
  assert.equal((await c.commandContext(source)).source_run.id, source);
  assert.equal((await c.command({ command }, session)).new_run_id, successor);
  assert.equal((await c.commandReceipt(session, command)).receipt?.new_run_id, successor);
  assert.deepEqual(calls, [
    { path: `/api/v1/runs/${source}/command-context`, method: "GET" },
    { path: `/api/v1/runs/${source}/commands`, method: "POST" },
    { path: `/api/v1/sessions/${session}/commands/${commandId}`, method: "GET" },
  ]);
});

test("durable 409 rejection stays a receipt, and not_found recovery never sends another command", async () => {
  const rejected = { ...receipt(), outcome: "rejected", rejection_code: "session_head_changed", new_run_id: null, task_root_run_id: null, relation: null };
  assert.equal((await client(async () => Response.json(rejected, { status: 409 })).command({ command }, session)).outcome, "rejected");
  let posts = 0;
  const c = client(async (_url, init) => {
    if (init?.method === "POST") { posts++; throw new Error("response lost"); }
    return Response.json({ object: "demian.run_command_status", version: 1, status: "not_found", receipt: null });
  });
  await assert.rejects(c.command({ command }, session));
  assert.equal((await c.commandReceipt(session, command)).status, "not_found"); assert.equal(posts, 1);
});

test("command replies reject wrong identities, kind, deadline, outcome and private fields", async () => {
  for (const patch of [{ command_id: successor }, { source_run_id: successor }, { session_id: source },
    { kind: "resume", relation: "continues" }, { expires_at: now }, { actor_user_id: "PRIVATE_ACTOR" },
    { recovery_proof_sha256: "PRIVATE_PROOF" }, { new_run_id: source }]) {
    const c = client(async () => Response.json({ ...receipt(), ...patch }, { status: 202 }));
    await assert.rejects(c.command({ command }, session));
    await assert.rejects(client(async () => Response.json({ object: "demian.run_command_status", version: 1, status: "found", receipt: { ...receipt(), ...patch } })).commandReceipt(session, command));
  }
  await assert.rejects(client(async () => Response.json(receipt(), { status: 409 })).command({ command }, session));
  await assert.rejects(client(async () => Response.json(receipt(), { status: 201 })).command({ command }, session));
  await assert.rejects(client(async () => Response.json({ ...context(), source_run: { ...context().source_run, id: successor } })).commandContext(source));
});

test("command contract closes unsupported states and continuation input rules before any dispatch", async () => {
  const offset = new Date(Date.parse(expires) + 9 * 60 * 60 * 1000).toISOString().replace("Z", "+09:00");
  assert.equal(nativeCommandWriteSchema.parse({ command: { ...command, expiresAt: offset } }).command.expiresAt, expires);
  assert.equal(nativeCommandWriteSchema.safeParse({ command, input: [{ type: "input_text", text: "changed retry" }] }).success, false);
  assert.equal(nativeCommandWriteSchema.safeParse({ command: { ...command, kind: "continue" } }).success, false);
  assert.equal(nativeCommandWriteSchema.safeParse({ command: { ...command, kind: "continue" }, input: [{ type: "input_text", text: "next task" }] }).success, true);
  assert.equal(nativeCommandContextSchema.safeParse({ ...context(), available_kinds: ["resume"] }).success, false);
  assert.equal(nativeCommandContextSchema.safeParse({ ...context(), available_kinds: ["retry", "retry"] }).success, false);
  assert.equal(nativeCommandContextSchema.safeParse({ ...context(), source_run: { ...context().source_run, status: "waiting_for_permission" } }).success, false);
  assert.equal(nativeCommandStatusSchema.safeParse({ object: "demian.run_command_status", version: 1, status: "not_found", receipt: receipt() }).success, false);
  assert.equal(nativeCommandReceiptSchema.safeParse({ ...receipt(), kind: "continue", relation: "continues" }).success, false);
  let requests = 0; const c = client(async () => { requests++; return Response.json(receipt()); });
  await assert.rejects(c.command({ command: { ...command, sourceRunId: "../other" } }, session)); assert.equal(requests, 0);
});
