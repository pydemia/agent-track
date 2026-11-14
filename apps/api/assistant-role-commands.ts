import { createHash } from "node:crypto";
import { AssistantCommandClient, AssistantCommandError, type AssistantCommandClientOptions } from "../../packages/adapters/assistant/commands.ts";
import { CommandError } from "../../packages/commands/index.ts";
import { CoordinatorDispatchWithheld, type CoordinatorPorts, type PreparedCoordinator } from "../../packages/commands/coordinator-commands.ts";
import { bindingSchema, type RunView, type Snapshot } from "../../packages/contracts/index.ts";
import type { AssistantCommandKind } from "../../packages/contracts/assistant-commands.ts";
import type { AssistantExecutionView } from "../../packages/contracts/assistant-view.ts";
import type { CoordinatorAvailability } from "../../packages/contracts/coordinator-panel.ts";
import type { Store } from "../../packages/storage/store.ts";
import type { Config, SourceConfig } from "./config.ts";
import type { Sources } from "./runner.ts";
import { sourceIdentity } from "./source-identity.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const binding = (run: RunView) => run.binding ? bindingSchema.parse(run.binding) : null;
const fail = (status: number, code: string) => new CommandError(status, code, "현재 조정자 실행과 명령 권한을 다시 확인해 주세요.");
type Writer = Pick<AssistantCommandClient, "capabilities" | "command" | "receipt">;

/** Protected Runs are controlled only through their current owning coordinator. */
export class AssistantRoleCommands {
  constructor(private store: Store, private config: () => Config, private sources: Sources,
    private snapshot: (user: string) => Snapshot,
    private clientFactory: (options: AssistantCommandClientOptions) => Writer = options => new AssistantCommandClient(options)) {}

  private target(user: string, runKey: string, confirmed: () => boolean, writing: boolean) {
    const config = this.config();
    if (!confirmed() || config.auth.mode !== "proxy" || config.auth.users.length !== 1 || config.auth.users[0] !== user)
      throw fail(403, "coordinator_forbidden");
    const run = this.snapshot(user).runs.find(run => run.key === runKey);
    const native = config.sources.find(source => source.id === run?.sourceId);
    const source = config.sources.find(source => source.id === native?.assistantNativeSourceId);
    if (!run || !native || native.kind !== "demian" || !source || source.kind !== "assistant" || source.assistantProtocol !== 2 ||
        !run.assistantAttempt || run.assistantAttempt.assistantSourceId !== source.id ||
        !native.users.includes(user) || !source.users.includes(user) || source.assistantUser !== user ||
        !source.assistantCommandCredentialFile || !source.assistantCommandPrincipalId || !source.assistantCredentialFile ||
        !source.assistantOwnerId || run.sourceState !== "connected" || run.stale ||
        !this.store.pinSourceIdentity(native.id, sourceIdentity(native)) || !this.store.pinSourceIdentity(source.id, sourceIdentity(source)))
      throw fail(404, "coordinator_run_unavailable");
    if (writing && !source.assistantCommandUsers?.includes(user)) throw fail(403, "coordinator_not_enabled");
    return { run, native: structuredClone(native), source: structuredClone(source), auth: structuredClone(config.auth) };
  }

  private localStamp(user: string, runKey: string, confirmed: () => boolean, writing: boolean) {
    const value = this.target(user, runKey, confirmed, writing);
    return hash([value.auth, value.native, value.source, value.run.key, value.run.runId, value.run.sessionId,
      value.run.workspaceId, value.run.status, binding(value.run), value.run.assistantAttempt]);
  }

  private client(user: string, source: SourceConfig): Writer {
    const config = this.config();
    return this.clientFactory({ sourceId: source.id, baseUrl: source.baseUrl!,
      credentialFile: source.assistantCommandCredentialFile!, readerCredentialFile: source.assistantCredentialFile!,
      user, ownerId: source.assistantOwnerId!, principalId: source.assistantCommandPrincipalId!,
      ...(config.auth.mode === "proxy" ? { proxySecretFile: config.auth.secretFile } : {}) });
  }

