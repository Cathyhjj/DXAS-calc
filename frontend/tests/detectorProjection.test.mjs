import assert from "node:assert/strict";
import test from "node:test";
import {
  DETECTOR_DISTANCE_MODES as MODE,
  detectorDistanceFromProjection,
  detectorProjectionFactor,
  projectedDetectorDistance,
  sameBraggInputs,
} from "../src/lib/detectorProjection.js";

test("either projection defines the same physical q at the calculated 2θ", () => {
  const theta = 14.3078;
  const q = 1.5;
  for (const mode of [MODE.PARALLEL, MODE.PERPENDICULAR]) {
    const projection = projectedDetectorDistance(q, mode, theta);
    assert.ok(projection > 0);
    assert.ok(Math.abs(detectorDistanceFromProjection(projection, mode, theta) - q) < 1e-12);
  }
  assert.ok(Math.abs(projectedDetectorDistance(q, MODE.PARALLEL, theta) - 1.3169) < 0.001);
  assert.ok(Math.abs(projectedDetectorDistance(q, MODE.PERPENDICULAR, theta) - 0.7181) < 0.001);
});

test("projection magnitudes also invert correctly beyond 90° scattering", () => {
  for (const theta of [0.5, 55, 70, 89]) {
    for (const mode of [MODE.PARALLEL, MODE.PERPENDICULAR]) {
      const projection = projectedDetectorDistance(2.3, mode, theta);
      assert.ok(Math.abs(detectorDistanceFromProjection(projection, mode, theta) - 2.3) < 1e-12);
    }
  }
});

test("zero projections and invalid distances cannot define q", () => {
  assert.equal(detectorProjectionFactor(MODE.PARALLEL, 45), null);
  assert.equal(detectorProjectionFactor(MODE.PERPENDICULAR, 90), null);
  assert.equal(detectorDistanceFromProjection(1, MODE.PARALLEL, 45), null);
  for (const value of ["", " ", 0, -1, "bad", "0x10", "1,5", Infinity]) {
    assert.equal(detectorDistanceFromProjection(value, MODE.PERPENDICULAR, 14), null);
  }
});

test("projection input uses a current API angle for the same Bragg inputs", () => {
  const accepted = { material: "Si", h: 1, k: 1, l: 1, energy_kev: 8 };
  assert.equal(sameBraggInputs({ ...accepted, energy_kev: "8", detector_distance_m: 2 }, accepted), true);
  assert.equal(sameBraggInputs({ ...accepted, energy_kev: 9 }, accepted), false);
  assert.equal(sameBraggInputs({ ...accepted, h: 3 }, accepted), false);
  assert.equal(sameBraggInputs({ ...accepted, energy_kev: "" }, accepted), false);
});
