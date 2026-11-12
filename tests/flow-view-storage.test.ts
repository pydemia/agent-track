import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import type { FlowViewContent } from "../packages/contracts/flow-views.ts";
import { FlowViewLimitError, FlowViewRepository } from "../packages/storage/flow-views.ts";
import { Store } from "../packages/storage/store.ts";

const contextId = "a".repeat(64);
const otherContext = "b".repeat(64);
const id = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`;
function content(name = "Saved flow", context = contextId): FlowViewContent {
  return {
    version: 1, contextId: context, name,
    anchors: { tasks: [{ sourceId: "local", projectId: id(100), taskId: id(101) }], runs: [], assistants: [] },
    state: {
      by: "task", depth: "detail", bundles: [{ key: "bundle", label: "Work", taskKeys: ["task:a", "task:b"] }],
      overrides: [["task:a", true], ["bundle", false]], focus: "task:b",
    },
  };
}
function memory(t: TestContext) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  return { db, repo: new FlowViewRepository(db) };
}

test("file persistence preserves bundles/collapse and remains compatible with Store v2", () => {
  const root = realpathSync(tmpdir());
  const fixture = realpathSync(mkdtempSync(join(root, "agent-track-flow-views-")));
  const path = join(fixture, "views.sqlite");
  let store: Store | undefined;
  try {
    store = new Store(path);
    const repo = new FlowViewRepository(store.db);
    const saved = repo.put("owner", id(1), 0, content());
    assert.ok(saved);
    assert.deepEqual(saved.content, content());
    assert.equal("actor" in saved, false);
    assert.equal(new Date(saved.createdAt).toISOString(), saved.createdAt);
    store.close();
    store = undefined;
    store = new Store(path);
    const reopened = new FlowViewRepository(store.db);
    assert.deepEqual(reopened.get("owner", id(1)), saved);
    assert.deepEqual(reopened.list("owner", contextId), [saved]);
    assert.equal(store.db.prepare("SELECT value FROM metadata WHERE key='schema_version'").get()?.value, "2");
    const secondDb = new DatabaseSync(path);
    try {
      const secondConnection = new FlowViewRepository(secondDb);
      const updated = secondConnection.put("owner", id(1), 1, content("Second connection"));
      assert.ok(updated);
      assert.equal(reopened.put("owner", id(1), 1, content("Stale connection")), null);
      assert.equal(reopened.remove("owner", id(1), 1), false);
      assert.deepEqual(reopened.get("owner", id(1)), updated);
    } finally {
      secondDb.close();
    }
    assert.equal(reopened.remove("owner", id(1), 2), true);
    store.close();
    store = undefined;
    store = new Store(path);
    assert.equal(new FlowViewRepository(store.db).get("owner", id(1)), undefined);
  } finally {
    store?.close();
    const target = realpathSync(fixture);
    assert.equal(target, fixture);
    assert.equal(dirname(target), root);
    rmSync(target, { recursive: true });
  }
});

test("CAS conflicts and missing revisions leave all persisted fields unchanged", t => {
  const { repo } = memory(t);
  assert.equal(repo.put("owner", id(1), 1, content()), null);
  const first = repo.put("owner", id(1), 0, content());
  assert.ok(first);
  assert.equal(repo.put("owner", id(1), 0, content("duplicate")), null);
  const second = repo.put("owner", id(1), 1, content("Updated", otherContext));
  assert.ok(second);
  assert.equal(second.revision, 2);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(new Date(second.updatedAt).toISOString(), second.updatedAt);
  assert.equal(repo.put("owner", id(1), 1, content("Stale")), null);
  assert.equal(repo.remove("owner", id(1), 1), false);
  assert.equal(repo.remove("owner", id(1), 0), false);
  assert.deepEqual(repo.get("owner", id(1)), second);
  assert.deepEqual(repo.list("owner", contextId), []);
  assert.deepEqual(repo.list("owner", otherContext), [second]);
  assert.equal(repo.remove("owner", id(1), 2), true);
  assert.equal(repo.remove("owner", id(1), 2), false);
});

test("owners cannot read/update/delete each other's records and may reuse a UUID", t => {
  const { repo } = memory(t);
  const owner = "owner' OR 1=1 --";
  const first = repo.put(owner, id(1), 0, content("Private title"));
  assert.equal(repo.get("other", id(1)), undefined);
  assert.deepEqual(repo.list("other", contextId), []);
  assert.equal(repo.put("other", id(1), 1, content("Overwrite")), null);
  assert.equal(repo.remove("other", id(1), 1), false);
  assert.throws(() => repo.get(id(1), owner), { message: "Invalid flow view input" });
  assert.ok(repo.put("other", id(1), 0, content("Other title")));
  assert.deepEqual(repo.get(owner, id(1)), first);
  assert.deepEqual(repo.list("other", contextId).map(view => view.content.name), ["Other title"]);
  assert.equal(repo.remove("other", id(1), 1), true);
  assert.deepEqual(repo.get(owner, id(1)), first);
});

test("quota spans contexts, permits updates at 20, and is independent for each owner", t => {
  const { repo } = memory(t);
  for (let n = 1; n <= 20; n++) assert.ok(repo.put("owner", id(n), 0, content("View", n % 2 ? contextId : otherContext)));
  assert.throws(() => repo.put("owner", id(21), 0, content()), FlowViewLimitError);
  assert.equal(repo.put("owner", id(21), 1, content()), null);
  assert.equal(repo.put("owner", id(1), 0, content()), null);
  assert.equal(repo.put("owner", id(1), 1, content("Updated"))?.revision, 2);
  assert.ok(repo.put("other", id(21), 0, content()));
  assert.equal(repo.remove("owner", id(2), 1), true);
  assert.ok(repo.put("owner", id(21), 0, content()));
  assert.equal(repo.list("owner", contextId).length + repo.list("owner", otherContext).length, 20);
});

test("list ordering breaks timestamp ties by id and filters context and owner", t => {
  const { repo, db } = memory(t);
  for (const n of [3, 1, 2]) repo.put("owner", id(n), 0, content());
  repo.put("other", id(4), 0, content());
  repo.put("owner", id(5), 0, content("Elsewhere", otherContext));
  db.prepare("UPDATE saved_flow_views SET created_at=?").run("2026-01-01T00:00:00.000Z");
  assert.deepEqual(repo.list("owner", contextId).map(view => view.id), [id(1), id(2), id(3)]);
});

test("runtime input validation rejects malformed values without disclosing input", t => {
  const { repo } = memory(t);
  const secret = "PRIVATE_RAW_CONTENT";
  for (const invalid of [{ ...content(), extra: secret }, { ...content(), name: "" }, { ...content(), version: 2 }]) {
    assert.throws(() => repo.put("owner", id(1), 0, invalid as FlowViewContent), { message: "Invalid flow view input" });
  }
  assert.throws(() => repo.put("", id(1), 0, content()));
  assert.throws(() => repo.get("owner", "bad-id"));
  assert.throws(() => repo.list("owner", "bad-context"));
  for (const revision of [-1, 0.5, NaN, 2_147_483_647]) {
    assert.throws(() => repo.put("owner", id(1), revision, content()));
    assert.throws(() => repo.remove("owner", id(1), revision));
  }
  assert.deepEqual(repo.list("owner", contextId), []);
});

test("corrupt stored JSON, schemas, metadata and revisions fail closed with sanitized errors", t => {
  const { repo, db } = memory(t);
  repo.put("owner", id(1), 0, content());
  const original = JSON.stringify(content());
  for (const corrupted of ["PRIVATE_RAW_CONTENT{", JSON.stringify({ ...content(), extra: "PRIVATE_RAW_CONTENT" }), "null"]) {
    db.prepare("UPDATE saved_flow_views SET content=?").run(corrupted);
    for (const read of [() => repo.get("owner", id(1)), () => repo.list("owner", contextId),
      () => repo.put("owner", id(1), 1, content()), () => repo.remove("owner", id(1), 1)]) {
      assert.throws(read, { message: "Invalid stored flow view" });
    }
    assert.deepEqual(repo.list("other", contextId), []);
  }
  db.prepare("UPDATE saved_flow_views SET content=?").run(original);
  for (const assignment of ["revision=0", "created_at='invalid'", "context_id='wrong'"]) {
    db.exec(`UPDATE saved_flow_views SET ${assignment}`);
    assert.throws(() => repo.get("owner", id(1)), { message: "Invalid stored flow view" });
    db.prepare("UPDATE saved_flow_views SET revision=1,created_at=?,context_id=?").run("2026-01-01T00:00:00.000Z", contextId);
  }
  assert.equal(repo.put("owner", id(1), 1, content())?.revision, 2);
});

test("failed SQL writes roll back and release the transaction for subsequent writes", t => {
  const { repo, db } = memory(t);
  const first = repo.put("owner", id(1), 0, content());
  db.exec(`CREATE TRIGGER reject_flow_update AFTER UPDATE ON saved_flow_views
    BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  assert.throws(() => repo.put("owner", id(1), 1, content("Must roll back")), /injected failure/);
  assert.deepEqual(repo.get("owner", id(1)), first);
  db.exec("DROP TRIGGER reject_flow_update");
  assert.equal(repo.put("owner", id(1), 1, content("Recovered"))?.revision, 2);
  db.prepare("UPDATE saved_flow_views SET revision=?").run(2_147_483_646);
  assert.throws(() => repo.put("owner", id(1), 2_147_483_646, content()));
  assert.equal(repo.get("owner", id(1))?.revision, 2_147_483_646);
  assert.ok(repo.put("owner", id(2), 0, content()));
});