  private async current(user: string, runKey: string, confirmed: () => boolean, writing: boolean) {
    await this.sources.refreshProjectGrants?.(user);
    const initial = this.target(user, runKey, confirmed, writing);
    const local = this.localStamp(user, runKey, confirmed, writing);
    const attempt = initial.run.assistantAttempt!;
    const execution = await this.sources.assistant.detail(user, initial.source.id, attempt.executionId);
    const fresh = this.target(user, runKey, confirmed, writing);
    if (this.localStamp(user, runKey, confirmed, writing) !== local || execution.sourceId !== initial.source.id ||
        execution.native.id !== attempt.executionId) throw fail(409, "coordinator_review_changed");
    const roles = execution.native.roles.filter(role => role.id === attempt.roleId);
    if (roles.length !== 1) throw fail(409, "coordinator_role_unavailable");
    const currentBinding = binding(fresh.run), task = execution.currentTask;
    if (task ? !currentBinding || currentBinding.projectSourceId !== task.projectsSourceId ||
        currentBinding.projectId !== task.project.id || currentBinding.taskId !== task.task.id : currentBinding !== null)
      throw fail(409, "coordinator_task_changed");
    const kinds = this.kinds(fresh.run, execution);
    if (writing && !kinds.length) throw fail(409, "coordinator_attempt_changed");
    const revision = Number(execution.native.revision);
    if (!Number.isSafeInteger(revision) || revision < 1) throw fail(503, "coordinator_revision_unavailable");
    return { ...fresh, execution, role: roles[0]!, kinds, revision, local,
      scopeIdentity: hash([local, execution.native.revision, execution.native.state, roles[0]!.state, task?.task.revision ?? null]) };
  }

  private kinds(run: RunView, execution: AssistantExecutionView): AssistantCommandKind[] {
    const attempt = run.assistantAttempt!;
    const roleIndex = execution.native.roles.findIndex(role => role.id === attempt.roleId), role = execution.native.roles[roleIndex];
    const links = execution.demianLinks?.links.filter(link => link.roleId === attempt.roleId) ?? [];
    if (!role || attempt.ordinal > 32 || execution.currentTask?.task.state === "done" || execution.demianLinks?.state !== "connected" || links.length !== 1 ||
        links[0]!.sourceId !== run.sourceId || links[0]!.runKey !== run.key || links[0]!.runId !== run.runId ||
        links[0]!.sessionId !== run.sessionId || links[0]!.workspaceId !== run.workspaceId ||
        links[0]!.operationId !== attempt.attemptId || !["failed", "cancelled"].includes(execution.native.state) ||
        execution.native.roles.slice(0, roleIndex).some(role => role.state !== "completed") ||
        execution.native.roles.some((role, index) => index !== roleIndex && role.state !== "completed" && role.runtime.taskId !== null)) return [];
    if (role.state === "failed" && run.status === "failed") return ["retry"];
    if (["cancelled", "interrupted"].includes(role.state) && ["cancelled", "expired", "interrupted"].includes(run.status)) return ["resume"];
    return [];
  }

  async availability(user: string, runKey: string, confirmed: () => boolean): Promise<CoordinatorAvailability> {
    const run = this.snapshot(user).runs.find(run => run.key === runKey);
    const native = this.config().sources.find(source => source.id === run?.sourceId);
    const source = this.config().sources.find(source => source.id === native?.assistantNativeSourceId);
    const result = (state: CoordinatorAvailability["state"], detail: CoordinatorAvailability["detail"]): CoordinatorAvailability =>
      ({ runKey, state, availableKinds: [], detail });
    if (!run || !confirmed()) throw fail(404, "run_not_found");
    if (!source?.assistantCommandUsers?.includes(user)) return result("unsupported", "not_enabled");
    if (!run.assistantAttempt) return result("unsupported", "attempt_history_unavailable");
    try {
      const current = await this.current(user, runKey, confirmed, false);
      await this.client(user, current.source).capabilities();
      if (this.localStamp(user, runKey, confirmed, false) !== current.local) throw fail(409, "coordinator_review_changed");
      return { runKey, state: "available", availableKinds: current.kinds,
        detail: current.kinds.length ? "ready" : "not_current_attempt" };
    } catch {
      if (!confirmed()) throw fail(403, "coordinator_forbidden");
      return result("unavailable", "coordinator_unavailable");
    }
  }

