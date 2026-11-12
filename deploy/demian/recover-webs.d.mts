type Profile = "local" | "public";
type WebRecord = { pid: number; [key: string]: unknown };
export function recoverWebProfiles(options: {
  replacements: Partial<Record<Profile, WebRecord>>; originals: Record<Profile, WebRecord>; stopped: Set<Profile>;
  activateFallback: () => Promise<void>; stop: (record: WebRecord) => Promise<unknown>;
  start: (profile: Profile) => Promise<WebRecord>; inspectOriginal: (record: WebRecord) => Promise<{ exited?: boolean }>;
  commitProfile: (profile: Profile, record: WebRecord) => Promise<void>;
}): Promise<{ recoveredIdentities: Partial<Record<Profile, WebRecord>>; failedProfiles: Profile[]; metadataUpdateFailures: Profile[] }>;

/** Inspection verifies the full frozen identity, including PID reuse, and public port ownership. */
export type PublicWebInspection =
  | { state: "owned-live" }
  | { state: "exited-free" }
  /** This record exited; only the other explicitly supplied live identity may own the port. */
  | { state: "exited-occupied"; listenerPid: number }
  | { state: "foreign" };
export function recoverPublicWeb<T extends WebRecord>(options: {
  original: T;
  /** Same-PID original/replacement records are rejected as ambiguous. */
  replacement?: T | undefined;
  journalIntent: (record: T) => Promise<void>;
  activateFallback: () => Promise<void>;
  inspect: (record: T) => Promise<PublicWebInspection>;
  /** Must enforce full identity ownership atomically before signaling. */
  stop: (record: T) => Promise<unknown>;
  /** Starts the explicitly frozen fallback independently of activation state; must preserve any racing foreign listener. */
  startFrozenFallback: () => Promise<T>;
  commitPublic: (record: T) => Promise<void>;
}): Promise<{
  recoveredIdentity?: T;
  activationFailed: boolean;
  recoveryFailed: boolean;
  metadataUpdateFailed: boolean;
}>;
