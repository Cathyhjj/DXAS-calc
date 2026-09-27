// Bound both the connection and response-body read. Catalogs and calculations
// share recovery messages, while 422 payloads keep their field-level detail.
export async function requestJson(
  url,
  { signal, timeoutMs = 45000, ...options } = {},
) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) throw signal.reason;
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const payload = await response.json().catch((error) => {
      if (controller.signal.aborted) throw error;
      return null;
    });
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(
        response.ok
          ? "The service sent an unreadable response. Please retry."
          : "The calculation service is unavailable. Please retry when it is running.",
      );
    }
    return { status: response.status, ok: response.ok, payload };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (timedOut)
      throw new Error(
        "The request timed out. Your inputs are preserved; please retry.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "Could not connect to the calculation service. Check the connection and retry.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export function requestCalculation(config, signal) {
  return requestJson("/api/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
    signal,
  });
}
