import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandService, type CancelPorts } from "../packages/commands/index.ts";
import { Store } from "../packages/storage/store.ts";

const sourceId = "source-a";
const runId = "tracked-run-key";
const runKey = Buffer.from(JSON.stringify([sourceId, runId])).toString("base64url");

test("already-cancelling Run does not dispatch a second native cancel", async () => {
  const store = new Store(":memory:");
  const service = new CommandService(store);
  let dispatches = 0;
  const ports: CancelPorts = {
    async authorize() {},
    async readRun() { return { sourceId, runId, status: "cancelling", cursor: "7" }; },
    async cancel(id) { dispatches++; return { sourceId, runId: id, status: "cancelling" }; },
    now: () => Date.parse("2026-11-11T10:00:00.000Z"),
  };

  try {
    await service.execute("alice", {
      kind: "cancel", runKey, idempotencyKey: "11111111-1111-4111-8111-111111111111",
      expectedCursor: "7", expiresAt: "2026-11-11T10:00:30.000Z",
    }, ports);
    assert.equal(dispatches, 0, "a Run observed in cancelling state must not trigger another cancel request");
  } finally {
    store.close();
  }
});
