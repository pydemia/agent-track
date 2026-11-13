import type { DatabaseSync } from 'node:sqlite';

export interface TrackDatabaseFingerprint {
  schemaSha256: string;
  tables: Array<{ name: string; count: number; sha256: string }>;
  sha256: string;
}

/** Caller owns the read transaction; fingerprints main schema and logical rows. */
export function trackDatabaseFingerprint(db: DatabaseSync): TrackDatabaseFingerprint;

/** Requires trusted stable directories and hardlink support; never overwrites.
 * Private local snapshot only, not encryption or off-machine restore validation.
 */
export function backupTrackDatabase(sourceFile: string, destinationFile: string): Promise<{
  fingerprint: TrackDatabaseFingerprint;
  integrityVerified: true;
  backupBytes: number;
}>;
