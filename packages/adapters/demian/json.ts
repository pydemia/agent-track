/** Bounded JSON metadata transport shared by Demian read contracts. */
export async function readBoundedNativeJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const failure = () => new Error("Invalid native metadata response");
  try {
    if (signal?.aborted || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" || !response.body) throw failure();
    reader = response.body.getReader();
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => reject(failure()); signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(onAbort, 10_000); if (signal?.aborted) onAbort();
    });
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0, text = ""; const deadline = Date.now() + 10_000;
    while (true) {
      if (signal?.aborted || Date.now() >= deadline) throw failure();
      const { value, done } = await Promise.race([reader.read(), stopped]); if (done) break;
      if (!(value instanceof Uint8Array)) throw failure(); size += value.byteLength;
      if (size > 1_048_576) throw failure(); text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode(); const value: unknown = JSON.parse(text);
    if (signal?.aborted || Date.now() >= deadline) throw failure(); return value;
  } catch { throw failure(); }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    else if (response.body && !response.body.locked) void response.body.cancel().catch(() => {});
  }
}
