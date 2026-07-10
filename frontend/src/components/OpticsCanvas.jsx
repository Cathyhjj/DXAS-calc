import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconRefresh, IconZoomIn, IconZoomOut } from "@tabler/icons-react";

const Q_MIN = 0.05;
const Q_MAX = 50;
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.15;
const TAU = Math.PI * 2;

const C = {
  background: "#fffdfa",
  ink: "#252337",
  muted: "#667085",
  faint: "#d7d3cd",
  incident: "#2f80ed",
  diffracted: "#7c4ac7",
  central: "#9c72d4",
  crystal: "#cbc8d2",
  crystalDark: "#777284",
  amber: "#b96a00",
  amberFill: "#fff7e8",
  white: "#ffffff",
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const positiveDistance = (value, fallback = 1.5) => {
  const parsed = finite(value, fallback);
  return parsed > 0 ? parsed : fallback;
};
const point = (origin, vector, distance) => ({
  x: origin.x + vector.x * distance,
  y: origin.y + vector.y * distance,
});
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (vector, amount) => ({ x: vector.x * amount, y: vector.y * amount });
const dot = (a, b) => a.x * b.x + a.y * b.y;

function formatNumber(value, digits = 2) {
  const n = finite(value, 0);
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(n) < 0.01 && n !== 0) return n.toExponential(1);
  return n.toFixed(digits);
}

function qToRatio(q) {
  return Math.log(clamp(q, Q_MIN, Q_MAX) / Q_MIN) / Math.log(Q_MAX / Q_MIN);
}

