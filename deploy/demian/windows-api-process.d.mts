export type ApiProcessSnapshot = { pid: number; name: string; executable: string; created: string; command: string };
export type ApiListener = { address: string; port: number; pid: number };
export function inspectApiProcess(pid: number): Promise<ApiProcessSnapshot | null>;
export function apiListeners(port: number): Promise<ApiListener[]>;
