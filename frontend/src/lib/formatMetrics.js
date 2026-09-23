function metricNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function hasMetric(value) {
  return metricNumber(value) !== null;
}

export function formatValue(value, unavailable = "—") {
  const numeric = metricNumber(value);
  if (numeric === null) return unavailable;
  const magnitude = Math.abs(numeric);
  if (magnitude === 0) return "0.000";
  if (magnitude >= 1000) {
    return numeric.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  if (magnitude >= 100) return numeric.toFixed(1);
  if (magnitude >= 10) return numeric.toFixed(2);
  if (magnitude >= 1) return numeric.toFixed(3);
  if (magnitude >= 0.01) return numeric.toFixed(4);
  return numeric.toExponential(2);
}

export function formatMetricDelta(current, baseline, unit, suffix = " vs baseline") {
  const currentValue = metricNumber(current);
  const baselineValue = metricNumber(baseline);
  if (currentValue === null || baselineValue === null) return null;
  const difference = currentValue - baselineValue;
  if (!Number.isFinite(difference)) return null;
  return `${difference > 0 ? "+" : ""}${formatValue(difference)}${unit ? ` ${unit}` : ""}${suffix}`;
}

export function formatDelta(current, baseline, unit) {
  return formatMetricDelta(current, baseline, unit, "") ?? "—";
}

const RESOLUTION_WARNING_CODES = {
  crystal_intrinsic_resolution_ev_fwhm: new Set([
    "resolution_enrichment_busy",
    "reflectivity_unavailable",
    "intrinsic_resolution_failed",
  ]),
  source_size_resolution_ev_fwhm: new Set([
    "resolution_enrichment_busy",
    "reflectivity_unavailable",
    "intrinsic_resolution_failed",
    "source_size_resolution_unavailable",
  ]),
  total_resolution_ev_fwhm: new Set([
    "resolution_enrichment_busy",
    "reflectivity_unavailable",
    "intrinsic_resolution_failed",
    "resolution_enrichment_failed",
    "source_size_resolution_unavailable",
  ]),
};

export function unavailableReason(result, metricKey) {
  if (hasMetric(result?.[metricKey])) return null;
  const relevantCodes = RESOLUTION_WARNING_CODES[metricKey];
  const warning = Array.isArray(result?.warnings)
    ? result.warnings.find((item) => item?.message && (
      item.field === metricKey || relevantCodes?.has(item.code)
    ))
    : null;
  return warning?.message || "This result did not provide a value.";
}
