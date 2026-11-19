import { useEffect, useState } from "react";
import type { RunView } from "../../../packages/contracts/index.ts";
import type { RunContentView } from "../../../packages/contracts/work-content.ts";
import { fetchRunContent } from "./work-content-client.ts";
import { PrivateReadError } from "./private-json.ts";

export function useRunContent(actor: string, run: RunView, onUnauthorized: (reason: string) => void) {
  const [retry, setRetry] = useState(0);
  const scope = JSON.stringify([actor, run.key, run.sourceState, run.stale, run.binding, run.assistantAttempt, retry]);
  const [read, setRead] = useState<{ scope: string; value: RunContentView | null; busy: boolean; error: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      setRead(previous => ({ scope, value: previous?.scope === scope ? previous.value : null, busy: true, error: false }));
      try {
        const value = await fetchRunContent(run, controller.signal);
        if (!controller.signal.aborted) setRead({ scope, value, busy: false, error: false });
      } catch (reason) {
        if (controller.signal.aborted) return;
        setRead({ scope, value: null, busy: false, error: true });
        if (reason instanceof PrivateReadError && reason.kind === "unauthorized") onUnauthorized("로그인이 만료되어 대화·응답 본문을 지웠습니다.");
      } finally { if (!controller.signal.aborted) timer = setTimeout(() => void load(), 20_000); }
    }
    if (run.sourceState === "connected" && !run.stale) void load();
    else setRead({ scope, value: null, busy: false, error: true });
    return () => { controller.abort(); clearTimeout(timer); };
  }, [scope, onUnauthorized]);
  const current = read?.scope === scope ? read : null;
  return { value: current?.value ?? null, busy: current?.busy ?? true, error: current?.error ?? false, retry: () => setRetry(value => value + 1) };
}
