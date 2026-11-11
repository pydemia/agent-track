import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { contextSummarySchema } from "./agent-track-shared/context/contracts";
import { ExecutionContextSummary } from "./agent-track-shared/context/ExecutionSummary";
import "./agent-track.css";

const responseSchema = z.discriminatedUnion("state", [
    z.object({ state: z.literal("connected"), summary: contextSummarySchema }).strict(),
    z.object({ state: z.enum(["disabled", "forbidden", "unavailable"]), summary: z.null() }).strict(),
]);
type Summary = z.infer<typeof contextSummarySchema>;
type StateValue = z.infer<typeof responseSchema> | { state: "loading" };
type State = { scope: string; value: StateValue };

const activityStatuses = [
    ["running", "실행 중"], ["queued", "대기"], ["leasing", "할당 중"], ["cancelling", "취소 중"],
    ["waiting_for_permission", "권한 대기"], ["failed", "실패"], ["expired", "만료"], ["interrupted", "중단"], ["succeeded", "성공"],
] as const;

export function AgentTrackActivity({ summary, taskId, showCoverage = false }: { summary: Summary; taskId?: string; showCoverage?: boolean }) {
    const runs = taskId ? summary.runs.filter(run => run.binding?.taskId === taskId) : summary.runs;
    const count = runs.length;
    const statuses = activityStatuses.flatMap(([status, label]) => {
        const statusCount = runs.filter(run => run.status === status).length;
        return statusCount ? [`${label} ${statusCount}`] : [];
    });
    const partial = summary.coverage.capped || summary.coverage.unavailable;
    if (!count && !(showCoverage && partial)) return null;
    return <span className="agent-track-activity" title="관측된 연결 실행">
        관측 실행 {count}{statuses.length ? ` · ${statuses.join(" · ")}` : ""}
        {showCoverage && partial && <small className="agent-track-coverage">관측 구간 일부{summary.coverage.capped ? " · 최대 50개" : ""}{summary.coverage.unavailable ? " · 일부 Run 확인 불가" : ""}</small>}
    </span>;
}

export function AgentTrackSummary({ projectId, taskId, compact = false, onProjectSummary }: { projectId: string; taskId?: string; compact?: boolean; onProjectSummary?: (summary: z.infer<typeof contextSummarySchema> | null) => void }) {
    const scope = taskId ? `task:${projectId}:${taskId}` : `project:${projectId}`;
    const [state, setState] = useState<State>({ scope, value: { state: "loading" } });
    const [attempt, setAttempt] = useState(0);
    const callbackRef = useRef(onProjectSummary);
    callbackRef.current = onProjectSummary;
    const retry = useCallback(() => setAttempt(value => value + 1), []);

    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let controller: AbortController | undefined;
        const path = taskId
            ? `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/agent-track`
            : `/api/projects/${encodeURIComponent(projectId)}/agent-track`;
        const load = async () => {
            controller = new AbortController();
            const deadline = setTimeout(() => controller?.abort(), 4000);
            try {
                const response = await fetch(path, { credentials: "same-origin", signal: controller.signal, headers: { Accept: "application/json" } });
                if (!alive) return;
                if (controller.signal.aborted) throw new Error("request deadline");
                if (response.status === 401 || response.status === 403) {
                    setState({ scope, value: { state: "forbidden", summary: null } });
                    if (!taskId) callbackRef.current?.(null);
                    return;
                }
                if (response.status === 404) {
                    setState({ scope, value: { state: "disabled", summary: null } });
                    if (!taskId) callbackRef.current?.(null);
                    return;
                }
                if (!response.ok) throw new Error("unavailable");
                const payload: unknown = await response.json();
                if (!alive) return;
                if (controller.signal.aborted) throw new Error("request deadline");
                const parsed = responseSchema.safeParse(payload);
                if (!parsed.success) throw new Error("invalid summary");
                const result = parsed.data;
                if (result.state === "connected") {
                    const context = result.summary.context;
                    if (context.kind !== (taskId ? "task" : "project") || context.projectId !== projectId || (taskId && (context.kind !== "task" || context.taskId !== taskId))) {
                        throw new Error("summary scope mismatch");
                    }
                }
                if (alive && !controller.signal.aborted) {
                    setState({ scope, value: result });
                    if (!taskId) callbackRef.current?.(result.state === "connected" ? result.summary : null);
                }
            } catch {
                if (alive) {
                    setState({ scope, value: { state: "unavailable", summary: null } });
                    if (!taskId) callbackRef.current?.(null);
                }
            } finally {
                clearTimeout(deadline);
                if (alive) timer = setTimeout(load, 15000);
            }
        };
        setState({ scope, value: { state: "loading" } });
        if (!taskId) callbackRef.current?.(null);
        timer = setTimeout(load, 0);
        return () => {
            alive = false;
            controller?.abort();
            if (timer) clearTimeout(timer);
            if (!taskId) callbackRef.current?.(null);
        };
    }, [projectId, taskId, attempt, scope]);

    const visible = state.scope === scope ? state.value : { state: "loading" as const };
    if (visible.state === "disabled") return null;
    if (visible.state === "forbidden") return <aside className={`agent-track-note ${compact ? "compact" : ""}`} role="status">실행 컨텍스트를 표시할 수 없습니다.</aside>;
    if (visible.state === "loading") return <aside className={`agent-track-note ${compact ? "compact" : ""}`} role="status">실행 기록 불러오는 중…</aside>;
    if (visible.state === "unavailable") return <aside className={`agent-track-note ${compact ? "compact" : ""}`} role="status">실행 기록을 불러오지 못했습니다. <button type="button" onClick={retry}>다시 시도</button></aside>;
    if (!visible.summary) return null;
    if (compact) {
        return <AgentTrackActivity summary={visible.summary} showCoverage />;
    }
    return <div className="agent-track-summary"><ExecutionContextSummary result={{ state: "connected", summary: visible.summary }} label={taskId ? "이 작업의 연결 실행" : "프로젝트 실행 요약"} /></div>;
}
