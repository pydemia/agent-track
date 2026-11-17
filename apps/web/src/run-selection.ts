import type { RunView, SourceView } from "../../../packages/contracts/index.ts";

export type SelectionSnapshot = {
  sources: ReadonlyArray<Pick<SourceView, "id" | "state">>;
  runs: ReadonlyArray<Pick<RunView, "key" | "sourceId">>;
};

function selectedSource(key: string): string | null {
  if (!key || key.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(key)) return null;
  try {
    const bytes = Uint8Array.from(atob(key.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
    const tuple: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return Array.isArray(tuple) && tuple.length === 2 && typeof tuple[0] === "string"
      && /^[a-z0-9_-]{1,80}$/.test(tuple[0]) && typeof tuple[1] === "string" && tuple[1].length > 0
      ? tuple[0] : null;
  } catch { return null; }
}

/** Retain only an identifier during a transport outage; metadata always comes from the new snapshot. */
export function reconcileRunSelection(key: string, snapshot: SelectionSnapshot, actorChanged: boolean): string {
  if (!key || actorChanged) return "";
  const run = snapshot.runs.find(run => run.key === key);
  const sourceId = run?.sourceId ?? selectedSource(key);
  const source = snapshot.sources.find(source => source.id === sourceId);
  if (!source || source.state === "forbidden" || source.state === "unsupported") return "";
  return run || source.state === "disconnected" ? key : "";
}
