import { useEffect, useRef, useState } from "react";
import type { RunView } from "../../../packages/contracts/index.ts";
import type { SuccessorPanel, SuccessorReceipt, SuccessorReviewInput } from "../../../packages/contracts/run-successors.ts";
import { PrivateReadError } from "./private-json.ts";
import { mergeSuccessors, readSuccessor, readSuccessors, selectSuccessorKind, successorRunKey, writeSuccessor } from "./run-successor-client.ts";

const kindNames = { retry: "실패 재시도", resume: "중단 작업 재개", continue: "새 입력으로 계속 실행" } as const;
const stateNames = { prepared: "검토 저장 · 미전송", dispatching: "원본에 전송 중", accepted: "새 Run 접수",
  rejected: "요청 거절", expired: "검토 만료", unknown: "접수 결과 미확정" } as const;
const unresolved = (receipt: SuccessorReceipt) => ["prepared", "dispatching", "unknown"].includes(receipt.state);
const availabilityNames = { ready: "명령 접수와 새 Run의 실행 성공은 별도입니다.", not_enabled: "현재 계정·출처에 실행 명령 권한이 설정되지 않았습니다.",
  protected_owner_required: "보호된 실행은 Assistant owner 제어 경로의 연결이 필요합니다. 읽기 전용 관측 권한으로 실행하지 않습니다.",
  native_contract_unavailable: "현재 원본에서 실행 명령 계약을 확인할 수 없습니다.", native_unavailable: "현재 원본과 권한을 확인할 수 없어 새 요청을 잠갔습니다.",
  no_terminal_action: "현재 원본 상태에서는 후속 실행 명령을 접수할 수 없습니다." } as const;

