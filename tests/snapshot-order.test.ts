import assert from "node:assert/strict";
import { test } from "node:test";
import { SnapshotOrder } from "../packages/projection/snapshot-order.ts";

test("a delayed allowed HTTP snapshot cannot restore metadata removed by a newer policy snapshot", () => {
  const order = new SnapshotOrder();
  let visible: string[] = [];
  const apply = (viewVersion: string, runs: string[]) => {
    if (order.accept({ viewEpoch: "same-server", viewVersion })) visible = runs;
  };
  apply("100", ["private-bound-run"]);
  apply("102", []);
  apply("101", ["private-bound-run"]);
  assert.deepEqual(visible, []);
  apply("102", ["conflicting-repeat"]);
  assert.deepEqual(visible, []);
});

test("BFF restart accepts a new epoch and rejects all delayed frames from the retired process", () => {
  const order = new SnapshotOrder();
  assert.equal(order.accept({ viewEpoch: "old", viewVersion: "9007199254740992" }), true);
  assert.equal(order.accept({ viewEpoch: "old", viewVersion: "9007199254740993" }), true);
  assert.equal(order.accept({ viewEpoch: "new", viewVersion: "1" }), true);
  assert.equal(order.accept({ viewEpoch: "old", viewVersion: "99999999999999999" }), false);
  assert.equal(order.accept({ viewEpoch: "new", viewVersion: "2" }), true);
  assert.equal(order.accept({ viewEpoch: "new", viewVersion: "01" }), false);
});
