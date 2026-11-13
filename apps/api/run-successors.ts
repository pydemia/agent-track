import { createHash } from "node:crypto";
import { DemianClient, SourceError } from "../../packages/adapters/demian/index.ts";
import { CommandError } from "../../packages/commands/index.ts";
import { SuccessorDispatchWithheld, type PreparedSuccessor, type SuccessorPorts } from "../../packages/commands/run-successors.ts";
import { bindingSchema, externalKey, type RunView, type Snapshot } from "../../packages/contracts/index.ts";
import { nativeCommandContextSchema, nativeCommandTerminalSchema } from "../../packages/contracts/native-run-commands.ts";
import type { SuccessorAvailability } from "../../packages/contracts/run-successors.ts";
import type { Store } from "../../packages/storage/store.ts";
import type { Config, SourceConfig } from "./config.ts";
import type { Sources } from "./runner.ts";
import { projectTaskMetadata } from "./project-task-metadata.ts";
import { sourceIdentity } from "./source-identity.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bindingValue = (run: RunView) => run.binding ? bindingSchema.parse(run.binding) : null;
const client = (source: SourceConfig) => new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl!,
  ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}), ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
  ...(source.organizationId ? { organizationId: source.organizationId } : {}) });

/** Ordinary Native owner path. Assistant readers remain incapable of dispatch. */
export class RunSuccessors {
  constructor(private store: Store, private config: () => Config, private sources: Sources,
    private snapshot: (user: string) => Snapshot) {}

  private target(user: string, runKey: string, confirmed: () => boolean, writing: boolean) {
    const config = this.config();
    if (!confirmed() || !(config.auth.mode === "proxy" ? config.auth.users.includes(user) : config.auth.user === user))
      throw new CommandError(403, "source_forbidden", "현재 계정의 접근 권한을 확인할 수 없습니다.");
    const run = this.snapshot(user).runs.find(run => run.key === runKey);
    const source = config.sources.find(source => source.id === run?.sourceId);
    if (!run || !source || source.kind !== "demian" || !source.baseUrl || !source.users.includes(user) ||
        source.assistantNativeSourceId || run.sourceState !== "connected" || run.stale ||
        !this.store.pinSourceIdentity(source.id, sourceIdentity(source)))
      throw new CommandError(404, "run_not_found", "현재 조회 가능한 일반 Native 실행이 아닙니다.");
    if (writing && (config.auth.mode !== "proxy" || config.auth.users.length !== 1 || config.auth.users[0] !== user ||
        !source.runCommandUsers?.includes(user) || !run.capabilities.includes("run.commands")))
      throw new CommandError(403, "run_commands_not_enabled", "이 계정과 출처의 실행 명령 권한이 열려 있지 않습니다.");
    return { run, source };
  }

  private stamp(user: string, run: RunView, source: SourceConfig, taskRevision: string | null) {
    return hash([user, sourceIdentity(source), source.tokenFile ?? null, source.credentialFormat ?? null,
      run.key, run.sessionId, run.workspaceId, bindingValue(run), taskRevision]);
  }

  private async current(user: string, runKey: string, confirmed: () => boolean, writing: boolean) {
    await this.sources.refreshProjectGrants?.(user);
    const initial = this.target(user, runKey, confirmed, writing), binding = bindingValue(initial.run);
    const producerStamp = hash([initial.source, binding, initial.run.sessionId, initial.run.workspaceId]);
    let taskRevision: string | null = null;
    if (binding?.taskId) taskRevision = (await projectTaskMetadata(this.sources, user, binding.projectSourceId, binding.projectId, binding.taskId)).task.revision;
    const observed = await client(initial.source).observe(initial.run.runId);
    if (observed.runId !== initial.run.runId || observed.sessionId !== initial.run.sessionId || observed.workspaceId !== initial.run.workspaceId)
      throw new CommandError(409, "review_changed", "원본 실행의 문맥이 바뀌었습니다.");
    await this.sources.refreshProjectGrants?.(user);
    const fresh = this.target(user, runKey, confirmed, writing);
    if (hash([fresh.source, bindingValue(fresh.run), fresh.run.sessionId, fresh.run.workspaceId]) !== producerStamp)
      throw new CommandError(409, "review_changed", "검토할 출처나 업무 연결이 바뀌었습니다.");
    this.store.observeRun(observed);
    return { ...fresh, run: { ...fresh.run, ...observed }, scopeIdentity: this.stamp(user, fresh.run, fresh.source, taskRevision) };
  }

