type Profile = "local" | "public";
type WebRecord = { pid: number; [key: string]: unknown };
export function recoverWebProfiles(options: {
  replacements: Partial<Record<Profile, WebRecord>>; originals: Record<Profile, WebRecord>; stopped: Set<Profile>;
  activateFallback: () => Promise<void>; stop: (record: WebRecord) => Promise<unknown>;
  start: (profile: Profile) => Promise<WebRecord>; inspectOriginal: (record: WebRecord) => Promise<{ exited?: boolean }>;
  commitProfile: (profile: Profile, record: WebRecord) => Promise<void>;
}): Promise<{ recoveredIdentities: Partial<Record<Profile, WebRecord>>; failedProfiles: Profile[]; metadataUpdateFailures: Profile[] }>;
