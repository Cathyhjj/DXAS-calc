export async function requestCalculation(config, signal) {
  const response = await fetch("/api/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
    signal,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, payload };
}
