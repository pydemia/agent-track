import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { AgentTrackActivity, AgentTrackSummary } from "./AgentTrackSummary";
import { contextSummarySchema, type ContextSummary } from "./agent-track-shared/context/contracts";

const projectId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const base = { version: 1, observedAt: "2026-11-12T00:00:00Z", task: null, runs: [{ sourceId: "projects", runId, sessionId, status: "succeeded", binding: { projectSourceId: "projects", projectId, taskId, revision: "1" }, observedAt: "2026-11-12T00:00:00Z", cursor: "1", highWater: "1", stale: false, incomplete: false, url: "https://track.example/?run=33333333-3333-4333-8333-333333333333" }], counts: { runs: 1, sessions: 1, byStatus: { queued: 0, leasing: 0, running: 0, waiting_for_permission: 0, cancelling: 0, succeeded: 1, failed: 0, cancelled: 0, expired: 0, interrupted: 0, unknown: 0 } }, coverage: { kind: "observed-window", limit: 50, capped: false, unavailable: false }, trackUrl: null };
const connected = (kind: "project" | "task", targetTaskId?: string) => ({ state: "connected", summary: { ...base, context: { kind, sourceId: "projects", projectId, ...(targetTaskId ? { taskId: targetTaskId } : {}) }, task: targetTaskId ? { id: targetTaskId, revision: "1", state: "done", requiresTest: false } : null } });

afterEach(() => vi.useRealTimers());

describe("AgentTrackSummary", () => {
    it("validates project summaries and counts observed runs", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(connected("project")), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        render(<AgentTrackSummary projectId={projectId} />);
        expect(await screen.findByText("Run 1개 · 세션 1개")).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${projectId}/agent-track`, expect.objectContaining({ credentials: "same-origin" }));
    });

    it("requests the selected task scope and discards mismatched summaries", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(connected("task", "55555555-5555-4555-8555-555555555555")), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        render(<AgentTrackSummary projectId={projectId} taskId={taskId} />);
        expect(await screen.findByText(/실행 기록을 불러오지 못했습니다/)).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${projectId}/tasks/${taskId}/agent-track`, expect.anything());
    });

    it("renders disabled as nothing and leaves native actions usable on errors", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ state: "disabled", summary: null }), { status: 200 }))
            .mockRejectedValue(new Error("offline"));
        vi.stubGlobal("fetch", fetchMock);
        const view = render(<><AgentTrackSummary projectId={projectId} /><button>작업 저장</button></>);
        await waitFor(() => expect(view.container.querySelector(".agent-track-note")).toBeNull());
        expect(screen.getByRole("button", { name: "작업 저장" }).hasAttribute("disabled")).toBe(false);
        view.rerender(<><AgentTrackSummary projectId={projectId} taskId={taskId} /><button>작업 저장</button></>);
        fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
        expect(screen.getByRole("button", { name: "작업 저장" }).hasAttribute("disabled")).toBe(false);
    });

    it("ignores late responses after unmount", async () => {
        let resolve!: (response: Response) => void;
        vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
        const view = render(<AgentTrackSummary projectId={projectId} />);
        await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        view.unmount();
        resolve(new Response(JSON.stringify(connected("project")), { status: 200 }));
        await Promise.resolve();
        expect(view.container.innerHTML).toBe("");
    });

    it.each([403, 404])("clears row activity after a connected summary changes to HTTP %i", async status => {
        vi.useFakeTimers();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(connected("project")), { status: 200 }))
            .mockResolvedValue(new Response(null, { status }));
        vi.stubGlobal("fetch", fetchMock);
        const publish = vi.fn();
        function ProjectActivity() {
            const [summary, setSummary] = useState<ContextSummary | null>(null);
            return <><AgentTrackSummary projectId={projectId} compact onProjectSummary={value => { publish(value); setSummary(value); }} />
                {summary?.runs.some(run => run.binding?.taskId === taskId) && <span>task row execution badge</span>}</>;
        }
        render(<ProjectActivity />);
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(screen.getByText("task row execution badge")).toBeTruthy();
        await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
        expect(screen.queryByText("task row execution badge")).toBeNull();
        expect(publish).toHaveBeenLastCalledWith(null);
    });

    it("hides the previous context synchronously when scope props change", async () => {
        const otherProjectId = "55555555-5555-4555-8555-555555555555";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(connected("project")), { status: 200 })));
        const view = render(<AgentTrackSummary projectId={projectId} />);
        expect(await screen.findByText("Run 1개 · 세션 1개")).toBeTruthy();
        view.rerender(<AgentTrackSummary projectId={otherProjectId} />);
        expect(screen.getByRole("status").textContent).toContain("불러오는 중");
        expect(screen.queryByText("Run 1개 · 세션 1개")).toBeNull();
    });

    it("shows status breakdowns and partial coverage even with zero returned runs", () => {
        const summary = contextSummarySchema.parse({
            ...connected("project").summary,
            runs: [],
            counts: { runs: 0, sessions: 0, byStatus: Object.fromEntries(Object.keys(base.counts.byStatus).map(status => [status, 0])) },
            coverage: { ...base.coverage, unavailable: true },
        });
        const view = render(<AgentTrackActivity summary={summary} showCoverage />);
        expect(view.container.textContent).toContain("관측 실행 0");
        expect(view.container.textContent).toContain("관측 구간 일부");
        const activity = contextSummarySchema.parse(connected("project").summary);
        view.rerender(<AgentTrackActivity summary={activity} showCoverage />);
        expect(view.container.textContent).toContain("성공 1");
    });

    it("rejects a payload whose JSON finishes after the request deadline", async () => {
        vi.useFakeTimers();
        let resolveJson!: (payload: unknown) => void;
        const response = { status: 200, ok: true, json: () => new Promise<unknown>(resolve => { resolveJson = resolve; }) } as Response;
        const publish = vi.fn();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
        render(<AgentTrackSummary projectId={projectId} onProjectSummary={publish} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
        await act(async () => { resolveJson(connected("project")); await Promise.resolve(); });
        expect(screen.getByText(/실행 기록을 불러오지 못했습니다/)).toBeTruthy();
        expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ runs: expect.any(Array) }));
    });
});
