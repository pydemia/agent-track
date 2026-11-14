import { useEffect, useRef, useState } from "react";
import type { RunView } from "../../../packages/contracts/index.ts";
import type { Receipt, ReceiptState } from "../../../packages/commands/index.ts";
import { RunSuccessorControls } from "./RunSuccessorControls.tsx";
import { CoordinatorCommandControls } from "./CoordinatorCommandControls.tsx";

const names: Record<ReceiptState, string> = {
  requested: "요청 기록", dispatching: "전송 중", accepted: "원본 접수",
  succeeded: "취소 종료 확인", failed: "처리 실패", expired: "요청 만료", unknown: "결과 미확정",
};
const unresolved = new Set<ReceiptState>(["requested", "dispatching", "accepted", "unknown"]);
const cancellable = new Set(["queued", "leasing", "running", "waiting_for_permission"]);
function mergeReceipts(previous: Receipt[], incoming: Receipt[]): Receipt[] {
  const byId = new Map(previous.map((item) => [item.id, item]));
  for (const item of incoming) {
    const old = byId.get(item.id);
    if (!old || Date.parse(item.updatedAt) > Date.parse(old.updatedAt)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// The parent keys this component by Run identity. In-flight work is aborted on selection changes.
export function RunControls({ run, onUnauthorized }: { run: RunView; onUnauthorized: (reason: string) => void }) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const lifetime = useRef<AbortController | null>(null);
  const pendingId = useRef<string | null>(null);
  const permitted = run.capabilities.includes("run.cancel");
  const native = run.capabilities.includes("session.link") || permitted;

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!native) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/commands?run=${encodeURIComponent(run.key)}`, { signal: controller.signal });
        if (response.status === 401 || response.status === 403) {
          onUnauthorized("명령 조회 권한이 해제되어 실행 데이터를 지웠습니다."); return;
        }
        if (!response.ok) throw new Error("명령 처리 기록을 조회할 수 없습니다.");
        const body = await response.json() as { receipts: Receipt[] };
        if (controller.signal.aborted) return;
        setReceipts((items) => mergeReceipts(items, body.receipts));
        setReady(true);
        if (pendingId.current && body.receipts.some((item) => item.id === pendingId.current)) {
          setAmbiguous(false);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted) setError("명령 처리 기록을 조회할 수 없습니다. 연결 복구 후 다시 확인합니다.");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 4000);
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [native, run.key, onUnauthorized, refresh]);

  async function cancel() {
    if (sending || !permitted || !ready || ambiguous || receipts.some((item) => unresolved.has(item.state))) return;
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted) return;
    const id = crypto.randomUUID();
    pendingId.current = id;
    setSending(true); setConfirming(false); setError("");
    try {
      const response = await fetch("/api/commands/cancel", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ kind: "cancel", runKey: run.key, idempotencyKey: id,
          expectedCursor: run.cursor, expiresAt: new Date(Date.now() + 90_000).toISOString() }),
      });
      if (response.status === 401 || response.status === 403) {
        onUnauthorized("실행 제어 권한이 해제되어 실행 데이터를 지웠습니다."); return;
      }
      if (!response.ok) {
        if (response.status >= 500) setAmbiguous(true);
        setError(response.status === 409 ? "원본 실행 상태가 바뀌었습니다. 최신 상태와 처리 기록을 확인해 주세요." : "취소를 완료하지 못했습니다. 처리 기록을 확인해 주세요.");
        return;
      }
      const body = await response.json() as { receipt: Receipt };
      if (!controller.signal.aborted) setReceipts((items) => mergeReceipts(items, [body.receipt]));
    } catch {
      if (!controller.signal.aborted) {
        setAmbiguous(true);
        setError("응답을 확인하지 못했습니다. 자동 재전송하지 않습니다. 처리 기록과 원본 상태를 확인해 주세요.");
      }
    } finally {
      if (!controller.signal.aborted) { setSending(false); setRefresh((value) => value + 1); }
    }
  }

  const blocked = sending || !ready || ambiguous || receipts.some((item) => unresolved.has(item.state));
  return <section className="run-controls" aria-label="실행 제어">
    <div className="unsupported-actions">
      <button disabled={!permitted || !cancellable.has(run.status) || blocked} onClick={() => setConfirming(true)}>{sending ? "취소 전송 중…" : permitted ? "실행 취소" : "취소 · 미지원"}</button></div>
    {confirming && <div className="cancel-confirm"><p>이 Run의 실행을 취소합니다. 원본이 취소를 접수한 뒤 종료 상태를 별도로 확인합니다.</p><code>{run.runId}</code><div><button onClick={() => void cancel()}>취소 요청 보내기</button><button onClick={() => setConfirming(false)}>돌아가기</button></div></div>}
    {error && <p role="alert" className="command-error">{error}</p>}
    {ambiguous && <small>요청 ID: {pendingId.current} · 새 요청은 잠겨 있습니다. 원본 세션에서 상태를 확인할 수 있습니다.</small>}
    {!!receipts.length && <ol className="receipt-list" aria-label="취소 처리 기록" aria-live="polite">{receipts.slice(-5).reverse().map((item) => <li key={item.id}><strong>{names[item.state]}</strong><time>{new Date(item.updatedAt).toLocaleTimeString("ko-KR")}</time><small>{item.state === "accepted" ? "접수됨 · 종료 확인 대기" : item.state === "unknown" ? "원본 재조회 중 · 재전송 없음" : item.state === "succeeded" ? "원본에서 취소 종료 상태 관측" : item.state === "failed" ? "원본 상태·연결을 확인해 주세요." : "요청 처리 상태이며 Run 종료 상태와 별도입니다."}</small></li>)}</ol>}
    {!permitted && <small>이 출처 또는 계정에는 실행 취소 기능이 열려 있지 않습니다.</small>}
    {run.assistantAttempt ? <CoordinatorCommandControls key={run.key} run={run} onUnauthorized={onUnauthorized} />
      : <RunSuccessorControls key={run.key} run={run} onUnauthorized={onUnauthorized} />}
  </section>;
}
