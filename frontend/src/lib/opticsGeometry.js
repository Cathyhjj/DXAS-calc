export const DISTANCE_MIN_M = 0.05;
export const DISTANCE_MAX_M = 50;
export const SCALE_SCHEMATIC = "schematic";
export const SCALE_PHYSICAL = "physical";
export const SOURCE_SHAPE_INDEX = 0;
export const DETECTOR_SHAPE_INDEX = 1;
export const CRYSTAL_LINE_WIDTH = Object.freeze({ bragg: 13, laue: 4 });

const SCHEMATIC_MIN = 1.75;
const SCHEMATIC_MAX = 5.35;
const SCHEMATIC_OFFSET_M = DISTANCE_MIN_M;
const SCHEMATIC_LOG_MIN = Math.log(DISTANCE_MIN_M + SCHEMATIC_OFFSET_M);
const SCHEMATIC_LOG_SPAN = Math.log(DISTANCE_MAX_M + SCHEMATIC_OFFSET_M) - SCHEMATIC_LOG_MIN;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function positiveDistance(value, fallback = 1.5) {
  const distance = Number(value);
  return Number.isFinite(distance) && distance > 0 ? distance : fallback;
}

export function isDistanceDraggable(distance) {
  return Number.isFinite(distance) && distance >= DISTANCE_MIN_M && distance <= DISTANCE_MAX_M;
}

export function distanceToDisplay(distanceMeters, scaleMode = SCALE_SCHEMATIC) {
  const distance = positiveDistance(distanceMeters);
  if (scaleMode === SCALE_PHYSICAL) return distance;
  // A monotonic logarithmic map keeps every positive distance distinct. The
  // offset also keeps very small positive values on the positive display axis.
  const ratio = (Math.log(distance + SCHEMATIC_OFFSET_M) - SCHEMATIC_LOG_MIN) / SCHEMATIC_LOG_SPAN;
  return SCHEMATIC_MIN + ratio * (SCHEMATIC_MAX - SCHEMATIC_MIN);
}

export function displayToDistance(displayDistance, scaleMode = SCALE_SCHEMATIC) {
  if (scaleMode === SCALE_PHYSICAL) return finite(displayDistance, DISTANCE_MIN_M);
  const ratio = (finite(displayDistance, SCHEMATIC_MIN) - SCHEMATIC_MIN) /
    (SCHEMATIC_MAX - SCHEMATIC_MIN);
  return Math.exp(SCHEMATIC_LOG_MIN + ratio * SCHEMATIC_LOG_SPAN) - SCHEMATIC_OFFSET_M;
}

const radians = (degrees) => (degrees * Math.PI) / 180;
const point = (origin, vector, distance) => ({
  x: origin.x + vector.x * distance,
  y: origin.y + vector.y * distance,
});
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (vector, amount) => ({ x: vector.x * amount, y: vector.y * amount });
const dot = (a, b) => a.x * b.x + a.y * b.y;

function rayAtDetector(start, focus, axis, qDisplay) {
  const direction = { x: focus.x - start.x, y: focus.y - start.y };
  const denominator = dot(direction, axis);
  if (Math.abs(denominator) < 1e-9) return point(start, axis, qDisplay);
  const startAxis = dot(start, axis);
  const parameter = (qDisplay - startAxis) / denominator;
  return add(start, scale(direction, parameter));
}

function lineAround(center, direction, halfLength) {
  return {
    x0: center.x - direction.x * halfLength,
    y0: center.y - direction.y * halfLength,
    x1: center.x + direction.x * halfLength,
    y1: center.y + direction.y * halfLength,
  };
}

