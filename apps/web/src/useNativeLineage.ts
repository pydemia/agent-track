import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { sequenceSchema, timestampSchema, type RunView } from "../../../packages/contracts/index.ts";
import type { NativeLineageObservation } from "../../../packages/adapters/demian/lineage.ts";

const schema = z.object({ state: z.enum(["connected", "disconnected", "forbidden", "unsupported"]), runKey: z.string(),
  observations: z.array(z.object({ sequence: sequenceSchema, invocationId: z.string().max(512).nullable(), nativeItemId: z.string().max(512).nullable(),
    nativeThreadId: z.string().max(512), nativeTurnId: z.string().max(512), phase: z.enum(["turn_started", "tool_started", "tool_completed", "message_completed"]),
    attempt: z.number().int().positive().safe(), executor: z.string().max(512), provider: z.string().max(512), observedAt: timestampSchema,
    parentInvocationId: z.string().max(512).optional() }).strict()).max(250), nextCursor: sequenceSchema, hasMore: z.boolean(), observedAt: timestampSchema, detail: z.string().max(2000) }).strict();
type State = { observations: NativeLineageObservation[]; cursor: string; hasMore: boolean; capped: boolean; state: string; detail: string };
const empty = (): State => ({ observations: [], cursor: "0", hasMore: false, capped: false, state: "unknown", detail: "Native lineage 조회 전입니다." });

export function useNativeLineage(run: RunView, onUnauthorized: (reason: string) => void) {
  const [state, setState] = useState<State>(empty); const current = useRef<State>(empty()); const [refresh, setRefresh] = useState(0);
  const native = run.capabilities.includes("session.link");
  useEffect(() => {
    if (!native || run.sourceState !== "connected") { current.current = empty(); setState(current.current); return; }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function read() {
      if (current.current.capped) return;
      try {
        const after = current.current.cursor;
        const response = await fetch(`/api/runs/${run.key}/lineage?after=${after}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if ([401, 403, 404].includes(response.status)) { onUnauthorized("실행 접근이 변경되어 Trace 근거를 지웠습니다."); return; }
        if (!response.ok) throw new Error();
        const value = schema.parse(await response.json()); if (controller.signal.aborted) return;
        if (value.runKey !== run.key) throw new Error();
        const rows: NativeLineageObservation[] = value.observations.map(({ parentInvocationId, ...row }) => ({ ...row, ...(parentInvocationId ? { parentInvocationId } : {}) }));
        const all = value.state === "connected" ? [...current.current.observations, ...rows] : [];
        const capped = all.length > 1000; const observations = all.slice(0, 1000);
        const next: State = { observations, cursor: value.state === "connected" ? observations.at(-1)?.sequence ?? value.nextCursor : "0",
          hasMore: value.hasMore || capped, capped, state: value.state, detail: value.detail };
        current.current = next; setState(next);
      } catch { if (!controller.signal.aborted) { const next = { ...empty(), state: "disconnected", detail: "Native lineage를 확인하지 못했습니다. 기록 없음으로 해석하지 마세요." }; current.current = next; setState(next); } }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void read(), 15_000); }
    }
    void read(); return () => { controller.abort(); clearTimeout(timer); };
  }, [run.key, run.sourceState, native, onUnauthorized, refresh]);
  return { ...state, observations: native && run.sourceState === "connected" ? state.observations : [], native,
    more: () => setRefresh((value) => value + 1) };
}
