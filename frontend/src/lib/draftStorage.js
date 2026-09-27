import { DEFAULT_CONFIG, NUMERIC_FIELDS } from "./configurationFile.js";
import { evInputToKev, kevToEvInput } from "./energyUnits.js";
import { DETECTOR_DISTANCE_MODES, isDetectorDistanceMode } from "./detectorProjection.js";

const STORAGE_KEY = "dxascalc-draft-v1";
const ENUMS = {
  geometry: ["bragg", "laue"],
  material: ["Si", "Ge"],
  polarization: ["unpolarized", "sigma", "pi"],
  condition: ["upper", "lower"],
};

// Drafts may include unfinished/invalid numbers. They are never treated as
// calculated results and must pass the API again after a refresh.
export function readDraft(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw || raw.length > 65536) return null;
    const payload = JSON.parse(raw);
    const config = payload?.config;
    if (payload.version !== 1 || !config || Array.isArray(config)) return null;
    const keys = Object.keys(DEFAULT_CONFIG);
    if (
      Object.keys(config).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(config, key))
    )
      return null;
    for (const key of keys) {
      const value = config[key];
      if (NUMERIC_FIELDS.includes(key)) {
        if (
          !(typeof value === "string" && value.length <= 80) &&
          !(typeof value === "number" && Number.isFinite(value))
        )
          return null;
      } else if (!ENUMS[key].includes(value)) return null;
    }
    const energyInputEv =
      typeof payload.energyInputEv === "string" &&
      payload.energyInputEv.length <= 80 &&
      evInputToKev(payload.energyInputEv) === config.energy_kev
        ? payload.energyInputEv
        : kevToEvInput(config.energy_kev);
    return {
      config,
      energyInputEv,
      thicknessEdited: payload.thicknessEdited === true,
      detectorDistanceMode: isDetectorDistanceMode(payload.detectorDistanceMode)
        ? payload.detectorDistanceMode
        : DETECTOR_DISTANCE_MODES.RAY,
    };
  } catch {
    return null;
  }
}

export function writeDraft(
  storage,
  { config, energyInputEv, thicknessEdited, detectorDistanceMode = DETECTOR_DISTANCE_MODES.RAY },
) {
  try {
    if (!storage) return false;
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        config,
        energyInputEv,
        thicknessEdited,
        detectorDistanceMode: isDetectorDistanceMode(detectorDistanceMode)
          ? detectorDistanceMode
          : DETECTOR_DISTANCE_MODES.RAY,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
