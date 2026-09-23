import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONFIG,
  configurationFilename,
  parseConfiguration,
  serializeConfiguration,
} from "../src/lib/configurationFile.js";

test("a saved configuration loads every scientific input", () => {
  const edited = {
    ...DEFAULT_CONFIG,
    geometry: "laue",
    material: "Ge",
    h: "2",
    k: "2",
    l: "0",
    energy_kev: "8.4",
    crystal_thickness_um: "50",
    polarization: "pi",
    source_distance_m: "2.75",
    condition: "lower",
  };
  const saved = serializeConfiguration(edited);
  assert.deepEqual(parseConfiguration(saved), {
    ...edited,
    h: 2,
    k: 2,
    l: 0,
    energy_kev: 8.4,
    crystal_thickness_um: 50,
    source_distance_m: 2.75,
  });
  assert.equal(configurationFilename(edited, new Date("2026-09-22T23:15:30Z")), "dxascalc-laue-ge-220-20260922-231530.json");
});

test("unsupported, incomplete, and malformed files are rejected", () => {
  assert.throws(() => parseConfiguration("not JSON"), /not valid JSON/);
  assert.throws(() => parseConfiguration(JSON.stringify({ format: "dxascalc-configuration", version: 2, config: DEFAULT_CONFIG })), /not a supported/);
  const incomplete = { ...DEFAULT_CONFIG };
  delete incomplete.pixel_size_um;
  assert.throws(() => parseConfiguration(JSON.stringify({ format: "dxascalc-configuration", version: 1, config: incomplete })), /missing: pixel_size_um/);
  assert.throws(() => serializeConfiguration({ ...DEFAULT_CONFIG, h: "" }), /valid number for h/);
  assert.throws(() => serializeConfiguration({ ...DEFAULT_CONFIG, geometry: "unknown" }), /Invalid geometry/);
});
