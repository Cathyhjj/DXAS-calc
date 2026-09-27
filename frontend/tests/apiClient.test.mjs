import test from "node:test";
import assert from "node:assert/strict";
import { requestJson, requestCalculation } from "../src/lib/apiClient.js";

test("a stalled request times out and aborts its connection", async (t) => {
  let signal;
  t.mock.method(globalThis, "fetch", (_url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  });
  await assert.rejects(requestJson("/api/calculate", { timeoutMs: 10 }), /timed out/i);
  assert.equal(signal.aborted, true);
});

test("caller cancellation stays distinct from timeout or network failure", async (t) => {
  t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  }));
  const controller = new AbortController();
  const pending = requestJson("/api/calculate", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("non-JSON and network failures explain how to recover", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Bad gateway", { status: 502 }));
  await assert.rejects(requestCalculation({}), /unavailable.*retry/i);
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(requestCalculation({}), /connect.*retry/i);
});

test("structured field validation is passed through without losing issues", async (t) => {
  const payload = { issues: [{ field: "energy_kev", message: "Must be positive" }] };
  t.mock.method(globalThis, "fetch", async () => Response.json(payload, { status: 422 }));
  assert.deepEqual(await requestCalculation({ energy_kev: -1 }), { ok: false, status: 422, payload });
});