export function buildOpticsGeometry(config = {}, result = null, scaleMode = SCALE_SCHEMATIC) {
  const sourceDistanceM = positiveDistance(config.source_distance_m, 1.2);
  const detectorDistanceM = positiveDistance(config.detector_distance_m, 1.5);
  const pDisplay = distanceToDisplay(sourceDistanceM, scaleMode);
  const qDisplay = distanceToDisplay(detectorDistanceM, scaleMode);
  const isLaue = config.geometry === "laue";
  const isLower = config.condition === "lower";
  const side = isLaue ? (isLower ? 1 : -1) : isLower ? -1 : 1;
  const thetaActualDeg = Math.abs(finite(result?.bragg_angle_deg, 14));
  // Angle is never compressed: a backscattering detector can lie to the right
  // of the crystal. Only distances are compressed in schematic mode.
  const thetaDisplayDeg = thetaActualDeg;
  const scatteringAngleDeg = thetaDisplayDeg * 2;

  // This is the horizontal mirror of the legacy left-to-right construction.
  // The incident ray points along -x and the existing upper/lower conventions
  // are preserved, including the opposite Laue branch direction.
  const incidentAngle = Math.PI;
  const outgoingAngle = incidentAngle + radians(scatteringAngleDeg * side);
  const outgoingAxis = { x: Math.cos(outgoingAngle), y: Math.sin(outgoingAngle) };
  const detectorNormal = { x: -outgoingAxis.y, y: outgoingAxis.x };

  const fallbackRotationDeg = isLaue ? 90 + thetaDisplayDeg * side : thetaDisplayDeg * side;
  const crystalRotationDeg = finite(result?.crystal_rotation_deg, fallbackRotationDeg);
  const crystalAngle = incidentAngle + radians(crystalRotationDeg);
  const crystalTangent = { x: Math.cos(crystalAngle), y: Math.sin(crystalAngle) };
  const crystalNormal = { x: -crystalTangent.y, y: crystalTangent.x };

  const crystal = { x: 0, y: 0 };
  const source = { x: pDisplay, y: 0 };
  const detector = point(crystal, outgoingAxis, qDisplay);
  const detectorProjection = { x: detector.x, y: 0 };
  const detectorLongitudinalM = Math.abs(detectorDistanceM * Math.cos(radians(thetaActualDeg * 2)));
  const detectorTransverseM = Math.abs(detectorDistanceM * Math.sin(radians(thetaActualDeg * 2)));
  const sceneSpan = Math.max(pDisplay, qDisplay, scaleMode === SCALE_PHYSICAL ? 0.2 : SCHEMATIC_MIN);
  // Device marks and the drawn ray envelope are illustrative, not physical
  // device dimensions. Cap their size when a long distance sets the viewport.
  const symbolSpan = scaleMode === SCALE_PHYSICAL ? Math.min(sceneSpan, 3) : sceneSpan;
  const sourceHalf = Math.max(symbolSpan * 0.075, scaleMode === SCALE_PHYSICAL ? 0.025 : 0.24);
  const detectorHalf = Math.max(symbolSpan * 0.12, scaleMode === SCALE_PHYSICAL ? 0.04 : 0.34);
  const crystalHalf = Math.max(symbolSpan * 0.095, scaleMode === SCALE_PHYSICAL ? 0.03 : 0.28);
  const rayHalf = crystalHalf * 0.42;

  const sourceLine = lineAround(source, { x: 0, y: 1 }, sourceHalf);
  const detectorLine = lineAround(detector, detectorNormal, detectorHalf);
  const crystalA = point(crystal, crystalTangent, -crystalHalf);
  const crystalB = point(crystal, crystalTangent, crystalHalf);
  const rayStartA = point(crystal, crystalTangent, -rayHalf);
  const rayStartB = point(crystal, crystalTangent, rayHalf);

  // The API focus is signed: negative is a virtual focus behind the crystal.
  const signedFocusM = finite(result?.geometric_focus_m, detectorDistanceM * 0.7);
  const focusDistanceM = Math.abs(signedFocusM);
  const focusDisplay = distanceToDisplay(focusDistanceM, scaleMode);
  const focusDirection = Math.sign(signedFocusM) || 1;
  const focus = point(crystal, outgoingAxis, focusDisplay * focusDirection);
  const detectorRayA = rayAtDetector(rayStartA, focus, outgoingAxis, qDisplay);
  const detectorRayB = rayAtDetector(rayStartB, focus, outgoingAxis, qDisplay);
  const directEndpoint = { x: -Math.max(pDisplay, qDisplay) * 1.04, y: 0 };

  const angleRadius = sceneSpan * 0.13;
  const angleArc = Array.from({ length: 25 }, (_, index) => {
    const angle = incidentAngle + radians(scatteringAngleDeg * side * (index / 24));
    return { x: Math.cos(angle) * angleRadius, y: Math.sin(angle) * angleRadius };
  });

  const rangePoints = [
    source,
    detector,
    detectorProjection,
    { x: sourceLine.x0, y: sourceLine.y0 },
    { x: sourceLine.x1, y: sourceLine.y1 },
    { x: detectorLine.x0, y: detectorLine.y0 },
    { x: detectorLine.x1, y: detectorLine.y1 },
    detectorRayA,
    detectorRayB,
    crystalA,
    crystalB,
    ...(isLaue ? [directEndpoint] : []),
  ];
  if (focusDisplay <= sceneSpan * 1.8) rangePoints.push(focus);
  const xValues = rangePoints.map((item) => item.x);
  const yValues = rangePoints.map((item) => item.y);
  const xPadding = sceneSpan * 0.18;
  const yExtent = Math.max(...yValues.map(Math.abs), sceneSpan * 0.3);

  return {
    scaleMode,
    isLaue,
    side,
    sourceDistanceM,
    detectorDistanceM,
    pDisplay,
    qDisplay,
    thetaActualDeg,
    thetaDisplayDeg,
    scatteringAngleDeg,
    crystalRotationDeg,
    source,
    crystal,
    detector,
    detectorProjection,
    detectorLongitudinalM,
    detectorTransverseM,
    outgoingAxis,
    detectorNormal,
    crystalTangent,
    crystalNormal,
    sourceLine,
    detectorLine,
    crystalA,
    crystalB,
    crystalHalf,
    rayStartA,
    rayStartB,
    detectorRayA,
    detectorRayB,
    focus,
    signedFocusM,
    focusDistanceM,
    focusDisplay,
    directEndpoint,
    angleArc,
    sceneSpan,
    xRange: [Math.min(...xValues) - xPadding, Math.max(...xValues) + xPadding],
    yRange: [-yExtent * 1.28, yExtent * 1.28],
  };
}

