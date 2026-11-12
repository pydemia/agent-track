import assert from "node:assert/strict";
import test from "node:test";
import { patchStartup } from "../deploy/demian/patch-startup.mjs";

const apiLaunch = "await launch('api', ['apps/api/dist/main.mjs'], repo, commonEnv)";
const gateLaunch = "await launch('auth-gate',process.execPath,[state+'/auth-gate.mjs'],root)";
const tunnelLaunch = "if(process.argv.includes('--with-tunnel'))await launch('domain-tunnel',root+'/bin/cloudflared.exe',['tunnel','--token-file',config.tokenFile],root)";
const local = `const repo = config.repository
${apiLaunch}
await launch('web', [repo + '/node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3000'], repo + '/apps/web', {
  ...commonEnv, DEMIAN_API_INTERNAL_URL: config.apiUrl, DEMIAN_WEB_PUBLIC_URL: config.webUrl,
})
`;
const publicWeb = `const children=[]
await launch('public-web',process.execPath,[service.repository+'/node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(config.webPort)],service.repository+'/apps/web',{
 ...env,DEMIAN_AUTH_MODE:'trusted',DEMIAN_API_TOKEN:secret.apiToken,DEMIAN_API_INTERNAL_URL:service.apiUrl,DEMIAN_WEB_PUBLIC_URL:config.publicUrl})
${gateLaunch}
${tunnelLaunch}
`;

test("local startup retains the API command and original web fallback", () => {
  const result = patchStartup(local, "local");
  assert.ok(result.includes(apiLaunch));
  assert.ok(result.includes("trackWeb ? [trackWeb.entry] : [repo + '/node_modules/next/dist/bin/next'"));
  assert.ok(result.includes("DEMIAN_API_INTERNAL_URL: config.apiUrl, DEMIAN_WEB_PUBLIC_URL: config.webUrl"));
  assert.ok(result.includes("HOSTNAME: '127.0.0.1', PORT: '3000'"));
  assert.ok(result.includes(".catch(() => null)"));
});

test("public startup retains gate, tunnel, credentials and the configured origin", () => {
  const result = patchStartup(publicWeb, "public");
  assert.ok(result.includes(gateLaunch)); assert.ok(result.includes(tunnelLaunch));
  assert.ok(result.includes("DEMIAN_AUTH_MODE:'trusted',DEMIAN_API_TOKEN:secret.apiToken,DEMIAN_API_INTERNAL_URL:service.apiUrl,DEMIAN_WEB_PUBLIC_URL:config.publicUrl"));
  assert.ok(result.includes("trackWeb?.cwd ?? service.repository+'/apps/web'"));
  assert.ok(result.includes("HOSTNAME:'127.0.0.1',PORT:String(config.webPort)"));
});

test("unknown native source and already patched startup are rejected for review", () => {
  assert.throws(() => patchStartup(local.replace("'--port', '3000'", "'--port', '3999'"), "local"), /Native startup changed/);
  assert.throws(() => patchStartup(local + "\nconst repo = config.repository", "local"), /Native startup changed/);
  assert.throws(() => patchStartup(patchStartup(local, "local"), "local"), /Native startup changed/);
  assert.throws(() => patchStartup(patchStartup(publicWeb, "public"), "public"), /Native startup changed/);
});

test("public-only patch selects only public activation and keeps backend launch bytes intact", () => {
  const result = patchStartup(publicWeb, "public", { publicOnly: true });
  assert.ok(result.includes("module.loadWebRelease(root,'public')"));
  assert.ok(result.includes("if(config.webPort!==3001)throw new Error('Public web must use port 3001')"));
  assert.ok(result.includes(gateLaunch));
  assert.ok(result.includes(tunnelLaunch));
  assert.ok(!result.includes("loadWebRelease(root)"));
  assert.throws(() => patchStartup(local, "local", { publicOnly: true }), /public-only/);
  assert.throws(() => patchStartup(result, "public", { publicOnly: true }), /Native startup changed/);
});

test("public-only startup refuses port 3000 before any launch, while its 3001 fallback preserves gate and tunnel", async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction("config", "service", "secret", "env", "root", "state", "process", "launch",
    patchStartup(publicWeb, "public", { publicOnly: true }));
  const launches: string[] = [];
  const invoke = (webPort: number) => run({ webPort, publicUrl: "https://fixture.invalid", tokenFile: "/fixture/token" },
    { repository: "/fixture/repo", apiUrl: "http://127.0.0.1:8080" }, { apiToken: "fixture-only" }, {},
    "/fixture/root", "/fixture/domain", { execPath: "/fixture/node", argv: ["--with-tunnel"] },
    async (name: string) => { launches.push(name); });
  await assert.rejects(invoke(3000), /Public web must use port 3001/);
  assert.deepEqual(launches, []);
  await invoke(3001);
  assert.deepEqual(launches, ["public-web", "auth-gate", "domain-tunnel"]);
});
