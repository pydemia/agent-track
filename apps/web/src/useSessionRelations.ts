import { useEffect, useRef, useState } from "react";
import type { RunView } from "../../../packages/contracts/index.ts";
import type { SessionRelationKind, SessionRelationsEvidence } from "../../../packages/contracts/session-relations.ts";
import { fetchSessionRelations } from "./session-relations-client.ts";
import { PrivateReadError } from "./private-json.ts";

export interface RelationWindow { kind: SessionRelationKind; pages: SessionRelationsEvidence[]; loading: boolean; failed: boolean }
const kinds = ["managed-children", "peer-processing"] as const;

export function useSessionRelations(actor: string, run: RunView, runs: RunView[], onUnauthorized: (reason: string) => void) {
  const native = run.capabilities.includes("session.link");
  const enabled = native && run.sourceState === "connected" && !run.stale;
  const identity = JSON.stringify([actor, run.key, run.sourceId, run.sessionId, enabled,
    runs.filter(item => item.sourceId === run.sourceId && item.sessionId === run.sessionId).map(item =>
      [item.key, item.sourceState, item.stale, item.binding?.projectSourceId, item.binding?.projectId, item.binding?.taskId]).sort()]);
  const [state, setState] = useState<{ identity: string; windows: RelationWindow[] }>({ identity: "", windows: [] });
  const [limits, setLimits] = useState<{ identity: string; value: Partial<Record<SessionRelationKind, number>> }>({ identity: "", value: {} });
  const [refresh, setRefresh] = useState(0);
  const unauthorized = useRef(onUnauthorized); unauthorized.current = onUnauthorized;
  const limitKey = JSON.stringify(limits.identity === identity ? limits.value : {});
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const pageLimits: Partial<Record<SessionRelationKind, number>> = JSON.parse(limitKey);
    const record = (window: RelationWindow) => {
      if (!controller.signal.aborted) setState(previous => ({ identity,
        windows: [...(previous.identity === identity ? previous.windows : []).filter(item => item.kind !== window.kind), window] }));
    };
    async function loadKind(kind: SessionRelationKind) {
      setState(previous => ({ identity, windows: (previous.identity === identity ? previous.windows : [])
        .map(item => item.kind === kind ? { ...item, loading: true } : item) }));
      try {
        const pages: SessionRelationsEvidence[] = [], cursors = new Set<string>(), ids = new Set<string>();
        let cursor: string | null = null;
        for (let index = 0; index < (pageLimits[kind] ?? 1); index++) {
          const page = await fetchSessionRelations(run, kind, cursor, controller.signal);
          if (page.state !== "connected") { record({ kind, pages: [page], loading: false, failed: false }); return; }
          for (const row of page.relations) {
            if (ids.has(row.runId)) throw new Error("Conflicting relation window");
            ids.add(row.runId);
          }
          pages.push(page);
          if (!page.hasMore) break;
          if (page.nextCursor === null || cursors.has(page.nextCursor)) throw new Error("Repeated relation cursor");
          cursor = page.nextCursor; cursors.add(cursor);
        }
        record({ kind, pages, loading: false, failed: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        record({ kind, pages: [], loading: false, failed: true });
        if (error instanceof PrivateReadError && error.kind === "unauthorized") unauthorized.current("로그인이 만료되어 세션 관계 근거를 지웠습니다.");
      }
    }
    async function poll() {
      await Promise.all(kinds.map(loadKind));
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 15_000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [identity, limitKey, refresh]);
  const windows = enabled && state.identity === identity ? state.windows : [];
  return { native, windows, evidence: windows.flatMap(item => item.pages),
    refresh: () => setRefresh(value => value + 1),
    more: (kind: SessionRelationKind) => setLimits(previous => ({ identity, value: {
      ...(previous.identity === identity ? previous.value : {}),
      [kind]: Math.min(4, (previous.identity === identity ? previous.value[kind] ?? 1 : 1) + 1),
    } })), maxPages: 4 };
}
