import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Sources } from "../apps/api/runner.ts";
import { Store } from "../packages/storage/store.ts";
import type { Config } from "../apps/api/config.ts";

test("source kind changes clear cached connected state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "track-source-state-"));
  const store = new Store(":memory:");
  const source: Config["sources"][number] = {
    id: "local", kind: "codex", label: "Local", device: "test", users: ["owner@example.com"],
    logRoot: dir, repositoryRoots: [dir], runIds: [], discoverActive: false, maxFiles: 10, sinceDays: 7,
  };
  let current: Config = {
    port: 14345, database: join(dir, "test.sqlite"), publicOrigin: "https://track.example.com",
    auth: { mode: "local", user: "owner@example.com" }, sources: [source],
  };
  const sources = new Sources(store, () => current);
  const started = sources.start();
  try {
    for (let attempt = 0; attempt < 100 && sources.views("owner@example.com")[0]?.state !== "connected"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(sources.views("owner@example.com")[0]?.state, "connected");

    current = { ...current, sources: [{ ...source, kind: "assistant" }] };
    assert.equal(sources.views("owner@example.com")[0]?.state, "unsupported");
  } finally {
    sources.stop();
    await started;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
