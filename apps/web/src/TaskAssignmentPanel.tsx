import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";
import type { ProjectTaskMetadata } from "../../../packages/contracts/index.ts";
import { assignmentPrompt } from "../../../packages/projection/assignment-review.ts";
import { mergeAssignmentReceipt, mergeAssignmentReceiptWindow } from "../../../packages/projection/assignment-receipts.ts";
import "./task-assignment.css";

const sourceIdSchema = z.string().regex(/^[a-z0-9_-]{1,80}$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const taskSchema = z.object({
  id: z.uuid(), projectId: z.uuid(), title: z.string().min(1).max(500),
  revision: z.string().regex(/^[1-9][0-9]{0,18}$/), state: z.string().min(1).max(100), requiresTest: z.boolean(),
}).strict() satisfies z.ZodType<ProjectTaskMetadata>;
const reviewSchema = z.object({
  task: taskSchema, body: z.string().max(5000), acceptanceCriteria: z.array(z.string().max(500)).max(20),
  complete: z.boolean(), reviewSha256: digestSchema.nullable(),
}).strict();
const sessionSchema = z.object({
  sessionId: z.uuid(), workspaceId: z.uuid(), title: z.string().max(1000), agent: z.string().max(500), provider: z.string().max(500),
  model: z.string().max(500).nullable(), mode: z.enum(["single-agent", "multi-agent"]),
  permissionPolicy: z.enum(["deny", "ask", "auto", "full"]), activeRunId: z.uuid().nullable(), archived: z.boolean(),
  sourceId: sourceIdSchema, sourceLabel: z.string().max(500), device: z.string().max(500), sessionSha256: digestSchema,
}).strict();
const sessionsSchema = z.object({ enabled: z.boolean(), sessions: z.array(sessionSchema).max(20), incomplete: z.boolean(), detail: z.string().max(2000) }).strict();
const receiptSchema = z.object({
  id: z.uuid(), actor: z.string().max(320), projectSourceId: sourceIdSchema, projectId: z.uuid(), taskId: z.uuid(),
  taskRevision: z.string().regex(/^[1-9][0-9]{0,18}$/), reviewSha256: digestSchema,
  demianSourceId: sourceIdSchema, sessionId: z.uuid(), sessionSha256: digestSchema,
  state: z.enum(["requested", "dispatching", "accepted", "unknown", "failed", "expired"]), runId: z.uuid().nullable(),
  bindingState: z.enum(["pending", "bound", "conflict"]).nullable(), createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
}).strict();
const receiptListSchema = z.object({ receipts: z.array(receiptSchema).max(100), incomplete: z.boolean() }).strict();
const assignmentInputSchema = z.object({
  id: z.uuid(), projectSourceId: sourceIdSchema, projectId: z.uuid(), taskId: z.uuid(),
  taskRevision: z.string().regex(/^[1-9][0-9]{0,18}$/), reviewSha256: digestSchema,
  demianSourceId: sourceIdSchema, sessionId: z.uuid(), sessionSha256: digestSchema,
  instructions: z.string().max(2000), expiresAt: z.iso.datetime({ offset: true }),
}).strict().refine((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 12_000);

type Review = z.infer<typeof reviewSchema>;
type Session = z.infer<typeof sessionSchema>;
type Receipt = z.infer<typeof receiptSchema>;
type AssignmentInput = z.infer<typeof assignmentInputSchema>;
type Props = {
  sourceId: string; projectId: string; projectTitle: string; task: ProjectTaskMetadata;
  onUnauthorized: (reason: string) => void; onAssigned: (runKey: string) => void;
};
type Attempt = { id: string; payload: AssignmentInput; outcome: "sending" | "unknown" };

const unresolved = (receipt: Receipt) => receipt.state === "requested" || receipt.state === "dispatching" || receipt.state === "unknown";
const stateNames: Record<Receipt["state"], string> = {
  requested: "요청 접수", dispatching: "원본 전송 중", accepted: "실행 수락", unknown: "결과 확인 중", failed: "접수 실패", expired: "요청 만료",
};
const bindingNames: Record<NonNullable<Receipt["bindingState"]>, string> = { pending: "Run 연결 대기", bound: "Run 연결 완료", conflict: "Run 연결 충돌" };
const route = (sourceId: string, projectId: string, taskId: string, kind: "review" | "assignment-sessions" | "assignments") =>
  `/api/projects/${encodeURIComponent(sourceId)}/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/${kind}`;
function browserExternalKey(sourceId: string, runId: string): string {
  // Match contracts/externalKey's JSON tuple + unpadded base64url without importing Node Buffer into the browser.
  const bytes = new TextEncoder().encode(JSON.stringify([sourceId, runId]));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function TaskAssignmentPanel({ sourceId, projectId, projectTitle, task, onUnauthorized, onAssigned }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsEnabled, setSessionsEnabled] = useState(false);
  const [sessionsComplete, setSessionsComplete] = useState(false);
  const [sessionsPartial, setSessionsPartial] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState("");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [receiptsComplete, setReceiptsComplete] = useState(false);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [receiptsError, setReceiptsError] = useState("");
  const [selectedSession, setSelectedSession] = useState("");
  const [instructions, setInstructions] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedSessionSha, setConfirmedSessionSha] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [sending, setSending] = useState(false);
  const [reconciling, setReconciling] = useState("");
  const [message, setMessage] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [reviewedRevision, setReviewedRevision] = useState("");
  const unauthorized = useRef(false);
  const callbacks = useRef({ onUnauthorized, onAssigned });
  callbacks.current = { onUnauthorized, onAssigned };
  const controllers = useRef(new Set<AbortController>());
  const attemptRef = useRef<Attempt | null>(null);
  const receiptRef = useRef<Receipt[]>([]);

  function makeController() {
    const controller = new AbortController();
    controllers.current.add(controller);
    return controller;
  }
  function finishController(controller: AbortController) { controllers.current.delete(controller); }
  function recordReceipt(incoming: Receipt): Receipt {
    const previous = receiptRef.current.find((receipt) => receipt.id === incoming.id);
    const effective = mergeAssignmentReceipt(previous, incoming);
    const next = previous
      ? receiptRef.current.map((receipt) => receipt.id === incoming.id ? effective : receipt)
      : [...receiptRef.current, effective];
    receiptRef.current = next;
    setReceipts(next);
    return effective;
  }
  function reflectAttemptReceipt(id: string, receipt: Receipt) {
    if (attemptRef.current?.id !== id) return;
    if (receipt.state === "accepted" && receipt.bindingState === "bound") {
      attemptRef.current = null; setAttempt(null); setInstructions(""); setConfirmed(false); setSelectedSession("");
      setSending(false); setMessage("실행 수락과 Run 연결을 확인했습니다.");
    } else if (receipt.state === "failed" || receipt.state === "expired") {
      attemptRef.current = null; setAttempt(null);
      setSending(false); setMessage(receipt.state === "failed" ? "실행이 시작되지 않았습니다. 지시문은 유지됩니다." : "배정 기한이 지나 실행되지 않았습니다. 지시문은 유지됩니다.");
    } else {
      const current = attemptRef.current;
      const next = current.outcome === "unknown" ? current : { ...current, outcome: "unknown" as const };
      attemptRef.current = next; setAttempt(next);
      setMessage(receipt.state === "accepted"
        ? "실행은 수락됐지만 Run 연결이 확인되지 않았습니다. 지시문을 유지하고 연결 상태만 조회합니다."
        : "요청 결과를 확인 중입니다. 이 요청 ID와 내용을 고정하고 새 요청을 보내지 않습니다.");
    }
  }
  function clearPrivateData() {
    unauthorized.current = true;
    for (const controller of controllers.current) controller.abort();
    setReview(null); setReviewError(""); setSessions([]); setSessionsEnabled(false); setSessionsComplete(false);
    setReceipts([]); setReceiptsComplete(false); setReceiptsError("접근 권한이 변경되어 배정 기록을 지웠습니다.");
    receiptRef.current = [];
    setInstructions(""); setConfirmed(false); setSelectedSession(""); setAttempt(null); attemptRef.current = null; setMessage("");
    setReviewLoading(false); setSessionsLoading(false); setReceiptsLoading(false); setSending(false); setReconciling("");
  }
  function handleUnauthorized() {
    if (unauthorized.current) return;
    clearPrivateData();
    callbacks.current.onUnauthorized("프로젝트 접근 권한이 변경되어 업무 원문과 실행 배정 입력을 지웠습니다.");
  }

  useEffect(() => () => { for (const controller of controllers.current) controller.abort(); controllers.current.clear(); }, []);

  async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
    if (unauthorized.current) throw new Error("access");
    const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if ([401, 403, 404].includes(response.status)) { handleUnauthorized(); throw new Error("access"); }
    if (!response.ok) throw new Error("unavailable");
    if (unauthorized.current || signal.aborted) throw new Error("aborted");
    return response.json() as Promise<unknown>;
  }

  async function refreshReview() {
    if (unauthorized.current || sending || attemptRef.current) return;
    setReview(null); setConfirmed(false); setReviewedRevision(""); setReviewLoading(true); setReviewError(""); setNeedsRefresh(false); setMessage("");
    const controller = makeController();
    try {
      const parsed = reviewSchema.safeParse(await getJson(route(sourceId, projectId, task.id, "review"), controller.signal));
      if (controller.signal.aborted) return;
      if (!parsed.success || parsed.data.task.id !== task.id || parsed.data.task.projectId !== projectId) throw new Error("invalid review");
      setReview(parsed.data); setReviewedRevision(parsed.data.task.revision);
      if (!parsed.data.complete || !parsed.data.reviewSha256) setReviewError("전체 업무 본문을 확인하지 못해 실행 배정할 수 없습니다.");
      if (parsed.data.task.revision !== task.revision) setNeedsRefresh(true);
    } catch {
      if (!controller.signal.aborted && !unauthorized.current) { setReview(null); setReviewError("업무 원문을 새로 확인하지 못했습니다. 이전 원문은 표시하지 않습니다."); }
    } finally { finishController(controller); if (!controller.signal.aborted) setReviewLoading(false); }
  }

  async function refreshSessions(signal?: AbortSignal) {
    const controller = signal ? null : makeController();
    const activeSignal = signal ?? controller!.signal;
    setSessionsLoading(true); setSessionsError("");
    try {
      const parsed = sessionsSchema.safeParse(await getJson(route(sourceId, projectId, task.id, "assignment-sessions"), activeSignal));
      if (activeSignal.aborted) return;
      if (!parsed.success) throw new Error("invalid sessions");
      setSessions(parsed.data.sessions); setSessionsEnabled(parsed.data.enabled); setSessionsComplete(true);
      setSessionsPartial(parsed.data.incomplete); setSessionsError("");
    } catch {
      if (!activeSignal.aborted && !unauthorized.current) {
        setSessions([]); setSessionsComplete(false); setSessionsEnabled(false);
        setSessionsError("허용 Session의 현재 상태를 확인하지 못했습니다. 실행 배정을 보류합니다.");
      }
    } finally { if (controller) finishController(controller); if (!activeSignal.aborted) setSessionsLoading(false); }
  }

  async function refreshReceipts(signal?: AbortSignal) {
    const controller = signal ? null : makeController();
    const activeSignal = signal ?? controller!.signal;
    setReceiptsLoading(true); setReceiptsError("");
    try {
      const parsed = receiptListSchema.safeParse(await getJson(route(sourceId, projectId, task.id, "assignments"), activeSignal));
      if (activeSignal.aborted) return;
      if (!parsed.success || parsed.data.receipts.some((item) => item.projectSourceId !== sourceId || item.projectId !== projectId || item.taskId !== task.id)) throw new Error("invalid receipts");
      const currentWindow = mergeAssignmentReceiptWindow(receiptRef.current, parsed.data.receipts);
      receiptRef.current = currentWindow;
      setReceipts(currentWindow);
      const activeAttempt = attemptRef.current;
      const resolved = activeAttempt && currentWindow.find((item) => item.id === activeAttempt.id);
      if (resolved) reflectAttemptReceipt(activeAttempt.id, resolved);
      setReceiptsComplete(!parsed.data.incomplete); setReceiptsError(parsed.data.incomplete ? "일부 실행 요청 상태를 확인하지 못했습니다." : "");
    } catch {
      if (!activeSignal.aborted && !unauthorized.current) {
        setReceipts([]); receiptRef.current = []; setReceiptsComplete(false);
        setReceiptsError("실행 요청 상태를 확인하지 못했습니다. 기존 요청 ID는 유지하고 Run 정보를 지웠으며 제출을 보류합니다.");
      }
    } finally { if (controller) finishController(controller); if (!activeSignal.aborted) setReceiptsLoading(false); }
  }

  // Session metadata and receipts refresh sequentially; task body is fetched only by the explicit review action.
  useEffect(() => {
    const controller = makeController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function cycle() {
      await refreshSessions(controller.signal);
      if (stopped || controller.signal.aborted || unauthorized.current) return;
      await refreshReceipts(controller.signal);
      if (stopped || controller.signal.aborted || unauthorized.current) return;
      timer = setTimeout(() => void cycle(), 15_000);
    }
    void cycle();
    return () => { stopped = true; if (timer) clearTimeout(timer); controller.abort(); finishController(controller); };
  // task metadata objects are refreshed by the parent; only identity changes restart these reads.
  }, [sourceId, projectId, task.id]);

  useEffect(() => {
    if (task.revision !== reviewedRevision && reviewedRevision) {
      setConfirmed(false); setNeedsRefresh(true); setMessage("원본 업무 revision이 바뀌었습니다. 지시문은 유지됩니다. 다시 검토해 주세요.");
    }
  }, [task.revision, reviewedRevision]);

  const sessionKey = (item: Session) => `${item.sourceId}/${item.sessionId}`;
  const selected = sessions.find((item) => sessionKey(item) === selectedSession);
  useEffect(() => { setConfirmed(false); }, [selectedSession, selected?.sessionSha256]);
  const currentReview = !!review && review.complete && !!review.reviewSha256 && review.task.revision === task.revision && reviewedRevision === task.revision;
  const scopedReceipts = receipts.filter((receipt) => sessions.some((session) => session.sourceId === receipt.demianSourceId && session.sessionId === receipt.sessionId));
  const ownReceipt = attempt ? scopedReceipts.find((receipt) => receipt.id === attempt.id) : undefined;
  const unresolvedReceipt = receipts.find(unresolved);
  const acceptedUnbound = receipts.some((receipt) => receipt.state === "accepted" && receipt.bindingState !== "bound");
  const frozenAttempt = !!attempt || sending;
  const currentSessionConfirmed = !!selected && confirmed && confirmedSessionSha === selected.sessionSha256;
  const prompt = review && currentReview ? assignmentPrompt(review, instructions) : "";
  const promptBytes = new TextEncoder().encode(prompt).byteLength;
  const canSubmit = !!review && currentReview && currentSessionConfirmed && !!selected && !selected.archived && !selected.activeRunId && sessionsEnabled && sessionsComplete && !sessionsLoading && !sessionsError &&
    !receiptsLoading && receiptsComplete && !receiptsError && !unresolvedReceipt && !acceptedUnbound && !frozenAttempt && !needsRefresh && !reviewLoading &&
    instructions.length <= 2000 && promptBytes <= 8192 && !unauthorized.current;

  function updateInstructions(value: string) { if (frozenAttempt || unresolvedReceipt) return; setInstructions(value); setMessage(""); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (attemptRef.current) return;
    if (!canSubmit || !review?.reviewSha256 || !selected) return;
    const id = crypto.randomUUID();
    const payload = {
      id, projectSourceId: sourceId, projectId, taskId: task.id, taskRevision: review.task.revision, reviewSha256: review.reviewSha256,
      demianSourceId: selected.sourceId, sessionId: selected.sessionId, sessionSha256: selected.sessionSha256,
      instructions, expiresAt: new Date(Date.now() + 90_000).toISOString(),
    };
    const checked = assignmentInputSchema.safeParse(payload);
    if (!checked.success) { setMessage("입력 길이와 배정 내용을 확인해 주세요."); return; }
    const frozen: Attempt = { id, payload: checked.data, outcome: "sending" };
    attemptRef.current = frozen; setAttempt(frozen); setSending(true); setMessage("기존 Session에 실행 배정을 요청하고 있습니다.");
    const controller = makeController();
    try {
      const response = await fetch("/api/projects/task-assignments", {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(checked.data), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if ([401, 403, 404].includes(response.status)) { handleUnauthorized(); return; }
      if (response.status === 400 || response.status === 409) {
        const canonical = receiptRef.current.find((receipt) => receipt.id === id);
        if (canonical) reflectAttemptReceipt(id, canonical);
        else {
          attemptRef.current = null; setAttempt(null); setMessage(response.status === 409
            ? "업무 검토 또는 Session 상태가 변경되어 요청이 거부됐습니다. 두 정보를 새로 확인해 주세요. 지시문은 유지됩니다."
            : "요청 내용이 유효하지 않아 전송하지 않았습니다. 지시문은 유지됩니다.");
          setNeedsRefresh(response.status === 409);
          if (response.status === 409) { setConfirmed(false); setReview(null); void refreshSessions(); }
        }
        return;
      }
      if (!response.ok) throw new Error("uncertain");
      const parsed = z.object({ receipt: receiptSchema }).strict().safeParse(await response.json());
      if (controller.signal.aborted) return;
      if (!parsed.success || parsed.data.receipt.id !== id || parsed.data.receipt.projectSourceId !== sourceId || parsed.data.receipt.taskId !== task.id) throw new Error("uncertain");
      const receipt = recordReceipt(parsed.data.receipt);
      reflectAttemptReceipt(id, receipt);
      if (receipt.state === "accepted") {
        void refreshReceipts();
      }
    } catch {
      if (!controller.signal.aborted && !unauthorized.current) {
        const canonical = receiptRef.current.find((receipt) => receipt.id === id);
        if (canonical) reflectAttemptReceipt(id, canonical);
        else {
          const current = attemptRef.current?.id === id ? attemptRef.current : frozen;
          const next = current.outcome === "unknown" ? current : { ...current, outcome: "unknown" as const };
          attemptRef.current = next; setAttempt(next); setMessage("전송 결과를 확인하지 못했습니다. 요청 ID와 내용을 고정하며 자동 재전송하지 않습니다.");
        }
      }
    } finally { finishController(controller); if (!controller.signal.aborted) setSending(false); }
  }

  async function reconcile(id: string) {
    if (reconciling || unauthorized.current) return;
    setReconciling(id); setMessage("기존 요청의 결과와 Run 연결을 조회하고 있습니다.");
    const controller = makeController();
    try {
      const response = await fetch(`/api/projects/task-assignments/${encodeURIComponent(id)}/reconcile`, {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: "{}", signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if ([401, 403, 404].includes(response.status)) { handleUnauthorized(); return; }
      if (!response.ok) throw new Error("lookup unavailable");
      const parsed = z.object({ receipt: receiptSchema }).strict().safeParse(await response.json());
      if (controller.signal.aborted) return;
      if (!parsed.success || parsed.data.receipt.id !== id) throw new Error("invalid receipt");
      const receipt = recordReceipt(parsed.data.receipt);
      reflectAttemptReceipt(id, receipt);
    } catch {
      if (!controller.signal.aborted && !unauthorized.current) {
        const canonical = receiptRef.current.find((receipt) => receipt.id === id);
        if (canonical) reflectAttemptReceipt(id, canonical);
        else setMessage("기존 요청을 조회하지 못했습니다. 지시문과 요청 ID를 유지했습니다.");
      }
    } finally { finishController(controller); if (!controller.signal.aborted) setReconciling(""); }
  }

  const displayedReceipt = ownReceipt ?? (attempt ? null : scopedReceipts.at(-1) ?? null);
  return <section className="task-assignment" aria-labelledby={`assignment-title-${task.id}`}>
    <h3 id={`assignment-title-${task.id}`}>기존 Session에 실행 배정</h3>
    <p className="assignment-note">{projectTitle} · revision {task.revision} · {task.state} · 테스트 {task.requiresTest ? "필요" : "불필요"}</p>
    <div className="assignment-actions">
      <button type="button" className="text-button" onClick={() => void refreshReview()} disabled={reviewLoading || frozenAttempt || !!unresolvedReceipt}>업무 내용 검토·새로고침</button>
      {reviewLoading && <span role="status">업무 내용을 확인하고 있습니다.</span>}
    </div>
    {reviewError && <p className="assignment-error" role="alert">{reviewError}</p>}
    {review && <section className="assignment-review" aria-label="검토한 원본 업무">
      <h4>{review.task.title}</h4>
      <p>revision {review.task.revision} · {review.task.state} · 테스트 {review.task.requiresTest ? "필요" : "불필요"}</p>
      <h5>업무 본문</h5><div className="assignment-private-body">{review.body || "(본문 없음)"}</div>
      <h5>수용 조건</h5>{review.acceptanceCriteria.length ? <ul>{review.acceptanceCriteria.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul> : <p>(명시된 조건 없음)</p>}
      {!review.complete && <p className="assignment-error">검토 응답이 불완전합니다.</p>}
      {needsRefresh && <p className="assignment-error">목록의 task revision이 바뀌었습니다. 지시문은 유지되며 새 검토가 필요합니다.</p>}
    </section>}
    <p className="assignment-note">{sessionsLoading ? "허용된 기존 Session을 확인하고 있습니다." : sessionsError || ""}</p>
    {sessionsPartial && !sessionsError && <p className="assignment-note">일부 대상은 확인되지 않았습니다. 현재 접근이 확인된 Session만 선택할 수 있습니다.</p>}
    <form className="assignment-form" onSubmit={(event) => void submit(event)}>
      <label>실행 대상 Session
        <select value={selectedSession} disabled={sessionsLoading || !sessionsComplete || !sessionsEnabled || frozenAttempt || !!unresolvedReceipt} onChange={(event) => { setSelectedSession(event.target.value); setConfirmed(false); }}>
          <option value="">Session 선택</option>{sessions.map((item) => <option key={sessionKey(item)} value={sessionKey(item)} disabled={item.archived || !!item.activeRunId}>
            {item.sourceLabel} · {item.title} · {item.provider}/{item.agent} · {item.model ?? "모델 미지정"} · {item.mode} · 권한 {item.permissionPolicy}{item.archived ? " · 보관됨" : item.activeRunId ? " · 실행 중" : ""}
          </option>)}
        </select>
      </label>
      {selected && <p className="assignment-note">장치 {selected.device} · {selected.archived ? "보관됨" : selected.activeRunId ? `활성 Run ${selected.activeRunId}` : "사용 가능"} · {selected.mode} · 권한 정책 {selected.permissionPolicy}</p>}
      <label>추가 실행 지시 <textarea rows={4} maxLength={2000} value={instructions} disabled={frozenAttempt || !!unresolvedReceipt} onChange={(event) => updateInstructions(event.target.value)} /></label>
      <p className="assignment-note">지시 {instructions.length}/2,000자 · 실제 전달 프롬프트 UTF-8 {promptBytes}/8,192바이트</p>
      {review && currentReview && <details className="assignment-preview"><summary>실제 전달 프롬프트 미리보기</summary><pre>{prompt}</pre></details>}
      <label className="assignment-confirm"><input type="checkbox" checked={currentSessionConfirmed} disabled={!currentReview || frozenAttempt || !!unresolvedReceipt} onChange={(event) => {
        setConfirmed(event.target.checked); setConfirmedSessionSha(event.target.checked ? selected?.sessionSha256 ?? null : null);
      }} /> 원문·수용 조건·선택한 Session 정책을 확인했고, 표시된 프롬프트를 기존 Session에 실행하도록 요청합니다.</label>
      {message && <p className="assignment-status" role="status" aria-live="polite">{message}</p>}
      {review && promptBytes > 8192 && <p className="assignment-error">프롬프트가 UTF-8 8,192바이트를 넘습니다. 추가 지시를 줄여 주세요.</p>}
      {displayedReceipt && <section className="assignment-receipt" aria-label={`배정 상태: ${stateNames[displayedReceipt.state]}`}>
        <strong>{stateNames[displayedReceipt.state]}</strong><small>요청 ID <code>{displayedReceipt.id}</code></small>
        {displayedReceipt.state === "accepted" && displayedReceipt.runId && <><small>Run ID <code>{displayedReceipt.runId}</code></small><small>연결 상태 {displayedReceipt.bindingState ? bindingNames[displayedReceipt.bindingState] : "연결 전"}</small>
          {(displayedReceipt.bindingState === "pending" || displayedReceipt.bindingState === "conflict") && <button type="button" className="text-button" disabled={!!reconciling} onClick={() => void reconcile(displayedReceipt.id)}>Run 연결 상태 조회</button>}
          {displayedReceipt.bindingState === "conflict" && <p className="assignment-error">Run은 수락됐지만 기존 연결과 충돌했습니다. 새 실행을 보내지 않습니다.</p>}
          <button type="button" className="text-button" onClick={() => callbacks.current.onAssigned(browserExternalKey(displayedReceipt.demianSourceId, displayedReceipt.runId!))}>수락된 Run 열기</button></>}
        {unresolved(displayedReceipt) && <button type="button" className="text-button" disabled={!!reconciling} onClick={() => void reconcile(displayedReceipt.id)}>{reconciling === displayedReceipt.id ? "조회 중…" : "같은 요청 결과만 조회"}</button>}
      </section>}
      {scopedReceipts.filter((receipt) => receipt.id !== displayedReceipt?.id && (unresolved(receipt) || (receipt.state === "accepted" && receipt.bindingState === "pending"))).map((receipt) => <section className="assignment-receipt" key={receipt.id} aria-label={`배정 상태: ${stateNames[receipt.state]}`}>
        <strong>{stateNames[receipt.state]}{receipt.bindingState ? ` · ${bindingNames[receipt.bindingState]}` : ""}</strong><small>요청 ID <code>{receipt.id}</code></small>
        {receipt.runId && <small>Run ID <code>{receipt.runId}</code></small>}
        <button type="button" className="text-button" disabled={!!reconciling} onClick={() => void reconcile(receipt.id)}>{reconciling === receipt.id ? "조회 중…" : receipt.state === "accepted" ? "Run 연결 상태 조회" : "같은 요청 결과만 조회"}</button>
      </section>)}
      {receiptsError && <p className="assignment-error" role="alert">{receiptsError}</p>}
      {attempt?.outcome === "unknown" && !ownReceipt && <section className="assignment-receipt" aria-label="요청 결과 확인 중">
        <strong>요청 결과 확인 중</strong><small>요청 ID <code>{attempt.id}</code></small>
        <p className="assignment-note">현재 조회 가능한 처리 기록이 없습니다. 요청 ID와 지시문을 유지하며 새 실행은 보내지 않습니다.</p>
        <button type="button" className="text-button" disabled={!!reconciling} onClick={() => void reconcile(attempt.id)}>{reconciling === attempt.id ? "조회 중…" : "같은 요청 결과만 조회"}</button>
      </section>}
      {!receiptsComplete && !receiptsError && receiptsLoading && <p className="assignment-note" role="status">이전 배정 상태를 확인하고 있습니다.</p>}
      {receiptsComplete && receipts.find((item) => item.state === "accepted" && item.bindingState === "pending") && <p className="assignment-note">수락된 미연결 Run이 있습니다. 해당 요청 결과와 연결만 조회할 수 있습니다.</p>}
      <div className="assignment-actions"><button type="submit" className="button-primary" disabled={!canSubmit}>{sending ? "요청 중…" : "검토한 업무 실행 배정"}</button>
        <button type="button" className="text-button" disabled={receiptsLoading || !!reconciling} onClick={() => void refreshReceipts()}>배정 상태 새로고침</button>
        <button type="button" className="text-button" disabled={sessionsLoading || frozenAttempt} onClick={() => void refreshSessions()}>Session 상태 새로고침</button></div>
      {unresolvedReceipt && <p className="assignment-note">미확정 요청이 있어 중복 배정을 막았습니다. 새 요청은 만들지 않고 해당 ID만 조회할 수 있습니다.</p>}
      {!sessionsEnabled && sessionsComplete && <p className="assignment-note">현재 사용할 수 있는 허용 Session이 없습니다. 새 Session은 만들지 않습니다.</p>}
    </form>
  </section>;
}
