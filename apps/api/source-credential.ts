import { createHash } from "node:crypto";
import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { SourceError } from "../../packages/adapters/demian/index.ts";
import type { SourceConfig } from "./config.ts";

/** Private in-memory comparison only; never expose the credential or its stamp. */
export function sourceCredentialStamp(source: SourceConfig): string | null {
  if (!source.tokenFile) return null;
  const handle = openSync(source.tokenFile, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(handle);
    if (!stat.isFile() || stat.size > 65_536) throw new SourceError(503);
    const bytes = Buffer.alloc(65_537); let used = 0;
    while (used < bytes.length) { const count = readSync(handle, bytes, used, bytes.length - used, null); if (!count) break; used += count; }
    if (used > 65_536) throw new SourceError(503);
    return createHash("sha256").update(bytes.subarray(0, used)).digest("hex");
  } finally { closeSync(handle); }
}