function ratioToQ(ratio) {
  return Q_MIN * Math.pow(Q_MAX / Q_MIN, clamp(ratio, 0, 1));
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function strokeLine(ctx, a, b, color, width = 1, dash = []) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function drawArrow(ctx, tip, direction, color, size = 6) {
  const angle = Math.atan2(direction.y, direction.x);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - Math.cos(angle - 0.55) * size, tip.y - Math.sin(angle - 0.55) * size);
  ctx.lineTo(tip.x - Math.cos(angle + 0.55) * size, tip.y - Math.sin(angle + 0.55) * size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawDoubleArrow(ctx, a, b, color) {
  strokeLine(ctx, a, b, color, 1);
  drawArrow(ctx, a, { x: a.x - b.x, y: a.y - b.y }, color);
  drawArrow(ctx, b, { x: b.x - a.x, y: b.y - a.y }, color);
}

function boundaryDistance(origin, direction, width, height, padding) {
  const distances = [];
  if (direction.x > 0) distances.push((width - padding - origin.x) / direction.x);
  if (direction.x < 0) distances.push((padding - origin.x) / direction.x);
  if (direction.y > 0) distances.push((height - padding - origin.y) / direction.y);
  if (direction.y < 0) distances.push((padding - origin.y) / direction.y);
  return Math.max(80, Math.min(...distances.filter((value) => value > 0)));
}

function makeGeometry(width, height, q, config, result) {
  const compact = width < 680;
  const source = { x: compact ? 34 : 54, y: height * (compact ? 0.57 : 0.58) };
  const crystal = { x: width * (compact ? 0.43 : 0.42), y: height * (compact ? 0.42 : 0.43) };
  const incidentAngle = Math.atan2(crystal.y - source.y, crystal.x - source.x);
  const theta = clamp(Math.abs(finite(result?.bragg_angle_deg, 14)), 2, 42);
  const side = config?.condition === "lower" ? -1 : 1;
  const geometryFactor = config?.geometry === "laue" ? 0.58 : 1;
  const deflection = clamp(theta * 2 * geometryFactor, 10, 48) * (Math.PI / 180) * side;
  const outgoingAngle = clamp(incidentAngle + deflection, -0.82, 0.82);
  const axis = { x: Math.cos(outgoingAngle), y: Math.sin(outgoingAngle) };
  const normal = { x: -axis.y, y: axis.x };
  const outLength = boundaryDistance(crystal, axis, width, height, compact ? 42 : 56) * 0.96;
  const axisMin = Math.min(72, outLength * 0.23);
  const axisMax = outLength * 0.92;
  const qDistance = axisMin + qToRatio(q) * (axisMax - axisMin);
  const detector = point(crystal, axis, qDistance);
  const detectorHalf = clamp(height * 0.12, 44, compact ? 62 : 82);
  const detectorA = add(detector, scale(normal, -detectorHalf));
  const detectorB = add(detector, scale(normal, detectorHalf));
  const realFocus = result?.focus_kind !== "virtual";
  const focusDistanceM = Math.abs(finite(result?.geometric_focus_m, q * 0.7));
  let focusDistance;
  if (realFocus) {
    focusDistance = axisMin + qToRatio(focusDistanceM) * (axisMax - axisMin);
  } else {
    const backRoom = Math.hypot(crystal.x - source.x, crystal.y - source.y);
    focusDistance = -clamp(40 + qToRatio(focusDistanceM) * 70, 40, backRoom * 0.42);
  }
  const focus = point(crystal, axis, focusDistance);
  const rayHalf = clamp(7 + Math.log10(1 + Math.abs(finite(result?.incident_beam_width_mm, 10))) * 4, 8, 22);
  const rayStartA = add(crystal, scale(normal, -rayHalf));
  const rayStartB = add(crystal, scale(normal, rayHalf));
  const baselineY = height - (compact ? 50 : 62);
  const rowlandRadius = clamp(height * 0.19, 68, 106);
  const rowlandCenter = { x: crystal.x, y: crystal.y + rowlandRadius };
  return {
    width, height, compact, source, crystal, incidentAngle, outgoingAngle, axis, normal,
    outLength, axisMin, axisMax, qDistance, detector, detectorA, detectorB, detectorHalf,
    focus, focusDistance, realFocus, rayHalf, rayStartA, rayStartB, baselineY,
    rowlandRadius, rowlandCenter,
  };
}

function rayAtDetector(start, focus, axis, crystal, qDistance) {
  const direction = { x: focus.x - start.x, y: focus.y - start.y };
  const denominator = dot(direction, axis);
  if (Math.abs(denominator) < 1e-6) return point(start, axis, qDistance);
  const startAxis = dot({ x: start.x - crystal.x, y: start.y - crystal.y }, axis);
  const t = (qDistance - startAxis) / denominator;
  return add(start, scale(direction, t));
}

function drawLegend(ctx, g) {
  const x = 18;
  const y = 18;
  const width = g.compact ? 138 : 156;
  const height = 144;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = C.faint;
  roundedRect(ctx, x, y, width, height, 10);
  ctx.fill();
  ctx.stroke();
  ctx.font = `${g.compact ? 10 : 11}px Inter, sans-serif`;
  ctx.fillStyle = C.ink;
  const rows = [
    ["Incident beam", C.incident, []],
    ["Diffracted beam", C.diffracted, []],
    ["Central (no bend)", C.central, [5, 5]],
    ["Rowland circle", C.muted, [3, 4]],
    [g.realFocus ? "Real focus" : "Virtual focus", C.diffracted, "dot"],
    ["Detector (movable)", C.incident, "detector"],
  ];
  rows.forEach(([label, color, kind], index) => {
    const rowY = y + 20 + index * 21;
    if (kind === "dot") {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + 24, rowY - 3, 4, 0, TAU);
      ctx.fill();
    } else if (kind === "detector") {
      strokeLine(ctx, { x: x + 24, y: rowY - 10 }, { x: x + 24, y: rowY + 4 }, color, 2.5);
    } else {
      strokeLine(ctx, { x: x + 12, y: rowY - 3 }, { x: x + 38, y: rowY - 3 }, color, 2, kind);
    }
    ctx.fillStyle = C.ink;
    ctx.fillText(label, x + 48, rowY);
  });
  ctx.restore();
}

function drawCrystal(ctx, g, config, result) {
  const rotation = clamp(finite(result?.crystal_rotation_deg, 0), -28, 28) * (Math.PI / 180) * 0.32;
  const radiusSign = Math.sign(finite(config?.bending_radius_m, 1)) || 1;
  const curve = radiusSign * 7;
  ctx.save();
  ctx.translate(g.crystal.x, g.crystal.y);
  ctx.rotate(rotation);
  ctx.fillStyle = C.crystal;
  ctx.strokeStyle = C.crystalDark;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-48, -7);
  ctx.quadraticCurveTo(0, -7 + curve, 48, -7);
  ctx.lineTo(46, 9);
  ctx.quadraticCurveTo(0, 9 + curve, -46, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = C.diffracted;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-46, -5);
  ctx.quadraticCurveTo(0, -5 + curve, 46, -5);
  ctx.stroke();
  ctx.restore();
}

