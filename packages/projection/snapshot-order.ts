import type { Snapshot } from "../contracts/index.ts";

// A projection version belongs to one BFF process, not a native event stream.
// Older HTTP/SSE responses must not restore metadata hidden by a newer grant read.
export class SnapshotOrder {
  private epoch: string | null = null;
  private version = "0";
  private retired = new Set<string>();

  accept(snapshot: Pick<Snapshot, "viewEpoch" | "viewVersion">): boolean {
    if (!snapshot.viewEpoch || !/^[1-9][0-9]*$/.test(snapshot.viewVersion)) return false;
    if (this.retired.has(snapshot.viewEpoch)) return false;
    if (snapshot.viewEpoch === this.epoch) {
      const compared = snapshot.viewVersion.length - this.version.length ||
        (snapshot.viewVersion < this.version ? -1 : snapshot.viewVersion > this.version ? 1 : 0);
      if (compared <= 0) return false;
    } else {
      if (this.epoch) this.retired.add(this.epoch);
      this.epoch = snapshot.viewEpoch;
    }
    this.version = snapshot.viewVersion;
    return true;
  }
}
