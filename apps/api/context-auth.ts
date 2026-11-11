import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import type { Config, ContextReader } from "./config.ts";
import { contextCredentialsSeparated, sameSecret } from "./auth.ts";

export function contextReaderStamp(reader: ContextReader): string {
  return createHash("sha256").update(JSON.stringify(reader)).digest("hex");
}

/** Private machine hop only. This credential cannot authenticate the web API. */
export function authenticateContextReader(request: IncomingMessage, config: Config): ContextReader | null {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")) return null;
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(String(request.headers.host ?? "")) ||
    ["origin", "x-forwarded-host", "x-forwarded-email", "x-track-proxy-key"].some((name) => request.headers[name] !== undefined)) return null;
  const id = request.headers["x-track-context-reader"];
  const authorization = request.headers.authorization;
  if (typeof id !== "string" || typeof authorization !== "string") return null;
  const token = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(authorization)?.[1];
  if (!token || config.auth.mode !== "proxy") return null;
  const reader = config.contextReaders?.find((item) => item.id === id && config.auth.mode === "proxy" && config.auth.users.includes(item.user));
  if (!reader) return null;
  try {
    const proxySecret = readFileSync(config.auth.secretFile, "utf8").replace(/^\uFEFF/, "").trim();
    if (!contextCredentialsSeparated(config, proxySecret)) return null;
    const secret = readFileSync(reader.secretFile, "utf8").replace(/^\uFEFF/, "").trim();
    return sameSecret(token, secret) ? reader : null;
  } catch { return null; }
}
