import { useEffect, useRef, useState } from "react";
import type { RunView } from "../../../packages/contracts/index.ts";
import type { CoordinatorPanel } from "../../../packages/contracts/coordinator-panel.ts";
import type { CoordinatorReceipt, CoordinatorReviewInput } from "../../../packages/contracts/coordinator-commands.ts";
import { PrivateReadError } from "./private-json.ts";
import { readCoordinatorCommands, readCoordinatorCommand, writeCoordinatorCommand, mergeCoordinatorCommands } from "./coordinator-command-client.ts";

const kinds = { retry: "실패 역할 재시도", resume: "중단 역할 재개" } as const;
const states = { prepared: "검토 저장 · 미전송", dispatching: "조정자에 전송 중", unknown: "저장 결과 미확정",
  intent_saved: "조정자 요청 저장", rejected: "전송 전 차단", discarded: "검토 폐기", expired: "검토 만료" } as const;
const availability = { ready: "선택한 Run이 현재 역할 시도인지 확인했습니다.", not_enabled: "현재 계정에 조정자 명령 권한이 설정되지 않았습니다.",
  attempt_history_unavailable: "원본의 역할 시도 이력 연결이 필요합니다.", not_current_attempt: "과거 시도이거나 현재 역할 상태에서 명령을 요청할 수 없습니다.",
  no_terminal_action: "현재 역할 상태에서 후속 명령을 요청할 수 없습니다.", coordinator_unavailable: "현재 조정자와 명령 권한을 확인하지 못했습니다." } as const;
const unresolved = (receipt: CoordinatorReceipt) => ["prepared", "dispatching", "unknown"].includes(receipt.state);