export function RunSuccessorControls({ run, onUnauthorized }: { run: RunView; onUnauthorized: (reason: string) => void }) {
  const [panel, setPanel] = useState<SuccessorPanel | null>(null), [error, setError] = useState("");
  const [kind, setKind] = useState<SuccessorReviewInput["kind"]>("retry"), [input, setInput] = useState("");
  const [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const [ownedReview, setOwnedReview] = useState<{ id: string; input: string | undefined } | null>(null);
  const [pending, setPending] = useState<{ id: string; phase: "review" | "dispatch" | "discard" } | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const pendingRef = useRef<typeof pending>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await readSuccessors(run.key, controller.signal);
        const expected = pendingRef.current;
        if (expected && !value.receipts.some(receipt => receipt.id === expected.id)) {
          const exact = await readSuccessor(run.key, expected.id, controller.signal);
          value.receipts = [exact, ...value.receipts].slice(0, 100);
        }
        if (controller.signal.aborted) return;
        setPanel(previous => ({ ...value, receipts: mergeSuccessors(previous?.receipts ?? [], value.receipts) }));
        if (expected && value.receipts.some(receipt => receipt.id === expected.id &&
            (expected.phase === "review" || receipt.state !== "prepared"))) { pendingRef.current = null; setPending(null); }
        setError("");
      } catch (reason) {
        if (controller.signal.aborted) return;
        setPanel(null);
        if (reason instanceof PrivateReadError && reason.kind === "unauthorized") {
          setInput(""); setOwnedReview(null); onUnauthorized("실행 명령 접근 권한이 해제되어 데이터를 지웠습니다.");
        } else {
          if (reason instanceof PrivateReadError && reason.kind === "unavailable") { setInput(""); setOwnedReview(null); }
          setError("현재 명령 기록을 확인하지 못했습니다. 같은 요청 ID를 다시 조회하며 자동 재전송하지 않습니다.");
        }
      } finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 4000); }
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [run.key, onUnauthorized, refresh]);

  async function act(action: "review" | "dispatch" | "discard", receipt?: SuccessorReceipt) {
    const controller = lifetime.current;
    if (inFlight.current || busy || !controller || controller.signal.aborted || !panel || pending) return;
    const selectedKind = selectSuccessorKind(kind, panel.availability.availableKinds);
    if (action === "review" && !selectedKind) return;
    const draft: SuccessorReviewInput | undefined = action === "review" ? { id: crypto.randomUUID(), runKey: run.key,
      kind: selectedKind!, expiresAt: new Date(Date.now() + 90_000).toISOString(), ...(selectedKind === "continue" ? { input } : {}) } : undefined;
    const id = draft?.id ?? receipt?.id; if (!id) return;
    if (action === "review") setOwnedReview({ id, input: draft?.input });
    inFlight.current = true; setBusy(true); pendingRef.current = { id, phase: action }; setPending({ id, phase: action }); setError("");
    try {
      const result = await writeSuccessor(run.key, action, draft ?? id, controller.signal);
      if (controller.signal.aborted) return;
      setPanel(previous => previous ? { ...previous, receipts: mergeSuccessors(previous.receipts,
        [result, ...previous.receipts.filter(item => item.id !== id)].slice(0, 100)) } : null);
      pendingRef.current = null; setPending(null);
      if (action !== "review") { setInput(""); setOwnedReview(null); }
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (reason instanceof PrivateReadError && reason.kind === "unauthorized") {
        setInput(""); setOwnedReview(null); setPanel(null); onUnauthorized("실행 명령 접근 권한이 해제되어 데이터를 지웠습니다.");
      } else setError("응답을 확인하지 못했습니다. 같은 요청 ID의 저장 기록을 확인할 때까지 새 요청을 잠급니다.");
    } finally { inFlight.current = false; if (!controller.signal.aborted) { setBusy(false); setRefresh(value => value + 1); } }
  }
  const prepared = panel?.receipts.find(receipt => receipt.state === "prepared");
  const blocked = busy || !!pending || !panel || panel.receipts.some(unresolved);
  const kinds = panel?.availability.availableKinds ?? [];
  const draftKind = selectSuccessorKind(kind, kinds);
  return <section className="run-successor-controls" aria-label="후속 실행 명령">
    <h4>재시도·재개·계속 실행</h4>
    <p>{panel ? availabilityNames[panel.availability.detail] : "현재 원본과 명령 기록을 확인하는 중…"}</p>
    {!!kinds.length && <><label>명령<select disabled={blocked} value={draftKind} onChange={event => setKind(event.target.value as SuccessorReviewInput["kind"])}>
      {kinds.map(value => <option key={value} value={value}>{kindNames[value]}</option>)}</select></label>
      {draftKind === "continue" && <label>새 입력<textarea value={input} maxLength={1_000_000} disabled={blocked} onChange={event => setInput(event.target.value)} /></label>}
      <p>{draftKind === "continue" ? "같은 Session에 새 입력·새 작업 root의 Run을 만듭니다. 기존 Projects 업무에 자동 배정하지 않습니다."
        : "이전 Run은 보존하고 원래 입력의 새 시도를 요청합니다. 이미 발생한 외부 효과를 되돌리는 동작은 아닙니다."}</p>
      <button type="button" disabled={blocked || draftKind === "continue" && !input.trim()} onClick={() => void act("review")}>원본 상태를 확인하고 검토</button></>}
    {prepared && <div className="cancel-confirm"><strong>{kindNames[prepared.kind]} · 전송 전 확인</strong>
      <p>원본 {prepared.sourceStatus} · cursor {prepared.expectedCursor}</p><code>{prepared.runId}</code>
      <p>Session {prepared.sessionId} · 검토 만료 {new Date(prepared.expiresAt).toLocaleTimeString("ko-KR")}</p>
      {run.binding?.taskId && <p>기록 당시 업무: {run.binding.taskTitle || run.binding.taskId} · revision {run.binding.taskRevision ?? "미확인"}</p>}
      {prepared.kind === "continue" && (ownedReview?.id === prepared.id ? <pre>{ownedReview.input}</pre> : <p>새 입력 초안이 이 화면에 없어 전송할 수 없습니다. 검토를 폐기하고 다시 작성해 주세요.</p>)}
      <button type="button" disabled={busy || !!pending || !kinds.includes(prepared.kind) || prepared.kind === "continue" && ownedReview?.id !== prepared.id || Date.parse(prepared.expiresAt) <= Date.now()}
        onClick={() => void act("dispatch", prepared)}>확인한 명령 한 번 보내기</button>
      <button type="button" disabled={busy || !!pending} onClick={() => void act("discard", prepared)}>검토 폐기</button></div>}
    {error && <p role="alert">{error}</p>}
    {pending && <small>요청 ID: {pending.id} · 접수 여부와 Run 상태는 별도로 확인합니다.</small>}
    <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>같은 기록 다시 확인</button>
    {!!panel?.receipts.length && <ol className="receipt-list" aria-label="후속 실행 명령 기록" aria-live="polite">{panel.receipts.slice(0, 5).map(receipt => <li key={receipt.id}>
      <strong>{kindNames[receipt.kind]} · {stateNames[receipt.state]}</strong><small>명령 {receipt.id}</small>
      {receipt.state === "accepted" && <><small>실행 성공·Projects 업무 수용은 별도입니다. {receipt.observationState === "observed" ? "새 Run 관측됨" : "새 Run 관측 대기"}</small>
        {receipt.observationState === "observed" && <a href={`/?view=map&run=${encodeURIComponent(successorRunKey(receipt.sourceId, receipt.newRunId!))}`}>새 Run 보기</a>}</>}
      {receipt.state === "unknown" && <small>같은 ID로 원본을 조회 중입니다. not_found도 미접수의 확정 근거가 아니며 새 명령을 자동 전송하지 않습니다.</small>}
    </li>)}</ol>}
    {panel?.hasMore && <small>최근 명령 100개 조회 창이며 이전 기록이 더 있습니다.</small>}
  </section>;
}
