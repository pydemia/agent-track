import { useEffect, useState } from "react";
import { z } from "zod";
import { idSchema, sequenceSchema, timestampSchema, type RunView } from "../../../packages/contracts/index.ts";
import type { ToolEvidencePage } from "../../../packages/adapters/demian/tool-evidence.ts";

const mark = z.object({ type: z.enum(["tool.requested", "tool.started", "tool.completed", "tool.failed"]), sequence: sequenceSchema,
  occurredAt: timestampSchema, ok: z.boolean().optional() }).strict();
const schema = z.object({ state: z.enum(["connected", "disconnected", "forbidden", "unsupported"]), runKey: idSchema, observedAt: timestampSchema,
  detail: z.string().max(2000), calls: z.array(z.object({ invocationId: idSchema.nullable(), callId: idSchema, tool: z.string().max(120).nullable(),
    requested: z.array(mark).max(2000), started: z.array(mark).max(2000), ended: z.array(mark).max(2000),
    outcome: z.enum(["succeeded", "failed", "unknown", "ambiguous"]) }).strict()).max(500), scanned: z.number().int().min(0).max(2000), limit: z.literal(2000),
  targetSequence: sequenceSchema, throughSequence: sequenceSchema, targetReached: z.boolean(), gaps: z.boolean(), truncated: z.boolean(),
  omittedCalls: z.number().int().nonnegative(), unidentifiedEvents: z.number().int().nonnegative(), complete: z.boolean() }).strict();

export function useToolEvidence(run: RunView, onUnauthorized: (reason: string) => void) {
  const [page, setPage] = useState<ToolEvidencePage | null>(null); const [detail, setDetail] = useState("원본 도구 근거 조회 전입니다.");
  const native = run.capabilities.includes("session.link");
  useEffect(() => {
    if (!native || run.sourceState !== "connected") { setPage(null); return; }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const response = await fetch(`/api/runs/${run.key}/tools`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if ([401, 403, 404].includes(response.status)) { onUnauthorized("실행 접근이 변경되어 도구 실행 근거를 지웠습니다."); return; }
        if (!response.ok) throw new Error();
        const value = schema.parse(await response.json()); if (controller.signal.aborted) return;
        if (value.runKey !== run.key) throw new Error();
        // Reconstruct the optional boolean rather than passing explicit undefined.
        const calls = value.calls.map((call) => ({ ...call, requested: call.requested.map(clean), started: call.started.map(clean), ended: call.ended.map(clean) }));
        setPage(value.state === "connected" ? { ...value, calls } : null); setDetail(value.detail);
      } catch { if (!controller.signal.aborted) { setPage(null); setDetail("원본 도구 결과를 확인하지 못했습니다. 정규 이벤트의 완료 보고와 결과 성공 여부는 별도입니다."); } }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void read(), 15_000); }
    }
    void read(); return () => { controller.abort(); clearTimeout(timer); };
  }, [run.key, run.sourceState, native, onUnauthorized]);
  return { native, page: native && run.sourceState === "connected" ? page : null, detail };
}
function clean({ ok, ...value }: z.infer<typeof mark>) { return { ...value, ...(ok === undefined ? {} : { ok }) }; }
