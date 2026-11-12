import type { ApiProcessSnapshot } from "./windows-api-process.mjs";
import type { PublicWebInspection } from "./recover-webs.mjs";

export function inspectOwnedWeb(record: ApiProcessSnapshot, port: number, otherRecord?: ApiProcessSnapshot): Promise<PublicWebInspection>;
export function stopOwnedWeb(record: ApiProcessSnapshot, port: number): Promise<{ state: "stopped" | "exited" }>;
