import type { RelationKind, RelationView, RunView } from "../contracts/index.ts";

export interface GraphNode {
  key: string;
  kind: string;
  id: string;
  label: string;
  runKey?: string;
}
export interface GraphEdge { key: string; from: string; to: string; kind: RelationKind | "context" }
export interface ExecutionGraph { nodes: GraphNode[]; edges: GraphEdge[] }
const entityKey = (source: string, entity: string) => JSON.stringify([source, entity]);

// Context edges express observed ownership only. They are never runtime parent/child evidence.
export function executionGraph(selected: RunView, runs: RunView[], relations: RelationView[]): ExecutionGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const node = (entity: string): string => {
    const key = entityKey(selected.sourceId, entity);
    if (nodes.has(key)) return key;
    const split = entity.indexOf(":");
    const kind = split < 0 ? "unknown" : entity.slice(0, split);
    const id = split < 0 ? entity : entity.slice(split + 1);
    const observed = kind === "run" ? [selected, ...runs].find((run) => run.sourceId === selected.sourceId && run.runId === id) : undefined;
    const label = observed ? observed.title || observed.runId : kind === "session" && id === selected.sessionId ? selected.title || id : id;
    nodes.set(key, { key, kind, id, label, ...(observed ? { runKey: observed.key } : {}) });
    return key;
  };
  const edge = (from: string, to: string, kind: GraphEdge["kind"]) => {
    const key = JSON.stringify([from, to, kind]);
    edges.set(key, { key, from: node(from), to: node(to), kind });
  };
  const root = `run:${selected.runId}`;
  node(root);
  edge(`session:${selected.sessionId}`, root, "context");
  if (selected.workspaceId) edge(`workspace:${selected.workspaceId}`, `session:${selected.sessionId}`, "context");
  for (const relation of relations) if (relation.runKey === selected.key) edge(relation.from, relation.to, relation.kind);
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export interface GraphAnalysis { components: string[][]; cyclic: Set<string>; isolated: Set<string>; layers: Map<string, number> }

// Iterative Kosaraju avoids recursion limits for large or cyclic source graphs.
export function analyseGraph(graph: ExecutionGraph): GraphAnalysis {
  const forward = new Map(graph.nodes.map((node) => [node.key, [] as string[]]));
  const reverse = new Map(graph.nodes.map((node) => [node.key, [] as string[]]));
  const degree = new Map(graph.nodes.map((node) => [node.key, 0]));
  for (const edge of graph.edges) {
    if (!forward.has(edge.from) || !forward.has(edge.to)) continue;
    forward.get(edge.from)!.push(edge.to); reverse.get(edge.to)!.push(edge.from);
    degree.set(edge.from, degree.get(edge.from)! + 1); degree.set(edge.to, degree.get(edge.to)! + 1);
  }
  const visited = new Set<string>();
  const order: string[] = [];
  for (const node of graph.nodes) {
    const stack: [string, boolean][] = [[node.key, false]];
    while (stack.length) {
      const [key, finishing] = stack.pop()!;
      if (finishing) { order.push(key); continue; }
      if (visited.has(key)) continue;
      visited.add(key); stack.push([key, true]);
      for (const next of forward.get(key)!) if (!visited.has(next)) stack.push([next, false]);
    }
  }
  const components: string[][] = [];
  const componentFor = new Map<string, number>();
  for (const root of order.reverse()) {
    if (componentFor.has(root)) continue;
    const index = components.length;
    const component: string[] = [];
    const stack = [root]; componentFor.set(root, index);
    while (stack.length) {
      const key = stack.pop()!; component.push(key);
      for (const previous of reverse.get(key)!) if (!componentFor.has(previous)) { componentFor.set(previous, index); stack.push(previous); }
    }
    components.push(component);
  }
  const cyclic = new Set(components.flatMap((component) => component.length > 1 || forward.get(component[0]!)!.includes(component[0]!) ? component : []));
  const isolated = new Set([...degree].filter(([, count]) => count === 0).map(([key]) => key));
  const successors = components.map(() => new Set<number>());
  const incoming = components.map(() => 0);
  const ranks = components.map(() => 0);
  for (const edge of graph.edges) {
    const from = componentFor.get(edge.from); const to = componentFor.get(edge.to);
    if (from === undefined || to === undefined || from === to || successors[from]!.has(to)) continue;
    successors[from]!.add(to); incoming[to]!++;
  }
  const queue = incoming.flatMap((count, index) => count === 0 ? [index] : []);
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i]!;
    for (const to of successors[from]!) {
      ranks[to] = Math.max(ranks[to]!, ranks[from]! + 1);
      incoming[to]!--; if (incoming[to] === 0) queue.push(to);
    }
  }
  return { components, cyclic, isolated, layers: new Map(graph.nodes.map((node) => [node.key, ranks[componentFor.get(node.key)!]!])) };
}
