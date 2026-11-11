import { createHash } from "node:crypto";
import { BindingRepository, BindingConflictError } from "../../packages/bindings/repository.ts";
import { bindingRequestSchema, type BindingRequest, type BindingView, type RunView, type Snapshot } from "../../packages/contracts/index.ts";
import { DemianClient } from "../../packages/adapters/demian/index.ts";
import { CommandError } from "../../packages/commands/index.ts";
import type { Store } from "../../packages/storage/store.ts";
import type { Config } from "./config.ts";
import type { Sources } from "./runner.ts";

// A binding is Track's explicit association, not a native Task write/assignment.
export class RunBindings {
  private repository: BindingRepository;
  constructor(private store: Store, private config: () => Config, private sources: Sources,
    private snapshot: (user: string) => Snapshot) { this.repository = new BindingRepository(store); }

  private run(user: string, key: string, writing = false): RunView {
    const config = this.config();
    const authorized = config.auth.mode === "proxy" ? config.auth.users.includes(user) : config.auth.user === user;
    const run = authorized ? this.snapshot(user).runs.find((item) => item.key === key) : undefined;
    if (!run) throw new CommandError(404, "run_not_found", "현재 접근 가능한 실행이 아닙니다.");
    if (writing && (config.auth.mode !== "proxy" || config.auth.users.length !== 1 || config.auth.users[0] !== user ||
        run.sourceState !== "connected" || !run.capabilities.includes("binding.write"))) {
      throw new CommandError(403, "binding_not_enabled", "실행 연결은 현재 소유자와 확인된 원본 접근을 요구합니다.");
    }
    return run;
  }

  private project(user: string, sourceId: string, projectId: string) {
    const source = this.config().sources.find((item) => item.id === sourceId && item.kind === "projects" && item.users.includes(user));
    const project = this.sources.projects.catalog(sourceId, user).find((item) => item.id === projectId);
    if (!source || !project) throw new CommandError(404, "project_not_found", "현재 접근 가능한 원본 프로젝트가 아닙니다.");
    return project;
  }

  view(user: string, key: string): BindingView {
    const run = this.run(user, key);
    const history = this.repository.history(key);
    const permitted = history.filter((record) => {
      try { this.project(user, record.binding.projectSourceId, record.binding.projectId); return true; }
      catch { return false; }
    });
    // Do not reveal the count or fields of records in now-inaccessible Projects.
    return { version: this.repository.currentVersion(key), current: run.binding, history: permitted.slice(-50), incomplete: permitted.length > 50 };
  }

  async apply(user: string, raw: unknown) {
    const parsed = bindingRequestSchema.safeParse(raw);
    if (!parsed.success) throw new CommandError(400, "invalid_binding", "실행·원본 업무·revision·연결 version을 확인해 주세요.");
    const input: BindingRequest = parsed.data;
    const before = this.run(user, input.runKey, true);
    this.project(user, input.projectSourceId, input.projectId);
    const source = this.config().sources.find((item) => item.id === before.sourceId && item.kind === "demian");
    if (!source?.baseUrl) throw new CommandError(403, "binding_not_enabled", "원본 실행 접근을 확인할 수 없습니다.");
    const observed = await new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl,
      ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}),
      ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
      ...(source.organizationId ? { organizationId: source.organizationId } : {}) }).observe(before.runId);
    if (observed.runId !== before.runId || observed.sessionId !== before.sessionId) throw new CommandError(409, "run_identity_changed", "원본 실행 식별자가 달라졌습니다.");
    const task = await this.sources.projects.client(input.projectSourceId, user).task(input.taskId, input.projectId);
    await this.sources.refreshProjectGrants(user);
    const after = this.run(user, input.runKey, true);
    if (after.sourceId !== before.sourceId || after.runId !== before.runId || after.sessionId !== before.sessionId) throw new CommandError(409, "run_identity_changed", "원본 실행 식별자가 달라졌습니다.");
    const project = this.project(user, input.projectSourceId, input.projectId);
    const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const replay = this.repository.receipt(user, input.id);
    if (!replay && task.revision !== input.taskRevision) throw new CommandError(409, "task_revision_changed", "원본 업무가 변경됐습니다. 다시 조회한 후 연결해 주세요.");
    this.store.observeRun(observed);
    try {
      return this.repository.apply({ actor: user, id: input.id, requestDigest: digest, expectedVersion: input.expectedVersion,
        binding: { sourceId: after.sourceId, runId: after.runId, projectSourceId: input.projectSourceId, projectId: input.projectId,
          taskId: task.id, taskRevision: task.revision, projectTitle: project.title, taskTitle: task.title, provenance: "operator" } });
    } catch (error) {
      if (error instanceof BindingConflictError) throw new CommandError(409, error.code, "다른 연결이 먼저 저장됐거나 요청 ID의 내용이 달라졌습니다. 현재 이력을 다시 확인해 주세요.");
      throw error;
    }
  }
}
