import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readConfig } from "../apps/api/config.ts";
import { ProjectsClient } from "../packages/adapters/projects/index.ts";
import type { ProjectDependencyPage } from "../packages/contracts/project-dependencies.ts";
import type { Snapshot } from "../packages/contracts/index.ts";
import { projectDependenciesFlow } from "../packages/projection/project-dependencies-flow.ts";

// Read only. The dependency was saved through the native Projects UI in its
// existing QA Project; this verifier never creates a Task, relation or Run.
async function main() {
  const config = readConfig(process.env.TRACK_CONFIG ?? "");
  assert(config.auth.mode === "proxy" && config.auth.users.length === 1);
  const user = config.auth.users[0]!;
  const source = config.sources.find((candidate) => candidate.id === "projects-native");
  assert(source?.baseUrl && source.projectsCredentialFile && source.projectsAccountId && source.projectsPrincipalId && source.projectsUser === user);
  const projectId = "7b0bc73a-8a1f-4111-9d7f-cc85efad3fea";
  const dependentId = "a061ce29-f674-4449-86c3-2902b16713c5";
  const prerequisiteId = "b01e84de-941a-4ac5-b921-ed65e2bcfbb9";
  const client = new ProjectsClient({ sourceId: source.id, baseUrl: source.baseUrl, user,
    accountId: source.projectsAccountId, principalId: source.projectsPrincipalId, credentialFile: source.projectsCredentialFile });
  const original = await client.dependencies(projectId);
  assert(original.supported);
  const native = original.dependencies.find((edge) => edge.fromTask.id === dependentId && edge.toTask.id === prerequisiteId);
  assert(native);
  assert.equal(native.fromRevision, "1"); assert.equal(native.toRevision, "2");
  assert.equal(native.fromTask.state, "todo"); assert.equal(native.toTask.state, "todo");
  const headers = { "x-track-proxy-key": (await readFile(config.auth.secretFile, "utf8")).trim(), "x-forwarded-email": user };
  const read = async <T>(path: string): Promise<T> => {
    const response = await fetch(`http://127.0.0.1:${config.port}${path}`, { headers, signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    return await response.json() as T;
  };
  const projected = await read<ProjectDependencyPage>(`/api/projects/${source.id}/${projectId}/task-dependencies`);
  assert.deepEqual(projected.dependencies.find((edge) => edge.id === native.id), native);
  const snapshot = await read<Snapshot>("/api/snapshot");
  const model = projectDependenciesFlow(projected, snapshot.runs, snapshot.sources, dependentId);
  const arrow = model.edges.find((edge) => edge.kind === "dependency" && edge.key.includes(native.id)); assert(arrow);
  assert.equal(model.nodes.find((node) => node.key === arrow.from)?.id, prerequisiteId);
  assert.equal(model.nodes.find((node) => node.key === arrow.to)?.id, dependentId);
  assert.equal(model.nodes.find((node) => node.id === dependentId)?.status, "todo");
  console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), sourceId: source.id, projectId,
    relationId: native.id, nativeRelation: native.relation, nativeFromTaskId: dependentId, nativeToTaskId: prerequisiteId,
    visualFromTaskId: prerequisiteId, visualToTaskId: dependentId,
    recordedFromRevision: native.fromRevision, recordedToRevision: native.toRevision,
    currentFromRevision: native.fromTask.revision, currentToRevision: native.toTask.revision,
    taskStates: [native.fromTask.state, native.toTask.state], nodes: model.nodes.length, edges: model.edges.length,
    observedRuns: model.nodes.filter((node) => node.kind === "run").length,
    partial: model.incomplete, cycles: model.cycles.size, nativeMutationsByVerifier: 0, rawBodyExported: false }, null, 2));
}
await main().catch(() => { console.error("Native dependency verification failed; source bodies and credentials omitted."); process.exitCode = 1; });
