import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/lib/configurationFile.js";
import {
  canonicalConfig,
  createCalculationSession,
  sameScientificConfig,
} from "../src/lib/calculationSession.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const calls = [];
  const session = createCalculationSession(DEFAULT_CONFIG, (config, signal) => {
    const response = deferred();
    calls.push({ config, signal, response });
    return response.promise;
  });
  return { session, calls };
}

const success = (result = { bragg_angle_deg: 14.31 }) => ({
  status: 200,
  ok: true,
  payload: { result },
});

test("a successful old request cannot mark a changed draft current", async () => {
  const { session, calls } = harness();
  const first = session.submit();
  session.edit({ ...session.read().draft, energy_kev: 8.9789 });
  calls[0].response.resolve(success());
  assert.equal((await first).kind, "accepted");
  assert.equal(session.read().accepted.canonicalConfig.energy_kev, 8);
  assert.equal(session.read().draft.energy_kev, 8.9789);
  assert.equal(session.read().isCurrent, false);
  session.edit({ ...session.read().draft, energy_kev: "8" });
  assert.equal(session.read().isCurrent, true, "returning to identical parameters restores currency");
});

test("a 422 from an earlier draft cannot attach errors to a later edit", async () => {
  const { session, calls } = harness();
  const first = session.submit();
  session.edit({ ...session.read().draft, bending_radius_m: -3 });
  calls[0].response.resolve({
    status: 422,
    ok: false,
    payload: { issues: [{ field: "bending_radius_m", message: "Invalid radius" }] },
  });
  assert.deepEqual((await first).kind, "invalid");
  assert.equal(session.read().error, null);
});

test("superseded requests do not replace the latest result or undo p then q", async () => {
  const { session, calls } = harness();
  session.edit({ ...session.read().draft, source_distance_m: 2 });
  const first = session.submit();
  session.edit({ ...session.read().draft, detector_distance_m: 2 });
  const second = session.submit();
  assert.equal(calls[0].signal.aborted, true);
  calls[1].response.resolve(success({ bragg_angle_deg: 12 }));
  assert.equal((await second).kind, "accepted");
  calls[0].response.resolve(success({ bragg_angle_deg: 99 }));
  assert.equal((await first).kind, "superseded");
  assert.equal(session.read().draft.source_distance_m, 2);
  assert.equal(session.read().draft.detector_distance_m, 2);
  assert.equal(session.read().accepted.result.bragg_angle_deg, 12);
  assert.equal(session.read().isCurrent, true);
});

for (const [firstField, secondField] of [
  ["detector_distance_m", "source_distance_m"],
  ["source_distance_m", "source_distance_m"],
]) {
  test(`superseded ${firstField} request cannot undo later ${secondField} edit`, async () => {
    const { session, calls } = harness();
    session.edit({ ...session.read().draft, [firstField]: 2 });
    const first = session.submit();
    session.edit({ ...session.read().draft, [secondField]: 3 });
    const second = session.submit();
    calls[1].response.resolve(success({ bragg_angle_deg: 12 }));
    assert.equal((await second).kind, "accepted");
    calls[0].response.resolve({
      status: 422,
      ok: false,
      payload: { issues: [{ field: firstField, message: "Old error" }] },
    });
    assert.equal((await first).kind, "superseded");
    assert.equal(session.read().draft[firstField], firstField === secondField ? 3 : 2);
    assert.equal(session.read().draft[secondField], 3);
    assert.equal(session.read().isCurrent, true);
    assert.equal(session.read().error, null);
  });
}

test("invalid and failed automatic submissions retain the user's latest draft", async () => {
  const { session, calls } = harness();
  session.edit({ ...session.read().draft, source_distance_m: 0 });
  const invalid = session.submit();
  calls[0].response.resolve({
    status: 422,
    ok: false,
    payload: { issues: [{ field: "source_distance_m", message: "Must be positive" }] },
  });
  assert.equal((await invalid).kind, "invalid");
  assert.equal(session.read().draft.source_distance_m, 0);
  assert.equal(session.read().error.fieldErrors.source_distance_m, "Must be positive");
  session.edit({ ...session.read().draft, source_distance_m: 2 });
  const failed = session.submit();
  calls[1].response.reject(new Error("Network unavailable"));
  assert.equal((await failed).kind, "failed");
  assert.equal(session.read().draft.source_distance_m, 2);
  assert.equal(session.read().error.message, "Network unavailable");
});

test("a strict JSON server failure exposes its specific issue", async () => {
  const { session, calls } = harness();
  const calculation = session.submit();
  calls[0].response.resolve({
    status: 503,
    ok: false,
    payload: {
      error: "calculation_unavailable",
      issues: [{ code: "nonfinite_result", field: "source_size_resolution_ev_fwhm", message: "The computed source-size resolution is not finite." }],
    },
  });
  assert.equal((await calculation).kind, "failed");
  assert.match(session.read().error.message, /source-size resolution is not finite/);
  assert.equal(session.read().isCurrent, false);
});

test("canonical comparison rejects unparseable drafts without treating blank as zero", () => {
  assert.equal(canonicalConfig({ ...DEFAULT_CONFIG, energy_kev: "" }), null);
  assert.equal(canonicalConfig({ ...DEFAULT_CONFIG, energy_kev: "1e" }), null);
  assert.equal(sameScientificConfig(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, energy_kev: "8" }), true);
  assert.equal(sameScientificConfig(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, bending_radius_m: "-2" }), true);
});
