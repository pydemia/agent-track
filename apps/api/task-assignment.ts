import { createHash } from "node:crypto";
import { z } from "zod";
import { DemianClient } from "../../packages/adapters/demian/index.ts";
import { DemianRunWriter, DemianAssignmentRejected, DemianAssignmentExpired, DemianAssignmentAccessChanged, prepareRunInput,
  type NativeAssignmentSession } from "../../packages/adapters/demian/assignment.ts";
import type { ProjectTaskReview } from "../../packages/adapters/projects/index.ts";
import { TaskAssignmentService, AssignmentRejected, AssignmentExpired, assignmentInputSchema, type AssignmentInput, type AssignmentTarget, type AssignmentPorts, type AssignmentReceipt } from "../../packages/commands/assign-task.ts";
import { CommandError } from "../../packages/commands/index.ts";
import { BindingRepository, BindingConflictError } from "../../packages/bindings/repository.ts";
import { bindingSchema, externalKey, type Snapshot } from "../../packages/contracts/index.ts";
import { assignmentPrompt } from "../../packages/projection/assignment-review.ts";
import type { Store } from "../../packages/storage/store.ts";
import type { Config, SourceConfig } from "./config.ts";
import type { Sources } from "./runner.ts";
import { sourceIdentity } from "./source-identity.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const taskReviewFingerprint = (sourceId: string, review: ProjectTaskReview) => hash([sourceId, review.task.id, review.task.projectId,
  review.task.revision, review.task.title, review.body, review.acceptanceCriteria, review.task.requiresTest]);
export const sessionFingerprint = (session: NativeAssignmentSession) => hash([session.sessionId, session.workspaceId, session.agent,
  session.provider, session.model, session.mode, session.permissionPolicy]);
const nativeOptions = (source: SourceConfig) => ({ sourceId: source.id, baseUrl: source.baseUrl!,
  ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}), ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
  ...(source.organizationId ? { organizationId: source.organizationId } : {}) });

