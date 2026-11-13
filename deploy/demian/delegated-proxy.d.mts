import type { IncomingMessage, ServerResponse } from "node:http";

/** Upstream must authenticate the signed scope, current binding and nonce. */
export function createDelegatedProxy(options: {
  hostname: string;
  organizationId: string;
  upstreamPort: number;
  resolveBearer: () => Promise<string | null>;
  timeoutMs?: number;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
