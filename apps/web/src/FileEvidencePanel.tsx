import { useEffect, useState } from "react";
import { z } from "zod";
import { sequenceSchema, timestampSchema, type FileChangeEvidence, type RunView } from "../../../packages/contracts/index.ts";

const schema = z.object({
  state: z.enum(["connected", "disconnected", "forbidden", "unsupported"]), runKey: z.string(),
  observedAt: timestampSchema, detail: z.string().max(1000), scanned: z.number().int().nonnegative(), limit: z.number().int().positive(),
  targetSequence: sequenceSchema, throughSequence: sequenceSchema, complete: z.boolean(), omittedChanges: z.number().int().nonnegative(),
  changes: z.array(z.object({ key: z.string().max(2048), path: z.string().min(1).max(2048), operation: z.enum(["add", "update", "delete", "unknown"]),
    state: z.enum(["reported", "pending", "failed", "ambiguous"]), mechanism: z.enum(["native-fileChange", "workspace-diff"]), callId: z.string().max(512).nullable(),
    requestedSequence: sequenceSchema.nullable(), completedSequence: sequenceSchema.nullable(), observedAt: timestampSchema, detail: z.string().max(1000) }).strict()).max(500),
}).strict();
const operations = { add: "추가", update: "수정", delete: "삭제", unknown: "종류 미확인" };
const states = { reported: "원본 변경 보고", pending: "편집 요청 · 완료 미확인", failed: "도구 실패 · 변경 미확인", ambiguous: "근거 모호 · 변경 미확인" };

export function FileEvidencePanel({ run, onUnauthorized }: { run: RunView; onUnauthorized: (reason: string) => void }) {
  const [evidence, setEvidence] = useState<FileChangeEvidence | null>(null);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false); const [refresh, setRefresh] = useState(0);
  const native = run.capabilities.includes("session.link");
  useEffect(() => {
    if (!native || run.sourceState !== "connected") return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/runs/${run.key}/files`, { signal: controller.signal });
        if (response.status === 401 || response.status === 403) { onUnauthorized("파일 근거 접근이 해제되어 실행 데이터를 지웠습니다."); return; }
        if (!response.ok) throw new Error();
        const value = schema.parse(await response.json());
        if (controller.signal.aborted) return;
        if (value.runKey !== run.key) throw new Error();
        setEvidence(value); setError("");
      } catch { if (!controller.signal.aborted) { setEvidence(null); setError("파일 변경 근거를 확인하지 못했습니다. 현재 원본 연결과 접근 범위를 확인해 주세요."); } }
      finally { if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(() => void load(), 15_000); } }
    };
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [run.key, run.sourceState, native, onUnauthorized, refresh]);

  return <section className="file-evidence" aria-label="Run 파일 변경 근거"><div className="section-heading"><h3>파일 변경 근거</h3>{native && <button className="text-button" disabled={loading || run.sourceState !== "connected"} onClick={() => setRefresh((value) => value + 1)}>파일 근거 다시 조회</button>}</div>
    {!native ? <p className="empty-inline">이 출처는 원본 파일 변경 근거 조회를 지원하지 않습니다.</p>
      : run.sourceState !== "connected" ? <p className="inline-warning">현재 원본 연결을 확인하지 못해 파일 근거를 숨겼습니다.</p>
      : error ? <p className="inline-error" role="alert">{error}</p>
      : !evidence ? <p role="status">원본 파일 근거 조회 중…</p>
      : <><p className="graph-legend">{evidence.detail}</p>{evidence.state === "connected" && <>
        {!evidence.complete && <p className="inline-warning">이 조회의 기록이 불완전하거나 표시 한도에 도달했습니다. 변경 없음·전체 파일 목록으로 해석하지 마세요.</p>}
        {evidence.changes.length ? <ul className="file-change-list" aria-label="원본 파일 변경 목록" tabIndex={0}>{evidence.changes.map((item) => <li key={item.key}><strong>{operations[item.operation]} · {states[item.state]}</strong><code dir="ltr">{item.path}</code><small>{item.detail}</small><small>{item.mechanism === "workspace-diff" ? "원본 diff 이벤트" : "native 편집 요청과 도구 결과"} · 요청 seq {item.requestedSequence ?? "미확인"} → 완료 seq {item.completedSequence ?? "미확인"}</small><time>{new Date(item.observedAt).toLocaleString("ko-KR")}</time></li>)}</ul>
          : <p className="empty-inline">조회 범위에서 표시 가능한 파일 변경 근거를 찾지 못했습니다. 일반 도구 실행이나 산출물 생성만으로 파일 변경을 만들지 않습니다.</p>}
        <small>원장 관측 seq {evidence.targetSequence}까지 조회 · 원본 관측 {evidence.throughSequence} · {evidence.scanned}/{evidence.limit}개 이벤트 검사{evidence.omittedChanges ? ` · ${evidence.omittedChanges}개 파일 근거 표시 제외` : ""}</small>
      </>}<small>조회 {new Date(evidence.observedAt).toLocaleTimeString("ko-KR")} · 내용·patch·도구 인자 저장 및 다운로드 없음</small></>}
  </section>;
}
