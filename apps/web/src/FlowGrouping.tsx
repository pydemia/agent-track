import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MissionNode, MissionEdge } from "../../../packages/projection/mission-flow.ts";
import { nativeFlowGroupDefinitions, withTaskBundles, groupsForNodes, type FlowGroupBy, type TaskBundle } from "../../../packages/projection/flow-group-definitions.ts";
import { projectFlowGroups, type FlowGroupSummary } from "../../../packages/projection/flow-groups.ts";
import { flowGroupContext } from "../../../packages/projection/flow-group-context.ts";
import type { FlowNode } from "./ui/flow-canvas.tsx";

type Depth = "overview" | "structure" | "detail";
const byNames: Record<FlowGroupBy, string> = { project: "Project·업무", task: "Task 실행", session: "Session", run: "실행 단위", none: "개별 node" };
const kindNames: Record<string, string> = { project: "Project 범위", task: "Task 실행", session: "Session 범위", run: "Run 범위", invocation: "호출 범위", cowork: "원본 협업", "task-bundle": "업무 묶음", "assistant-execution": "Assistant 실행", "assistant-work-package": "실행 내 Work package", "peer-connection-context": "peer 처리 연결", "peer-conversation-context": "peer 처리 대화" };
const basisNames = { native: "원본 소속", binding: "명시적 업무 연결", view: "사용자가 고른 화면 묶음" };
const countNames: Record<string, string> = { task: "업무", session: "Session", uniqueRun: "관측 Run", "assistant-execution": "Assistant 실행", "assistant-role": "역할", "assistant-runtime-task": "Runtime Task 참조", "assistant-thread": "Thread 참조", "assistant-turn": "Turn 참조", invocation: "호출", tool: "도구", permission: "승인", group: "원본 협업 그룹", member: "협업 멤버", artifact: "산출물", "peer-message": "처리 메시지", "session-relation-receipt": "관계 영수증", "managed-parent-reference": "부모 Run 미확인 참조" };
const executionStates: Record<string, string> = { queued: "대기", leasing: "할당 중", running: "실행 중", waiting_for_permission: "승인 대기", cancelling: "취소 중", succeeded: "성공 종료", failed: "실패", cancelled: "취소", expired: "만료", interrupted: "중단", unknown: "미확인", unobserved: "미조회 참조", observed: "관측됨", "observed-reference": "관계 참조", registering: "등록 중", publishing: "게시 처리 중", linking: "연결 처리 중", reconciliation_required: "확인 필요", pending: "준비 대기", preparing: "준비 중", awaiting_connection: "연결 대기", awaiting_runtime: "런타임 대기" };
const groupStatusLabel = (kind: string, status: string): string => {
  if (kind === "task") return ({ todo: "할 일", in_progress: "진행", in_review: "검토", done: "원본 완료", cancelled: "취소", bound: "연결 기록 · 현재 상태 미확인", observed: "상태 미확인", "observed-reference": "상태 미확인" } as Record<string, string>)[status] ?? status;
  if (kind === "invocation" || kind === "tool") return ({ started: "시작 관측", completed: "완료 이벤트 관측", failed: "실패 이벤트 관측", unknown: "미확인", ambiguous: "기록 모호" } as Record<string, string>)[status] ?? status;
  return status === "completed" ? "완료 관측" : executionStates[status] ?? status;
};
const summary = (group: FlowGroupSummary) => Object.entries(countNames).filter(([kind]) => group.counts[kind])
  .map(([kind, label]) => `${label} ${group.counts[kind]}`).join(" · ") || `${group.leafKeys.length}개 항목`;

