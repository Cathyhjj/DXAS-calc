export const DETECTOR_DISTANCE_MODES = Object.freeze({
  RAY: "ray",
  PARALLEL: "parallel",
  PERPENDICULAR: "perpendicular",
});

export function isDetectorDistanceMode(mode) {
  return Object.values(DETECTOR_DISTANCE_MODES).includes(mode);
}

// These are magnitudes of the detector displacement projected onto the
// incident-beam axis and its perpendicular. The drawing uses the API's Bragg
// angle, so the scattering angle is 2θ in every geometry/condition branch.
export function detectorProjectionFactor(mode, braggAngleDeg) {
  if (mode === DETECTOR_DISTANCE_MODES.RAY) return 1;
  if (!Number.isFinite(braggAngleDeg)) return null;
  const angle = (2 * braggAngleDeg * Math.PI) / 180;
  const factor = mode === DETECTOR_DISTANCE_MODES.PARALLEL
    ? Math.abs(Math.cos(angle))
    : mode === DETECTOR_DISTANCE_MODES.PERPENDICULAR
      ? Math.abs(Math.sin(angle))
      : null;
  return factor !== null && factor > 1e-9 ? factor : null;
}

export function projectedDetectorDistance(qMeters, mode, braggAngleDeg) {
  const q = Number(qMeters);
  const factor = detectorProjectionFactor(mode, braggAngleDeg);
  return Number.isFinite(q) && q > 0 && factor !== null ? q * factor : null;
}

export function detectorDistanceFromProjection(distanceMeters, mode, braggAngleDeg) {
  if (typeof distanceMeters !== "number" && typeof distanceMeters !== "string") return null;
  if (String(distanceMeters).trim() === "") return null;
  if (typeof distanceMeters === "string" &&
      !/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(distanceMeters.trim())) return null;
  const distance = Number(distanceMeters);
  const factor = detectorProjectionFactor(mode, braggAngleDeg);
  if (!Number.isFinite(distance) || distance <= 0 || factor === null) return null;
  const q = distance / factor;
  return Number.isFinite(q) && q > 0 ? q : null;
}

export function sameBraggInputs(draft, calculated) {
  if (!draft || !calculated || draft.material !== calculated.material) return false;
  return ["h", "k", "l", "energy_kev"].every((field) => {
    const value = draft[field];
    return (typeof value === "number" || typeof value === "string") &&
      String(value).trim() !== "" &&
      Number.isFinite(Number(value)) &&
      Number(value) === Number(calculated[field]);
  });
}