export class TaskAssignments {
  private service: TaskAssignmentService;
  private bindings: BindingRepository;
  constructor(private store: Store, private config: () => Config, private sources: Sources) {
    this.service = new TaskAssignmentService(store); this.bindings = new BindingRepository(store);
  }
  private project(user: string, sourceId: string, projectId: string) {
    const current = this.config();
    const root = current.auth.mode === "proxy" ? current.auth.users.includes(user) : current.auth.user === user;
    const source = current.sources.find((value) => value.id === sourceId && value.kind === "projects" && value.users.includes(user) && value.projectsUser === user);
    const project = source && this.sources.projects.catalog(sourceId, user).find((value) => value.id === projectId && !value.archived);
    if (!root || !source || !project || !z.uuid().safeParse(projectId).success) throw new CommandError(404, "project_not_found", "현재 접근 가능한 원본 프로젝트가 아닙니다.");
    return { source, project };
  }
  private scope(user: string, target: AssignmentTarget) {
    const current = this.config(); const { source: projectSource, project } = this.project(user, target.projectSourceId, target.projectId);
    const source = current.sources.find((value) => value.id === target.demianSourceId && value.kind === "demian" && value.users.includes(user));
    if (current.auth.mode !== "proxy" || current.auth.users.length !== 1 || current.auth.users[0] !== user ||
        !projectSource.assignmentProjectIds?.includes(target.projectId) || !source?.baseUrl || !source.assignmentUsers?.includes(user) ||
        !source.assignmentSessionIds?.includes(target.sessionId) || this.sources.views(user).find((view) => view.id === source.id)?.state !== "connected") {
      throw new CommandError(403, "assignment_not_enabled", "이 업무와 Session의 실행 배정 연결이 열려 있지 않습니다.");
    }
    // Pin this target and origin/principal, while rechecking its live grants.
    // An unrelated newly allowed Session must not invalidate earlier receipts.
    const identity = hash([sourceIdentity(projectSource), sourceIdentity(source), user, projectSource.id, source.id, target.projectId, target.sessionId]);
    return { source, projectSource, project, identity };
  }
  async review(user: string, sourceId: string, projectId: string, taskId: string) {
    await this.sources.refreshProjectGrants(user); const before = this.project(user, sourceId, projectId); const stamp = sourceIdentity(before.source);
    const value = await this.sources.projects.client(sourceId, user).taskReview(taskId, projectId);
    await this.sources.refreshProjectGrants(user); const after = this.project(user, sourceId, projectId);
    if (sourceIdentity(after.source) !== stamp) throw new CommandError(403, "source_identity_changed", "업무 읽기 연결이 변경됐습니다.");
    return { ...value, reviewSha256: value.complete ? taskReviewFingerprint(sourceId, value) : null };
  }
  async sessions(user: string, projectSourceId: string, projectId: string, taskId: string) {
    await this.sources.refreshProjectGrants(user); const { source } = this.project(user, projectSourceId, projectId);
    await this.sources.projects.client(projectSourceId, user).task(taskId, projectId);
    const targets = source.assignmentProjectIds?.includes(projectId) ? this.config().sources.filter((item) => item.kind === "demian" && item.assignmentUsers?.includes(user))
      .flatMap((item) => (item.assignmentSessionIds ?? []).map((sessionId) => ({ item, sessionId }))) : [];
    const results = await Promise.allSettled(targets.slice(0, 20).map(async ({ item, sessionId }) => {
      const target: AssignmentTarget = { projectSourceId, projectId, taskId, taskRevision: "1", reviewSha256: "0".repeat(64), demianSourceId: item.id, sessionId, sessionSha256: "0".repeat(64) };
      const before = this.scope(user, target); const session = await new DemianRunWriter(nativeOptions(before.source)).session(sessionId);
      await this.sources.refreshProjectGrants(user); const after = this.scope(user, target);
      if (after.identity !== before.identity) throw new Error();
      return { target, identity: after.identity, session: { ...session, sourceId: item.id, sourceLabel: item.label, device: item.device, sessionSha256: sessionFingerprint(session) } };
    }));
    await this.sources.refreshProjectGrants(user); this.project(user, projectSourceId, projectId);
    const sessions = results.flatMap((value) => {
      if (value.status !== "fulfilled") return [];
      try { return this.scope(user, value.value.target).identity === value.value.identity ? [value.value.session] : []; } catch { return []; }
    });
    return { enabled: sessions.length > 0, sessions, incomplete: targets.length > 20 || sessions.length !== results.length,
      detail: "명시적으로 허용한 기존 Session입니다. agent·provider·model·실행 권한 정책을 확인한 뒤 선택하세요. 새 Session을 자동 생성하지 않습니다." };
  }
  private async authorize(user: string, target: AssignmentTarget) {
    await this.sources.refreshProjectGrants(user); const before = this.scope(user, target);
    await new DemianRunWriter(nativeOptions(before.source)).session(target.sessionId);
    await this.sources.refreshProjectGrants(user); const after = this.scope(user, target);
    if (after.identity !== before.identity) throw new CommandError(403, "source_identity_changed", "실행 연결 구성이 변경됐습니다.");
    return after;
  }
  private async prepare(user: string, input: AssignmentInput) {
    const review = await this.review(user, input.projectSourceId, input.projectId, input.taskId);
    if (!review.complete || !review.reviewSha256 || review.reviewSha256 !== input.reviewSha256 || review.task.revision !== input.taskRevision) {
      throw new CommandError(409, "task_review_changed", "원본 업무가 변경됐거나 검토 범위가 불완전합니다. 다시 검토해 주세요.");
    }
    const context = this.scope(user, input); const session = await new DemianRunWriter(nativeOptions(context.source)).session(input.sessionId);
    if (sessionFingerprint(session) !== input.sessionSha256 || session.archived || session.activeRunId) {
      throw new CommandError(409, "session_changed", "Session의 실행 정책·활성 상태가 변경됐습니다. 다시 선택해 주세요.");
    }
    const text = assignmentPrompt(review, input.instructions);
    try { return { text, ...prepareRunInput(text) }; }
    catch { throw new CommandError(400, "assignment_input_too_large", "전달할 업무와 추가 지시는 UTF-8 8,192byte 이내여야 합니다. 부분 본문은 전송하지 않습니다."); }
  }
  private ports(user: string): AssignmentPorts {
    let prepared: { text: string; inputSha256: string } | undefined; let authorizedIdentity: string | undefined;
    return {
      authorize: async (target) => { const context = await this.authorize(user, target); authorizedIdentity = context.identity; return context; },
      prepare: async (input) => { prepared = await this.prepare(user, input); return prepared; },
      start: async (input) => {
        const context = this.scope(user, input); const initial = prepared; if (!initial) throw new AssignmentRejected();
        try {
          return await new DemianRunWriter(nativeOptions(context.source)).start(input.sessionId, input.id, initial.text, { expiresAt: input.expiresAt,
            refreshAuthorization: async () => {
              const fresh = await this.prepare(user, input);
              await this.sources.refreshProjectGrants(user);
              if (fresh.inputSha256 !== initial.inputSha256 || this.scope(user, input).identity !== authorizedIdentity) throw new Error();
            },
            isAuthorized: () => { try { return this.scope(user, input).identity === authorizedIdentity; } catch { return false; } } });
        } catch (error) {
          if (error instanceof DemianAssignmentExpired) throw new AssignmentExpired();
          if (error instanceof DemianAssignmentRejected || error instanceof DemianAssignmentAccessChanged) throw new AssignmentRejected();
          throw error;
        }
      },
      lookup: async (target, id, inputSha256) => new DemianRunWriter(nativeOptions(this.scope(user, target).source)).lookup(target.sessionId, id, inputSha256),
      bind: async (target, id, runId) => {
        const before = await this.authorize(user, target);
        const task = await this.sources.projects.client(target.projectSourceId, user).task(target.taskId, target.projectId);
        if (task.revision !== target.taskRevision) return "conflict";
        const observation = await new DemianClient(nativeOptions(before.source)).observe(runId);
        if (observation.runId !== runId || observation.sessionId !== target.sessionId) throw new Error();
        await this.sources.refreshProjectGrants(user); const after = this.scope(user, target);
        if (after.identity !== before.identity) throw new Error();
        const key = this.store.observeRun(observation); const payload = this.store.run(key)?.binding;
        const current = payload ? bindingSchema.parse(JSON.parse(payload)) : null;
        if (current) return current.projectSourceId === target.projectSourceId && current.projectId === target.projectId && current.taskId === target.taskId && current.taskRevision === target.taskRevision ? "bound" : "conflict";
        try {
          this.bindings.apply({ actor: user, id, expectedVersion: "0", requestDigest: hash([target, id, runId]), binding: {
            sourceId: target.demianSourceId, runId, projectSourceId: target.projectSourceId, projectId: target.projectId, taskId: target.taskId,
            taskRevision: target.taskRevision, projectTitle: after.project.title, taskTitle: task.title, provenance: "operator" } });
          return "bound";
        } catch (error) { if (error instanceof BindingConflictError) return "conflict"; throw error; }
      },
    };
  }
  async execute(user: string, raw: unknown) {
    const parsed = assignmentInputSchema.safeParse(raw);
    if (!parsed.success) throw new CommandError(400, "invalid_assignment", "업무 검토·Session·추가 지시·기한을 확인해 주세요.");
    return this.service.execute(user, parsed.data, this.ports(user));
  }
  async reconcile(user: string, id: string) { return this.service.reconcile(user, id, this.ports(user)); }
  async confirm(user: string, receipt: AssignmentReceipt) {
    const context = await this.authorize(user, receipt);
    if (!this.service.sourceMatches(user, receipt.id, context.identity)) throw new CommandError(403, "source_identity_changed", "실행 연결 구성이 달라졌습니다.");
  }
  async status(user: string, sourceId: string, projectId: string, taskId: string) {
    await this.sources.refreshProjectGrants(user); this.project(user, sourceId, projectId);
    const records = this.service.list(user, sourceId, projectId, taskId, 101); const receipts = []; let incomplete = records.length > 100;
    for (const receipt of records.slice(-100)) {
      try {
        receipts.push(await this.service.reconcile(user, receipt.id, this.ports(user)));
      } catch { incomplete = true; }
    }
    await this.sources.refreshProjectGrants(user); this.project(user, sourceId, projectId);
    const current = receipts.filter((receipt) => {
      try { return this.service.sourceMatches(user, receipt.id, this.scope(user, receipt).identity); } catch { return false; }
    });
    return { receipts: current, incomplete: incomplete || current.length !== receipts.length };
  }
  filterSnapshot(value: Snapshot, allowProject: (sourceId: string, projectId: string) => boolean = () => true): Snapshot {
    const denied = new Set((this.store.db.prepare(`SELECT demian_source_id,run_id,project_source_id,project_id FROM task_assignment_receipts
      WHERE actor=? AND state='accepted' AND run_id IS NOT NULL`).all(value.user) as unknown as Array<{ demian_source_id: string; run_id: string; project_source_id: string; project_id: string }>).filter((row) =>
        !allowProject(row.project_source_id, row.project_id) || !value.sources.some((source) => source.id === row.project_source_id && source.kind === "projects" && source.state === "connected" && source.authorizedProjectIds?.includes(row.project_id)))
      .map((row) => externalKey(row.demian_source_id, row.run_id)));
    if (!denied.size) return value;
    const runs = value.runs.filter((run) => !denied.has(run.key)); const keys = new Set(runs.map((run) => run.key));
    return { ...value, runs, relations: value.relations.filter((relation) => keys.has(relation.runKey)) };
  }
}
