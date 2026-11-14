import { CommandError } from "../../packages/commands/index.ts";
import { deleteFlowViewSchema, flowViewIdSchema, saveFlowViewSchema, type FlowViewAnchors, type SavedFlowView } from "../../packages/contracts/flow-views.ts";
import { FlowViewLimitError, FlowViewRepository } from "../../packages/storage/flow-views.ts";

export type FlowViewAuthorization = (actor: string, anchors: FlowViewAnchors, deadline?: number) => Promise<() => void>;
const invalid = () => new CommandError(400, "invalid_flow_view", "저장 보기의 형식이 올바르지 않습니다.");
const missing = () => new CommandError(404, "flow_view_not_found", "현재 접근 가능한 저장 보기가 아닙니다.");
const checkDeadline = (deadline: number) => {
  if (performance.now() >= deadline) throw new CommandError(503, "flow_view_source_unavailable", "저장 보기의 원본 접근을 확인하지 못했습니다.");
};

/** Stored labels are published only after current source authorization. */
export class FlowViews {
  constructor(private repository: FlowViewRepository, private authorize: FlowViewAuthorization) {}

  private async authorized(actor: string, anchors: FlowViewAnchors, deadline: number): Promise<() => void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([this.authorize(actor, anchors, deadline), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CommandError(503, "flow_view_source_unavailable", "저장 보기의 원본 접근을 확인하지 못했습니다.")), Math.max(0, Math.ceil(deadline - performance.now())));
      })]);
    } finally { clearTimeout(timer); }
  }

  async list(actor: string, contextId: string, deadline = performance.now() + 10_000): Promise<SavedFlowView[]> {
    checkDeadline(deadline);
    if (!/^[a-f0-9]{64}$/.test(contextId)) throw invalid();
    const allowed: SavedFlowView[] = [], guards: Array<() => void> = [];
    for (const row of this.repository.list(actor, contextId)) {
      try { const confirm = await this.authorized(actor, row.content.anchors, deadline); confirm(); guards.push(confirm); allowed.push(row); }
      catch (error) { if (!(error instanceof CommandError && error.status === 404)) throw error; }
    }
    // Earlier records can lose grants while later records await their sources.
    for (const confirm of guards) confirm();
    checkDeadline(deadline);
    return allowed;
  }

  async save(actor: string, input: unknown, actorIsCurrent: () => boolean = () => true, deadline = performance.now() + 10_000): Promise<SavedFlowView> {
    checkDeadline(deadline);
    const parsed = saveFlowViewSchema.safeParse(input); if (!parsed.success) throw invalid();
    const { id, expectedRevision, content } = parsed.data;
    const confirm = await this.authorized(actor, content.anchors, deadline); confirm(); checkDeadline(deadline);
    if (!actorIsCurrent()) throw new CommandError(401, "authentication_required", "현재 로그인 권한을 다시 확인하세요.");
    try {
      const saved = this.repository.put(actor, id, expectedRevision, content);
      if (!saved) throw new CommandError(409, "flow_view_changed", "저장 보기가 다른 화면에서 변경됐습니다. 목록을 다시 확인하세요.");
      return saved;
    } catch (error) {
      if (error instanceof FlowViewLimitError) throw new CommandError(409, "flow_view_limit", "저장 보기는 계정당 20개까지 만들 수 있습니다.");
      throw error;
    }
  }

  remove(actor: string, id: string, input: unknown, deadline = performance.now() + 10_000): void {
    checkDeadline(deadline);
    const parsed = deleteFlowViewSchema.safeParse(input);
    if (!flowViewIdSchema.safeParse(id).success || !parsed.success) throw invalid();
    if (!this.repository.get(actor, id)) throw missing();
    if (!this.repository.remove(actor, id, parsed.data.expectedRevision))
      throw new CommandError(409, "flow_view_changed", "저장 보기가 다른 화면에서 변경됐습니다. 목록을 다시 확인하세요.");
  }
}
