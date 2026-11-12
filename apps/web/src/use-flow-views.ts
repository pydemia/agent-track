import { useEffect, useMemo, useRef, useState } from "react";
import type { FlowViewContent, SavedFlowView } from "../../../packages/contracts/flow-views.ts";
import { flowViewContentSchema } from "../../../packages/contracts/flow-views.ts";
import type { MissionNode, MissionEdge } from "../../../packages/projection/mission-flow.ts";
import { captureFlowViewAnchors, reconcileSavedFlowView } from "../../../packages/projection/saved-flow-view-state.ts";
import { fetchFlowViews, flowViewContextId, saveFlowView, removeFlowView, FlowViewsReadError } from "./flow-views-client.ts";

type Model = { nodes: MissionNode[]; edges: MissionEdge[] };
export function useFlowViews(actor: string | null, scope: string, model: Model,
  state: FlowViewContent["state"], apply: (state: FlowViewContent["state"]) => void, invalidate: () => void, onUnauthorized?: (reason: string) => void) {
  const anchors = useMemo(() => captureFlowViewAnchors(model.nodes), [model.nodes]);
  const rawStamp = JSON.stringify([actor, scope, anchors]);
  const epoch = useRef({ raw: rawStamp, value: 0 });
  if (epoch.current.raw !== rawStamp) epoch.current = { raw: rawStamp, value: epoch.current.value + 1 };
  const stamp = JSON.stringify([rawStamp, epoch.current.value]);
  const [context, setContext] = useState<{ scope: string; id: string } | null>(null);
  const contextScope = JSON.stringify([actor, scope]);
  const contextId = context?.scope === contextScope ? context.id : null;
  const [records, setRecords] = useState<{ stamp: string; views: SavedFlowView[] } | null>(null);
  const [draft, setDraft] = useState({ stamp, name: "" });
  const [selected, setSelected] = useState<{ stamp: string; view: SavedFlowView } | null>(null);
  const [notice, setNotice] = useState({ stamp, text: "" });
  const [working, setWorking] = useState<string | null>(null);
  const requests = useRef(new Set<AbortController>()), action = useRef(0);
  const workingRef = useRef<string | null>(null);
  const restored = useRef<{ scope: string; id: string; revision: number } | null>(null);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const current = useRef({ stamp, actor, contextId, model, apply, invalidate, onUnauthorized });
  current.current = { stamp, actor, contextId, model, apply, invalidate, onUnauthorized };
  useEffect(() => () => { if (restored.current?.scope === contextScope) restored.current = null; }, [contextScope]);
  useEffect(() => {
    let active = true; setContext(null);
    if (actor) void flowViewContextId(contextScope).then(id => { if (active) setContext({ scope: contextScope, id }); }).catch(() => {});
    return () => { active = false; };
  }, [contextScope]);
  useEffect(() => {
    return () => { action.current++; workingRef.current = null; for (const controller of requests.current) controller.abort(); requests.current.clear(); };
  }, [stamp, contextId]);
  const valid = (controller: AbortController, sequence?: number) => !controller.signal.aborted && current.current.stamp === stamp && current.current.contextId === contextId && (sequence === undefined || sequence === action.current);
  const failed = (error: unknown) => {
    if (restored.current?.scope === contextScope) { restored.current = null; current.current.invalidate(); }
    setRecords(null); setSelected(null); setDraft({ stamp, name: "" });
    if (error instanceof FlowViewsReadError && error.kind === "unauthorized") current.current.onUnauthorized?.("저장 보기의 로그인 권한이 해제되어 이전 내용을 지웠습니다.");
    setNotice({ stamp, text: "저장 보기를 확인하지 못했습니다. 원본 접근과 다른 화면의 변경을 확인한 뒤 다시 불러오세요." });
  };
  const refresh = async (controller: AbortController) => {
    if (!actor || !contextId) return [];
    const sequence = action.current;
    const views = await fetchFlowViews(actor, contextId, controller.signal);
    if (!valid(controller, sequence)) return [];
    const contains = (ref: { id: string; revision: number }) => views.some(view => view.id === ref.id && view.revision === ref.revision);
    if (restored.current?.scope === contextScope && !contains(restored.current)) { restored.current = null; current.current.invalidate(); }
    const chosen = selectedRef.current;
    if (chosen?.stamp === stamp && !contains(chosen.view)) {
      selectedRef.current = null; setSelected(null); setDraft({ stamp, name: "" });
      setNotice({ stamp, text: "선택한 저장 보기의 접근이나 내용이 달라져 이전 이름과 선택을 지웠습니다." });
    }
    setRecords({ stamp, views }); return views;
  };
  useEffect(() => {
    if (!actor || !contextId || !anchors) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController(); requests.current.add(controller);
    const poll = async () => {
      if (workingRef.current === stamp) { timer = setTimeout(() => void poll(), 15_000); return; }
      const sequence = action.current;
      try { await refresh(controller); }
      catch (error) { if (valid(controller, sequence)) failed(error); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 15_000); }
    };
    void poll();
    return () => { controller.abort(); requests.current.delete(controller); clearTimeout(timer); };
  }, [stamp, contextId]);
  const views = records?.stamp === stamp ? records.views.filter(view => reconcileSavedFlowView(view.content, model) !== null) : [];
  const selection = selected?.stamp === stamp && views.some(view => view.id === selected.view.id) ? selected.view : null;
  const name = draft.stamp === stamp ? draft.name : "";
  const perform = async (job: (controller: AbortController, sequence: number) => Promise<void>) => {
    if (!actor || !contextId || !anchors || workingRef.current === stamp) return;
    const sequence = ++action.current, controller = new AbortController(); requests.current.add(controller); workingRef.current = stamp; setWorking(stamp);
    try { await job(controller, sequence); }
    catch (error) { if (valid(controller, sequence)) failed(error); }
    finally { requests.current.delete(controller); if (valid(controller, sequence)) { workingRef.current = null; setWorking(null); } }
  };
  const choose = (id: string) => {
    const view = views.find(item => item.id === id); setSelected(view ? { stamp, view } : null);
    setDraft({ stamp, name: view?.content.name ?? "" }); setNotice({ stamp, text: "" });
  };
  const save = (asNew: boolean) => void perform(async (controller, sequence) => {
    if (!anchors || !actor || !contextId) return;
    if (!asNew && (!selection || !views.some(view => view.id === selection.id && view.revision === selection.revision))) throw new Error("Changed view");
    const content = flowViewContentSchema.parse({ version: 1, contextId, name, anchors, state });
    const saved = await saveFlowView(actor, asNew ? crypto.randomUUID() : selection!.id, asNew ? 0 : selection!.revision, content, controller.signal);
    if (!valid(controller, sequence)) return;
    restored.current = { scope: contextScope, id: saved.id, revision: saved.revision };
    const confirmed = (await refresh(controller)).find(view => view.id === saved.id && view.revision === saved.revision);
    if (!valid(controller, sequence)) return;
    if (!confirmed) throw new Error("Saved view no longer authorized");
    restored.current = { scope: contextScope, id: confirmed.id, revision: confirmed.revision };
    setSelected({ stamp, view: saved }); setDraft({ stamp, name: saved.content.name });
    setNotice({ stamp, text: "계정에 저장했습니다. 다음 접속에서 이 흐름의 저장 보기를 불러올 수 있습니다." });
  });
  const load = () => void perform(async (controller, sequence) => {
    if (!selection) return;
    const latest = (await refresh(controller)).find(view => view.id === selection.id);
    if (!valid(controller, sequence)) return;
    const presentation = latest && reconcileSavedFlowView(latest.content, current.current.model);
    if (!latest || !presentation) throw new Error("Unavailable saved view");
    restored.current = { scope: contextScope, id: latest.id, revision: latest.revision };
    current.current.apply(presentation); setSelected({ stamp, view: latest }); setDraft({ stamp, name: latest.content.name });
    setNotice({ stamp, text: "현재 접근 가능한 구성으로 저장 보기를 복원했습니다." });
  });
  const remove = () => void perform(async (controller, sequence) => {
    if (!selection || !actor) return;
    await removeFlowView(actor, selection, controller.signal);
    if (!valid(controller, sequence)) return;
    setSelected(null); setDraft({ stamp, name: "" }); await refresh(controller);
    if (valid(controller, sequence)) setNotice({ stamp, text: "저장 보기를 삭제했습니다." });
  });
  return { ready: Boolean(actor && contextId && anchors), busy: working === stamp, name,
    setName: (name: string) => setDraft({ stamp, name }), views, selection, choose, save, load, remove,
    refresh: () => void perform(async controller => { await refresh(controller); }),
    notice: notice.stamp === stamp ? notice.text : "" };
}
