type ErrorKind = "unauthorized" | "unavailable" | "failure";
const messages = {
  unauthorized: "Authentication is required.",
  unavailable: "Metadata scope is unavailable.",
  failure: "Metadata could not be loaded.",
} as const;
export class PrivateReadError extends Error {
  constructor(public readonly kind: ErrorKind) {
    super(messages[kind]);
    this.name = "PrivateReadError";
  }
}

const deadlineMs = 12_000;
const bodyLimit = 2 * 1024 * 1024;

/** The boundary also settles custom transports that ignore AbortSignal. */
export async function fetchPrivateJson<T>(url: string, signal: AbortSignal,
  fetcher: typeof fetch, validate: (value: unknown) => T): Promise<T> {
  if (!url.startsWith("/api/") || /[\u0000-\u001f\u007f]/.test(url)) throw new PrivateReadError("failure");
  const controller = new AbortController();
  const deadline = performance.now() + deadlineMs;
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  const cancel = () => {
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
    else if (response?.body) void response.body.cancel().catch(() => {});
  };
  let rejectBoundary!: (error: PrivateReadError) => void;
  const boundary = new Promise<never>((_, reject) => { rejectBoundary = reject; });
  const abort = () => { cancel(); rejectBoundary(new PrivateReadError("failure")); };
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, deadlineMs);
  const check = () => {
    if (finished || signal.aborted || controller.signal.aborted || performance.now() >= deadline)
      throw new PrivateReadError("failure");
  };
  const work = async () => {
    check();
    response = await fetcher(url, { method: "GET", credentials: "same-origin",
      redirect: "error", signal: controller.signal });
    // A late response owns a new body even after the outer finally ran.
    try { check(); } catch (error) { cancel(); throw error; }
    if (response.status === 401) throw new PrivateReadError("unauthorized");
    if (response.status === 403 || response.status === 404)
      throw new PrivateReadError("unavailable");
    if (!response.ok) throw new PrivateReadError("failure");
    const contentType = response.headers.get("content-type");
    if (!contentType || !/^application\/json(?:\s*;[^\r\n]*)?$/i.test(contentType))
      throw new PrivateReadError("failure");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^[0-9]{1,10}$(?![\s\S])/.test(length) || Number(length) > bodyLimit))
      throw new PrivateReadError("failure");
    if (!response.body) throw new PrivateReadError("failure");
    const activeReader = response.body.getReader();
    reader = activeReader;
    // One fixed buffer bounds allocation even with millions of tiny chunks.
    const bytes = new Uint8Array(bodyLimit);
    let size = 0;
    try {
      while (true) {
        const result = await activeReader.read();
        check();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > bodyLimit) throw new PrivateReadError("failure");
        bytes.set(result.value, size - result.value.byteLength);
      }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true })
        .decode(bytes.subarray(0, size)));
      check();
      const validated = validate(value);
      check();
      return validated;
    } finally {
      void activeReader.cancel().catch(() => {});
      activeReader.releaseLock();
      reader = undefined;
    }
  };
  try { return await Promise.race([work(), boundary]); }
  catch (error) {
    // Never expose transport errors, response content or schema diagnostics.
    throw new PrivateReadError(error instanceof PrivateReadError ? error.kind : "failure");
  } finally {
    finished = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    cancel();
  }
}
