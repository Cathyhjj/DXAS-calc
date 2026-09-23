import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDelta,
  formatMetricDelta,
  formatValue,
  hasMetric,
  unavailableReason,
} from "../src/lib/formatMetrics.js";

test("missing and non-finite values never become zero", () => {
  for (const value of [null, undefined, "", "  ", NaN, Infinity, -Infinity, false, []]) {
    assert.equal(hasMetric(value), false);
    assert.equal(formatValue(value), "—");
    assert.equal(formatValue(value, "Unavailable"), "Unavailable");
  }
  assert.equal(hasMetric(0), true);
  assert.equal(formatValue(0), "0.000");
});

test("delta requires two valid values and preserves a real zero baseline", () => {
  for (const [current, baseline] of [[null, null], [null, 1.35], [1.35, null], [Infinity, 1]]) {
    assert.equal(formatMetricDelta(current, baseline, "eV FWHM"), null);
    assert.equal(formatDelta(current, baseline, "eV FWHM"), "—");
  }
  assert.equal(formatMetricDelta(1.35, 0, "eV FWHM"), "+1.350 eV FWHM vs baseline");
  assert.equal(formatDelta(0, 0, "eV/px"), "0.000 eV/px");
  assert.equal(formatDelta(0, 1.35, "eV FWHM"), "-1.350 eV FWHM");
});

test("negative and small scientific values remain distinct from unavailable", () => {
  assert.equal(formatValue(-123.456), "-123.5");
  assert.equal(formatValue(-0.000004), "-4.00e-6");
  assert.equal(formatDelta(0.000004, 0, "eV/px"), "+4.00e-6 eV/px");
  assert.equal(formatValue("0"), "0.000");
});

test("missing resolution can expose the warning that explains it", () => {
  const result = {
    total_resolution_ev_fwhm: null,
    warnings: [{ code: "resolution_enrichment_failed", message: "Convolution exceeded the grid." }],
  };
  assert.equal(unavailableReason(result, "total_resolution_ev_fwhm"), "Convolution exceeded the grid.");
  assert.equal(unavailableReason(result, "crystal_intrinsic_resolution_ev_fwhm"), "This result did not provide a value.");
  assert.equal(unavailableReason({ ...result, total_resolution_ev_fwhm: 0 }, "total_resolution_ev_fwhm"), null);
});
