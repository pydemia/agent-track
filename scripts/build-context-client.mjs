import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const outDir = resolve(root, ".runtime/context-client");
await build({ root, configFile: false, ssr: { noExternal: true }, build: {
  ssr: "packages/context/client.ts", outDir, target: "node22", emptyOutDir: false, minify: false,
  rollupOptions: { output: { entryFileNames: "client.mjs" } },
} });
const digest = (data) => createHash("sha256").update(data).digest("hex");
const files = ["packages/context/client.ts", "packages/context/contracts.ts", "packages/contracts/index.ts"];
const sources = await Promise.all(files.map(async (path) => ({ path, sha256: digest(await readFile(resolve(root, path))) })));
const bundle = await readFile(resolve(outDir, "client.mjs"));
const metadata = { builtAt: new Date().toISOString(), target: "node22", sources, bundle: { name: "client.mjs", bytes: bundle.length, sha256: digest(bundle) } };
await writeFile(resolve(outDir, "build.json"), JSON.stringify(metadata, null, 2) + "\n");
console.log(JSON.stringify(metadata));