  async availability(user: string, runKey: string, confirmed: () => boolean): Promise<SuccessorAvailability> {
    const run = this.snapshot(user).runs.find(run => run.key === runKey);
    const source = this.config().sources.find(source => source.id === run?.sourceId);
    if (!run || !source || !confirmed()) throw new CommandError(404, "run_not_found", "현재 실행에 접근할 수 없습니다.");
    const unavailable = (state: "unsupported" | "unavailable", detail: SuccessorAvailability["detail"]): SuccessorAvailability =>
      ({ runKey, state, availableKinds: [], detail });
    if (source.assistantNativeSourceId) return unavailable("unsupported", "protected_owner_required");
    if (!source.runCommandUsers?.includes(user) || !run.capabilities.includes("run.commands")) return unavailable("unsupported", "not_enabled");
    try {
      const current = await this.current(user, runKey, confirmed, true), context = await client(current.source).commandContext(run.runId);
      this.target(user, runKey, confirmed, true);
      if (context.source_run.session_id !== run.sessionId) throw new CommandError(409, "review_changed", "원본 Session이 바뀌었습니다.");
      return { state: "available", runKey, availableKinds: context.available_kinds,
        detail: context.available_kinds.length ? "ready" : "no_terminal_action" };
    } catch (error) {
      if (!confirmed()) throw new CommandError(403, "source_forbidden", "현재 계정의 접근 권한을 확인할 수 없습니다.");
      return unavailable(error instanceof SourceError && error.status === 404 ? "unsupported" : "unavailable",
        error instanceof SourceError && error.status === 404 ? "native_contract_unavailable" : "native_unavailable");
    }
  }

