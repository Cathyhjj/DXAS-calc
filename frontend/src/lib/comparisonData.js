import { kevToEvInput } from "./energyUnits.js";
import { formatDelta, hasMetric } from "./formatMetrics.js";

const POLARIZATION_LABELS = {
  unpolarized: "Unpolarized (σ + π)",
  sigma: "σ",
  pi: "π",
};

export const SCIENTIFIC_INPUTS = Object.freeze([
  { key: "geometry", label: "Geometry", display: (value) => value === "laue" ? "Laue" : value === "bragg" ? "Bragg" : value },
  { key: "material", label: "Crystal material" },
  { key: "h", label: "Miller h" },
  { key: "k", label: "Miller k" },
  { key: "l", label: "Miller l" },
  { key: "energy_kev", label: "Photon energy", unit: "eV", display: kevToEvInput },
  { key: "crystal_thickness_um", label: "Crystal thickness", unit: "µm" },
  { key: "polarization", label: "Polarization", display: (value) => POLARIZATION_LABELS[value] ?? value },
  { key: "source_distance_m", label: "Source–crystal distance p", unit: "m" },
  { key: "source_size_um", label: "Source size FWHM", unit: "µm" },
  { key: "divergence_mrad", label: "Divergence", unit: "mrad" },
  { key: "bending_radius_m", label: "Bending radius R", unit: "m" },
  { key: "asymmetry_angle_deg", label: "Asymmetry angle", unit: "°" },
  { key: "condition", label: "Diffraction branch", display: (value) => value === "upper" ? "Upper" : value === "lower" ? "Lower" : value },
  { key: "detector_distance_m", label: "Crystal–detector distance q", unit: "m" },
  { key: "pixel_size_um", label: "Detector pixel size", unit: "µm" },
]);

function canonicalInput(value) {
  if (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }
  return value;
}

function displayInput(field, value) {
  if (value === null || value === undefined || value === "") return "—";
  const displayed = field.display ? field.display(value) : value;
  return displayed === "" || displayed === null || displayed === undefined ? "—" : String(displayed);
}

export function compareScientificInputs(baselineConfig, currentConfig) {
  if (!baselineConfig || !currentConfig) return [];
  return SCIENTIFIC_INPUTS.filter((field) =>
    !Object.is(canonicalInput(baselineConfig[field.key]), canonicalInput(currentConfig[field.key])),
  ).map((field) => ({
    key: field.key,
    label: field.label,
    baseline: displayInput(field, baselineConfig[field.key]),
    current: displayInput(field, currentConfig[field.key]),
    unit: field.unit || "",
  }));
}

function modelName(value) {
  return typeof value === "string" && value.trim() ? value : "Unavailable";
}

export function compareModelProvenance(baselineResult, currentResult) {
  const baselineReflectivity = modelName(baselineResult?.reflectivity_model);
  const currentReflectivity = modelName(currentResult?.reflectivity_model);
  const baselineTotalMethod = modelName(baselineResult?.total_resolution_method);
  const currentTotalMethod = modelName(currentResult?.total_resolution_method);
  return {
    baselineReflectivity,
    currentReflectivity,
    baselineTotalMethod,
    currentTotalMethod,
    sameReflectivity: baselineReflectivity !== "Unavailable" && baselineReflectivity === currentReflectivity,
    sameTotalMethod: baselineTotalMethod !== "Unavailable" && baselineTotalMethod === currentTotalMethod,
  };
}

export function formatComparisonDelta(currentResult, baselineResult, metricKey, unit) {
  const current = currentResult?.[metricKey];
  const baseline = baselineResult?.[metricKey];
  if (!hasMetric(current) || !hasMetric(baseline)) return "—";
  if (["crystal_intrinsic_resolution_ev_fwhm", "total_resolution_ev_fwhm"].includes(metricKey)) {
    const provenance = compareModelProvenance(baselineResult, currentResult);
    if (!provenance.sameReflectivity) return "Different response models";
    if (metricKey === "total_resolution_ev_fwhm" && !provenance.sameTotalMethod) {
      return "Different resolution methods";
    }
  }
  return formatDelta(current, baseline, unit);
}
