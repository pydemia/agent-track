import { useEffect, useState } from "react";
import type { RunView } from "../../../packages/contracts/index.ts";
import type { ToolEvidencePage } from "../../../packages/adapters/demian/tool-evidence.ts";
import type { ModelRequestEvidence } from "../../../packages/contracts/model-requests.ts";
import { parseToolEvidenceReply } from "./tool-evidence-reply.ts";

type ScopedToolEvidencePage = ToolEvidencePage & ModelRequestEvidence & { runKey: string };
type EvidenceState = { actor: string; sourceId: string; runKey: string; authScope: (reason: string) => void; page: ScopedToolEvidencePage };

export function useToolEvidence(run: RunView, onUnauthorized: (reason: string) => void, actor = run.sourceId) {
  const [state, setState] = useState<EvidenceState | null>(null); const [detail, setDetail] = useState("원본 도구 근거 조회 전입니다.");
  const native = run.capabilities.includes("session.link");
  useEffect(() => {
    if (!native || run.sourceState !== "connected" || run.stale) { setState(null); return; }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const response = await fetch(`/api/runs/${run.key}/tools?include=model-requests`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if ([401, 403, 404].includes(response.status)) { setState(null); onUnauthorized("실행 접근이 변경되어 도구 실행 근거를 지웠습니다."); return; }
        if (!response.ok) throw new Error();
        const value = parseToolEvidenceReply(await response.json(), run); if (controller.signal.aborted) return;
        setState(value.state === "connected" ? { actor, sourceId: run.sourceId, runKey: run.key, authScope: onUnauthorized, page: value } : null); setDetail(value.detail);
      } catch { if (!controller.signal.aborted) { setState(null); setDetail("원본 도구 결과를 확인하지 못했습니다. 정규 이벤트의 완료 보고와 결과 성공 여부는 별도입니다."); } }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void read(), 15_000); }
    }
    void read(); return () => { controller.abort(); clearTimeout(timer); };
  }, [run.key, run.sourceId, run.sourceState, run.stale, native, onUnauthorized, actor]);
  const scoped = state && state.actor === actor && state.sourceId === run.sourceId && state.runKey === run.key && state.authScope === onUnauthorized ? state.page : null;
  return { native, page: native && run.sourceState === "connected" && !run.stale ? scoped : null, detail };
}
