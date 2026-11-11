import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";
import type { TaskCreationReceipt } from "../../../packages/commands/create-task.ts";
import { mergeTaskReceipts } from "../../../packages/projection/task-receipts.ts";

const stateSchema = z.enum(["requested", "dispatching", "created", "failed", "expired", "unknown"]);
const receiptSchema = z.object({
  id: z.uuid(), actor: z.string().max(320), sourceId: z.string().min(1).max(80), projectId: z.uuid(),
  state: stateSchema, taskId: z.uuid().nullable(), taskRevision: z.string().regex(/^[1-9][0-9]{0,18}$/).nullable(),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
}).strict() satisfies z.ZodType<TaskCreationReceipt>;
const overviewSchema = z.object({ enabled: z.boolean(), detail: z.string().max(2000), receipts: z.array(receiptSchema).max(100), incomplete: z.boolean() }).strict();
const requestSchema = z.object({
  id: z.uuid(), sourceId: z.string().regex(/^[a-z0-9_-]{1,80}$/), projectId: z.uuid(),
  title: z.string().min(1).max(300).refine((value) => value.trim().length > 0), body: z.string().max(5000),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).max(20), requiresTest: z.boolean(), expiresAt: z.string().datetime({ offset: true }),
}).strict().refine((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 8192);

type Draft = { title: string; body: string; criteria: string[]; requiresTest: boolean };
type Attempt = { id: string; payload: z.infer<typeof requestSchema>; outcome: "sending" | "unknown" };
type Props = { sourceId: string; projectId: string; projectTitle: string; onUnauthorized: (reason: string) => void; onCreated: () => void };
const unresolved = (receipt: TaskCreationReceipt) => receipt.state === "requested" || receipt.state === "dispatching" || receipt.state === "unknown";
const stateLabels: Record<TaskCreationReceipt["state"], string> = {
  requested: "요청 접수", dispatching: "원본 전송 중", created: "원본 업무 생성", failed: "생성 실패", expired: "요청 만료", unknown: "결과 확인 중",
};
const urlFor = (sourceId: string, projectId: string) => `/api/projects/${encodeURIComponent(sourceId)}/${encodeURIComponent(projectId)}/task-creation`;

export function TaskCreatePanel({ sourceId, projectId, projectTitle, onUnauthorized, onCreated }: Props) {
  const [draft, setDraft] = useState<Draft>({ title: "", body: "", criteria: [""], requiresTest: true });
  const [overview, setOverview] = useState<z.infer<typeof overviewSchema> | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [sending, setSending] = useState(false);
  const [knownFailure, setKnownFailure] = useState<{ id: string; label: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [checkFailed, setCheckFailed] = useState(false);
  const [message, setMessage] = useState("");
  const unauthorizedRef = useRef(false);
  const createdRef = useRef<string | null>(null);
  const resolvedRef = useRef(new Set<string>());
  const postController = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); postController.current = controller; return () => controller.abort(); }, []);
  function handleUnauthorized() {
    if (unauthorizedRef.current) return;
    unauthorizedRef.current = true;
    setDraft(emptyDraft()); setAttempt(null); setOverview(null); setMessage(""); setKnownFailure(null);
    attemptRef.current = null;
    onUnauthorized("프로젝트 접근 권한이 변경되어 원본 업무 작성 정보를 지웠습니다.");
  }

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sleep = () => new Promise<void>((resolve) => { timer = setTimeout(resolve, 5000); });
    async function refresh() {
      try {
        const response = await fetch(urlFor(sourceId, projectId), { signal: controller.signal });
        if (controller.signal.aborted) return null;
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          handleUnauthorized();
          return null;
        }
        if (!response.ok) throw new Error("metadata");
        const parsed = overviewSchema.safeParse(await response.json());
        if (controller.signal.aborted) return null;
        if (!parsed.success || parsed.data.receipts.some((item) => item.sourceId !== sourceId || item.projectId !== projectId)) throw new Error("metadata");
        setOverview((old) => ({ ...parsed.data, receipts: parsed.data.enabled ? mergeTaskReceipts(old?.receipts ?? [], parsed.data.receipts) : [] })); setCheckFailed(false); setChecking(false);
        const current = attemptRef.current;
        const matching = current && parsed.data.receipts.find((item) => item.id === current.id);
        if (matching?.state === "created" && current) {
          resolvedRef.current.add(current.id); attemptRef.current = null;
          setAttempt(null); setDraft(emptyDraft()); setMessage("원본 업무가 생성되었습니다.");
          if (createdRef.current !== current.id) { createdRef.current = current.id; onCreated(); }
        } else if (matching && (matching.state === "failed" || matching.state === "expired")) {
          resolvedRef.current.add(matching.id); attemptRef.current = null;
          setAttempt(null); setMessage(matching.state === "failed" ? "원본에서 생성을 완료하지 못했습니다. 초안은 유지됩니다." : "요청 기한이 지나 생성되지 않았습니다. 초안은 유지됩니다.");
        } else if (matching && unresolved(matching)) {
          setAttempt((old) => old?.id === matching.id ? { ...old, outcome: "unknown" } : old);
          setMessage("요청 결과를 확인하고 있습니다. 결과가 확인될 때까지 다시 전송할 수 없습니다.");
        }
        return parsed.data;
      } catch {
        if (!controller.signal.aborted) { setCheckFailed(true); setChecking(false); setMessage("원본 업무 생성 상태를 확인하지 못했습니다. 다시 조회될 때까지 전송할 수 없습니다."); }
        return null;
      }
    }
    async function poll() {
      setChecking(true);
      while (!stopped && !controller.signal.aborted) {
        const result = await refresh();
        if (stopped || controller.signal.aborted || unauthorizedRef.current) break;
        setChecking(false);
        await sleep();
      }
    }
    void poll();
    return () => { stopped = true; controller.abort(); if (timer) clearTimeout(timer); };
  }, [sourceId, projectId, onUnauthorized, onCreated]);

  const attemptRef = useRef<Attempt | null>(null);
  attemptRef.current = attempt;
  const receipts = overview?.receipts ?? [];
  const pending = receipts.some(unresolved);
  const isBlocked = checking || checkFailed || !overview || !overview.enabled || overview.incomplete || pending || sending || !!attempt;
  const criteria = draft.criteria.filter((item) => item.trim().length > 0);

  function updateDraft(patch: Partial<Draft>) { setKnownFailure(null); setDraft((current) => ({ ...current, ...patch })); }
  function clearDraft() {
    if (sending || attempt) return;
    setDraft(emptyDraft()); setMessage(""); setKnownFailure(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBlocked || !overview?.enabled) return;
    const controller = postController.current;
    if (!controller || controller.signal.aborted) return;
    const id = crypto.randomUUID();
    const payload = { id, sourceId, projectId, title: draft.title, body: draft.body, acceptanceCriteria: criteria, requiresTest: draft.requiresTest, expiresAt: new Date(Date.now() + 90_000).toISOString() };
    const validated = requestSchema.safeParse(payload);
    if (!validated.success) { setMessage("제목·본문·수용 기준의 길이와 입력 크기를 확인해 주세요."); return; }
    const frozen: Attempt = { id, payload: validated.data, outcome: "sending" };
    setAttempt(frozen); attemptRef.current = frozen; setKnownFailure(null); setSending(true); setMessage("원본 업무 생성 요청을 전송하고 있습니다.");
    try {
      const response = await fetch("/api/projects/task-creation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(validated.data), signal: controller.signal });
      if (controller.signal.aborted || resolvedRef.current.has(id)) return;
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        handleUnauthorized();
        return;
      }
      if (response.status === 400 || response.status === 409) {
        setAttempt(null); attemptRef.current = null; setKnownFailure({ id, label: response.status === 409 ? "요청 보류" : "요청 거부" }); setMessage(response.status === 409 ? "프로젝트의 기존 요청 상태를 확인하고 있습니다. 초안은 유지됩니다." : "요청을 확인할 수 없어 전송하지 않았습니다. 초안은 유지됩니다.");
        setCheckFailed(true); setChecking(true);
        return;
      }
      if (!response.ok) throw new Error("uncertain");
      const result = z.object({ receipt: receiptSchema }).strict().safeParse(await response.json());
      if (controller.signal.aborted || resolvedRef.current.has(id)) return;
      if (!result.success || result.data.receipt.id !== id || result.data.receipt.sourceId !== sourceId || result.data.receipt.projectId !== projectId) throw new Error("uncertain");
      const receipt = result.data.receipt;
      setOverview((old) => old ? { ...old, receipts: mergeTaskReceipts(old.receipts, [receipt]) } : old);
      if (receipt.state === "created") {
        resolvedRef.current.add(id);
        setAttempt(null); attemptRef.current = null; setDraft(emptyDraft()); setMessage("원본 업무가 생성되었습니다.");
        if (createdRef.current !== id) { createdRef.current = id; onCreated(); }
      } else if (receipt.state === "failed" || receipt.state === "expired") {
        resolvedRef.current.add(id);
        setAttempt(null); attemptRef.current = null; setMessage(receipt.state === "failed" ? "원본에서 생성을 완료하지 못했습니다. 초안은 유지됩니다." : "요청 기한이 지나 생성되지 않았습니다. 초안은 유지됩니다.");
      } else {
        const next = { ...frozen, outcome: "unknown" as const };
        setAttempt(next); attemptRef.current = next; setMessage("요청 결과를 확인하고 있습니다. 결과가 확인될 때까지 다시 전송할 수 없습니다.");
      }
    } catch {
      if (controller.signal.aborted || resolvedRef.current.has(id)) return;
      const next = { ...frozen, outcome: "unknown" as const };
      setAttempt(next); attemptRef.current = next; setMessage("전송 결과를 확인하지 못했습니다. 초안과 요청 ID를 유지하며 다시 전송하지 않습니다.");
    } finally { if (!controller.signal.aborted) setSending(false); }
  }

  const ownReceipt = attempt ? receipts.find((item) => item.id === attempt.id) : undefined;
  const otherReceipts = receipts.filter((item) => !attempt || item.id !== attempt.id);
  const locked = !!attempt || sending || pending || checking || checkFailed || !!overview?.incomplete;
  return <details className="task-create-panel">
    <summary>원본 업무 만들기 <small>{!overview ? "생성 권한 확인 중" : !overview.enabled ? "현재 생성 불가" : projectTitle}</small></summary>
    {!overview ? <p className="task-create-note" role="status">원본 업무 생성 가능 여부를 확인하고 있습니다.</p>
      : !overview.enabled ? <p className="task-create-note">이 프로젝트에서는 현재 원본 업무를 만들 수 없습니다.</p>
        : <>
          <p className="task-create-note">{overview.detail}</p>
          {message && <p className="task-create-status" role="status" aria-live="polite">{message}</p>}
          {ownReceipt && <ReceiptView receipt={ownReceipt} />}
          {attempt && !ownReceipt && <section className="task-create-receipt" aria-label="원본 업무 생성 상태: 결과 확인 중"><strong>{attempt.outcome === "sending" ? "요청 전송 중" : "결과 확인 중"}</strong><small>요청 ID <code>{attempt.id}</code></small></section>}
          {knownFailure && <section className="task-create-receipt" aria-label="원본 업무 생성 상태: 요청 거부"><strong>{knownFailure.label}</strong><small>요청 ID <code>{knownFailure.id}</code></small></section>}
          {overview.incomplete && <p className="task-create-note">일부 이전 요청 기록을 불러오지 못했습니다. 전송은 보류됩니다.</p>}
          {otherReceipts.slice(-1).map((receipt) => <ReceiptView key={receipt.id} receipt={receipt} />)}
          {otherReceipts.length > 1 && <details className="task-create-history"><summary>이전 생성 처리 기록 {otherReceipts.length - 1}건</summary><div role="region" aria-label="이전 업무 생성 처리 기록" tabIndex={0}>{otherReceipts.slice(0, -1).reverse().map((receipt) => <ReceiptView key={receipt.id} receipt={receipt} />)}</div></details>}
          <form className="task-create-form" onSubmit={submit}>
            <label>제목 <input required maxLength={300} value={draft.title} disabled={locked} onChange={(event) => updateDraft({ title: event.target.value })} /></label>
            <label>본문 <textarea maxLength={5000} rows={4} value={draft.body} disabled={locked} onChange={(event) => updateDraft({ body: event.target.value })} /></label>
            <fieldset><legend>수용 기준 <small>최대 20개 · 항목당 500자</small></legend>
              {draft.criteria.map((value, index) => <div className="task-create-criterion" key={index}><label className="sr-only" htmlFor={`task-criterion-${index}`}>수용 기준 {index + 1}</label><input id={`task-criterion-${index}`} maxLength={500} value={value} disabled={locked} onChange={(event) => updateDraft({ criteria: draft.criteria.map((item, i) => i === index ? event.target.value : item) })} /><button type="button" className="text-button" disabled={locked || draft.criteria.length === 1} onClick={() => updateDraft({ criteria: draft.criteria.filter((_, i) => i !== index) })}>삭제</button></div>)}
              <button type="button" className="text-button" disabled={locked || draft.criteria.length >= 20} onClick={() => updateDraft({ criteria: [...draft.criteria, ""] })}>기준 추가</button>
            </fieldset>
            <label className="task-create-check"><input type="checkbox" checked={draft.requiresTest} disabled={locked} onChange={(event) => updateDraft({ requiresTest: event.target.checked })} /> 테스트가 필요합니다</label>
            <p className="task-create-note">전송 가능한 제목 300자, 본문 5,000자, 수용 기준 20개이며 요청 전체는 UTF-8 기준 8 KiB 이내입니다.</p>
            <div className="task-create-actions"><button className="button-primary" type="submit" disabled={isBlocked || draft.title.trim().length === 0 || criteria.length > 20}>{sending ? "전송 중…" : "원본 업무 만들기"}</button><button className="text-button" type="button" disabled={locked} onClick={clearDraft}>초안 비우기</button></div>
            {(pending || attempt?.outcome === "unknown") && <p className="task-create-note">처리 중인 요청이 있어 중복 전송을 막았습니다. 상태를 순차 조회하고 있습니다.</p>}
          </form>
        </>}
  </details>;
}

function emptyDraft(): Draft { return { title: "", body: "", criteria: [""], requiresTest: true }; }
function ReceiptView({ receipt }: { receipt: TaskCreationReceipt }) {
  return <section className="task-create-receipt" aria-label={`원본 업무 생성 상태: ${stateLabels[receipt.state]}`}>
    <strong>{stateLabels[receipt.state]}</strong><small>요청 ID <code>{receipt.id}</code></small>
    {receipt.state === "created" && receipt.taskId && receipt.taskRevision && <p>원본 업무 ID <code>{receipt.taskId}</code> · revision <code>{receipt.taskRevision}</code><small>새 원본 업무의 ID와 revision입니다. 기존 업무에 할당된 것은 아닙니다.</small></p>}
  </section>;
}
