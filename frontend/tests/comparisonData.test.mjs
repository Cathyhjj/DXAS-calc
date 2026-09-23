import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONFIG } from "../src/lib/configurationFile.js";
import {
  SCIENTIFIC_INPUTS,
  compareModelProvenance,
  compareScientificInputs,
  formatComparisonDelta,
} from "../src/lib/comparisonData.js";

test("every changed scientific input is listed with its actual value and unit", () => {
  const baseline = { ...DEFAULT_CONFIG };
  const current = {
    ...baseline,
    geometry: "laue",
    material: "Ge",
    h: 2,
    k: 2,
    l: 0,
    energy_kev: 8.9789,
    crystal_thickness_um: 50,
    polarization: "sigma",
    source_distance_m: 1.20001,
    source_size_um: 0.005,
    divergence_mrad: 0.2,
    bending_radius_m: -123.456,
    asymmetry_angle_deg: -3.5,
    condition: "lower",
    detector_distance_m: 1.80002,
    pixel_size_um: 75,
  };
  const changes = compareScientificInputs(baseline, current);
  assert.deepEqual(changes.map((change) => change.key), SCIENTIFIC_INPUTS.map((field) => field.key));
  assert.deepEqual(changes.find((change) => change.key === "energy_kev"), {
    key: "energy_kev", label: "Photon energy", baseline: "8000", current: "8978.9", unit: "eV",
  });
  assert.equal(changes.find((change) => change.key === "source_distance_m").current, "1.20001");
  assert.equal(changes.find((change) => change.key === "bending_radius_m").current, "-123.456");
  assert.equal(changes.find((change) => change.key === "polarization").current, "σ");
});

test("equal numeric inputs do not create a false difference", () => {
  assert.deepEqual(compareScientificInputs(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, energy_kev: "8" }), []);
  assert.deepEqual(compareScientificInputs(null, DEFAULT_CONFIG), []);
});

test("resolution deltas require available values and matching model provenance", () => {
  const baseline = {
    crystal_intrinsic_resolution_ev_fwhm: 0,
    total_resolution_ev_fwhm: 1,
    reflectivity_model: "XOP bent crystal",
    total_resolution_method: "convolution",
  };
  const current = {
    crystal_intrinsic_resolution_ev_fwhm: 1.35,
    total_resolution_ev_fwhm: 2,
    reflectivity_model: "XOP bent crystal",
    total_resolution_method: "convolution",
  };
  assert.equal(compareModelProvenance(baseline, current).sameReflectivity, true);
  assert.equal(formatComparisonDelta(current, baseline, "crystal_intrinsic_resolution_ev_fwhm", "eV FWHM"), "+1.350 eV FWHM");
  assert.equal(formatComparisonDelta(current, baseline, "total_resolution_ev_fwhm", "eV FWHM"), "+1.000 eV FWHM");
  assert.equal(formatComparisonDelta({ ...current, total_resolution_ev_fwhm: null }, baseline, "total_resolution_ev_fwhm", "eV FWHM"), "—");
  assert.equal(formatComparisonDelta({ ...current, reflectivity_model: "crystalpy flat" }, baseline, "total_resolution_ev_fwhm", "eV FWHM"), "Different response models");
  assert.equal(formatComparisonDelta({ ...current, total_resolution_method: "quadrature" }, baseline, "total_resolution_ev_fwhm", "eV FWHM"), "Different resolution methods");
});
