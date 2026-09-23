export const DEFAULT_CONFIG = Object.freeze({
  geometry: "bragg",
  material: "Si",
  h: 1,
  k: 1,
  l: 1,
  energy_kev: 8,
  crystal_thickness_um: 200,
  polarization: "unpolarized",
  source_distance_m: 1.2,
  source_size_um: 1.5,
  divergence_mrad: 1.2,
  bending_radius_m: -2,
  asymmetry_angle_deg: 0,
  condition: "upper",
  detector_distance_m: 1.5,
  pixel_size_um: 55,
});

export const NUMERIC_FIELDS = [
  "h", "k", "l", "energy_kev", "crystal_thickness_um", "source_distance_m",
  "source_size_um", "divergence_mrad", "bending_radius_m", "asymmetry_angle_deg",
  "detector_distance_m", "pixel_size_um",
];

const ENUM_OPTIONS = {
  geometry: ["bragg", "laue"],
  material: ["Si", "Ge"],
  polarization: ["unpolarized", "sigma", "pi"],
  condition: ["upper", "lower"],
};

function normalizedConfig(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("The file does not contain a configuration object.");
  }

  const expected = Object.keys(DEFAULT_CONFIG);
  const missing = expected.filter((field) => !Object.hasOwn(candidate, field));
  const unknown = Object.keys(candidate).filter((field) => !Object.hasOwn(DEFAULT_CONFIG, field));
  if (missing.length || unknown.length) {
    throw new Error(`Configuration fields do not match this version of DXASCalc${missing.length ? `; missing: ${missing.join(", ")}` : ""}${unknown.length ? `; unknown: ${unknown.join(", ")}` : ""}.`);
  }

  const config = {};
  for (const [field, options] of Object.entries(ENUM_OPTIONS)) {
    if (!options.includes(candidate[field])) {
      throw new Error(`Invalid ${field} in the configuration file.`);
    }
    config[field] = candidate[field];
  }
  for (const field of NUMERIC_FIELDS) {
    const value = candidate[field];
    if ((typeof value !== "number" && typeof value !== "string") ||
        (typeof value === "string" && value.trim() === "")) {
      throw new Error(`Enter a valid number for ${field} before saving or loading.`);
    }
    const number = Number(value);
    if (!Number.isFinite(number) || (["h", "k", "l"].includes(field) && !Number.isInteger(number))) {
      throw new Error(`Enter a valid number for ${field} before saving or loading.`);
    }
    config[field] = number;
  }
  return config;
}

export function serializeConfiguration(config) {
  return JSON.stringify({ format: "dxascalc-configuration", version: 1, config: normalizedConfig(config) }, null, 2) + "\n";
}

export function parseConfiguration(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  if (!payload || payload.format !== "dxascalc-configuration" || payload.version !== 1) {
    throw new Error("This is not a supported DXASCalc configuration file.");
  }
  return normalizedConfig(payload.config);
}

export function configurationFilename(config, now = new Date()) {
  const reflection = `${config.h}${config.k}${config.l}`.replace(/[^0-9-]/g, "");
  const timestamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `dxascalc-${config.geometry}-${String(config.material).toLowerCase()}-${reflection || "setup"}-${timestamp}.json`;
}
