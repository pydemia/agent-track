import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { permissionViewSchema, type ApprovalReceipt, type PermissionDecision, type PermissionReview, type RunView } from "../../../packages/contracts/index.ts";
import { mergeApprovalReceipts } from "../../../packages/projection/approval-receipts.ts";
import { currentPermissionReview } from "../../../packages/projection/permission-review.ts";

const entrySchema = permissionViewSchema.extend({ reviewAvailable: z.boolean() });
type Entry = z.infer<typeof entrySchema>;
const decisions: Record<PermissionDecision, string> = { allow_once: "이번 호출만 허용", allow_session: "세션의 같은 도구 허용", deny: "거절" };
const states: Record<string, string> = { requested: "요청 기록", dispatching: "원본 전송 중", succeeded: "원본 결정 확인", failed: "처리 실패", expired: "만료", unknown: "결과 미확정" };
const unresolved = new Set(["requested", "dispatching", "unknown"]);

export function RunApprovals({ run, onUnauthorized }: { run: RunView; onUnauthorized: (reason: string) => void }) {
  const [requests, setRequests] = useState<Entry[]>([]);
  const [receipts, setReceipts] = useState<ApprovalReceipt[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<PermissionReview | null>(null);
  const [confirm, setConfirm] = useState<PermissionDecision | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  const lifetime = useRef<AbortController | null>(null);
  const reviewing = useRef(0);
  const pending = useRef<{ id: string; permissionId: string } | null>(null);
  const permitted = run.capabilities.includes("permission.decide");
  const native = run.capabilities.includes("session.link") || permitted;

  function denied(response: Response) {
    if (response.status !== 401 && response.status !== 403) return false;
    onUnauthorized("승인 요청 접근이 해제되어 실행 데이터를 지웠습니다."); return true;
  }

  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { controller.abort(); reviewing.current++; clearInterval(clock); };
  }, []);

  useEffect(() => {
    if (!native) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [listResponse, receiptResponse] = await Promise.all([
          fetch(`/api/runs/${run.key}/permissions`, { signal: controller.signal }),
          fetch(`/api/approvals?run=${encodeURIComponent(run.key)}`, { signal: controller.signal }),
        ]);
        if (denied(listResponse) || denied(receiptResponse)) return;
        if (!listResponse.ok || !receiptResponse.ok) throw new Error();
        const list = z.object({ requests: z.array(entrySchema) }).parse(await listResponse.json());
        const records = await receiptResponse.json() as { receipts: ApprovalReceipt[] };
        if (controller.signal.aborted) return;
        setRequests(list.requests); setReceipts((old) => mergeApprovalReceipts(old, records.receipts)); setReady(true); setError("");
        if (pending.current && records.receipts.some((item) => item.id === pending.current!.id)) pending.current = null;
      } catch {
        if (!controller.signal.aborted) { setRequests([]); setReceipts([]); setReview(null); setConfirm(null); setReady(false); setError("현재 승인 요청을 읽지 못했습니다. 연결과 원본 접근을 확인해 주세요."); }
      } finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3000); }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [native, run.key, refresh, onUnauthorized]);

  const current = review ? requests.find((item) => currentPermissionReview(item, review.request, now)) : undefined;
  useEffect(() => {
    if (review && !current) { setReview(null); setConfirm(null); reviewing.current++; }
  }, [review, current]);

  async function open(item: Entry) {
    const controller = lifetime.current;
    if (!controller || busy || controller.signal.aborted) return;
    const generation = ++reviewing.current;
    setReview(null); setConfirm(null); setError("");
    try {
      const response = await fetch(`/api/runs/${run.key}/permissions/${item.id}/review`, { signal: controller.signal });
      if (denied(response)) return;
      if (!response.ok) throw new Error();
      const value = z.object({ request: permissionViewSchema, reviewText: z.string().max(65_536), reviewComplete: z.boolean() }).strict().parse(await response.json());
      if (controller.signal.aborted || generation !== reviewing.current) return;
      if (!currentPermissionReview(item, value.request, Date.now())) { setRefresh((value) => value + 1); throw new Error(); }
      setReview(value);
    } catch { if (!controller.signal.aborted && generation === reviewing.current) setError("요청 내용이 달라졌거나 접근할 수 없습니다. 최신 요청을 다시 확인해 주세요."); }
  }

  async function decide() {
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted || !current || !review?.reviewComplete || !confirm || !ready || !permitted || busy ||
        pending.current?.permissionId === current.id || receipts.some((item) => item.permissionId === current.id && unresolved.has(item.state))) return;
    const id = crypto.randomUUID(); const decision = confirm; const request = current;
    pending.current = { id, permissionId: request.id }; setBusy(true); setConfirm(null); setError("");
    try {
      const response = await fetch("/api/commands/approval", { method: "POST", headers: { "Content-Type": "application/json" },
        signal: controller.signal, body: JSON.stringify({ id, runKey: run.key, permissionId: request.id, fingerprint: request.fingerprint,
          decision, expiresAt: new Date(Math.min(Date.parse(request.expiresAt), Date.now() + 90_000)).toISOString() }) });
      if (denied(response)) return;
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status < 500) pending.current = null;
        setError(response.status === 409 ? "요청이 바뀌었거나 이미 처리됐습니다. 현재 원본 상태와 기록을 확인해 주세요." : "결정을 확인하지 못했습니다. 원본을 재조회하며 자동 재전송하지 않습니다.");
        return;
      }
      const body = await response.json() as { receipt: ApprovalReceipt };
      if (controller.signal.aborted) return;
      setReceipts((old) => mergeApprovalReceipts(old, [body.receipt])); pending.current = null;
    } catch { if (!controller.signal.aborted) setError("응답을 확인하지 못했습니다. 같은 요청의 원본 결과를 재조회하며 자동 재전송하지 않습니다."); }
    finally { if (!controller.signal.aborted) { setBusy(false); setReview(null); setRefresh((value) => value + 1); } }
  }

  if (!native) return <section className="run-approvals"><h3>승인 요청</h3><small>이 출처는 원본 승인 요청 조회를 지원하지 않습니다.</small></section>;
  const waiting = requests.filter((item) => item.status === "pending" && Date.parse(item.expiresAt) > now);
  const historical = requests.filter((item) => item.status !== "pending" || Date.parse(item.expiresAt) <= now).slice(-5);
  const locked = !!current && (busy || pending.current?.permissionId === current.id || receipts.some((item) => item.permissionId === current.id && unresolved.has(item.state)));
  return <section className="run-approvals" aria-label="원본 승인 요청"><h3>승인 요청 {ready ? `${waiting.length}건 대기` : "조회 필요"}</h3>
    <p>원본이 결정과 만료를 재검사합니다. 결정 반영과 도구 실행·업무 완료는 별도입니다.</p>
    {!permitted && <small>현재 계정은 조회만 가능합니다.</small>}
    {waiting.length ? <ol className="permission-list">{waiting.map((item) => <li key={item.id}><strong>{item.tool}</strong><small>호출 {item.callId}</small><small>만료 {new Date(item.expiresAt).toLocaleString("ko-KR")}</small><button className="text-button" disabled={busy} onClick={() => void open(item)}>요청 내용 확인</button>{!item.reviewAvailable && <small>검토 제한 초과 · 원본에서 처리</small>}</li>)}</ol> : ready ? <p>현재 유효한 승인 대기 요청이 없습니다.</p> : null}
    {review && current && <div className="permission-review"><h4>{current.tool} · 요청 검토</h4><small>인자는 현재 화면에서만 조회합니다. 닫기·만료·선택 변경 시 제거합니다.</small><pre tabIndex={0} aria-label="승인 대상 도구 인자">{review.reviewText}</pre>
      {permitted && review.reviewComplete && <div className="permission-actions">{(Object.keys(decisions) as PermissionDecision[]).map((decision) => <button key={decision} disabled={locked || !["running", "waiting_for_permission"].includes(run.status)} onClick={() => setConfirm(decision)}>{decisions[decision]}</button>)}</div>}
      {confirm && <div role="group" aria-label="승인 결정 확인"><p>{decisions[confirm]}: {confirm === "allow_session" ? "이 세션에서 같은 도구의 후속 호출도 허용됩니다. 개별 호출 승인보다 범위가 넓습니다." : confirm === "allow_once" ? "위 요청의 이번 도구 호출에만 허용합니다." : "이 도구 요청을 거절합니다."}</p><button className="button-secondary" disabled={locked} onClick={() => void decide()}>원본에 결정 보내기</button><button className="text-button" disabled={busy} onClick={() => setConfirm(null)}>돌아가기</button></div>}
      <button className="text-button" disabled={busy} onClick={() => { reviewing.current++; setReview(null); setConfirm(null); }}>요청 내용 닫기</button></div>}
    {error && <p className="command-error" role="alert">{error}</p>}
    {!!historical.length && <details><summary>원본 요청 상태 {historical.length}건</summary><ol className="permission-list">{historical.map((item) => <li key={item.id}><strong>{item.tool}</strong><small>{item.status === "expired" ? "원본 만료" : item.status === "resolved" ? `원본 해결 · ${item.decision ? decisions[item.decision] : "결정 미확인"}` : "기한 경과 · 원본 확인 대기"}</small><small>{item.id}</small></li>)}</ol></details>}
    <button className="text-button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>현재 요청·처리 기록 다시 조회</button>
    {!!receipts.length && <ol className="receipt-list" aria-label="승인 결정 처리 기록">{receipts.slice(-5).reverse().map((item) => <li key={item.id}><strong>{decisions[item.decision]} · {states[item.state] ?? "미확인"}</strong><small>{item.permissionId}</small><small>{item.detail === "observed_resolution_no_dispatch" ? "원본의 기존 결정 관측 · 이번 요청은 전송하지 않음" : item.detail === "runtime_resolution_observed_attribution_unknown" ? "원본 결정 관측 · 이번 요청이 반영됐는지는 미확정" : item.state === "succeeded" ? "원본 결정 응답 확인 · 실제 도구 실행 결과는 별도" : item.state === "unknown" ? "결과 미확정 · 원본 조회만 수행, 재전송 없음" : "요청 처리 상태이며 Run 종료와 별도"}</small></li>)}</ol>}
  </section>;
}
