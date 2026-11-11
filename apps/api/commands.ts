import { CommandError, type CancelPorts } from "../../packages/commands/index.ts";
import { DemianClient } from "../../packages/adapters/demian/index.ts";
import type { RunView, Snapshot } from "../../packages/contracts/index.ts";
import { runSchema } from "../../packages/contracts/index.ts";
import type { Store } from "../../packages/storage/store.ts";
import type { Config, SourceConfig } from "./config.ts";

export function commandPorts(store: Store, config: () => Config, snapshot: (user: string) => Snapshot,
  user: string, runKey: string, writing: boolean, refreshGrants: () => Promise<void> = async () => {}): CancelPorts {
  const authorized = (): { run: RunView; source: SourceConfig } => {
    const current = config();
    if (current.auth.mode === "proxy" ? !current.auth.users.includes(user) : current.auth.user !== user) {
      throw new CommandError(403, "source_forbidden", "Current user access is unavailable.");
    }
    const run = snapshot(user).runs.find((item) => item.key === runKey);
    const source = current.sources.find((item) => item.id === run?.sourceId);
    if (!run || !source || source.kind !== "demian" || !source.baseUrl || !source.users.includes(user) || run.sourceState !== "connected") {
      throw new CommandError(403, "source_forbidden", "Current source access is unavailable.");
    }
    if (writing && (current.auth.mode !== "proxy" || current.auth.users.length !== 1 || current.auth.users[0] !== user ||
        !source.cancelUsers?.includes(user) || !run.capabilities.includes("run.cancel"))) {
      throw new CommandError(403, "cancel_not_enabled", "Cancel requires an explicit single-owner native grant.");
    }
    return { run, source };
  };
  const client = (source: SourceConfig) => new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl!,
    ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}),
    ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
    ...(source.organizationId ? { organizationId: source.organizationId } : {}) });
  return {
    async authorize() { await refreshGrants(); authorized(); },
    async readRun() {
      await refreshGrants();
      const { run, source } = authorized();
      const observed = await client(source).observe(run.runId);
      await refreshGrants();
      authorized();
      store.observeRun(observed);
      return { sourceId: source.id, runId: observed.runId, status: observed.status,
        cursor: store.cursor(source.id, observed.runId) };
    },
    async cancel(runId) {
      if (!writing) throw new CommandError(403, "read_only_receipt", "Receipt reconciliation cannot dispatch commands.");
      const { run, source } = authorized();
      if (runId !== run.runId) throw new CommandError(409, "run_identity_mismatch", "Cancel target did not match the tracked Run.");
      const result = await client(source).cancel(runId);
      const row = store.run(runKey);
      if (row) {
        const previous = runSchema.parse(JSON.parse(row.observation));
        // Source acknowledges the status. Completion time remains unknown until its next snapshot.
        store.observeRun({ ...previous, status: result.status, observedAt: new Date().toISOString() });
      }
      return { sourceId: source.id, ...result };
    },
  };
}
