import assert from "node:assert/strict";
import test from "node:test";
import { recoverWebProfiles } from "../deploy/demian/recover-webs.mjs";

const originals = { local: { pid: 100 }, public: { pid: 200 } };
const replacements = { local: { pid: 1 }, public: { pid: 2 } };
const stopped = new Set<"local" | "public">(["local", "public"]);

test("a conflicting public listener does not prevent local recovery and metadata repair", async () => {
  const committed: Array<[string, number]> = [];
  const events: string[] = [];
  const result = await recoverWebProfiles({ originals, replacements, stopped,
    activateFallback: async () => { events.push("activation"); },
    stop: async record => { events.push("stop:" + record.pid); if (record.pid === 2) throw new Error("Foreign listener preserved"); },
    start: async profile => ({ pid: profile === "local" ? 11 : 22, entry: "frozen-original", startedAt: "fixture" }),
    inspectOriginal: async () => ({ exited: false }), commitProfile: async (profile, record) => { committed.push([profile, record.pid]); },
  });
  assert.equal(events[0], "activation");
  assert.deepEqual(committed, [["local", 11]]);
  assert.deepEqual(result.failedProfiles, ["public"]);
  assert.deepEqual(result.recoveredIdentities.local, { pid: 11, entry: "frozen-original", startedAt: "fixture" });
});

test("lost activation ownership preserves running replacements without destructive cleanup", async () => {
  let operations = 0;
  await assert.rejects(recoverWebProfiles({ originals, replacements, stopped,
    activateFallback: async () => { throw new Error("Activation ownership changed"); },
    stop: async () => { operations++; }, start: async () => { operations++; return { pid: 11 }; },
    inspectOriginal: async () => ({ exited: false }), commitProfile: async () => { operations++; },
  }), /ownership changed/);
  assert.equal(operations, 0);
});

test("a profile metadata failure retains both recovered identities and repairs its sibling", async () => {
  const attempted: string[] = [];
  const result = await recoverWebProfiles({ originals, replacements, stopped,
    activateFallback: async () => {}, stop: async () => {}, start: async profile => ({ pid: profile === "local" ? 11 : 22 }),
    inspectOriginal: async () => ({ exited: false }), commitProfile: async profile => { attempted.push(profile); if (profile === "local") throw new Error("Metadata conflict"); },
  });
  assert.deepEqual(attempted, ["local", "public"]);
  assert.deepEqual(result.metadataUpdateFailures, ["local"]);
  assert.deepEqual(result.recoveredIdentities, { local: { pid: 11 }, public: { pid: 22 } });
});

test("an exited replacement permits both original profiles to be restored", async () => {
  const result = await recoverWebProfiles({ originals, replacements, stopped,
    activateFallback: async () => {}, stop: async () => ({ exited: true, portFree: true }),
    start: async profile => ({ pid: profile === "local" ? 11 : 22 }), inspectOriginal: async () => ({ exited: false }), commitProfile: async () => {},
  });
  assert.deepEqual(result.failedProfiles, []); assert.deepEqual(result.metadataUpdateFailures, []);
  assert.deepEqual(result.recoveredIdentities, { local: { pid: 11 }, public: { pid: 22 } });
});
