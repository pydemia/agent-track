export function readWebVerificationResponse(response: Response, limit: number): Promise<Buffer>;
export function publicWebLaunchPrerequisites(phase: "candidate" | "rollback", checks: { ownership: () => Promise<void>; preservation: () => Promise<void> }): Promise<void>;
export function preflightPublicWeb(inputFile: string, expectedSha256: string): Promise<unknown>;
export function executePublicWeb(inputFile: string, expectedSha256: string): Promise<{ committed: boolean; operationId: string; stage: string; [key: string]: unknown }>;
