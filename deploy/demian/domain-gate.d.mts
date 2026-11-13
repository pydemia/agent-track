import type { IncomingMessage, ServerResponse } from "node:http";
export function createDomainGate(options: {
  hostname: string;
  webPort: number;
  login: { username: string; password: string };
  delegated?: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
}): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
