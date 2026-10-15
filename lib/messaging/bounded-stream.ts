export async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  {
    maxBytes,
    expectedBytes,
    timeoutMs = 15_000,
    signal,
  }: {
    maxBytes: number;
    expectedBytes?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    (expectedBytes !== undefined &&
      (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > maxBytes))
  ) {
    throw new RangeError("Invalid file size limit.");
  }
  signal?.throwIfAborted();
  const reader = stream.getReader();
  // A fixed buffer also bounds memory when an attacker sends millions of tiny
  // chunks. Retaining each chunk (or racing every read against one pending
  // promise) would accumulate unbounded bookkeeping despite a byte limit.
  const buffer = new Uint8Array(expectedBytes ?? maxBytes);
  let returnedBuffer = false;
  let length = 0;
  let stopped = false;
  let stopReason: unknown;
  const stop = (reason: unknown) => {
    if (stopped) return;
    stopped = true;
    stopReason = reason;
    // Stream cancellation closes pending reads before awaiting the source's
    // cancellation hook, so even an unresponsive source cannot hold the reader.
    void reader.cancel().catch(() => {});
  };
  const abort = () =>
    stop(signal?.reason ?? new DOMException("File processing cancelled.", "AbortError"));
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => stop(new Error("File processing timed out. Try a smaller file.")),
    timeoutMs,
  );
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (stopped) {
        value?.fill(0);
        throw stopReason;
      }
      if (done) break;
      if (value.byteLength > buffer.byteLength - length) {
        value.fill(0);
        throw new RangeError("File exceeds its allowed size.");
      }
      buffer.set(value, length);
      length += value.byteLength;
      value.fill(0);
    }
    if (expectedBytes !== undefined && length !== expectedBytes) {
      throw new Error("File size does not match its message details.");
    }
    if (length === buffer.byteLength) {
      returnedBuffer = true;
      return buffer;
    }
    return buffer.slice(0, length);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
    if (!returnedBuffer) buffer.fill(0);
  }
}
