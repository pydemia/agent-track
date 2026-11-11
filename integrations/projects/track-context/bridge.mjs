import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { Readable } from "node:stream";
import { ContextSummaryClient } from "./client.mjs";

// The host BFF supplies only stable target IDs. Credentials stay in private files.
async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error("configuration_required");
  const config = JSON.parse(await readFile(filename, "utf8"));
  const input = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 2048) throw new Error("target_limit");
    input.push(chunk);
  }
  const target = JSON.parse(Buffer.concat(input).toString("utf8"));
  const privateFetch = (input, init) => new Promise((resolve, reject) => {
    const url = new URL(input);
    if (url.origin !== "http://localhost" || init.method !== "GET" || !url.pathname.startsWith("/api/integrations/context/v1/")) {
      reject(new Error("invalid_private_route")); return;
    }
    const headers = Object.fromEntries(new Headers(init.headers));
    const outgoing = request({ socketPath: config.socket_path, path: url.pathname, method: "GET", headers: { ...headers, host: "localhost" }, signal: init.signal }, (incoming) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(key, value);
      resolve(new Response(Readable.toWeb(incoming), { status: incoming.statusCode, headers }));
    });
    outgoing.once("error", reject); outgoing.end();
  });
  const client = new ContextSummaryClient({ baseUrl: "http://localhost", readerId: config.reader_id, tokenFile: config.secret_file,
    publicOrigin: config.public_origin, fetch: privateFetch });
  process.stdout.write(JSON.stringify(await client.read(target)));
}
await main().catch(() => { process.stdout.write(JSON.stringify({ state: "unavailable", summary: null })); });
