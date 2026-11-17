import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileRunSelection } from "../apps/web/src/run-selection.ts";

const key = Buffer.from(JSON.stringify(["native-owner", "run-a"])).toString("base64url");
const view = (state: "connected" | "disconnected" | "forbidden" | "unsupported", present = false) => ({
  sources: [{ id: "native-owner", state }],
  runs: present ? [{ key, sourceId: "native-owner" }] : [],
});

test("a transient source loss keeps only the selection intent until fresh authorized metadata returns", () => {
  let selected = key;
  const initial = view("connected", true);
  selected = reconcileRunSelection(selected, initial, false);
  const outage = view("disconnected");
  selected = reconcileRunSelection(selected, outage, false);
  assert.equal(selected, key);
  assert.equal(outage.runs.find(run => run.key === selected), undefined, "no old Run is used as fallback metadata");
  selected = reconcileRunSelection(selected, view("connected", true), false);
  assert.equal(selected, key);
});

test("authority withdrawal, source removal and actor change forget the intent", () => {
  for (const denied of [view("forbidden"), view("unsupported"), view("connected"), {sources:[], runs:[]}]) {
    const cleared = reconcileRunSelection(key, denied, false);
    assert.equal(cleared, "");
    assert.equal(reconcileRunSelection(cleared, view("connected", true), false), "");
  }
  assert.equal(reconcileRunSelection(key, view("connected", true), true), "");
  assert.equal(reconcileRunSelection(key, view("disconnected"), true), "");
  assert.equal(reconcileRunSelection(key, view("forbidden", true), false), "");
});

test("an unrelated failing source cannot retain a removed selected Run", () => {
  const removed = {sources:[{id:"other",state:"disconnected" as const}],runs:[]};
  assert.equal(reconcileRunSelection(key, removed, false), "");
  for (const malformed of ["not-a-run-key", "a".repeat(9000), Buffer.from(JSON.stringify(["native-owner"])).toString("base64url")])
    assert.equal(reconcileRunSelection(malformed, view("disconnected"), false), "");
});
