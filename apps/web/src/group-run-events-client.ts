import { z } from "zod";
import { eventSchema, idSchema, sequenceSchema, timestampSchema, type EventView, type RunView } from "../../../packages/contracts/index.ts";

const pageSchema = z.object({ events: z.array(eventSchema.extend({ key: idSchema, receivedAt: timestampSchema }).strict()).max(2000),
  nextCursor: sequenceSchema, hasMore: z.boolean() }).strict();
export interface GroupRunEventsPage { events: EventView[]; nextCursor: string; hasMore: boolean }
export class GroupRunEventsError extends Error {
  constructor(readonly kind: "unauthorized" | "unavailable" | "failure") {
    super(kind === "unauthorized" ? "실행 조회 권한이 해제되었습니다." : kind === "unavailable" ? "선택한 실행 범위를 확인할 수 없습니다." : "실행 근거를 확인할 수 없습니다.");
  }
}

export async function fetchGroupRunEvents(run: Pick<RunView, "key" | "sourceId" | "runId">, after: string | null,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<GroupRunEventsPage> {
  if (!idSchema.safeParse(run.key).success || after !== null && !sequenceSchema.safeParse(after).success) throw new GroupRunEventsError("failure");
  const controller = new AbortController(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined; let finished = false;
  const cleanup = () => { controller.abort(); if (reader) void reader.cancel().catch(() => {}); else if (response?.body) void response.body.cancel().catch(() => {}); };
  let rejectBoundary: (reason: Error) => void = () => {};
  const boundary = new Promise<never>((_, reject) => { rejectBoundary = reject; });
  const abort = () => { cleanup(); rejectBoundary(new GroupRunEventsError("failure")); };
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 4000);
  const work = async () => {
    if (signal.aborted) throw new GroupRunEventsError("failure");
    response = await fetcher(`/api/runs/${encodeURIComponent(run.key)}/events${after === null ? "" : `?after=${encodeURIComponent(after)}`}`,
      { signal: controller.signal, redirect: "error", credentials: "same-origin", cache: "no-store" });
    if (finished || controller.signal.aborted) { cleanup(); throw new GroupRunEventsError("failure"); }
    if (response.status === 401 || response.status === 403) throw new GroupRunEventsError("unauthorized");
    if (response.status === 404) throw new GroupRunEventsError("unavailable");
    if (!response.ok || !response.body) throw new GroupRunEventsError("failure");
    reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const next = await reader.read();
      if (finished || controller.signal.aborted) throw new GroupRunEventsError("failure");
      if (next.done) break;
      size += next.value.length;
      if (size > 1024 * 1024) throw new GroupRunEventsError("failure");
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const page = pageSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    const seen = new Set<string>(); let sequence = BigInt(after ?? "0");
    for (const event of page.events) {
      if (event.sourceId !== run.sourceId || event.runId !== run.runId || seen.has(event.key) || BigInt(event.sequence) <= sequence) throw new GroupRunEventsError("failure");
      seen.add(event.key); sequence = BigInt(event.sequence);
    }
    if (BigInt(page.nextCursor) < sequence || page.hasMore && BigInt(page.nextCursor) <= BigInt(after ?? "0")) throw new GroupRunEventsError("failure");
    return page;
  };
  try { return await Promise.race([work(), boundary]); }
  catch (error) { throw error instanceof GroupRunEventsError ? error : new GroupRunEventsError("failure"); }
  finally { finished = true; clearTimeout(timer); signal.removeEventListener("abort", abort); cleanup(); }
}
