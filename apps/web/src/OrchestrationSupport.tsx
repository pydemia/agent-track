import { useEffect, useState } from "react";
import { z } from "zod";
import type { RunView } from "../../../packages/contracts/index.ts";

const schema = z.object({
  state: z.enum(["connected", "disconnected", "forbidden", "unsupported"]), runKey: z.string(),
  support: z.object({ provider: z.string().max(500), providerType: z.string().max(100).nullable(), providerConfigured: z.boolean().nullable(),
    toolOrchestration: z.enum(["external", "demian", "unknown"]), reported: z.object({ goals: z.boolean().nullable(), cowork: z.boolean().nullable(), managedChild: z.boolean().nullable() }).strict(),
    workers: z.number().int().nonnegative().safe().nullable(), checkedAt: z.string().nullable() }).strict().nullable(),
  sessionMode: z.enum(["single-agent", "multi-agent"]).nullable(), observedAt: z.string(), detail: z.string().max(2000),
}).strict();
type Evidence = z.infer<typeof schema>;
const flag = (value: boolean | null | undefined) => value === true ? "활성 선언" : value === false ? "비활성 선언" : "미확인";

export function OrchestrationSupport({ run, onUnauthorized }: { run: RunView; onUnauthorized: (reason: string) => void }) {
  const [value, setValue] = useState<Evidence | null>(null);
  const [failedKey, setFailedKey] = useState("");
  const native = run.capabilities.includes("session.link");
  useEffect(() => {
    if (!native || run.sourceState !== "connected") { setValue(null); return; }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(run.key)}/orchestration`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if ([401, 403, 404].includes(response.status)) { setValue(null); onUnauthorized("실행 접근이 변경되어 조직화 지원 정보를 지웠습니다."); return; }
        if (!response.ok) throw new Error();
        const next = schema.parse(await response.json());
        if (next.runKey !== run.key) throw new Error();
        if (!controller.signal.aborted) { setValue(next); setFailedKey(""); }
      } catch { if (!controller.signal.aborted) { setValue(null); setFailedKey(run.key); } }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void read(), 30_000); }
    }
    void read(); return () => { controller.abort(); clearTimeout(timer); };
  }, [run.key, run.sourceState, native, onUnauthorized]);
  if (!native) return null;
  const current = run.sourceState === "connected" && value?.runKey === run.key ? value : null;
  const support = current?.support;
  return <details className="orchestration-support"><summary>이 실행의 조직화 지원 <small>{support
    ? `${support.provider} · ${support.toolOrchestration === "external" ? "원본 실행기 관리" : support.toolOrchestration === "demian" ? "Demian 관리" : "관리 방식 미확인"}`
    : failedKey === run.key || current?.state === "disconnected" ? "조회 실패" : current?.state === "forbidden" ? "원본 접근 확인 필요" : current?.state === "unsupported" ? "미지원" : run.sourceState !== "connected" ? "원본 연결 확인 필요" : "조회 중"}</small></summary>
    {support ? <>
      <dl><div><dt>선택한 provider</dt><dd>{support.provider} · {support.providerType ?? "유형 미확인"}</dd></div>
        <div><dt>현재 Session</dt><dd>{current?.sessionMode} · provider 구성 {support.providerConfigured === null ? "미확인" : support.providerConfigured ? "확인" : "없음"}</dd></div>
        <div><dt>Worker 전역 선언</dt><dd>Goal {flag(support.reported.goals)} · Cowork {flag(support.reported.cowork)} · Managed child {flag(support.reported.managedChild)}</dd></div></dl>
      <p>{support.toolOrchestration === "external"
        ? "이 provider는 원본 실행기가 도구와 하위 호출을 관리합니다. Demian 관리형 하위 실행 대상은 이 경로에서 제공되지 않습니다. 원본에서 관측한 호출·도구 lineage와 Demian 위임·cowork를 구분해 표시합니다."
        : support.toolOrchestration === "demian"
          ? "Demian이 도구를 조직하는 유형입니다. 현재 Session 정책과 실제 callable target·원본 접수가 확인되어야 하위 실행으로 표시할 수 있습니다."
          : "이 provider의 조직화 방식을 확인하지 못했습니다. 전역 기능 선언만으로 하위 실행 지원을 판단하지 않습니다."}</p>
      <p>{current?.detail}</p>
    </> : <p>{current?.detail ?? (failedKey === run.key ? "원본 지원 정보를 확인하지 못했습니다. 그래프의 빈 관계를 지원 없음으로 해석하지 마세요." : "현재 접근 가능한 원본의 기능 선언과 provider 실행 방식을 확인합니다.")}</p>}
  </details>;
}
