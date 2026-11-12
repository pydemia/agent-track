import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { AssistantClient, AssistantSourceError } from "../packages/adapters/assistant/index.ts";
import { AssistantReadService, AssistantReadError } from "../packages/assistant-read/service.ts";

const origin = "http://127.0.0.1:12345";
const instant = "2026-11-12T00:00:00.000Z";
const owner = "sso-sub:" + "a".repeat(64);
const id = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const caps = { version: 1, service: "assistant", audience: "agent-track", ownerId: owner,
  principalId: "track-reader", revision: "1", executionsRead: true, eventsRead: true,
  controls: false, listLimit: 50, eventLimit: 100, demianReferencesSupported: false };
const page = { version: 1, observedAt: instant, executions: [], cursor: null, hasMore: false, omitted: 0, complete: false };
const events = { version: 1, observedAt: instant, executionId: id(), events: [], cursor: "0", hasMore: false, complete: false };
const json = (value: unknown) => Response.json(value);
const failure = (status: number) => (error: unknown) => {
  assert.ok(error instanceof AssistantSourceError);
  assert.equal(error.status, status);
  assert.equal(error.message, "assistant_source_unavailable");
  assert.equal(error.cause, undefined);
  assert.deepEqual(Object.keys(error), ["status"]);
  return true;
};

function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "track-assistant-v2-client-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("track-assistant-v2-client-"));
    rmSync(root, { recursive: true, force: true });
  });
  const secretFile = join(root, "client.key");
  const credentialFile = join(root, "client.json");
  const secret = randomBytes(32).toString("base64url");
  const config = { version: 1, audience: "agent-track", sourceId: "assistant-native", user: "local-user",
    ownerId: owner, principalId: "track-reader", revision: 1, notBefore: "2026-11-11T00:00:00Z",
    expiresAt: "2026-12-12T00:00:00Z", nativeOrigin: origin, secretFile };
  const edit = (patch: Record<string, unknown>) => writeFileSync(credentialFile, JSON.stringify({ ...config, ...patch }));
  edit({}); writeFileSync(secretFile, secret);
  let clock = Date.parse(instant);
  const calls: string[] = [];
  let respond: (url: URL, init: RequestInit) => Response | Promise<Response> = url =>
    json(url.pathname.endsWith("/capabilities") ? caps : url.pathname.endsWith("/events") ? events : page);
  const transport: typeof fetch = async (input, init) => {
    assert.equal(typeof input, "string");
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    assert.equal(url.origin, origin);
    assert.equal(init?.method, "GET"); assert.equal(init.redirect, "manual"); assert.equal(init.credentials, "omit");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), `Bearer ${secret}`);
    assert.equal(headers.get("x-agent-track-principal"), config.principalId);
    assert.equal(headers.get("cookie"), null);
    return respond(url, init);
  };
  const options = { sourceId: config.sourceId, baseUrl: origin, credentialFile, user: config.user,
    ownerId: owner, principalId: config.principalId, fetch: transport, now: () => clock };
  return { root, config, secret, secretFile, credentialFile, options, edit, calls,
    client: new AssistantClient(options), respond: (fn: typeof respond) => { respond = fn; },
    advance: (value: number) => { clock += value; } };
}


