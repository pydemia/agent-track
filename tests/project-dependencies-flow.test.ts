import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectTaskMetadata, RunView, SourceView } from "../packages/contracts/index.ts";
import type { ProjectDependencyPage } from "../packages/contracts/project-dependencies.ts";
import { dependencyEntityKey, projectDependenciesFlow } from "../packages/projection/project-dependencies-flow.ts";

const at = "2026-11-12T01:02:03Z";
const task = (id: string, projectId = "p"): ProjectTaskMetadata => ({
  id, projectId, title: `Task ${id}`, revision: "9", state: "todo", requiresTest: true,
});
const grant = (ids = ["p", "q", "owner"]): SourceView[] => [{ id: "projects", kind: "projects",
  label: "Projects", device: "test", state: "connected", lastObservedAt: at,
  detail: "", capabilities: [], authorizedProjectIds: ids }];
const dependency = (from: string, to: string, id = `${from}-${to}`) => ({
  id, projectId: "owner", relation: "depends_on" as const,
  fromTask: task(from), toTask: task(to, "q"), fromRevision: "2", toRevision: "3",
});
const page = (dependencies = [dependency("dependent", "prerequisite")]): ProjectDependencyPage => ({
  sourceId: "projects", projectId: "p", supported: true, observedAt: at, dependencies, hasMore: false,
});
function run(sourceId = "native", id = "run", projectSourceId = "projects", projectId = "p", taskId = "dependent"): RunView {
  return { sourceId, runId: id, sessionId: "same-session", workspaceId: null, title: "Observed Run",
    status: "succeeded", createdAt: at, startedAt: at, completedAt: at, observedAt: at,
    key: JSON.stringify([sourceId, id]), cursor: "0", highWater: "0", incomplete: false, stale: false,
    binding: { sourceId, runId: id, projectSourceId, projectId, taskId, taskRevision: "4",
      projectTitle: "Project", taskTitle: "Task", provenance: "source" },
    sourceLabel: sourceId, device: "test", sourceState: "connected", sourceUrl: null,
    workspaceKey: null, projectKey: null, capabilities: [] };
}

test("native prerequisite arrow preserves exact IDs, current states and link revisions without Runs", () => {
  const result = projectDependenciesFlow(page(), [], grant());
  assert.equal(result.nodes.length, 2);
  const edge = result.edges[0]!;
  assert.equal(edge.from, dependencyEntityKey("projects", "task", "prerequisite"));
  assert.equal(edge.to, dependencyEntityKey("projects", "task", "dependent"));
  assert.equal(edge.label, "선행 조건");
  assert.match(edge.detail, /fromTask dependent depends_on toTask prerequisite/);
  assert.match(edge.detail, /Relation ID: dependent-prerequisite/);
  assert.match(edge.detail, /현재 revision 9; 관계 기록 revision 2/);
  assert.match(edge.detail, /현재 revision 9; 관계 기록 revision 3/);
  assert.ok(result.nodes.every((n) => n.status === "todo"));
});

test("only exact explicit bindings attach observed Runs; source-qualified collisions remain separate", () => {
  const a = run(); const b = run("other-native");
  const result = projectDependenciesFlow(page(), [a, b, a,
    run("native", "foreign-task-source", "foreign"), run("native", "foreign-project", "projects", "q"),
    run("native", "absent-task", "projects", "p", "missing"),
    { ...run("native", "no-binding"), binding: null }], grant());
  assert.equal(result.nodes.filter((n) => n.kind === "run").length, 2);
  assert.equal(result.nodes.filter((n) => n.kind === "session").length, 2);
  assert.equal(result.nodes.filter((n) => n.kind === "task").length, 2);
  assert.equal(result.nodes.find((n) => n.id === "dependent")?.status, "todo");
  assert.deepEqual(new Set(result.edges.map((e) => e.kind)), new Set(["dependency", "task-binding", "ownership"]));
  assert.ok(result.nodes.find((n) => n.runKey === a.key)?.details.some((d) => d.value === "4"));
  assert.equal(result.nodes.some((n) => n.id === "missing"), false);
});

test("current grant intersection includes requested project, owner and both endpoints", () => {
  for (const ids of [["p", "q"], ["p", "owner"], ["q", "owner"], []]) {
    assert.equal(projectDependenciesFlow(page(), [run()], grant(ids)).nodes.length, 0);
  }
  const revoked = grant(); revoked[0]!.state = "forbidden";
  assert.equal(projectDependenciesFlow(page(), [run()], revoked).nodes.length, 0);
  const foreign = grant(); foreign[0]!.id = "other-projects";
  assert.equal(projectDependenciesFlow(page(), [run()], foreign).nodes.length, 0);
});

test("dedup, cycles and focused closure never invent missing Task metadata", () => {
  const ab = dependency("a", "b"); const ba = dependency("b", "a");
  // Consistent Task project identities, as in a validated snapshot.
  ba.fromTask = task("b", "q"); ba.toTask = task("a");
  const p = page([ab, ba, ab, dependency("c", "d")]);
  const result = projectDependenciesFlow(p, [], grant(), "a");
  assert.equal(result.nodes.length, 2); assert.equal(result.edges.length, 2);
  assert.equal(result.cycles.size, 2); assert.equal(result.focusPresent, true);
  const missing = projectDependenciesFlow(p, [], grant(), "absent");
  assert.equal(missing.nodes.length, 0); assert.equal(missing.focusPresent, false);
  assert.equal(missing.nodes.some((n) => n.id === "absent"), false);
});

test("partial page and 160-node cap retain only edges with real displayed endpoints", () => {
  const p = page(Array.from({ length: 100 }, (_, i) => dependency(`a${i}`, `b${i}`)));
  p.hasMore = true;
  const result = projectDependenciesFlow(p, [], grant());
  assert.equal(result.nodes.length, 160); assert.equal(result.hiddenNodes, 40);
  assert.equal(result.incomplete, true);
  const ids = new Set(result.nodes.map((n) => n.key));
  assert.ok(result.edges.every((e) => ids.has(e.from) && ids.has(e.to)));
  assert.equal(projectDependenciesFlow({ ...page(), supported: false, dependencies: [] }, [run()], grant()).nodes.length, 0);
});
