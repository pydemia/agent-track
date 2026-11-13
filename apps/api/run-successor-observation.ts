import type { SuccessorCommands } from "../../packages/commands/run-successors.ts";
import type { Snapshot, RunView } from "../../packages/contracts/index.ts";
import { nativeCommandLinkSchema, type NativeCommandLink } from "../../packages/contracts/native-command-observation.ts";
import type { Config } from "./config.ts";
import { sourceIdentity } from "./source-identity.ts";

/** Current owner and Run grants intersect an immutable, previously admitted receipt. */
export function projectSuccessorSnapshot(snapshot: Snapshot, config: Config, journal: SuccessorCommands): Snapshot {
  const window = journal.acceptedObservations(snapshot.user);
  const derived = snapshot.runs.some(run => run.nativeCommandLink) || snapshot.sources.some(source =>
    typeof source.detail === "string" && source.detail.includes("\n후속 명령 관계: 소유자 원장"));
  // A metadata overlay has no work in a legacy/project-only snapshot. Preserve
  // its exact existing scope rather than introducing unrelated source reads.
  if (!window.observations.length && !window.incomplete && !derived) return snapshot;
  const base = snapshot.runs.map(run => { const { nativeCommandLink: _link, ...value } = run; return value; });
  const cleanSources = snapshot.sources.map(source => typeof source.detail === "string"
    ? { ...source, detail: source.detail.replace(/\n후속 명령 관계: 소유자 원장.*$/su, "") } : source);
  const root = config.auth.mode === "proxy" ? config.auth.users.includes(snapshot.user) : config.auth.user === snapshot.user;
  if (!root) return { ...snapshot, runs: base, sources: cleanSources };
  const byTarget = new Map<string, typeof window.observations>();
  for (const observation of window.observations) {
    const source = config.sources.find(source => source.id === observation.sourceId);
    if (!source || source.kind !== "demian" || source.assistantNativeSourceId || !source.users.includes(snapshot.user) ||
        sourceIdentity(source) !== observation.sourceIdentity) continue;
    const key = JSON.stringify([source.id, observation.receipt.new_run_id]);
    const rows = byTarget.get(key) ?? []; rows.push(observation); byTarget.set(key, rows);
  }
  const source = (id: string) => {
    const matches = snapshot.sources.filter(source => source.id === id);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const visible = (run: RunView) => {
    const native = source(run.sourceId), binding = run.binding;
    const project = binding ? source(binding.projectSourceId) : undefined;
    return run.sourceState === "connected" && !run.stale && native?.kind === "demian" && native.state === "connected" &&
      (!native.authorizedRunIds || native.authorizedRunIds.includes(run.runId)) && (!binding ||
        binding.sourceId === run.sourceId && binding.runId === run.runId && project?.kind === "projects" &&
        project.state === "connected" && project.authorizedProjectIds?.includes(binding.projectId));
  };
  const exact = (sourceId: string, runId: string, sessionId: string, workspaceId: string | null) => {
    const rows = base.filter(run => run.sourceId === sourceId && run.runId === runId);
    const run = rows.length === 1 ? rows[0] : undefined;
    return run && run.sessionId === sessionId && run.workspaceId === workspaceId && visible(run) ? run : undefined;
  };
  const runs = base.map(run => {
    const rows = byTarget.get(JSON.stringify([run.sourceId, run.runId]));
    if (!rows?.length) return run;
    const unavailable = (reason: Extract<NativeCommandLink, { state: "unavailable" }>["reason"]): RunView =>
      ({ ...run, nativeCommandLink: { state: "unavailable", reason } });
    if (rows.length !== 1 || base.filter(row => row.key === run.key || row.sourceId === run.sourceId && row.runId === run.runId).length !== 1)
      return unavailable("ambiguous-receipt");
    if (!visible(run)) return unavailable("source-unavailable");
    const receipt = rows[0]!.receipt;
    if (run.sessionId !== receipt.session_id) return unavailable("ambiguous-receipt");
    if (!exact(run.sourceId, receipt.source_run_id, receipt.session_id, run.workspaceId)) return unavailable("predecessor-unavailable");
    const root = exact(run.sourceId, receipt.task_root_run_id!, receipt.session_id, run.workspaceId);
    return { ...run, nativeCommandLink: nativeCommandLinkSchema.parse({ state: "observed", receipt: {
      commandId: receipt.command_id, kind: receipt.kind, sourceRunId: receipt.source_run_id, targetRunId: run.runId,
      sessionId: receipt.session_id, rootRunId: root?.runId ?? null, relation: receipt.relation,
      acceptedAt: receipt.created_at, provenance: "native-command-receipt",
    } }) };
  });
  const sources = cleanSources.map(source => {
    const configured = config.sources.find(value => value.id === source.id);
    if (!configured || !configured.users.includes(snapshot.user) || source.kind !== "demian" || source.state !== "connected" || typeof source.detail !== "string" ||
        configured.assistantNativeSourceId || !window.observations.length && !window.incomplete) return source;
    const detail = source.detail.replace(/\n후속 명령 관계: 소유자 원장.*$/su, "");
    return { ...source, detail: `${detail}\n후속 명령 관계: 소유자 원장 최근 1000건·현재 인가된 전후 Run${window.incomplete ? "·일부 제외" : ""}. 접수와 실행 성공은 별도입니다.` };
  });
  return { ...snapshot, runs, sources };
}