export function CoordinatorCommandControls({ run, onUnauthorized }: { run: RunView; onUnauthorized: (reason: string) => void }) {
  const [panel, setPanel] = useState<CoordinatorPanel | null>(null), [error, setError] = useState("");
  const [kind, setKind] = useState<CoordinatorReviewInput["kind"]>("retry"), [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState<{ id: string; action: "review" | "dispatch" | "discard" } | null>(null);
  const inFlight = useRef(false), pendingRef = useRef(pending), lifetime = useRef<AbortController | null>(null);
  const changeVersion = useRef(0);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (inFlight.current) { timer = setTimeout(() => void poll(), 4000); return; }
      const version = changeVersion.current;
      try {
        const page = await readCoordinatorCommands(run.key, controller.signal);
        if (controller.signal.aborted || version !== changeVersion.current) return;
        setPanel(old => ({ ...page, receipts: mergeCoordinatorCommands(old?.receipts ?? [], page.receipts) }));
        setKind(old => page.availability.availableKinds.includes(old) ? old : page.availability.availableKinds[0] ?? old);
        setError("");
        const active = pendingRef.current, received = page.receipts.find(receipt => receipt.id === active?.id);
        if (!inFlight.current && received && !(active?.action === "dispatch" && received.state === "prepared")) {
          pendingRef.current = null; setPending(null);
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setPanel(null);
          if (failure instanceof PrivateReadError && failure.kind === "unauthorized") onUnauthorized("조정자 명령 접근 권한을 다시 확인해 주세요.");
          setError("기록을 확인하지 못했습니다. 자동 재전송하지 않으며 같은 요청 ID로 조회합니다.");
        }
      } finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 4000); }
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [run.key, onUnauthorized, refresh]);

  async function act(action: "review" | "dispatch" | "discard", selected?: CoordinatorReceipt) {
    if (inFlight.current || !lifetime.current || lifetime.current.signal.aborted) return;
    const id = selected?.id ?? crypto.randomUUID(), signal = lifetime.current.signal;
    inFlight.current = true; changeVersion.current++; const active = { id, action }; pendingRef.current = active; setPending(active); setError("");
    try {
      const value = action === "review" ? { id, runKey: run.key, kind, expiresAt: new Date(Date.now() + 90_000).toISOString() } : id;
      const receipt = await writeCoordinatorCommand(run.key, action, value, signal);
      if (signal.aborted) return;
      setPanel(old => old ? { ...old, receipts: [...old.receipts.filter(item => item.id !== id), receipt] } : old);
      pendingRef.current = null; setPending(null);
    } catch (failure) {
      if (!signal.aborted) {
        setPanel(null);
        if (failure instanceof PrivateReadError && failure.kind === "unauthorized") onUnauthorized("조정자 명령 접근 권한을 다시 확인해 주세요.");
        setError("응답을 확인하지 못했습니다. 같은 요청 ID 조회로만 복구하며 다시 전송하지 않습니다.");
      }
    } finally { changeVersion.current++; inFlight.current = false; if (!signal.aborted) setRefresh(value => value + 1); }
  }
  async function recover(id: string) {
    if (inFlight.current || !lifetime.current || lifetime.current.signal.aborted) return;
    inFlight.current = true; changeVersion.current++;
    try {
      const receipt = await readCoordinatorCommand(run.key, id, lifetime.current.signal);
      if (lifetime.current.signal.aborted) return;
      setPanel(old => old ? { ...old, receipts: [...old.receipts.filter(item => item.id !== id), receipt] } : old);
      if (!(pendingRef.current?.action === "dispatch" && receipt.state === "prepared")) { pendingRef.current = null; setPending(null); }
      setError("");
    } catch (failure) {
      if (!lifetime.current.signal.aborted) {
        setPanel(null);
        if (failure instanceof PrivateReadError && failure.kind === "unauthorized") onUnauthorized("조정자 명령 접근 권한을 다시 확인해 주세요.");
        setError("같은 요청 ID의 현재 기록을 아직 확인하지 못했습니다.");
      }
    } finally { changeVersion.current++; inFlight.current = false; if (!lifetime.current.signal.aborted) setRefresh(value => value + 1); }
  }
  const locked = !panel || panel.availability.state !== "available" || pending !== null || panel.receipts.some(unresolved);
  return <section className="successor-controls" aria-label="조정자 역할 명령">
    <h4>조정자 역할 명령</h4>
    <p>Assistant가 새 역할 시도를 저장합니다. 요청 저장·Demian 접수·실행 성공은 별도로 확인합니다.</p>
    {panel && <p>{availability[panel.availability.detail]}</p>}
    {error && <p role="alert">{error}</p>}
    <label>명령 <select value={kind} onChange={event => setKind(event.target.value as typeof kind)} disabled={locked}>
      {(panel?.availability.availableKinds.length ? panel.availability.availableKinds : [kind]).map(value => <option key={value} value={value}>{kinds[value]}</option>)}
    </select></label>
    <button disabled={locked || !panel?.availability.availableKinds.includes(kind)} onClick={() => void act("review")}>요청 검토</button>
    {pending && <p>요청 ID: <code>{pending.id}</code> <button onClick={() => void recover(pending.id)}>같은 ID 조회</button></p>}
    {panel?.hasMore && <p>현재 표시 범위를 넘는 이전 요청 기록이 있습니다.</p>}
    <ol aria-label="조정자 요청 기록" aria-live="polite">{panel?.receipts.map(receipt => <li key={receipt.id}>
      <strong>{kinds[receipt.kind]} · {states[receipt.state]}</strong> <code>{receipt.id}</code>
      {receipt.state === "prepared" && <div><p>Run {run.runId} · 현재 역할의 {run.assistantAttempt?.ordinal}번째 시도에서 새 시도를 요청합니다. 검토 기한: {receipt.expiresAt}</p>
        <button disabled={pending !== null || panel.availability.state !== "available"} onClick={() => void act("dispatch", receipt)}>확인하고 조정자에 전송</button>
        <button disabled={pending !== null} onClick={() => void act("discard", receipt)}>검토 폐기</button></div>}
      {receipt.state === "intent_saved" && <p>조정자 {receipt.coordinatorReceipt?.command.attempt}번째 시도 요청을 저장했습니다. 실제 후속 Run은 Flow·Trace에서 별도로 관측합니다.</p>}
      {["dispatching", "unknown"].includes(receipt.state) && <button onClick={() => void recover(receipt.id)}>같은 ID로 저장 결과 조회</button>}
    </li>)}</ol>
  </section>;
}
