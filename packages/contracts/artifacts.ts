import { z } from "zod";
import type { ArtifactEvidence } from "./index.ts";

const uuid = z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
export const artifactMetadataSchema = z.strictObject({
  id: uuid, runId: uuid, sessionId: uuid, kind: z.enum(["attachment", "result"]),
  filename: z.string().min(1).max(256).refine(value => value.trim().length > 0 &&
    !/[\/\\\x00-\x1f\x7f]/.test(value) && ![".", ".."].includes(value)),
  mediaType: z.string().max(255).regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/),
  sizeBytes: z.number().int().min(0).max(8 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  representation: z.enum(["original", "extracted_text", "summary", "reference"]),
  createdAt: z.iso.datetime({ offset: true }),
});
export const artifactEvidenceSchema = z.strictObject({
  state: z.enum(["connected", "disconnected", "forbidden", "unsupported"]),
  runKey: z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/),
  observedAt: z.iso.datetime({ offset: true }), detail: z.string().min(1).max(1024),
  artifacts: z.array(artifactMetadataSchema).max(100), scanned: z.number().int().min(0).max(100),
  limit: z.literal(100), complete: z.literal(false),
}).refine(page => page.artifacts.length <= page.scanned &&
  new Set(page.artifacts.map(row => row.id.toLowerCase())).size === page.artifacts.length &&
  (page.state === "connected" || page.artifacts.length === 0 && page.scanned === 0));

export function parseArtifactEvidence(value: unknown): ArtifactEvidence {
  try { return artifactEvidenceSchema.parse(value); }
  catch { throw new Error("Invalid artifact metadata scope"); }
}
