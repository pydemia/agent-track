import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import type { Config } from "./config.ts";

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return typeof value === "string" ? value : "";
}
export function sameSecret(actual: string, expected: string): boolean {
  return !!actual && expected.length >= 32 && timingSafeEqual(
    createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest(),
  );
}
export function authenticate(request: IncomingMessage, config: Config): string | null {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")) return null;
  if (config.auth.mode === "local") {
    const host = header(request, "host");
    // Explicit development mode never trusts public Host/forwarded identity.
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host) || header(request, "x-forwarded-host")) return null;
    return config.auth.user;
  }
  const secret = readFileSync(config.auth.secretFile, "utf8").trim();
  if (!sameSecret(header(request, "x-track-proxy-key"), secret)) return null;
  const user = header(request, "x-forwarded-email").toLowerCase();
  return config.auth.users.includes(user) ? user : null;
}
export function validMutationOrigin(request: IncomingMessage, config: Config): boolean {
  const origin = header(request, "origin");
  return origin === new URL(config.publicOrigin).origin && header(request, "sec-fetch-site") !== "cross-site";
}
