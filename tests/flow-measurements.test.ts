import assert from "node:assert/strict";
import test from "node:test";
import { adoptUserNodes, Position } from "@xyflow/system";
import { captureFlowMeasurements, measuredFlowNodes } from "../apps/web/src/flow-measurements.ts";
import type { FlowNode } from "../apps/web/src/ui/flow-canvas.tsx";

const node: FlowNode = { id: "node", type: "pyd-flow-node", position: { x: 0, y: 0 }, width: 240, height: 136, data: { title: "Observed" } };
test("controlled metadata refresh retains React Flow port bounds instead of removing all edges", () => {
  const lookup = new Map(), parents = new Map();
  adoptUserNodes([node], lookup, parents);
  const bounds = { source: [{ id: null, x: 234, y: 62, width: 12, height: 12, position: Position.Right, type: "source", nodeId: node.id }], target: [] };
  lookup.get(node.id).internals.handleBounds = bounds;
  const refresh = { ...node, data: { title: "Status refreshed" } };
  adoptUserNodes([refresh], lookup, parents);
  assert.equal(lookup.get(node.id).internals.handleBounds, undefined);
  lookup.get(node.id).internals.handleBounds = bounds;
  const measurements = captureFlowMeasurements(new Map(), [{ id: node.id, type: "dimensions", dimensions: { width: 240, height: 136 } }]);
  adoptUserNodes(measuredFlowNodes([refresh], measurements), lookup, parents);
  assert.deepEqual(lookup.get(node.id).internals.handleBounds, bounds);
});

test("resized groups must measure their new geometry; unchanged dimensions do not churn state", () => {
  const change = { id: node.id, type: "dimensions" as const, dimensions: { width: 240, height: 136 } };
  const measurements = captureFlowMeasurements(new Map(), [change]);
  assert.equal(captureFlowMeasurements(measurements, [change]), measurements);
  assert.equal(captureFlowMeasurements(measurements, [{ ...change, dimensions: { width: NaN, height: 0 } }]), measurements);
  const resized = { ...node, width: 600 };
  assert.equal(measuredFlowNodes([resized], measurements)[0], resized);
  const updated = captureFlowMeasurements(measurements, [{ ...change, dimensions: { width: 600, height: 136 } }]);
  assert.deepEqual(measuredFlowNodes([resized], updated)[0]!.measured, { width: 600, height: 136 });
  assert.equal(node.measured, undefined);
});
