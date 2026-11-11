import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

// Public HTTP only: no native cookies, reader key or proxy identity.
const run = promisify(execFile);
const release = JSON.parse(await readFile(resolve(process.argv[2]), "utf8"));
const root = resolve(".runtime/projects-context/public-probe");
await mkdir(root, { recursive: true });
const curl = process.platform === "win32" ? "curl.exe" : "curl";
const sha = data => createHash("sha256").update(data).digest("hex");
const files = Object.entries(release.payloadFiles).filter(([name]) =>
  name.startsWith("web/dist/assets/") || ["favicon.svg", "favicon.ico", "favicon-light-32.png", "favicon-dark-32.png"].includes(basename(name)));
const assets = [];
for (const [name, expected] of files) {
  const path = "/" + name.slice("web/dist/".length);
  const body = join(root, basename(name)); const headers = body + ".headers";
  await run(curl, ["--silent", "--show-error", "--connect-timeout", "10", "--max-time", "25", "--output", body, "--dump-header", headers, "https://projects.pydemia.ai" + path]);
  const raw = await readFile(headers, "utf8"); const status = [...raw.matchAll(/^HTTP\/\S+ (\d+)/gm)].at(-1)?.[1];
  const mime = [...raw.matchAll(/^content-type:\s*([^;\r\n]+)/gim)].at(-1)?.[1].trim();
  const allowed = name.endsWith(".js") ? ["text/javascript", "application/javascript"] : name.endsWith(".css") ? ["text/css"] : name.endsWith(".svg") ? ["image/svg+xml"] : name.endsWith(".ico") ? ["image/x-icon", "image/vnd.microsoft.icon"] : ["image/png"];
  if (status !== "200" || !allowed.includes(mime) || sha(await readFile(body)) !== expected) throw new Error("Public asset mismatch: " + path);
  assets.push({ path, status: 200, contentType: mime, sha256: expected });
}
const body = join(root, "anonymous.body"); const headers = join(root, "anonymous.headers");
await run(curl, ["--silent", "--show-error", "--connect-timeout", "10", "--max-time", "25", "--output", body, "--dump-header", headers, "https://projects.pydemia.ai/api/projects/7b0bc73a-8a1f-4111-9d7f-cc85efad3fea/agent-track"]);
const raw = await readFile(headers, "utf8"); const status = Number([...raw.matchAll(/^HTTP\/\S+ (\d+)/gm)].at(-1)?.[1]);
if (![302, 401, 403].includes(status) || (await readFile(body, "utf8")).includes('"summary"')) throw new Error("Anonymous context boundary failed");
if (status === 302) {
  const location = [...raw.matchAll(/^location:\s*([^\r\n]+)/gim)].at(-1)?.[1];
  const url = new URL(location, "https://projects.pydemia.ai");
  if (!((url.origin === "https://projects.pydemia.ai" && url.pathname.startsWith("/oauth2/")) || url.origin === "https://login.microsoftonline.com")) throw new Error("Unexpected authentication redirect");
}
const result = { verifiedAt: new Date().toISOString(), scope: "public unauthenticated assets and native context denial; authenticated UI checked separately", image: release.image, payloadSha256: release.payloadSha256, assets, anonymousContextStatus: status };
await writeFile("docs/projects-context-public-verification.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ assetsMatched: assets.length, anonymousContextStatus: status }));
