import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { requestPublicGate } from "../deploy/demian/public-web-gate.mjs";
import { publicWebLaunchPrerequisites, readWebVerificationResponse } from "../deploy/demian/promote-public-web.mjs";
import { executePublicWebTransition } from "../deploy/demian/public-web-transition.mjs";
import { recoverPublicWeb, type PublicWebInspection } from "../deploy/demian/recover-webs.mjs";

test("gate reads preserve the public Host, do not follow redirects and bound streaming duration", { timeout: 10000 }, async () => {
  let seenHost = "", encoding = "", redirectFollowed = false;
  const server = createServer((req, res) => {
    seenHost = req.headers.host ?? ""; encoding = String(req.headers["accept-encoding"]);
    if (req.url === "/redirect") { res.writeHead(302, { Location: "/unexpected" }); res.end(); return; }
    if (req.url === "/unexpected") redirectFollowed = true;
    if (req.url === "/slow") { res.writeHead(200); res.write("pending"); return; }
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string"); const port = address.port;
  assert(![3000, 3001, 3100, 8080, 14345].includes(port));
  try {
    const response = await requestPublicGate("/", {}, { port });
    assert.equal(response.status, 200); assert.equal((await readWebVerificationResponse(response, 10)).toString(), "ok");
    assert.equal(seenHost, "demian.pydemia.ai"); assert.equal(encoding, "identity");
    const redirect = await requestPublicGate("/redirect", {}, { port }); assert.equal(redirect.status, 302); await redirect.body?.cancel();
    assert.equal(redirectFollowed, false);
    await assert.rejects(async () => { const slow = await requestPublicGate("/slow", {}, { port, timeoutMs: 30 }); await readWebVerificationResponse(slow, 1024); });
    for (const path of ["//foreign.invalid/", "/\r\nInjected: x", "relative"]) assert.throws(() => requestPublicGate(path, {}, { port }));
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("Docker preservation failure after stop still restores the fallback through the ownership guard", async () => {
  const original = { pid: 101 }, fallback = { pid: 303 };
  const states = new Map<number, PublicWebInspection>([[original.pid, { state: "owned-live" }]]);
  let containerCalls = 0, starts = 0, committed = 0, ownershipCalls = 0;
  const checks = { ownership: async () => { ownershipCalls++; }, preservation: async () => { containerCalls++; throw new Error("Docker inspection unavailable"); } };
  const result = await executePublicWebTransition({ original, prepare: async () => {}, checkPreserved: async () => {},
    journal: async () => {}, inspect: async record => states.get(record.pid)!, stop: async () => { states.set(original.pid, { state: "exited-free" }); },
    startCandidate: async () => { await publicWebLaunchPrerequisites("candidate", checks); starts++; return { pid: 202 }; },
    findCandidate: async () => undefined, verifyCandidate: async () => {}, commitCandidate: async () => { committed++; },
    recover: async () => recoverPublicWeb({ original, activateFallback: async () => {}, journalIntent: async () => {},
      inspect: async record => states.get(record.pid)!, stop: async () => {},
      startFrozenFallback: async () => { await publicWebLaunchPrerequisites("rollback", checks); starts++; states.set(fallback.pid, { state: "owned-live" }); return fallback; },
      commitPublic: async () => { committed++; } }), report: async () => {} });
  assert.equal(result.committed, false); assert.equal(result.recovery?.recoveredIdentity, fallback);
  assert.equal(result.recovery?.recoveryFailed, false); assert.equal(containerCalls, 1); assert.equal(ownershipCalls, 2);
  assert.equal(starts, 1); assert.equal(committed, 1);
});

test("rollback still refuses changed backend ownership and unknown launch phases", async () => {
  let preservationCalls = 0;
  const checks = { ownership: async () => { throw new Error("Changed backend ownership"); }, preservation: async () => { preservationCalls++; } };
  await assert.rejects(publicWebLaunchPrerequisites("rollback", checks), /Changed backend ownership/);
  await assert.rejects(publicWebLaunchPrerequisites("unknown" as "rollback", checks));
  assert.equal(preservationCalls, 0);
});