test("v2 selection is immutable, exact, and never falls back on incompatible capabilities", async t => {
  const f = fixture(t);
  const options = { ...f.options, protocol: 2 as 1 | 2 };
  const client = new AssistantClient(options);
  options.protocol = 1;
  await assert.rejects(client.executions(), failure(502));
  assert.deepEqual(f.calls, ["/api/integrations/track/v2/capabilities"]);
  f.respond(url => json(url.pathname.endsWith("/capabilities") ? {...caps,version:2,demianReferencesSupported:true} : {...page,version:2}));
  assert.equal((await client.executions()).version, 2);
  assert.ok(f.calls.every(path => path.startsWith("/api/integrations/track/v2/")));
  await assert.rejects(f.client.capabilities(), failure(502));
});
test("v2 data envelopes cannot downgrade or carry private response fields", async t => {
  const f = fixture(t); const client = new AssistantClient({...f.options,protocol:2});
  for (const value of [page, {...page,version:2,body:"private"}]) {
    f.respond(url => json(url.pathname.endsWith("/capabilities") ? {...caps,version:2,demianReferencesSupported:true} : value));
    await assert.rejects(client.executions(), failure(502));
  }
  f.respond(url => json(url.pathname.endsWith("/capabilities") ? {...caps,version:2,demianReferencesSupported:true} : {...events,version:2}));
  assert.equal((await client.events(id())).version,2);
});
test("v2 does not borrow source, owner, principal, user or origin grants", async t => {
  const f = fixture(t);
  for (const patch of [{sourceId:"other"},{ownerId:"sso-sub:"+"b".repeat(64)},{principalId:"other"},{user:"other"},{nativeOrigin:"https://other.example"},{version:2}]) {
    f.edit(patch);
    await assert.rejects(new AssistantClient({...f.options,protocol:2}).capabilities(),failure(401));
  }
  assert.equal(f.calls.length,0);
});
test("canonical producer omits v1 external rows and isolates cursor MACs", async t => {
  const f = fixture(t); const configFile = join(f.root,"producer.json");
  const {sourceId,user,nativeOrigin,...grant}=f.config;
  writeFileSync(configFile,JSON.stringify({...grant,enabled:true}));
  const raw = {id:id(),instructionId:id(2),instructionRevision:1,revision:1,state:"completed",errorCode:null,taskRef:null,createdAt:instant,updatedAt:instant,
    roles:[{id:id(3),assignmentId:"a",workPackageId:"w",membershipId:"m",membershipRevision:1,teamId:"t",teamName:"Team",personaName:"Agent",role:"Writer",responsibility:"contributor",state:"completed",runtimeTaskId:null,threadId:null,turnId:null,attempts:1,
      observation:{basis:"external_run_wall_timestamps_unverified",queuedAt:null,startedAt:instant,endedAt:instant,executionSeconds:null,timingComplete:false}}]};
  const seen: Array<1|2|undefined> = [];
  const service = (protocol:1|2) => new AssistantReadService({protocol,configFile,configuredOwner:()=>owner,now:()=>Date.parse(instant),port:{
    scan:()=>({rows:[{id:id(),ordinal:"2"}],through:"2",hasMore:true}),
    execution:(_owner,_id,version)=>{seen.push(version);return raw;},events:()=>({events:[],hasMore:false})}});
  const v1=service(1),v2=service(2);
  const request=(protocol:1|2,path:string)=>({method:"GET",url:"/api/integrations/track/v"+protocol+path,headers:{authorization:"Bearer "+f.secret,"x-agent-track-principal":f.config.principalId}});
  const one=await v1.handle(request(1,"/executions")) as {omitted:number;executions:unknown[];cursor:string};
  const two=await v2.handle(request(2,"/executions")) as {omitted:number;executions:unknown[];cursor:string};
  assert.equal(one.omitted,1);assert.equal(one.executions.length,0);assert.equal(two.omitted,0);assert.equal(two.executions.length,1);
  assert.deepEqual(seen,[1,2]);
  for(const [svc,protocol,cursor] of [[v1,1,two.cursor],[v2,2,one.cursor]] as const)
    await assert.rejects(svc.handle(request(protocol,"/executions?cursor="+cursor)),e=>e instanceof AssistantReadError && e.status===400);
  await assert.rejects(v1.handle(request(1,"/executions/"+id())),e=>e instanceof AssistantReadError && e.status===404);
  await assert.rejects(v1.handle(request(1,"/executions/"+id()+"/events")),e=>e instanceof AssistantReadError && e.status===404);
  await assert.rejects(v2.handle(request(1,"/capabilities")),e=>e instanceof AssistantReadError && e.status===404);
});
