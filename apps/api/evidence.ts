import { DemianClient, SourceError, type DemianOptions } from "../../packages/adapters/demian/index.ts";
import { CommandError } from "../../packages/commands/index.ts";
import type { ArtifactEvidence, Snapshot } from "../../packages/contracts/index.ts";
import { parseArtifactEvidence } from "../../packages/contracts/artifacts.ts";
import type { Config } from "./config.ts";
import { sourceIdentity } from "./source-identity.ts";
import { sourceCredentialStamp } from "./source-credential.ts";

type Reader = Pick<DemianClient, "observe" | "artifacts">;
export interface ArtifactReadOptions { signal?: AbortSignal; timeoutMs?: number; factory?: (options: DemianOptions) => Reader }

export async function artifactEvidence(config: () => Config, snapshot: (user: string) => Snapshot, user: string, runKey: string,
  refreshGrants: () => Promise<void> = async () => {}, options: ArtifactReadOptions = {}): Promise<ArtifactEvidence> {
  const timeout = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 10_000) throw new Error("Invalid artifact read deadline");
  const deadline = performance.now() + timeout;
  const unavailable = () => new CommandError(404, "run_not_found", "현재 접근 가능한 실행이 아닙니다.");
  const authorized = () => {
    const current = config(), view = snapshot(user);
    if (!(current.auth.mode === "proxy" ? current.auth.users.includes(user) : current.auth.user === user)) {
      throw new CommandError(403, "source_forbidden", "현재 접근 권한을 확인할 수 없습니다.");
    }
    const run = view.runs.find(item => item.key === runKey);
    const source = current.sources.find(item => item.id === run?.sourceId && item.users.includes(user));
    if (!run || !source) throw unavailable();
    const connected = run.sourceState === "connected" && !run.stale && view.sources.some(item =>
      item.id === source.id && item.kind === source.kind && item.state === "connected");
    const binding = run.binding;
    if (binding && (!connected || binding.sourceId !== run.sourceId || binding.runId !== run.runId ||
      !view.sources.some(item => item.id === binding.projectSourceId && item.kind === "projects" && item.state === "connected" && item.authorizedProjectIds?.includes(binding.projectId)))) throw unavailable();
    return { run, source: structuredClone(source), connected,
      stamp: JSON.stringify([sourceIdentity(source), source.tokenFile, source.credentialFormat, source.users, current.auth, run.runId, run.sessionId, binding]) };
  };
  const initial = authorized(), { run, source } = initial;
  const empty = (state: ArtifactEvidence["state"], detail: string): ArtifactEvidence => ({
    state, runKey, observedAt: new Date().toISOString(), detail, artifacts: [], scanned: 0, limit: 100, complete: false,
  });
  if (source.kind !== "demian" || !source.baseUrl || source.assistantNativeSourceId) return empty("unsupported", "이 출처의 산출물 metadata 조회는 지원하지 않습니다.");
  if (!initial.connected) return empty("disconnected", "원본의 현재 접근을 확인한 후 산출물을 다시 조회합니다.");
  const controller = new AbortController(), signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - performance.now()));
  let stop!: () => void;
  const stopped = new Promise<never>((_, reject) => { stop = () => reject(new SourceError(503)); signal.addEventListener("abort", stop, { once: true }); });
  const guarded = async <T>(read: () => Promise<T>): Promise<T> => {
    if (signal.aborted || performance.now() >= deadline) throw new SourceError(503);
    const value = await Promise.race([read(), stopped]);
    if (signal.aborted || performance.now() >= deadline) throw new SourceError(503);
    return value;
  };
  try {
    await guarded(refreshGrants);
    const before = authorized(); if (before.stamp !== initial.stamp || !before.connected) throw unavailable();
    const credential = sourceCredentialStamp(source);
    const client = (options.factory ?? (settings => new DemianClient(settings)))({ sourceId: source.id, baseUrl: source.baseUrl,
      ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}), ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
      ...(source.organizationId ? { organizationId: source.organizationId } : {}), signal });
    const check = (observed: Awaited<ReturnType<Reader["observe"]>>) => {
      if (observed.runId !== run.runId || observed.sessionId !== run.sessionId) throw new SourceError(403);
    };
    check(await guarded(() => client.observe(run.runId)));
    const page = await guarded(() => client.artifacts(run.runId, run.sessionId));
    if (page.artifacts.some(item => item.runId !== run.runId || item.sessionId !== run.sessionId)) throw new SourceError(403);
    await guarded(refreshGrants);
    const refreshed = authorized();
    if (refreshed.stamp !== initial.stamp || !refreshed.connected || sourceCredentialStamp(refreshed.source) !== credential) throw unavailable();
    check(await guarded(() => client.observe(run.runId)));
    const final = authorized();
    if (final.stamp !== initial.stamp || !final.connected || sourceCredentialStamp(final.source) !== credential) throw unavailable();
    const result = parseArtifactEvidence({ ...page, state: "connected", runKey, observedAt: new Date().toISOString(),
      detail: "원본 세션의 최근100개 목록에서 이 Run의 미철회 metadata만 조회했습니다. 결과와 첨부 귀속을 구분하며 전체 과거 이력을 보장하지 않습니다." });
    if (signal.aborted || performance.now() >= deadline) throw new SourceError(503);
    return result;
  } catch (error) {
    if (error instanceof CommandError) throw error;
    authorized();
    return empty(error instanceof SourceError && [401, 403, 404].includes(error.status) ? "forbidden" : "disconnected",
      "산출물의 현재 원본 접근과 조회 범위를 확인하지 못해 이전 metadata를 숨깁니다.");
  } finally { clearTimeout(timer); signal.removeEventListener("abort", stop); }
}
