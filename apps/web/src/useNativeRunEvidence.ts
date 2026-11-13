import { useEffect, useState } from "react";
import type { RunView } from "../../../packages/contracts/index.ts";
import { nativeRunEvidenceViewSchema, type NativeEvidenceRecord, type PublicNativeRunEvidencePage } from "../../../packages/contracts/native-run-evidence.ts";

export type NativeRunEvidenceState = {
  scope: string; state: string; page: PublicNativeRunEvidencePage | null; records: NativeEvidenceRecord[];
  hasMore: boolean; detail: string;
};
const empty = (scope: string, state = "unknown", detail = "원본 상세 근거 조회 전입니다."): NativeRunEvidenceState =>
  ({ scope, state, page: null, records: [], hasMore: false, detail });

/** Fresh authorization per page; no private evidence survives a scope change or failed read. */
export function useNativeRunEvidence(actor: string, run: RunView, onUnauthorized: (reason: string) => void) {
  const native = run.capabilities.includes("run.evidence");
  const scope = JSON.stringify([actor, run.key, run.sourceId, run.workspaceId, run.sessionId, run.sourceState, run.stale, native]);
  const [value, setValue] = useState<NativeRunEvidenceState>(() => empty(scope));
  useEffect(() => {
    setValue(empty(scope));
    if (!native || run.sourceState !== "connected" || run.stale) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        let after = "0", reference: string | undefined;
        let page: PublicNativeRunEvidencePage | null = null, detail = "";
        const records: NativeEvidenceRecord[] = [];
        for (let index = 0; index < 4; index++) {
          const response = await fetch(`/api/runs/${encodeURIComponent(run.key)}/evidence?after=${after}&limit=250`, { signal: controller.signal, cache: "no-store" });
          if (controller.signal.aborted) return;
          if ([401, 403, 404].includes(response.status)) {
            setValue(empty(scope, "forbidden", "실행 접근이 변경되어 상세 근거를 지웠습니다."));
            onUnauthorized("실행 접근이 변경되어 상세 근거를 지웠습니다."); return;
          }
          if (!response.ok) throw new Error("Evidence unavailable");
          const result = nativeRunEvidenceViewSchema.parse(await response.json());
          if (controller.signal.aborted) return;
          if (result.runKey !== run.key || result.sourceId !== run.sourceId) throw new Error("Evidence scope mismatch");
          if (result.state !== "connected") { setValue(empty(scope, result.state, result.detail)); return; }
          const next = result.page!;
          if (next.events.after !== after || next.events.limit !== 250 || next.run.id !== run.runId ||
              next.run.session_id !== run.sessionId || next.run.workspace_id !== run.workspaceId ||
              reference !== undefined && reference !== JSON.stringify(result.executionRef)) throw new Error("Evidence page mismatch");
          reference = JSON.stringify(result.executionRef); page = next; detail = result.detail;
          records.push(...next.events.data); after = next.events.next_after;
          if (!next.events.has_more) break;
        }
        if (!controller.signal.aborted) setValue({ scope, state: "connected", page, records, hasMore: page?.events.has_more ?? false, detail });
      } catch {
        if (!controller.signal.aborted) setValue(empty(scope, "disconnected", "상세 근거를 확인하지 못했습니다. 기록 없음으로 해석하지 마세요."));
      } finally { if (!controller.signal.aborted) timer = setTimeout(() => void read(), 15_000); }
    }
    void read(); return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [scope, native, run.key, run.runId, run.sourceId, run.workspaceId, run.sessionId, run.sourceState, run.stale, onUnauthorized]);
  return { ...(value.scope === scope ? value : empty(scope)), native };
}
