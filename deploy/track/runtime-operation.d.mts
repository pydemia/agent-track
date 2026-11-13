export const trackRuntimeOperationSources: readonly string[];
export function validateTrackRuntimePlan(value: unknown, expected: {state: string; repository: string}): unknown;
export function trackPendingCommands(database: string): Record<string, number>;
export function assertTrackHistoryPreserved(database: string, backupFile: string, tableNames: string[], allowSaved: boolean): void;
export function runTrackRuntimePhase(phase: string, inputFile: string, inputSha: string): Promise<unknown>;