export function useFlowGrouping(model: { nodes: MissionNode[]; edges: MissionEdge[]; incomplete?: boolean }, options: {
  scopeKey: string; defaultBy: FlowGroupBy; defaultDepth?: Depth; chooseNode: (key: string) => void; chooseEdge: (key: string) => void;
}) {
  const [by, setBy] = useState(options.defaultBy);
  const [depth, setDepth] = useState<Depth>(options.defaultDepth ?? "structure");
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [bundles, setBundles] = useState<TaskBundle[]>([]);
  const [focusKey, setFocus] = useState<string | null>(null);
  const [focusTargets, setFocusTargets] = useState<string[]>([]);
  const [fitVersion, setFitVersion] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [taskKeys, setTaskKeys] = useState<Set<string>>(new Set());
  const [stateScope, setStateScope] = useState(options.scopeKey);
  const sameScope = stateScope === options.scopeKey;
  const availableTasks = model.nodes.filter(node => node.kind === "task");
  const taskIdentity = JSON.stringify(availableTasks.map(node => node.key).sort());
  useEffect(() => {
    const allowed = new Set<string>(JSON.parse(taskIdentity));
    setBundles(previous => previous.filter(bundle => bundle.taskKeys.every(key => allowed.has(key))));
    setTaskKeys(previous => new Set([...previous].filter(key => allowed.has(key))));
  }, [taskIdentity]);
  useEffect(() => {
    setStateScope(options.scopeKey); setBy(options.defaultBy); setDepth(options.defaultDepth ?? "structure");
    setOverrides(new Map()); setBundles([]); setFocus(null); setFocusTargets([]); setFormOpen(false); setLabel(""); setTaskKeys(new Set());
  }, [options.scopeKey]);
  const definitions = useMemo(() => withTaskBundles(model, nativeFlowGroupDefinitions(model, sameScope ? by : options.defaultBy),
    sameScope && by !== "none" ? bundles : []), [model, by, bundles, sameScope, options.defaultBy]);
  const collapsed = useMemo(() => new Set(definitions.filter(group => {
    if (sameScope && overrides.has(group.key)) return overrides.get(group.key);
    const current = sameScope ? depth : options.defaultDepth ?? "structure";
    return current === "overview" || current === "structure" && ["run", "invocation", "cowork", "assistant-execution", "assistant-work-package", "peer-conversation-context"].includes(group.kind);
  }).map(group => group.key)), [definitions, overrides, depth, sameScope, options.defaultDepth]);
  const projection = useMemo(() => projectFlowGroups(model, definitions, collapsed), [model, definitions, collapsed]);
  const groupByKey = useMemo(() => new Map(projection.groups.map(group => [group.key, group])), [projection]);
  const activeFocus = sameScope && focusKey && groupByKey.has(focusKey) ? focusKey : null;
  const breadcrumb: FlowGroupSummary[] = [];
  for (let current = activeFocus ? groupByKey.get(activeFocus) : undefined; current; current = current.parentKey ? groupByKey.get(current.parentKey) : undefined) breadcrumb.unshift(current);
  const targetIdentity = JSON.stringify(sameScope ? focusTargets.filter(key => projection.nodes.some(node => node.key === key)) : []);
  const focusNodeIds = useMemo(() => { const targets: string[] = JSON.parse(targetIdentity); return targets.length ? targets : activeFocus ? [activeFocus] : undefined; }, [activeFocus, targetIdentity, fitVersion]);
  const resetFocus = useCallback(() => { setFocus(null); setFocusTargets([]); setFitVersion(value => value + 1); }, []);
  const enter = useCallback((key: string) => {
    if (!groupByKey.has(key)) {
      if (sameScope && bundles.some(bundle => bundle.key === key)) {
        setBy(options.defaultBy === "none" ? "task" : options.defaultBy);
        setFocus(key); setFocusTargets([]); setFitVersion(value => value + 1); options.chooseNode(key);
      }
      return;
    }
    setOverrides(previous => {
      const next = new Map(previous);
      for (let group = groupByKey.get(key); group; group = group.parentKey ? groupByKey.get(group.parentKey) : undefined) next.set(group.key, false);
      return next;
    });
    setFocus(key); setFocusTargets([]); setFitVersion(value => value + 1); options.chooseNode(key);
  }, [groupByKey, options.chooseNode, bundles, sameScope, options.defaultBy]);
  const toggle = useCallback((key: string) => {
    setFocusTargets([]);
    setOverrides(previous => new Map(previous).set(key, !collapsed.has(key)));
    options.chooseNode(key);
    if (activeFocus && groupByKey.get(key)?.leafKeys.some(member => groupByKey.get(activeFocus)?.leafKeys.includes(member))) setFocus(key);
  }, [collapsed, activeFocus, groupByKey, options.chooseNode]);
  const reveal = (keys: string[]) => {
    const ancestors = groupsForNodes(projection.groups, keys);
    setOverrides(previous => { const next = new Map(previous); for (const key of ancestors) next.set(key, false); return next; });
    const direct = projection.groups.find(group => keys.some(key => group.memberKeys.includes(key)));
    setFocus(direct?.key ?? null); setFocusTargets(keys); setFitVersion(value => value + 1);
  };
  const revealNode = (key: string) => { if (model.nodes.some(node => node.key === key)) { reveal([key]); options.chooseNode(key); } };
  const revealEdge = (key: string) => { const edge = model.edges.find(edge => edge.key === key); if (edge) { reveal([edge.from, edge.to]); options.chooseEdge(key); } };
  const selectDepth = (next: Depth) => { setDepth(next); setOverrides(new Map()); resetFocus(); };
  const decorate = (node: MissionNode, base: FlowNode): FlowNode => {
    const parent = projection.parents.get(node.key);
    const parentProps = parent ? { parentId: parent, extent: "parent" as const } : {};
    const group = groupByKey.get(node.key);
    if (!group) return { ...base, ...parentProps };
    const isCollapsed = collapsed.has(group.key);
    const width = 320; const height = isCollapsed ? 172 : 180;
    return { ...base, ...parentProps, type: "pyd-flow-group", width, height, zIndex: -1,
      style: { width, height }, ariaLabel: `${group.label} 그룹 · ${summary(group)} · ${isCollapsed ? "접힘" : "펼침"}`,
      data: { title: group.label, kindLabel: kindNames[group.kind] ?? group.kind, description: summary(group),
        group: { collapsed: isCollapsed, basis: group.basis, partial: !!model.incomplete, cyclicMembers: group.cyclicMembers } } };
  };
  const inspectNodes = [...model.nodes, ...projection.nodes.filter(node => node.kind === "container")];
  const inspectEdges = [...projection.edges, ...model.edges.filter(edge => !projection.edges.some(displayed => displayed.key === edge.key))];
  const topology = JSON.stringify([projection.nodes.map(node => [node.key, projection.parents.get(node.key) ?? ""]), projection.edges.map(edge => edge.key), [...collapsed].sort(), activeFocus, fitVersion]);
  const validBundles = sameScope ? bundles.filter(bundle => bundle.taskKeys.length >= 2 && bundle.taskKeys.every(key => availableTasks.some(task => task.key === key))) : [];
  const occupied = new Set(validBundles.flatMap(bundle => bundle.taskKeys));
  const createBundle = () => {
    const keys = [...taskKeys].filter(key => availableTasks.some(task => task.key === key) && !occupied.has(key));
    const title = label.trim(); if (!title || keys.length < 2) return;
    const key = JSON.stringify(["flow-container", "view-task-bundle", crypto.randomUUID()]);
    setBundles(previous => [...previous, { key, label: title, taskKeys: keys }]);
    if (by === "none") setBy(options.defaultBy === "none" ? "task" : options.defaultBy);
    setOverrides(previous => new Map(previous).set(key, false)); setTaskKeys(new Set()); setLabel(""); setFormOpen(false);
    options.chooseNode(key); setFocus(key); setFocusTargets([]); setFitVersion(value => value + 1);
  };
  const removeBundle = (key: string) => { setBundles(previous => previous.filter(bundle => bundle.key !== key)); resetFocus(); };
  return { by, setBy: (next: FlowGroupBy) => { setBy(next); setOverrides(new Map()); resetFocus(); }, depth, selectDepth,
    projection, collapsed, groupByKey, decorate, inspectNodes, inspectEdges, topology, focusNodeIds, fitVersion,
    enter, toggle, resetFocus, revealNode, revealEdge, breadcrumb, activeFocus, formOpen, setFormOpen, label, setLabel, taskKeys, setTaskKeys,
    availableTasks, validBundles, occupied, createBundle, removeBundle, partial: Boolean(model.incomplete), chooseNode: options.chooseNode, chooseEdge: options.chooseEdge };
}
type Grouping = ReturnType<typeof useFlowGrouping>;

