import assert from "node:assert/strict";
import test from "node:test";
import { missionNodeOrder } from "../packages/projection/mission-order.ts";
import type { MissionEdge, MissionNode } from "../packages/projection/mission-flow.ts";

const node = (key: string, kind: string, sequence?: string): MissionNode => ({ key, id: key, kind, label: key, status: "observed", description: "", sourceId: "native", details: [], sequences: sequence ? [sequence] : [] });
const edge = (from: string, to: string): MissionEdge => ({ key: `${from}:${to}`, from, to, kind: "ownership", label: "소속", detail: "", sourceId: "native", sequences: [] });

test("Session and Run columns share lanes even when their opaque IDs sort in opposite order", () => {
  const nodes = [node("session-a", "session"), node("session-b", "session"), node("run-a", "run"), node("run-b", "run"), node("tool-a", "tool", "10"), node("tool-z", "tool", "9")];
  const edges = [edge("session-a", "run-b"), edge("session-b", "run-a")];
  const before = JSON.stringify({ nodes, edges }); const order = missionNodeOrder({ nodes, edges });
  assert.ok(order.indexOf("session-a") < order.indexOf("session-b"));
  assert.ok(order.indexOf("run-b") < order.indexOf("run-a"));
  assert.ok(order.indexOf("tool-z") < order.indexOf("tool-a"), "tool chronology uses numeric string sequence");
  assert.deepEqual(missionNodeOrder({ nodes: [...nodes].reverse(), edges: [...edges].reverse() }), order);
  assert.equal(JSON.stringify({ nodes, edges }), before, "does not mutate the graph or invent a relation");
});