function drawDimensions(ctx, g, config, q) {
  const y = g.baselineY;
  const crystalX = g.crystal.x;
  const detectorX = g.detector.x;
  const sourceX = g.source.x;
  ctx.save();
  ctx.strokeStyle = C.muted;
  ctx.fillStyle = C.muted;
  ctx.font = `${g.compact ? 9 : 11}px Inter, sans-serif`;
  [sourceX, crystalX, detectorX].forEach((x) => strokeLine(ctx, { x, y: y - 8 }, { x, y: y + 10 }, C.muted, 1));
  drawDoubleArrow(ctx, { x: sourceX + 5, y }, { x: crystalX - 5, y }, C.muted);
  drawDoubleArrow(ctx, { x: crystalX + 5, y }, { x: detectorX - 5, y }, C.muted);
  ctx.textAlign = "center";
  ctx.fillStyle = C.ink;
  ctx.font = `italic ${g.compact ? 11 : 13}px Georgia, serif`;
  ctx.fillText("p", (sourceX + crystalX) / 2, y - 8);
  ctx.fillText("q", (crystalX + detectorX) / 2, y - 8);
  ctx.font = `${g.compact ? 9 : 10}px Inter, sans-serif`;
  ctx.fillStyle = C.muted;
  ctx.fillText(`${formatNumber(config?.source_distance_m, 2)} m`, (sourceX + crystalX) / 2, y + 17);
  ctx.fillText(`${formatNumber(q, 2)} m`, (crystalX + detectorX) / 2, y + 17);
  ctx.restore();
}

