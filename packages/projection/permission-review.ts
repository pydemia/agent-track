import type { PermissionView } from "../contracts/index.ts";

export function currentPermissionReview(listed: PermissionView, reviewed: PermissionView, now: number): boolean {
  return listed.id === reviewed.id && listed.runId === reviewed.runId && listed.fingerprint === reviewed.fingerprint &&
    listed.status === "pending" && reviewed.status === "pending" &&
    Date.parse(listed.expiresAt) > now && Date.parse(reviewed.expiresAt) > now;
}