  ports(user: string, runKey: string, confirmed: () => boolean): SuccessorPorts {
    const authorize = async (prepared: PreparedSuccessor | null, writing: boolean) => {
      const current = await this.current(user, runKey, confirmed, writing);
      if (!prepared) return;
      const target = prepared.target;
      if (target.runKey !== runKey || target.sourceId !== current.source.id || target.runId !== current.run.runId ||
          target.sessionId !== current.run.sessionId || target.sourceIdentity !== sourceIdentity(current.source) ||
          JSON.stringify(target.binding) !== JSON.stringify(bindingValue(current.run)))
        throw new CommandError(409, "review_changed", "저장한 검토의 실행·출처·업무 연결이 현재 문맥과 다릅니다.");
      if (writing) {
        if (current.scopeIdentity !== prepared.scopeIdentity || current.run.status !== target.sourceStatus ||
            this.store.cursor(current.source.id, current.run.runId) !== target.expectedCursor)
          throw new CommandError(409, "review_changed", "검토 뒤 실행이나 업무 revision이 바뀌었습니다.");
        const context = nativeCommandContextSchema.parse(await client(current.source).commandContext(current.run.runId));
        this.target(user, runKey, confirmed, true);
        if (context.source_run.session_id !== target.sessionId || context.source_run.status !== target.sourceStatus ||
            context.session_head_sha256 !== prepared.native.command.expectedSessionHead ||
            context.authority_sha256 !== prepared.native.command.expectedAuthoritySha256 || !context.available_kinds.includes(prepared.native.command.kind))
          throw new CommandError(409, "review_changed", "검토한 원본 상태·Session head·현재 권한이 바뀌었습니다.");
      }
    };
    return {
      authorize,
      prepare: async input => {
        const current = await this.current(user, runKey, confirmed, true);
        if (input.runKey !== runKey) throw new CommandError(400, "invalid_command", "실행 경로와 요청 대상이 다릅니다.");
        const context = await client(current.source).commandContext(current.run.runId);
        this.target(user, runKey, confirmed, true);
        if (context.source_run.session_id !== current.run.sessionId || !context.available_kinds.includes(input.kind))
          throw new CommandError(409, "review_changed", "현재 원본에서 이 명령을 접수할 수 없습니다.");
        const status = nativeCommandTerminalSchema.parse(context.source_run.status);
        return { target: { runKey, sourceId: current.source.id, runId: current.run.runId, sessionId: current.run.sessionId,
          sourceStatus: status, expectedCursor: this.store.cursor(current.source.id, current.run.runId),
          sourceIdentity: sourceIdentity(current.source), binding: bindingValue(current.run) }, scopeIdentity: current.scopeIdentity,
          native: { command: { version: 1, commandId: input.id, sourceRunId: current.run.runId, kind: input.kind,
            expectedSessionHead: context.session_head_sha256, expectedSourceStatus: status,
            expectedAuthoritySha256: context.authority_sha256, expiresAt: input.expiresAt },
          ...(input.input !== undefined ? { input: [{ type: "input_text" as const, text: input.input }] } : {}) } };
      },
      dispatch: async prepared => {
        const source = structuredClone(this.target(user, runKey, confirmed, true).source);
        return client(source).command(prepared.native, prepared.target.sessionId, () => {
          let current;
          try { current = this.target(user, runKey, confirmed, true); }
          catch { throw new SuccessorDispatchWithheld("authority_changed"); }
          if (Date.parse(prepared.native.command.expiresAt) <= Date.now()) throw new SuccessorDispatchWithheld("deadline_passed");
          if (JSON.stringify(current.source) !== JSON.stringify(source) || prepared.target.runKey !== runKey ||
              prepared.target.sourceId !== current.source.id || prepared.target.sourceIdentity !== sourceIdentity(current.source) ||
              prepared.target.runId !== current.run.runId || prepared.target.sessionId !== current.run.sessionId ||
              prepared.target.sourceStatus !== current.run.status || prepared.target.expectedCursor !== this.store.cursor(current.source.id, current.run.runId) ||
              JSON.stringify(prepared.target.binding) !== JSON.stringify(bindingValue(current.run)))
            throw new SuccessorDispatchWithheld("review_changed");
        });
      },
      lookup: async prepared => {
        const current = this.target(user, runKey, confirmed, false);
        const result = await client(current.source).commandReceipt(prepared.target.sessionId, prepared.native.command);
        this.target(user, runKey, confirmed, false); return result;
      },
      observeAccepted: async (prepared, receipt) => {
        await authorize(prepared, false);
        const current = this.target(user, runKey, confirmed, false);
        if (!receipt.new_run_id) return false;
        const observation = await client(current.source).observe(receipt.new_run_id);
        if (observation.sessionId !== prepared.target.sessionId || observation.workspaceId !== current.run.workspaceId) return false;
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);
        let opened = false;
        try { await client(current.source).stream(observation.runId, "0", () => {}, controller.signal, () => { opened = true; controller.abort(); }); }
        catch { if (!opened) return false; }
        finally { clearTimeout(timeout); }
        await authorize(prepared, false);
        // New metadata is visible only after Native Run, Session and event ACLs.
        const key = this.store.observeRun(observation), binding = prepared.target.binding;
        if (prepared.native.command.kind !== "continue" && binding) {
          const expected = { ...binding, sourceId: observation.sourceId, runId: observation.runId };
          const previous = this.store.run(key)?.binding;
          if (previous && JSON.stringify(bindingSchema.parse(JSON.parse(previous))) !== JSON.stringify(expected)) return false;
          if (!previous) this.store.bind(expected, user);
        }
        return this.snapshot(user).runs.some(run => run.key === externalKey(current.source.id, observation.runId));
      },
    };
  }
}
