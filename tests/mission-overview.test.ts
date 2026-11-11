import assert from "node:assert/strict";
import { test } from "node:test";
import { missionOverview } from "../packages/projection/mission-overview.ts";
import type { RunView } from "../packages/contracts/index.ts";

test("mission overview joins exact task bindings across sessions and counts source-qualified Runs once", () => {
  const at = "2026-11-11T12:00:00Z";
  const run = (sourceId: string, projectId: string, taskId: string | null): RunView => ({ key: JSON.stringify([sourceId, "run"]), sourceId, runId: "run",
    sessionId: "same-session", workspaceId: null, title: "same title", status: "succeeded", createdAt: at, startedAt: at, completedAt: at, observedAt: at,
    cursor: "0", highWater: "0", incomplete: false, stale: false, sourceLabel: sourceId, device: "one", sourceState: "connected", sourceUrl: null,
    workspaceKey: null, projectKey: null, capabilities: [], binding: taskId ? { sourceId, runId: "run", projectSourceId: "projects", projectId, taskId,
      taskRevision: "1", projectTitle: "Project", taskTitle: "Task", provenance: "operator" } : null });
  const first = run("a", "p", "t"); const other = run("b", "p", "t"); other.status = "waiting_for_permission";
  const foreign = run("c", "different-project", "t"); const unbound = run("d", "p", null);
  const input = [first, first, other, foreign, unbound]; const before = structuredClone(input);
  const result = missionOverview(input, []); assert.equal(result.length, 2);
  const joined = result.find((item) => item.runs.length === 2)!;
  assert.equal(joined.sessions, 2); assert.equal(joined.active, 1); assert.equal(joined.decisions, 1);
  assert.equal(joined.childRelations, 0); assert.equal(joined.peerRelations, 0);
  assert.equal("done" in joined, false); assert.deepEqual(input, before);
});
