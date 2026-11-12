import { useEffect, useRef, useState } from "react";
import type { ArtifactEvidence, RunView } from "../../../packages/contracts/index.ts";
import { fetchArtifactEvidence } from "./artifact-client.ts";
import { PrivateReadError } from "./private-json.ts";

export function useArtifactEvidence(actor: string, run: RunView, onUnauthorized: (reason: string) => void) {
  const native = run.capabilities.includes("session.link");
  const enabled = native && run.sourceState === "connected" && !run.stale;
  const identity = JSON.stringify([actor, run.key, run.sourceId, run.runId, run.sessionId, run.status, enabled, run.binding]);
  const [state, setState] = useState<{ identity: string; evidence: ArtifactEvidence | null; loading: boolean; failed: boolean }>({ identity: "", evidence: null, loading: false, failed: false });
  const [refresh, setRefresh] = useState(0);
  const unauthorized = useRef(onUnauthorized); unauthorized.current = onUnauthorized;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      setState(previous => ({ identity, evidence: previous.identity === identity ? previous.evidence : null, loading: true, failed: false }));
      try {
        const evidence = await fetchArtifactEvidence(run, controller.signal);
        if (!controller.signal.aborted) setState({ identity, evidence, loading: false, failed: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ identity, evidence: null, loading: false, failed: true });
        if (error instanceof PrivateReadError && error.kind === "unauthorized") unauthorized.current("로그인이 만료되어 산출물 근거를 지웠습니다.");
      } finally { if (!controller.signal.aborted) timer = setTimeout(() => void load(), 15_000); }
    }
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [identity, refresh]);
  const current = enabled && state.identity === identity ? state : { evidence: null, loading: enabled, failed: false };
  return { native, enabled, evidence: current.evidence, loading: current.loading, failed: current.failed, refresh: () => setRefresh(value => value + 1) };
}