  ports(user: string, runKey: string, confirmed: () => boolean, batchRead = false): CoordinatorPorts {
    let readScope: Awaited<ReturnType<AssistantRoleCommands["current"]>> | undefined;
    const authorize = async (prepared: PreparedCoordinator | null, writing: boolean) => {
      // Only a list's internal reads share this scope. Null boundaries force a
      // fresh start/final read; writes and individual receipt requests never cache.
      const reusable = batchRead && !writing && prepared !== null && readScope &&
        this.localStamp(user, runKey, confirmed, false) === readScope.local;
      const current = reusable ? readScope! : await this.current(user, runKey, confirmed, writing);
      if (batchRead && !writing) readScope = current;
      if (!prepared) return;
      const target = prepared.target, attempt = current.run.assistantAttempt!;
      if (target.runKey !== runKey || target.runId !== current.run.runId || target.sessionId !== current.run.sessionId ||
          target.nativeSourceId !== current.native.id || target.nativeSourceIdentity !== sourceIdentity(current.native) ||
          target.assistantSourceId !== current.source.id || target.assistantSourceIdentity !== sourceIdentity(current.source) ||
          target.executionId !== attempt.executionId || target.roleId !== attempt.roleId || target.attemptId !== attempt.attemptId ||
          target.attemptOrdinal !== attempt.ordinal || JSON.stringify(target.binding) !== JSON.stringify(binding(current.run)))
        throw fail(409, "coordinator_review_changed");
      if (writing && (prepared.scopeIdentity !== current.scopeIdentity || target.expectedRevision !== current.revision ||
          target.sourceStatus !== current.run.status || !current.kinds.includes(prepared.command.kind)))
        throw fail(409, "coordinator_review_changed");
    };
    return {
      authorize,
      prepare: async input => {
        if (input.runKey !== runKey) throw fail(400, "coordinator_target_mismatch");
        const current = await this.current(user, runKey, confirmed, true), attempt = current.run.assistantAttempt!;
        if (!current.kinds.includes(input.kind)) throw fail(409, "coordinator_attempt_changed");
        await this.client(user, current.source).capabilities();
        if (this.localStamp(user, runKey, confirmed, true) !== current.local) throw fail(409, "coordinator_review_changed");
        return { target: { runKey, runId: current.run.runId, sessionId: current.run.sessionId,
          nativeSourceId: current.native.id, nativeSourceIdentity: sourceIdentity(current.native),
          assistantSourceId: current.source.id, assistantSourceIdentity: sourceIdentity(current.source),
          executionId: attempt.executionId, roleId: attempt.roleId, attemptId: attempt.attemptId, attemptOrdinal: attempt.ordinal,
          expectedRevision: current.revision, sourceStatus: current.run.status as PreparedCoordinator["target"]["sourceStatus"], binding: binding(current.run) },
          scopeIdentity: current.scopeIdentity,
          command: { operationId: input.id, kind: input.kind, expectedRevision: current.revision, expiresAt: input.expiresAt } };
      },
      dispatch: async prepared => {
        let current: ReturnType<AssistantRoleCommands["target"]>, stamp: string;
        try {
          await authorize(prepared, true);
          current = this.target(user, runKey, confirmed, true);
          stamp = this.localStamp(user, runKey, confirmed, true);
        } catch { throw new CoordinatorDispatchWithheld("authority_changed"); }
        let withheldDetail: "deadline_passed" | "authority_changed" = "authority_changed";
        try {
          return await this.client(user, current.source).command(prepared.target.executionId, prepared.target.roleId, prepared.command, () => {
            if (Date.parse(prepared.command.expiresAt) <= Date.now()) {
              withheldDetail = "deadline_passed";
              throw new CoordinatorDispatchWithheld(withheldDetail);
            }
            if (this.localStamp(user, runKey, confirmed, true) !== stamp) throw new CoordinatorDispatchWithheld("authority_changed");
          });
        } catch (error) {
          if (error instanceof AssistantCommandError && error.disposition === "withheld") throw new CoordinatorDispatchWithheld(withheldDetail);
          throw error;
        }
      },
      lookup: async prepared => {
        await authorize(prepared, false);
        const current = this.target(user, runKey, confirmed, false);
        try { return await this.client(user, current.source).receipt(prepared.target.executionId, prepared.target.roleId, prepared.command.operationId, prepared.command.kind); }
        catch (error) { if (error instanceof AssistantCommandError && error.status === 404) return null; throw error; }
      },
    };
  }
}