function drawScene(ctx, g, config, result, q) {
  const { source, crystal, detector, detectorA, detectorB, axis, normal, focus } = g;
  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, g.width, g.height);

  if (!g.compact) {
    ctx.save();
    ctx.strokeStyle = "#a8a5ad";
    ctx.fillStyle = C.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.arc(g.rowlandCenter.x, g.rowlandCenter.y, g.rowlandRadius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    const radiusEnd = {
      x: g.rowlandCenter.x - g.rowlandRadius * 0.58,
      y: g.rowlandCenter.y - g.rowlandRadius * 0.76,
    };
    strokeLine(ctx, g.rowlandCenter, radiusEnd, "#a8a5ad", 1);
    ctx.font = "italic 13px Georgia, serif";
    ctx.fillText(
      "R",
      (g.rowlandCenter.x + radiusEnd.x) / 2 - 8,
      (g.rowlandCenter.y + radiusEnd.y) / 2,
    );
    ctx.restore();
  }

  const incNormal = { x: -Math.sin(g.incidentAngle), y: Math.cos(g.incidentAngle) };
  const incidentHalf = clamp(g.rayHalf * 0.65, 5, 12);
  strokeLine(ctx, source, add(crystal, scale(incNormal, -incidentHalf)), C.incident, 1.8);
  strokeLine(ctx, source, add(crystal, scale(incNormal, incidentHalf)), C.incident, 1.8);
  strokeLine(ctx, source, crystal, C.incident, 1.2, [4, 4]);

  const centralEnd = point(crystal, axis, g.outLength);
  strokeLine(ctx, crystal, centralEnd, C.central, 1.35, [6, 5]);
  if (!g.realFocus) strokeLine(ctx, focus, crystal, C.central, 1, [3, 4]);

  const endA = rayAtDetector(g.rayStartA, focus, axis, crystal, g.qDistance);
  const endB = rayAtDetector(g.rayStartB, focus, axis, crystal, g.qDistance);
  const extend = (start, through, amount) => {
    const dx = through.x - start.x;
    const dy = through.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: through.x + (dx / length) * amount, y: through.y + (dy / length) * amount };
  };
  strokeLine(ctx, g.rayStartA, extend(g.rayStartA, endA, 7), C.diffracted, 1.8);
  strokeLine(ctx, g.rayStartB, extend(g.rayStartB, endB, 7), C.diffracted, 1.8);

  drawCrystal(ctx, g, config, result);

  ctx.save();
  ctx.fillStyle = C.ink;
  ctx.beginPath();
  ctx.arc(source.x, source.y, 5.5, 0, TAU);
  ctx.fill();
  ctx.font = `${g.compact ? 10 : 11}px Inter, sans-serif`;
  ctx.fillText("Source", source.x - 10, source.y - 18);
  ctx.fillStyle = C.muted;
  ctx.fillText(`${formatNumber(config?.energy_kev, 2)} keV`, source.x - 10, source.y + 22);
  if (!g.compact) {
    ctx.fillText(
      `ΔE ≈ ${formatNumber(result?.flat_energy_span_ev, 2)} eV`,
      source.x - 10,
      source.y + 38,
    );
    ctx.fillText(
      `beam ${formatNumber(result?.incident_beam_width_mm, 2)} mm`,
      source.x - 10,
      source.y + 54,
    );
  }

  ctx.textAlign = "center";
  ctx.fillStyle = C.ink;
  ctx.fillText("Bent crystal", crystal.x, crystal.y + 32);
  ctx.fillStyle = C.muted;
  ctx.fillText(`${config?.material ?? "Si"}(${config?.h ?? 1}${config?.k ?? 1}${config?.l ?? 1})`, crystal.x, crystal.y + 48);

  ctx.fillStyle = C.diffracted;
  ctx.beginPath();
  ctx.arc(focus.x, focus.y, 5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = C.diffracted;
  ctx.fillText(`${g.realFocus ? "Real" : "Virtual"} focus`, focus.x, focus.y - 18);
  ctx.fillStyle = C.muted;
  ctx.fillText(`${formatNumber(result?.geometric_focus_m, 3)} m`, focus.x, focus.y - 4);

  strokeLine(ctx, detectorA, detectorB, C.incident, 3);
  ctx.fillStyle = C.ink;
  ctx.fillText("Detector plane", detector.x, Math.min(detectorA.y, detectorB.y) - 24);
  ctx.fillStyle = C.muted;
  ctx.fillText(`q = ${formatNumber(q, 2)} m`, detector.x, Math.min(detectorA.y, detectorB.y) - 9);

  const beamHalf = clamp(Math.hypot(endA.x - endB.x, endA.y - endB.y) / 2, 5, g.detectorHalf * 0.8);
  const measureCenter = add(detector, scale(axis, 15));
  const measureA = add(measureCenter, scale(normal, -beamHalf));
  const measureB = add(measureCenter, scale(normal, beamHalf));
  drawDoubleArrow(ctx, measureA, measureB, C.incident);
  ctx.textAlign = "left";
  ctx.fillStyle = C.muted;
  ctx.fillText("Beam width", measureCenter.x + 9, measureCenter.y - 3);
  ctx.fillStyle = C.incident;
  ctx.fillText(`${formatNumber(result?.detector_beam_width_mm, 2)} mm`, measureCenter.x + 9, measureCenter.y + 12);

  const arcRadius = g.compact ? 28 : 36;
  ctx.strokeStyle = C.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(crystal.x, crystal.y, arcRadius, g.incidentAngle, g.outgoingAngle, g.outgoingAngle < g.incidentAngle);
  ctx.stroke();
  if (!g.compact) {
    ctx.textAlign = "center";
    ctx.fillStyle = C.ink;
    ctx.font = "11px Inter, sans-serif";
    ctx.fillText("Bragg angle θ", crystal.x, Math.max(22, crystal.y - 76));
    ctx.font = "600 20px Inter, sans-serif";
    ctx.fillText(`${formatNumber(result?.bragg_angle_deg, 3)}°`, crystal.x, Math.max(40, crystal.y - 56));
  }
  ctx.restore();

  drawDimensions(ctx, g, config, q);
  if (!g.compact) drawLegend(ctx, g);

  if (result?.image_inverted) {
    const boxWidth = Math.min(g.width - 32, g.compact ? 280 : 390);
    const x = (g.width - boxWidth) / 2;
    const boxHeight = g.compact ? 38 : 50;
    const y = g.baselineY - (g.compact ? 54 : 76);
    ctx.save();
    ctx.fillStyle = C.amberFill;
    ctx.strokeStyle = C.amber;
    roundedRect(ctx, x, y, boxWidth, boxHeight, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.amber;
    ctx.textAlign = "center";
    ctx.font = `600 ${g.compact ? 9 : 10}px Inter, sans-serif`;
    ctx.fillText("Detector is beyond focus — image is inverted", g.width / 2, y + 20);
    if (!g.compact) {
      ctx.fillStyle = C.muted;
      ctx.font = "10px Inter, sans-serif";
      ctx.fillText("Move the detector closer to the crystal for an upright image.", g.width / 2, y + 36);
    }
    ctx.restore();
  }

  if (!result) {
    ctx.save();
    ctx.fillStyle = "rgba(255,253,250,0.86)";
    ctx.fillRect(0, 0, g.width, g.height);
    ctx.fillStyle = C.muted;
    ctx.textAlign = "center";
    ctx.font = "500 13px Inter, sans-serif";
    ctx.fillText("Enter a valid setup to preview the optical path", g.width / 2, g.height / 2);
    ctx.restore();
  }
}

function distanceToSegment(p, a, b) {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const ap = { x: p.x - a.x, y: p.y - a.y };
  const lengthSquared = dot(ab, ab) || 1;
  const t = clamp(dot(ap, ab) / lengthSquared, 0, 1);
  const nearest = add(a, scale(ab, t));
  return Math.hypot(p.x - nearest.x, p.y - nearest.y);
}

export function OpticsCanvas({ config = {}, result = null, onDetectorDistanceChange }) {
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const geometryRef = useRef(null);
  const draggingRef = useRef(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [draftQ, setDraftQ] = useState(() => positiveDistance(config.detector_distance_m));
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!draggingRef.current) setDraftQ(positiveDistance(config.detector_distance_m));
  }, [config.detector_distance_m]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const measure = () => {
      const rect = frame.getBoundingClientRect();
      setViewport((current) => {
        const width = Math.max(300, Math.round(rect.width || 900));
        const height = Math.max(300, Math.round(rect.height || 520));
        return current.width === width && current.height === height ? current : { width, height };
      });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(frame);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !viewport.width || !viewport.height) return;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    const geometry = makeGeometry(viewport.width, viewport.height, draftQ, config, result);
    geometryRef.current = geometry;
    ctx.save();
    ctx.translate(viewport.width / 2, viewport.height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-viewport.width / 2, -viewport.height / 2);
    drawScene(ctx, geometry, config, result, draftQ);
    ctx.restore();
  }, [config, result, draftQ, viewport, zoom]);

  const pointerInScene = useCallback((event) => {
    const canvas = canvasRef.current;
    const g = geometryRef.current;
    if (!canvas || !g) return null;
    const rect = canvas.getBoundingClientRect();
    const screen = {
      x: ((event.clientX - rect.left) / rect.width) * g.width,
      y: ((event.clientY - rect.top) / rect.height) * g.height,
    };
    return {
      x: g.width / 2 + (screen.x - g.width / 2) / zoom,
      y: g.height / 2 + (screen.y - g.height / 2) / zoom,
    };
  }, [zoom]);

  const qFromPointer = useCallback((event) => {
    const g = geometryRef.current;
    const p = pointerInScene(event);
    if (!g || !p) return draftQ;
    const projected = dot({ x: p.x - g.crystal.x, y: p.y - g.crystal.y }, g.axis);
    const ratio = (projected - g.axisMin) / (g.axisMax - g.axisMin);
    return clamp(ratioToQ(ratio), Q_MIN, Q_MAX);
  }, [draftQ, pointerInScene]);

  const commitQ = useCallback((value) => {
    const next = clamp(finite(value, draftQ), Q_MIN, Q_MAX);
    setDraftQ(next);
    setAnnouncement(`Detector distance set to ${formatNumber(next, 2)} meters.`);
    onDetectorDistanceChange?.(next);
  }, [draftQ, onDetectorDistanceChange]);

  const handlePointerDown = useCallback((event) => {
    const g = geometryRef.current;
    const p = pointerInScene(event);
    if (!g || !p || distanceToSegment(p, g.detectorA, g.detectorB) > 18 / zoom) return;
    event.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [pointerInScene, zoom]);

  const handlePointerMove = useCallback((event) => {
    if (!draggingRef.current) return;
    event.preventDefault();
    setDraftQ(qFromPointer(event));
  }, [qFromPointer]);

  const finishDrag = useCallback((event, commit = true) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (commit) commitQ(qFromPointer(event));
    else setDraftQ(positiveDistance(config.detector_distance_m));
  }, [commitQ, config.detector_distance_m, qFromPointer]);

  const handleKeyDown = useCallback((event) => {
    let next = draftQ;
    const step = event.shiftKey ? Math.max(0.1, draftQ * 0.1) : Math.max(0.01, draftQ * 0.025);
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next += step;
    else if (event.key === "Home") next = Q_MIN;
    else if (event.key === "End") next = Q_MAX;
    else return;
    event.preventDefault();
    commitQ(next);
  }, [commitQ, draftQ]);

  const ariaDescription = useMemo(() => {
    const kind = result?.focus_kind === "virtual" ? "virtual" : "real";
    return `Interactive ${config.geometry ?? "Bragg"} optical path. Source to ${config.material ?? "silicon"} crystal distance ${formatNumber(config.source_distance_m, 2)} meters. ${kind} focus at ${formatNumber(result?.geometric_focus_m, 3)} meters. Detector distance ${formatNumber(draftQ, 2)} meters and beam width ${formatNumber(result?.detector_beam_width_mm, 2)} millimeters. Drag the detector line, or use arrow keys, to change detector distance between ${Q_MIN} and ${Q_MAX} meters.`;
  }, [config.geometry, config.material, config.source_distance_m, draftQ, result]);

  const adjustZoom = (delta) => setZoom((value) => clamp(Number((value + delta).toFixed(2)), ZOOM_MIN, ZOOM_MAX));

  return (
    <section className="optics-canvas-root" aria-label="Interactive optical path">
      <div className="optics-canvas-shell" ref={frameRef}>
        <canvas
          ref={canvasRef}
          className="optics-canvas-element"
          data-dragging={dragging ? "true" : "false"}
          role="img"
          tabIndex={0}
          aria-label={ariaDescription}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishDrag(event, true)}
          onPointerCancel={(event) => finishDrag(event, false)}
          onKeyDown={handleKeyDown}
        >
          {ariaDescription}
        </canvas>

        <button
          className="optics-canvas-reset"
          type="button"
          onClick={() => {
            setZoom(1);
            setDraftQ(positiveDistance(config.detector_distance_m));
            setAnnouncement("Optical path view reset.");
          }}
          aria-label="Reset optical path view"
        >
          <IconRefresh size={17} stroke={1.8} aria-hidden="true" />
          <span>Reset view</span>
        </button>

        <div className="optics-canvas-toolbar" role="group" aria-label="Optical path zoom controls">
          <button type="button" onClick={() => adjustZoom(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">
            <IconZoomOut size={17} stroke={1.8} aria-hidden="true" />
          </button>
          <output aria-label="Current zoom">{Math.round(zoom * 100)}%</output>
          <button type="button" onClick={() => adjustZoom(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">
            <IconZoomIn size={17} stroke={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </section>
  );
}

export default OpticsCanvas;