export function focusPresentation(geometry, result) {
  const focusDistance = result?.geometric_focus_m;
  const render = focusDistance !== null && focusDistance !== undefined && focusDistance !== "" &&
    Number.isFinite(Number(focusDistance)) &&
    Number.isFinite(geometry?.focus?.x) && Number.isFinite(geometry?.focus?.y);
  if (!render) return { render: false, outsideInitialView: false };

  // Visibility in the initial viewport is independent of whether the focus
  // belongs in Plotly data. Keep distant points so pan/zoom can reveal them.
  const insideInitialView = geometry.focus.x >= geometry.xRange[0] &&
    geometry.focus.x <= geometry.xRange[1] &&
    geometry.focus.y >= geometry.yRange[0] &&
    geometry.focus.y <= geometry.yRange[1];
  return { render: true, outsideInitialView: !insideInitialView };
}

function hasShapeUpdate(update, index) {
  const prefix = `shapes[${index}]`;
  return Object.keys(update || {}).some((key) => key === prefix || key.startsWith(`${prefix}.`));
}

function updatedLine(update, index, baseLine) {
  const prefix = `shapes[${index}]`;
  const direct = update?.[prefix];
  const next = { ...baseLine, ...(direct && typeof direct === "object" ? direct : {}) };
  for (const coordinate of ["x0", "y0", "x1", "y1"]) {
    const key = `${prefix}.${coordinate}`;
    if (Object.prototype.hasOwnProperty.call(update || {}, key)) next[coordinate] = finite(update[key], next[coordinate]);
  }

  // Plotly normally emits both endpoints for a translated line. If a browser
  // reports only one endpoint, move the opposite endpoint by the same delta so
  // the distance still comes from the line center rather than a resized edge.
  for (const axis of ["x", "y"]) {
    const firstKey = `${prefix}.${axis}0`;
    const secondKey = `${prefix}.${axis}1`;
    const hasFirst = Object.prototype.hasOwnProperty.call(update || {}, firstKey);
    const hasSecond = Object.prototype.hasOwnProperty.call(update || {}, secondKey);
    if (hasFirst && !hasSecond) next[`${axis}1`] = baseLine[`${axis}1`] + (next[`${axis}0`] - baseLine[`${axis}0`]);
    if (hasSecond && !hasFirst) next[`${axis}0`] = baseLine[`${axis}0`] + (next[`${axis}1`] - baseLine[`${axis}1`]);
  }
  return next;
}

export function distanceChangeFromRelayout(update, geometry, scaleMode = SCALE_SCHEMATIC) {
  if (!geometry || !update) return null;

  if (hasShapeUpdate(update, SOURCE_SHAPE_INDEX)) {
    if (!isDistanceDraggable(geometry.sourceDistanceM)) return null;
    const line = updatedLine(update, SOURCE_SHAPE_INDEX, geometry.sourceLine);
    const displayDistance = (line.x0 + line.x1) / 2;
    return {
      target: "source",
      field: "source_distance_m",
      value: Number(clamp(displayToDistance(displayDistance, scaleMode), DISTANCE_MIN_M, DISTANCE_MAX_M).toFixed(4)),
    };
  }

  if (hasShapeUpdate(update, DETECTOR_SHAPE_INDEX)) {
    if (!isDistanceDraggable(geometry.detectorDistanceM)) return null;
    const line = updatedLine(update, DETECTOR_SHAPE_INDEX, geometry.detectorLine);
    const center = { x: (line.x0 + line.x1) / 2, y: (line.y0 + line.y1) / 2 };
    const displayDistance = dot(center, geometry.outgoingAxis);
    return {
      target: "detector",
      field: "detector_distance_m",
      value: Number(clamp(displayToDistance(displayDistance, scaleMode), DISTANCE_MIN_M, DISTANCE_MAX_M).toFixed(4)),
    };
  }

  return null;
}

export function distanceRelayoutAction(update, geometry, scaleMode = SCALE_SCHEMATIC) {
  const change = distanceChangeFromRelayout(update, geometry, scaleMode);
  if (!change) return null;
  const current = change.target === "source" ? geometry.sourceDistanceM : geometry.detectorDistanceM;
  // Plotly can move a handle perpendicular to its ray while its projected p/q
  // stays unchanged. That edit still needs an editrevision to restore the line.
  return change.value === Number(current.toFixed(4))
    ? { kind: "reset", target: change.target }
    : { kind: "commit", change };
}
