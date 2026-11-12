import type { PublicWebInspection } from "./recover-webs.mjs";

export type { PublicWebInspection } from "./recover-webs.mjs";

export interface PublicWebRecovery<T extends { pid: number }> {
  recoveredIdentity?: T;
  activationFailed: boolean;
  recoveryFailed: boolean;
  metadataUpdateFailed: boolean;
}

export interface PublicWebTransitionResult<T extends { pid: number }> {
  /** Last transition stage, retained across recovery and reporting failures. */
  stage: string;
  committed: boolean;
  stopAttempted: boolean;
  replacement?: T;
  recovery?: PublicWebRecovery<T>;
  journalFailed: boolean;
  reportFailed: boolean;
  failure?: "invalid-original" | "transition-failed" | "reporting-failed";
}

export interface PublicWebTransitionOptions<T extends { pid: number }> {
  original: T;
  prepare: () => Promise<void>;
  /** Throw if any preserved resource changed. */
  checkPreserved: () => Promise<void>;
  /** Verify the full frozen identity and public port ownership. */
  inspect: (record: T) => Promise<PublicWebInspection>;
  /** Resolve only after the intent has been durably persisted. */
  journal: (stage: string, record?: T) => Promise<void>;
  /** Atomically enforce identity ownership before signaling. */
  stop: (record: T) => Promise<unknown>;
  startCandidate: () => Promise<T>;
  /** Reconcile this same operation's receipt; must not start another process. */
  findCandidate: () => Promise<T | undefined>;
  verifyCandidate: (record: T) => Promise<void>;
  commitCandidate: (record: T) => Promise<void>;
  /** Owns public port 3001 only; may reconcile receipts again if undefined. */
  recover: (replacement?: T) => Promise<PublicWebRecovery<T>>;
  report: (result: PublicWebTransitionResult<T>) => Promise<void>;
}

/** Invalid originals return before invoking any callback. No I/O at import. */
export function executePublicWebTransition<T extends { pid: number }>(
  options: PublicWebTransitionOptions<T>,
): Promise<PublicWebTransitionResult<T>>;
