import { readConfig } from "../api/config.ts";
import { Store } from "../../packages/storage/store.ts";
import { CodexCollector } from "../../packages/adapters/codex/index.ts";

const path = process.env.TRACK_CONFIG;
if (!path) throw new Error("TRACK_CONFIG is required");
const config = readConfig(path);
const store = new Store(config.database);
try {
  const collector = new CodexCollector(store);
  for (const source of config.sources) {
    if (source.kind !== "codex" || !source.logRoot || !source.repositoryRoots.length) continue;
    const report = await collector.collect({ sourceId: source.id, logRoot: source.logRoot,
      repositoryRoots: source.repositoryRoots, maxFiles: source.maxFiles, sinceDays: source.sinceDays });
    console.log(JSON.stringify({ source: source.id, ...report }));
  }
} finally { store.close(); }