export function FlowGroupControls({ state }: { state: Grouping }) {
  return <section className="flow-group-controls" aria-label="그룹과 탐색 깊이">
    <div className="flow-group-toolbar"><label>묶음 기준 <select value={state.by} onChange={event => state.setBy(event.target.value as FlowGroupBy)}>{Object.entries(byNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <div role="group" aria-label="흐름 탐색 깊이">{([["overview", "묶음 개요"], ["structure", "실행 구조"], ["detail", "상세 근거"]] as const).map(([key, name]) => <button key={key} type="button" aria-pressed={state.depth === key} onClick={() => state.selectDepth(key)}>{name}</button>)}</div>
      {state.availableTasks.length >= 2 && <button type="button" aria-expanded={state.formOpen} onClick={() => state.setFormOpen(!state.formOpen)}>업무 묶음 만들기</button>}
      <span>{state.projection.groups.length}개 그룹 · 현재 화면 묶음은 재접속 시 저장되지 않습니다.</span></div>
    <nav className="flow-group-breadcrumb" aria-label="그룹 탐색 경로"><button type="button" onClick={state.resetFocus}>전체 흐름</button>{state.breadcrumb.map(group => <span key={group.key}> / <button type="button" onClick={() => state.enter(group.key)} aria-current={state.activeFocus === group.key ? "location" : undefined}>{group.label}</button></span>)}
      {state.activeFocus && <button type="button" onClick={() => { const parent = state.groupByKey.get(state.activeFocus!)?.parentKey; if (parent) state.enter(parent); else state.resetFocus(); }}>상위 묶음</button>}</nav>
    {state.formOpen && <form className="flow-bundle-form" onSubmit={event => { event.preventDefault(); state.createBundle(); }}><label>화면 묶음 이름<input maxLength={80} value={state.label} onChange={event => state.setLabel(event.target.value)} required /></label>
      <fieldset><legend>묶을 업무 선택 · 두 개 이상</legend>{state.availableTasks.map(task => <label key={task.key}><input type="checkbox" checked={state.taskKeys.has(task.key)} disabled={state.occupied.has(task.key)} onChange={event => state.setTaskKeys(previous => { const next = new Set(previous); if (event.target.checked) next.add(task.key); else next.delete(task.key); return next; })} />{task.label}{state.occupied.has(task.key) ? " · 다른 화면 묶음에 포함" : ""}</label>)}</fieldset>
      <p>현재 화면의 탐색용 묶음입니다. 원본 업무·배정·의존성은 변경하지 않습니다.</p><button type="submit" disabled={!state.label.trim() || state.taskKeys.size < 2}>화면 묶음 생성</button><button type="button" onClick={() => state.setFormOpen(false)}>닫기</button></form>}
    {!!state.validBundles.length && <div className="flow-bundle-list" aria-label="현재 화면 업무 묶음">{state.validBundles.map(bundle => <div key={bundle.key}><button type="button" onClick={() => state.enter(bundle.key)}>{bundle.label}</button><button type="button" aria-label={`${bundle.label} 화면 묶음 해제`} onClick={() => state.removeBundle(bundle.key)}>해제</button></div>)}</div>}
    {!!state.projection.groups.length && <details className="flow-group-list"><summary>그룹 목록으로 탐색 · {state.projection.groups.length}개</summary>{state.projection.groups.map(group => <div key={group.key}><button type="button" onClick={() => { state.enter(group.key); }}>{group.label}</button><small>{kindNames[group.kind] ?? group.kind} · {summary(group)}</small></div>)}</details>}
    {!!state.projection.invalidGroups.length && <p role="status">소속을 확정할 수 없는 그룹 {state.projection.invalidGroups.length}개는 만들지 않고 개별 항목을 유지했습니다.</p>}
  </section>;
}

export function FlowGroupInspector({ group, state, nodes, edges }: { group: FlowGroupSummary; state: Grouping; nodes: MissionNode[]; edges: MissionEdge[] }) {
  const members = new Set(group.leafKeys);
  const internal = edges.filter(edge => members.has(edge.from) && members.has(edge.to));
  const boundary = edges.filter(edge => members.has(edge.from) !== members.has(edge.to));
  const name = (key: string) => nodes.find(node => node.key === key)?.label ?? key;
  return <><small>{kindNames[group.kind] ?? group.kind} · {basisNames[group.basis]}</small><h3>{group.label}</h3><p>{group.description}</p>
    <div className="flow-group-inspector-actions"><button type="button" onClick={() => state.toggle(group.key)}>{state.collapsed.has(group.key) ? "이 그룹 펼치기" : "이 그룹 접기"}</button><button type="button" onClick={() => state.enter(group.key)}>내부 흐름 보기</button></div>
    <p>{summary(group)}</p>
    <FlowGroupContextDetails group={group} state={state} nodes={nodes} edges={edges} />
    <details><summary>소속·관계 근거</summary><dl><div><dt>소속 근거</dt><dd>{basisNames[group.basis]}</dd></div><div><dt>출처</dt><dd>{group.sourceId === "visual-group" ? "현재 화면의 사용자 묶음" : group.sourceId}</dd></div><div><dt>내부 / 경계 관계</dt><dd>{group.internalEdges} / {group.boundaryEdges}건</dd></div><div><dt>의존 관계 순환</dt><dd>{group.cyclicMembers ? `${group.cyclicMembers}개 항목` : "현재 내부 근거에서 발견되지 않음"}</dd></div></dl></details>
    <p>Run 종료·업무 상태·검증·수용은 각각 별도입니다. 그룹을 접어도 원본 관계와 실행 근거는 보존합니다.</p>
    <details><summary>구성 항목 · {group.leafKeys.length}개</summary>{nodes.filter(node => members.has(node.key)).map(node => <button type="button" className="flow-list-choice" key={node.key} onClick={() => state.revealNode(node.key)}><strong>{node.label}</strong><span>{countNames[node.kind] ?? node.kind} · {groupStatusLabel(node.kind, node.status)} · {node.sourceId}</span></button>)}</details>
    {([["내부 관계", internal], ["경계 관계", boundary]] as const).map(([label, values]) => <details key={label}><summary>{label} · {values.length}건</summary>{values.map(edge => <button type="button" className="flow-list-choice" key={edge.key} onClick={() => state.revealEdge(edge.key)}><strong>{edge.label}</strong><span>{name(edge.from)} → {name(edge.to)}</span></button>)}</details>)}
  </>;
}

function GroupEvidenceChoices({ children }: { children: ReactNode[] }) {
  return <>{children.slice(0, 6)}{children.length > 6 && <details><summary>나머지 근거 {children.length - 6}개 보기</summary>{children.slice(6)}</details>}</>;
}

function FlowGroupContextDetails({ group, state, nodes, edges }: { group: FlowGroupSummary; state: Grouping; nodes: MissionNode[]; edges: MissionEdge[] }) {
  const context = flowGroupContext(group, nodes, edges, state.partial);
  const nodeByKey = new Map(nodes.map(node => [node.key, node]));
  const concernNames = { approval_wait: "승인 대기", runtime_wait: "연결·런타임 대기", failed: "실패 관측", review: "업무 검토" };
  const directionNames = { incoming: "외부 선행 → 내부 업무", outgoing: "내부 업무 → 외부 후속", internal: "묶음 내부 선행 관계" };
  const artifactNames = { output: "Run 결과 관계", association: "Run 귀속 참조", reference: "관측 참조" };
  return <section className="flow-group-context" aria-label="그룹 관측 요약">
    <h4>단위별 상태</h4>
    <p>{context.partial ? "부분 관측 · " : "현재 조회 범위 · "}{context.memberCount}개 구성 항목. 단위별 상태를 따로 집계합니다.</p>
    {context.statusByKind.length ? <dl className="flow-group-statuses">{context.statusByKind.map(row => <div key={row.kind}><dt>{row.kind === "run" ? "Run" : countNames[row.kind] ?? row.kind}</dt><dd>{row.states.map(item => `${groupStatusLabel(row.kind, item.state)} ${item.count}`).join(" · ")}</dd></div>)}</dl> : <p>실행·업무 상태를 집계할 원본 항목이 없습니다.</p>}
    <h4>대기·실패·검토 · {context.concerns.length}건</h4>
    {context.concerns.length ? <GroupEvidenceChoices>{context.concerns.map(item => { const node = nodeByKey.get(item.nodeKey)!; return <button key={item.nodeKey} type="button" className="flow-list-choice" onClick={() => state.revealNode(item.nodeKey)}><strong>{concernNames[item.kind]} · {node.label}</strong><span>{countNames[node.kind] ?? node.kind} · {groupStatusLabel(node.kind, node.status)} · {node.sourceId}</span></button>; })}</GroupEvidenceChoices> : <p>현재 구성에서 명시적으로 관측된 항목이 없습니다. 전체 업무의 대기 여부는 미확인입니다.</p>}
    <h4>선행·후속 업무 · {context.dependencies.length}건</h4>
    {context.dependencies.length ? <><p>원본 의존 관계와 현재 업무 상태입니다. 실행 차단 여부나 수용 판정을 뜻하지 않습니다.</p><GroupEvidenceChoices>{context.dependencies.map(item => { const from = nodeByKey.get(item.fromKey)!, to = nodeByKey.get(item.toKey)!; return <button key={item.edgeKey} type="button" className="flow-list-choice" onClick={() => state.revealEdge(item.edgeKey)}><strong>{from.label} → {to.label}</strong><span>{directionNames[item.direction]} · {groupStatusLabel(from.kind, from.status)} → {groupStatusLabel(to.kind, to.status)}</span></button>; })}</GroupEvidenceChoices></> : <p>현재 조회 범위에서 연결된 업무 의존 관계가 없습니다. 누락된 선행 조건은 확인할 수 없습니다.</p>}
    <h4>산출물 근거 · {context.artifacts.length}개</h4>
    {context.artifacts.length ? <><p>관측된 metadata와 Run 관계입니다. 파일 내용 검증·업무 수용은 별도입니다.</p><GroupEvidenceChoices>{context.artifacts.map(item => { const node = nodeByKey.get(item.nodeKey)!; return <button key={item.nodeKey} type="button" className="flow-list-choice" onClick={() => state.revealNode(item.nodeKey)}><strong>{node.label}</strong><span>{artifactNames[item.relationship]} · {node.sourceId}</span></button>; })}</GroupEvidenceChoices></> : <p>이 묶음에서 관측한 산출물 metadata가 없습니다.</p>}
    <h4>목적·입력·수용 조건</h4><p>현재 읽기 계약에는 원본 목적·입력·수용 조건이 제공되지 않습니다. 업무 제목·화면 묶음 이름은 위 구성에서 확인할 수 있습니다.</p>
  </section>;
}

export function FlowGroupEdgeEvidence({ edgeKey, state, nodes }: { edgeKey: string; state: Grouping; nodes: MissionNode[] }) {
  const originals = state.projection.edgeEvidence.get(edgeKey);
  if (!originals?.length || originals.length === 1 && originals[0]?.key === edgeKey) return null;
  const name = (key: string) => nodes.find(node => node.key === key)?.label ?? key;
  return <details className="flow-group-edge-evidence" open><summary>대표선의 원본 관계 · {originals.length}건</summary>
    <p>경계 사이의 표시를 묶었습니다. 관계 종류·방향·출처와 원본 근거는 각각 유지합니다.</p>
    {originals.map(edge => <div key={edge.key}><strong>{edge.label}</strong><p>{name(edge.from)} → {name(edge.to)}</p>
      <small>{edge.kind} · {edge.sourceId} · {edge.sequences.length ? `seq ${edge.sequences.join(", ")}` : "명시된 소속·업무 연결"}</small>
      <button className="flow-list-choice" type="button" onClick={() => state.revealEdge(edge.key)}>원본 관계 상세 보기</button></div>)}
  </details>;
}
