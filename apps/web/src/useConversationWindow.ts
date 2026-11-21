import { useEffect, useState } from "react";
import type { RunView } from "../../../packages/contracts/index.ts";
import type { RunConversationView } from "../../../packages/contracts/conversation.ts";
import type { MissionNode } from "../../../packages/projection/mission-flow.ts";
import { fetchConversationWindow } from "./conversation-client.ts";
import { PrivateReadError } from "./private-json.ts";

/** Bounded fallback for v1 Run paging, with fresh authorization on every page. */
export function useConversationWindow(actor: string | null, run: RunView, node: MissionNode | undefined,
  enabled: boolean, onUnauthorized: (reason: string) => void) {
  const scope = JSON.stringify([actor, run.key, run.runId, run.sessionId, run.workspaceId, run.binding, run.assistantAttempt,
    run.sourceState, run.stale, enabled, node?.kind, node?.id, node?.callId, node?.invocationId]);
  const [position, setPosition] = useState({ scope, cursor: "0", previous: [] as string[] });
  const [retry, setRetry] = useState(0);
  const [read, setRead] = useState<{ scope: string; value: RunConversationView | null; busy: boolean; searched: number; error: string | null } | null>(null);
  const currentPosition = position.scope === scope ? position : { scope, cursor: "0", previous: [] as string[] };
  const requestScope = JSON.stringify([scope, currentPosition.cursor, retry]);
  useEffect(() => {
    if (!actor || !enabled || run.sourceState !== "connected" || run.stale) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const cursor = currentPosition.cursor;
    async function load() {
      setRead(previous => previous?.scope === requestScope ? previous : { scope: requestScope, value: null, busy: true, searched: 0, error: null });
      try {
        const { value, searched } = await fetchConversationWindow(run, cursor, node, controller.signal);
        if (!controller.signal.aborted) {
          if (value.state === "forbidden") onUnauthorized("현재 실행의 접근 권한이 변경되어 이전 대화와 본문을 지웠습니다.");
          else setRead({ scope: requestScope, value, busy: false, searched, error: null });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setRead({ scope: requestScope, value: null, busy: false, searched: 0, error: "현재 범위의 대화 기록을 읽지 못했습니다. 다시 확인해 주세요." });
        if (error instanceof PrivateReadError && ["unauthorized", "unavailable"].includes(error.kind))
          onUnauthorized(error.kind === "unauthorized" ? "로그인이 만료되어 대화·도구 기록을 지웠습니다." : "현재 실행의 접근 권한이 변경되어 이전 대화와 본문을 지웠습니다.");
      } finally { if (!controller.signal.aborted) timer = setTimeout(() => void load(), 20_000); }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [requestScope, onUnauthorized]);
  const active = actor && enabled && !run.stale && run.sourceState === "connected";
  const current = active && read?.scope === requestScope ? read : null;
  return { value: current?.value ?? null, busy: !!active && (!current || current.busy), error: current?.error ?? null,
    searched: current?.searched ?? 0, pageNumber: currentPosition.previous.length + 1, canBack: currentPosition.previous.length > 0,
    retry: () => setRetry(value => value + 1), reset: () => { setPosition({ scope, cursor: "0", previous: [] }); setRetry(value => value + 1); },
    more: () => { const next = current?.value?.page?.next; if (next) setPosition({ scope, cursor: next, previous: [...currentPosition.previous, currentPosition.cursor] }); },
    back: () => { if (currentPosition.previous.length) setPosition({ scope, cursor: currentPosition.previous.at(-1)!, previous: currentPosition.previous.slice(0, -1) }); } };
}
