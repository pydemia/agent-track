import { DemianClient, SourceError } from "../../packages/adapters/demian/index.ts";
import { CommandError } from "../../packages/commands/index.ts";
import type { ApprovalPorts, ApprovalObservation } from "../../packages/approvals/index.ts";
import type { PermissionReview, RunView, Snapshot } from "../../packages/contracts/index.ts";
import type { Store } from "../../packages/storage/store.ts";
import type { Config, SourceConfig } from "./config.ts";
import type { Sources } from "./runner.ts";

export class RunPermissions {
  constructor(private store: Store, private config: () => Config, private sources: Sources, private snapshot: (user: string) => Snapshot) {}

  private authorized(user: string, key: string, writing = false): { run: RunView; source: SourceConfig } {
    const config = this.config();
    const root = config.auth.mode === "proxy" ? config.auth.users.includes(user) : config.auth.user === user;
    const run = root ? this.snapshot(user).runs.find((item) => item.key === key) : undefined;
    const source = config.sources.find((item) => item.id === run?.sourceId && item.kind === "demian" && item.users.includes(user));
    if (!run || !source?.baseUrl || run.sourceState !== "connected") throw new CommandError(404, "run_not_found", "현재 접근 가능한 원본 실행이 아닙니다.");
    if (writing && (config.auth.mode !== "proxy" || config.auth.users.length !== 1 || config.auth.users[0] !== user ||
        !source.approvalUsers?.includes(user) || !run.capabilities.includes("permission.decide"))) {
      throw new CommandError(403, "approval_not_enabled", "현재 소유자에 대한 원본 승인 기능이 열려 있지 않습니다.");
    }
    return { run, source };
  }

  private client(source: SourceConfig) {
    return new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl!,
      ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}),
      ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
      ...(source.organizationId ? { organizationId: source.organizationId } : {}) });
  }

  async list(user: string, key: string): Promise<{ requests: PermissionReview[]; observation: RunView }> {
    await this.sources.refreshProjectGrants(user);
    const { run, source } = this.authorized(user, key);
    const client = this.client(source);
    try {
      const observed = await client.observe(run.runId);
      if (observed.sessionId !== run.sessionId) throw new CommandError(403, "source_forbidden", "실행 세션이 달라졌습니다.");
      const requests = await client.permissions(run.runId);
      await this.sources.refreshProjectGrants(user);
      const current = this.authorized(user, key);
      if (current.source.baseUrl !== source.baseUrl || current.source.organizationId !== source.organizationId || current.run.sessionId !== run.sessionId) {
        throw new CommandError(403, "source_forbidden", "조회 중 원본 연결이 달라졌습니다.");
      }
      this.store.observeRun(observed);
      return { requests, observation: { ...current.run, status: observed.status } };
    } catch (error) {
      if (error instanceof SourceError && [401, 403, 404].includes(error.status)) throw new CommandError(404, "permission_unavailable", "현재 원본 승인 요청에 접근할 수 없습니다.");
      throw error;
    }
  }

  async review(user: string, key: string, id: string): Promise<PermissionReview> {
    const result = await this.list(user, key);
    const review = result.requests.find((item) => item.request.id === id);
    if (!review) throw new CommandError(404, "permission_not_found", "현재 원본 승인 요청에 접근할 수 없습니다.");
    return review;
  }

  ports(user: string, key: string, writing: boolean): ApprovalPorts {
    return {
      authorize: async () => { await this.sources.refreshProjectGrants(user); this.authorized(user, key, writing); },
      read: async (id) => {
        const result = await this.list(user, key);
        const value = result.requests.find((item) => item.request.id === id);
        if (!value) throw new CommandError(404, "permission_not_found", "원본 승인 요청에 접근할 수 없습니다.");
        if (writing && !value.reviewComplete) throw new CommandError(409, "review_unavailable", "요청 내용을 전부 확인할 수 없어 원본에서 처리해야 합니다.");
        return { sourceId: result.observation.sourceId, runId: result.observation.runId,
          runStatus: result.observation.status, permission: value.request } satisfies ApprovalObservation;
      },
      decide: async (id, decision) => {
        if (!writing) throw new CommandError(403, "read_only_receipt", "처리 기록 조회는 결정을 전송할 수 없습니다.");
        // The service just reauthorized and rechecked its/source deadlines. Avoid
        // inserting another awaited step before the native atomic decision.
        const { source, run } = this.authorized(user, key, true);
        const response = await this.client(source).decidePermission(run.runId, id, decision);
        return { sourceId: source.id, runId: run.runId, runStatus: run.status, permission: response.request } satisfies ApprovalObservation;
      },
    };
  }
}
