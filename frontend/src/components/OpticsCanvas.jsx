import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";

import {
  CRYSTAL_LINE_WIDTH,
  DISTANCE_MAX_M,
  DISTANCE_MIN_M,
  SCALE_PHYSICAL,
  SCALE_SCHEMATIC,
  buildOpticsGeometry,
  distanceChangeFromRelayout,
  distanceRelayoutAction,
  finite,
  focusPresentation,
  isDistanceDraggable,
  positiveDistance,
} from "../lib/opticsGeometry.js";

const PlotlyFigure = lazy(() => import("./PlotlyFigure.jsx"));

const COLORS = Object.freeze({
  background: "#fffdfa",
  grid: "#ece8e2",
  ink: "#252337",
  muted: "#667085",
  faint: "#d7d3cd",
  incident: "#2f80ed",
  diffracted: "#7c4ac7",
  direct: "#9c72d4",
  crystal: "#a9a6b2",
  crystalLine: "#5e596b",
  focus: "#7c4ac7",
  construction: "#9b86ad",
  amber: "#b96a00",
});

function isAvailableNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function formatNumber(value, digits = 2) {
  if (!isAvailableNumber(value)) return "Unavailable";
  const numeric = Number(value);
  if (Math.abs(numeric) >= 1000) {
    return numeric.toLocaleString(undefined, { maximumFractionDigits: digits });
  }
  if (Math.abs(numeric) < 0.01 && numeric !== 0) return numeric.toExponential(1);
  return numeric.toFixed(digits);
}

function formatEditableDistance(value) {
  return Number(value).toString();
}

function parseEditableDistance(value) {
  const text = value.trim();
  if (!/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0
    ? numeric
    : null;
}

function DistanceLabelInput({ target, value, position, onCommit }) {
  const [draft, setDraft] = useState(() => formatEditableDistance(value));
  const [error, setError] = useState("");
  const focusedRef = useRef(false);
  const cancelBlurRef = useRef(false);
  const symbol = target === "source" ? "p" : "q";
  const label = target === "source" ? "Source–crystal distance p" : "Crystal–detector distance q";

  useEffect(() => {
    if (!focusedRef.current) setDraft(formatEditableDistance(value));
  }, [value]);

  function submit() {
    const parsed = parseEditableDistance(draft);
    if (parsed === null) {
      setError("Enter a finite distance greater than 0 m.");
      return false;
    }
    setError("");
    setDraft(formatEditableDistance(parsed));
    if (parsed !== Number(value)) onCommit(target, parsed);
    return true;
  }

  return (
    <div
      className={`optics-inline-distance optics-inline-distance--${target}`}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      <label>
        <i>{symbol}</i> =
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          aria-label={`${label} in meters`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${target}-distance-input-error` : undefined}
          onFocus={(event) => {
            focusedRef.current = true;
            setError("");
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (parseEditableDistance(draft) !== null) event.currentTarget.blur();
              else submit();
            } else if (event.key === "Escape") {
              cancelBlurRef.current = true;
              setDraft(formatEditableDistance(value));
              setError("");
              event.currentTarget.blur();
            }
          }}
          onBlur={() => {
            focusedRef.current = false;
            if (cancelBlurRef.current) {
              cancelBlurRef.current = false;
              return;
            }
            if (!submit()) {
              setDraft(formatEditableDistance(value));
              setError("Invalid entry; previous distance restored.");
            }
          }}
        />
        <span>m</span>
      </label>
      {error ? <span className="optics-inline-distance__error" id={`${target}-distance-input-error`} role="alert">{error}</span> : null}
    </div>
  );
}

function lineHalfLength(line) {
  return Math.hypot(line.x1 - line.x0, line.y1 - line.y0) / 2;
}

function distanceGuide(start, end, normal, offset, color, role) {
  const shifted = (point, amount) => ({
    x: point.x + normal.x * amount,
    y: point.y + normal.y * amount,
  });
  const startGuide = shifted(start, offset);
  const endGuide = shifted(end, offset);
  const startWitness = shifted(start, offset * 0.55);
  const endWitness = shifted(end, offset * 0.55);
  return {
    trace: {
      type: "scatter",
      mode: "lines",
      showlegend: false,
      x: [startGuide.x, endGuide.x, null, startWitness.x, startGuide.x, null, endWitness.x, endGuide.x],
      y: [startGuide.y, endGuide.y, null, startWitness.y, startGuide.y, null, endWitness.y, endGuide.y],
      line: { color, width: 1.5 },
      hoverinfo: "skip",
      meta: { role },
    },
    midpoint: {
      x: (startGuide.x + endGuide.x) / 2,
      y: (startGuide.y + endGuide.y) / 2,
    },
  };
}

function buildCrystalCurve(geometry, config) {
  const radiusSign = Math.sign(finite(config.bending_radius_m, 1)) || 1;
  const sag = radiusSign * geometry.crystalHalf * (geometry.isLaue ? 0.035 : 0.09);
  return Array.from({ length: 25 }, (_, index) => {
    const t = -1 + (index / 24) * 2;
    const along = geometry.crystalHalf * t;
    const bend = sag * (1 - t * t);
    return {
      x: geometry.crystalTangent.x * along + geometry.crystalNormal.x * bend,
      y: geometry.crystalTangent.y * along + geometry.crystalNormal.y * bend,
    };
  });
}

export function makeOpticsFigure(geometry, config, result, scaleMode, shapeRevision, showGuides, compactPlot) {
  const crystalCurve = buildCrystalCurve(geometry, config);
  const sourceHalf = lineHalfLength(geometry.sourceLine);
  const detectorHalf = lineHalfLength(geometry.detectorLine);
  const focusVisible = focusPresentation(geometry, result).render;
  const projectionVisible = showGuides && isAvailableNumber(result?.bragg_angle_deg);
  const angleMidpoint = geometry.angleArc[Math.floor(geometry.angleArc.length / 2)];
  const detectorLabel = {
    x: geometry.detector.x + geometry.detectorNormal.x * detectorHalf * 1.45,
    y: geometry.detector.y + geometry.detectorNormal.y * detectorHalf * 1.45,
  };
  const crystalLabel = {
    x: geometry.crystalNormal.x * geometry.crystalHalf * 1.85,
    y: geometry.crystalNormal.y * geometry.crystalHalf * 1.85,
  };
  const guideOffset = (distance) => scaleMode === SCALE_PHYSICAL
    ? Math.max(distance * 0.16, 0.025)
    : geometry.sceneSpan * 0.16;
  const sourceGuide = distanceGuide(
    geometry.crystal,
    geometry.source,
    { x: 0, y: 1 },
    guideOffset(geometry.pDisplay),
    COLORS.incident,
    "source-distance-guide",
  );
  const detectorGuide = distanceGuide(
    geometry.crystal,
    geometry.detector,
    {
      x: geometry.detectorNormal.x * (geometry.detector.y <= 0 ? 1 : -1),
      y: geometry.detectorNormal.y * (geometry.detector.y <= 0 ? 1 : -1),
    },
    guideOffset(geometry.qDisplay),
    COLORS.diffracted,
    "detector-distance-guide",
  );
  const virtualFocusVisible = focusVisible && geometry.signedFocusM < 0;

  const data = [
    {
      type: "scatter",
      mode: "lines",
      name: "Incident beam",
      x: [
        geometry.source.x,
        geometry.rayStartA.x,
        null,
        geometry.source.x,
        geometry.crystal.x,
        null,
        geometry.source.x,
        geometry.rayStartB.x,
      ],
      y: [
        geometry.source.y,
        geometry.rayStartA.y,
        null,
        geometry.source.y,
        geometry.crystal.y,
        null,
        geometry.source.y,
        geometry.rayStartB.y,
      ],
      line: { color: COLORS.incident, width: 2 },
      hoverinfo: "skip",
      meta: { role: "incident-ray" },
    },
    {
      type: "scatter",
      mode: "lines",
      name: "Diffracted beam",
      x: [
        geometry.rayStartA.x,
        geometry.detectorRayA.x,
        null,
        geometry.crystal.x,
        geometry.detector.x,
        null,
        geometry.rayStartB.x,
        geometry.detectorRayB.x,
      ],
      y: [
        geometry.rayStartA.y,
        geometry.detectorRayA.y,
        null,
        geometry.crystal.y,
        geometry.detector.y,
        null,
        geometry.rayStartB.y,
        geometry.detectorRayB.y,
      ],
      line: { color: COLORS.diffracted, width: 2.2 },
      hoverinfo: "skip",
      meta: { role: "diffracted-ray" },
    },
    ...(geometry.isLaue
      ? [
          {
            type: "scatter",
            mode: "lines",
            name: "Direct transmission",
            x: [geometry.crystal.x, geometry.directEndpoint.x],
            y: [geometry.crystal.y, geometry.directEndpoint.y],
            line: { color: COLORS.direct, width: 1.5, dash: "dash" },
            hoverinfo: "skip",
            meta: { role: "direct-ray" },
          },
        ]
      : []),
    ...(showGuides ? [sourceGuide.trace, detectorGuide.trace] : []),
    ...(projectionVisible
      ? [
          {
            type: "scatter",
            mode: "lines",
            showlegend: false,
            x: [geometry.crystal.x, geometry.detectorProjection.x, null, geometry.detectorProjection.x, geometry.detector.x],
            y: [geometry.crystal.y, geometry.detectorProjection.y, null, geometry.detectorProjection.y, geometry.detector.y],
            line: { color: COLORS.construction, width: 1.5, dash: "dash" },
            hoverinfo: "skip",
            meta: { role: "detector-projection-guide" },
          },
        ]
      : []),
    ...(showGuides && virtualFocusVisible
      ? [
          {
            type: "scatter",
            mode: "lines",
            showlegend: false,
            x: [geometry.rayStartA.x, geometry.focus.x, null, geometry.rayStartB.x, geometry.focus.x],
            y: [geometry.rayStartA.y, geometry.focus.y, null, geometry.rayStartB.y, geometry.focus.y],
            line: { color: COLORS.focus, width: 1.5, dash: "dash" },
            hoverinfo: "skip",
            meta: { role: "virtual-focus-guide" },
          },
        ]
      : []),
    {
      type: "scatter",
      mode: "lines",
      showlegend: false,
      x: geometry.angleArc.map((item) => item.x),
      y: geometry.angleArc.map((item) => item.y),
      line: { color: COLORS.amber, width: 1.5, dash: "dot" },
      hovertemplate: `Scattering angle 2θ = ${formatNumber(geometry.thetaActualDeg * 2, 3)}°<extra></extra>`,
      meta: { role: "scattering-angle" },
    },
    {
      type: "scatter",
      mode: "lines",
      showlegend: false,
      x: crystalCurve.map((item) => item.x),
      y: crystalCurve.map((item) => item.y),
      line: {
        color: COLORS.crystal,
        width: geometry.isLaue ? CRYSTAL_LINE_WIDTH.laue : CRYSTAL_LINE_WIDTH.bragg,
      },
      hovertemplate: `${geometry.isLaue ? "Thin Laue transmission" : "Bragg reflection"} crystal<br>Rotation = ${formatNumber(geometry.crystalRotationDeg, 3)}°<extra></extra>`,
      meta: { role: "crystal" },
    },
    {
      type: "scatter",
      mode: "lines",
      showlegend: false,
      x: crystalCurve.map((item) => item.x),
      y: crystalCurve.map((item) => item.y),
      line: { color: COLORS.crystalLine, width: geometry.isLaue ? 1 : 1.5 },
      hoverinfo: "skip",
    },
    {
      type: "scatter",
      mode: "markers",
      showlegend: false,
      x: [geometry.source.x],
      y: [geometry.source.y],
      marker: {
        color: COLORS.incident,
        size: 10,
        symbol: "diamond",
        line: { color: "#ffffff", width: 1.5 },
      },
      hovertemplate: `Source<br>p = ${formatNumber(geometry.sourceDistanceM, 4)} m<br>Drag the source plane to adjust<extra></extra>`,
      meta: { role: "source" },
    },
    {
      type: "scatter",
      mode: "markers",
      showlegend: false,
      x: [geometry.detector.x],
      y: [geometry.detector.y],
      marker: {
        color: COLORS.incident,
        size: 8,
        symbol: "circle",
        line: { color: "#ffffff", width: 1.2 },
      },
      hovertemplate: `Detector<br>q = ${formatNumber(geometry.detectorDistanceM, 4)} m<br>Beam = ${isAvailableNumber(result?.detector_beam_width_mm) ? `${formatNumber(result.detector_beam_width_mm, 3)} mm` : "Unavailable"}<extra></extra>`,
      meta: { role: "detector" },
    },
    ...(showGuides && focusVisible
      ? [
          {
            type: "scatter",
            mode: "markers",
            showlegend: false,
            x: [geometry.focus.x],
            y: [geometry.focus.y],
            marker: {
              color: COLORS.focus,
              size: 9,
              symbol: geometry.signedFocusM < 0 ? "circle-open" : "circle",
              line: { color: COLORS.focus, width: 2 },
            },
            hovertemplate: `${geometry.signedFocusM < 0 ? "Virtual" : "Real"} focus<br>${formatNumber(result?.geometric_focus_m, 4)} m<extra></extra>`,
            meta: { role: "focus" },
          },
        ]
      : []),
  ];

  const commonAnnotation = {
    showarrow: false,
    bgcolor: "rgba(255, 253, 250, 0.86)",
    borderpad: 3,
    font: { family: "Inter, sans-serif", size: 10, color: COLORS.ink },
  };
  const annotations = [
    {
      ...commonAnnotation,
      x: geometry.source.x,
      y: geometry.source.y + sourceHalf * 1.55,
      text: "<b>Source</b>",
    },
    {
      ...commonAnnotation,
      x: detectorLabel.x,
      y: detectorLabel.y,
      text: "<b>Detector</b>",
    },
    ...(showGuides
      ? [
          {
            ...commonAnnotation,
            ...sourceGuide.midpoint,
            yshift: compactPlot && scaleMode === SCALE_PHYSICAL ? 24 : 0,
            text: `<b><i>p</i> = ${formatNumber(geometry.sourceDistanceM, 3)} m</b>`,
            font: { ...commonAnnotation.font, size: 12, color: COLORS.incident },
            bordercolor: COLORS.incident,
            borderwidth: 1,
            borderpad: 5,
          },
          {
            ...commonAnnotation,
            ...detectorGuide.midpoint,
            text: `<b><i>q</i> = ${formatNumber(geometry.detectorDistanceM, 3)} m</b>`,
            font: { ...commonAnnotation.font, size: 12, color: COLORS.diffracted },
            bordercolor: COLORS.diffracted,
            borderwidth: 1,
            borderpad: 5,
          },
        ]
      : []),
    ...(projectionVisible && !compactPlot
      ? [
          {
            ...commonAnnotation,
            x: geometry.detectorProjection.x / 2,
            y: 0,
            yshift: geometry.detector.y < 0 ? 11 : -11,
            text: `|<i>q</i>∥| = ${formatNumber(geometry.detectorLongitudinalM, 3)} m`,
            font: { ...commonAnnotation.font, color: COLORS.construction },
          },
          {
            ...commonAnnotation,
            x: geometry.detectorProjection.x,
            y: geometry.detector.y / 2,
            xshift: -8,
            xanchor: "right",
            text: `|<i>q</i>⊥| = ${formatNumber(geometry.detectorTransverseM, 3)} m`,
            font: { ...commonAnnotation.font, color: COLORS.construction },
          },
        ]
      : []),
    {
      ...commonAnnotation,
      x: crystalLabel.x,
      y: crystalLabel.y,
      text: `<b>${config.material || "Si"}(${config.h ?? 1}${config.k ?? 1}${config.l ?? 1})</b><br>${geometry.isLaue ? "thin Laue" : "Bragg"} crystal`,
    },
    {
      ...commonAnnotation,
      x: angleMidpoint.x * 1.35,
      y: angleMidpoint.y * 1.35,
      text: `2θ ${formatNumber(geometry.thetaActualDeg * 2, 2)}°`,
      font: { ...commonAnnotation.font, color: COLORS.amber },
    },
    ...(showGuides && focusVisible
      ? [
          {
            ...commonAnnotation,
            x: geometry.focus.x,
            y: geometry.focus.y,
            xshift: compactPlot ? -12 : 12,
            yshift: compactPlot ? 18 : -15,
            xanchor: compactPlot ? "right" : "left",
            text: compactPlot
              ? `${geometry.signedFocusM < 0 ? "Virtual" : "Real"} focus`
              : `${geometry.signedFocusM < 0 ? "Virtual" : "Real"} focus<br><i>f</i><sub>g</sub> = ${formatNumber(result?.geometric_focus_m, 3)} m`,
            font: { ...commonAnnotation.font, size: compactPlot ? 9 : 10, color: COLORS.diffracted },
          },
        ]
      : []),
  ];

  const physical = scaleMode === SCALE_PHYSICAL;
  const axisCommon = {
    range: undefined,
    fixedrange: false,
    zeroline: false,
    showgrid: physical,
    gridcolor: COLORS.grid,
    gridwidth: 1,
    showline: physical,
    linecolor: COLORS.faint,
    ticks: physical ? "outside" : "",
    tickfont: { size: 9, color: COLORS.muted },
    visible: physical,
  };
  const layout = {
    autosize: true,
    paper_bgcolor: COLORS.background,
    plot_bgcolor: COLORS.background,
    font: { family: "Inter, sans-serif", color: COLORS.ink },
    margin: physical ? { l: 54, r: 24, t: 44, b: 60 } : { l: 20, r: 20, t: 40, b: 28 },
    hovermode: "closest",
    dragmode: "pan",
    showlegend: true,
    legend: {
      orientation: "h",
      x: 0.5,
      xanchor: "center",
      y: 1.01,
      yanchor: "top",
      bgcolor: "rgba(255, 253, 250, 0.82)",
      bordercolor: COLORS.faint,
      borderwidth: 1,
      font: { size: 9, color: COLORS.muted },
    },
    xaxis: {
      ...axisCommon,
      range: geometry.xRange,
      title: physical ? { text: "Longitudinal position (m)", font: { size: 10 } } : undefined,
      constrain: "domain",
    },
    yaxis: {
      ...axisCommon,
      range: geometry.yRange,
      title: physical ? { text: "Transverse position (m)", font: { size: 10 } } : undefined,
      scaleanchor: "x",
      scaleratio: 1,
      constrain: "domain",
    },
    shapes: [
      {
        type: "line",
        xref: "x",
        yref: "y",
        ...geometry.sourceLine,
        editable: isDistanceDraggable(geometry.sourceDistanceM),
        layer: "above",
        line: { color: COLORS.incident, width: 7 },
        name: "source-handle",
      },
      {
        type: "line",
        xref: "x",
        yref: "y",
        ...geometry.detectorLine,
        editable: isDistanceDraggable(geometry.detectorDistanceM),
        layer: "above",
        line: { color: COLORS.incident, width: 6 },
        name: "detector-handle",
      },
    ],
    annotations,
    editrevision: `optics-shapes-${shapeRevision}`,
    uirevision: `${scaleMode}-${config.geometry}-${config.condition}-${config.h}-${config.k}-${config.l}-${geometry.sourceDistanceM}-${geometry.detectorDistanceM}-${geometry.thetaActualDeg}-${geometry.signedFocusM}`,
  };

  return { data, layout };
}

export function OpticsCanvas({
  config = {},
  result = null,
  onSourceDistanceChange,
  onDetectorDistanceChange,
}) {
  const [scaleMode, setScaleMode] = useState(SCALE_SCHEMATIC);
  const [showGuides, setShowGuides] = useState(true);
  const [compactPlot, setCompactPlot] = useState(false);
  const [plotDistances, setPlotDistances] = useState(() => ({
    source: positiveDistance(config.source_distance_m, 1.2),
    detector: positiveDistance(config.detector_distance_m, 1.5),
  }));
  const [preview, setPreview] = useState(null);
  const [labelPositions, setLabelPositions] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [shapeRevision, setShapeRevision] = useState(0);
  const plotStageRef = useRef(null);
  const plotShellRef = useRef(null);
  const labelPositionFrameRef = useRef(null);
  const geometryRef = useRef(null);
  const lastCommittedRef = useRef({ source: null, detector: null });
  const commitSequenceRef = useRef(0);

  const measureLabelPositions = useCallback(() => {
    const shell = plotShellRef.current;
    const stage = plotStageRef.current;
    if (!shell || !stage) return;
    if (stage.closest('.optics-plot-root')?.dataset.guidesVisible !== "true") return;
    const source = stage.querySelector('.optics-plot-figure g.annotation[data-index="2"]');
    const detector = stage.querySelector('.optics-plot-figure g.annotation[data-index="3"]');
    if (!source || !detector || !/^p\s*=/.test(source.textContent.trim()) || !/^q\s*=/.test(detector.textContent.trim())) return;
    const shellRect = shell.getBoundingClientRect();
    const center = (node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2 - shellRect.left,
        y: rect.top + rect.height / 2 - shellRect.top,
      };
    };
    const next = { source: center(source), detector: center(detector) };
    setLabelPositions((previous) =>
      previous && ["source", "detector"].every((target) =>
        Math.abs(previous[target].x - next[target].x) < 0.5 &&
        Math.abs(previous[target].y - next[target].y) < 0.5,
      ) ? previous : next,
    );
  }, []);

  const scheduleLabelPositionMeasure = useCallback(() => {
    if (labelPositionFrameRef.current !== null) cancelAnimationFrame(labelPositionFrameRef.current);
    labelPositionFrameRef.current = requestAnimationFrame(() => {
      labelPositionFrameRef.current = null;
      measureLabelPositions();
    });
  }, [measureLabelPositions]);

  useEffect(() => {
    const stage = plotStageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const compact = entry.contentRect.width < 600;
      setCompactPlot((current) => current === compact ? current : compact);
      scheduleLabelPositionMeasure();
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [scheduleLabelPositionMeasure]);

  useEffect(() => {
    if (showGuides) scheduleLabelPositionMeasure();
    else setLabelPositions(null);
  }, [showGuides, scheduleLabelPositionMeasure]);

  useEffect(() => () => {
    if (labelPositionFrameRef.current !== null) cancelAnimationFrame(labelPositionFrameRef.current);
  }, []);

  useEffect(() => {
    const source = positiveDistance(config.source_distance_m, 1.2);
    const detector = positiveDistance(config.detector_distance_m, 1.5);
    commitSequenceRef.current += 1;
    setPlotDistances({ source, detector });
    setPreview(null);
    setAnnouncement("");
    setShapeRevision((current) => current + 1);
    lastCommittedRef.current = { source, detector };
  }, [config.source_distance_m, config.detector_distance_m]);

  const plotConfig = useMemo(
    () => ({
      ...config,
      source_distance_m: plotDistances.source,
      detector_distance_m: plotDistances.detector,
    }),
    [config, plotDistances.detector, plotDistances.source],
  );
  const geometry = useMemo(
    () => buildOpticsGeometry(plotConfig, result, scaleMode),
    [plotConfig, result, scaleMode],
  );
  geometryRef.current = geometry;
  const figure = useMemo(
    () => makeOpticsFigure(geometry, plotConfig, result, scaleMode, shapeRevision, showGuides, compactPlot),
    [geometry, plotConfig, result, scaleMode, shapeRevision, showGuides, compactPlot],
  );

  const commitDistance = useCallback(
    async (target, value) => {
      const next = Number(value);
      if (!Number.isFinite(next) || next <= 0) return;
      if (lastCommittedRef.current[target] === next) {
        // An editable plane may have moved perpendicular to its optical axis.
        // Its p/q is unchanged, but Plotly still needs a fresh shape revision
        // to put the visible handle back on the physical ray.
        setShapeRevision((current) => current + 1);
        setPreview(null);
        return;
      }
      setShapeRevision((current) => current + 1);
      const sequence = commitSequenceRef.current + 1;
      commitSequenceRef.current = sequence;
      lastCommittedRef.current[target] = next;
      setPlotDistances((current) => ({ ...current, [target]: next }));
      setPreview(null);
      const label = target === "source" ? "Source distance p" : "Detector distance q";
      setAnnouncement(`${label} set to ${formatNumber(next, 4)} meters. Recalculating.`);
      const callback = target === "source" ? onSourceDistanceChange : onDetectorDistanceChange;
      const success = await callback?.(next);
      if (success === false && sequence === commitSequenceRef.current) {
        setAnnouncement(`${label} draft retained. Calculation did not complete.`);
      }
    },
    [onDetectorDistanceChange, onSourceDistanceChange],
  );

  const handleRelayouting = useCallback(
    (update) => {
      const change = distanceChangeFromRelayout(update, geometryRef.current, scaleMode);
      if (change) setPreview(change);
    },
    [scaleMode],
  );

  const handleRelayout = useCallback(
    (update) => {
      const action = distanceRelayoutAction(update, geometryRef.current, scaleMode);
      if (action?.kind === "reset") {
        setPreview(null);
        setShapeRevision((current) => current + 1);
      } else if (action?.kind === "commit") {
        commitDistance(action.change.target, action.change.value);
      }
    },
    [commitDistance, scaleMode],
  );

  const handleDistanceKey = useCallback(
    (target, event) => {
      const current = plotDistances[target];
      const step = event.shiftKey ? Math.max(0.0001, current * 0.1) : Math.max(0.00001, current * 0.025);
      let next = current;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= step;
      else if (event.key === "ArrowRight" || event.key === "ArrowUp") next += step;
      else if (event.key === "Home") next = DISTANCE_MIN_M;
      else if (event.key === "End") next = DISTANCE_MAX_M;
      else return;
      event.preventDefault();
      if (next <= 0) next = current * 0.5;
      commitDistance(target, next);
    },
    [commitDistance, plotDistances],
  );

  const shownSource = preview?.target === "source" ? preview.value : plotDistances.source;
  const shownDetector = preview?.target === "detector" ? preview.value : plotDistances.detector;
  const hasLocalDistanceDraft = plotDistances.source !== positiveDistance(config.source_distance_m, 1.2) ||
    plotDistances.detector !== positiveDistance(config.detector_distance_m, 1.5);
  const reflection = `${config.h ?? 1}${config.k ?? 1}${config.l ?? 1}`;
  const detectorSide = geometry.detector.x > geometry.crystal.x ? "right" : "left";
  const focusKind = geometry.signedFocusM < 0 ? "virtual" : "real";
  const focusOutsideInitialView = focusPresentation(geometry, result).outsideInitialView;
  const distanceOutsideDragRange = !isDistanceDraggable(geometry.sourceDistanceM) ||
    !isDistanceDraggable(geometry.detectorDistanceM);
  const projectionDescription = isAvailableNumber(result?.bragg_angle_deg)
    ? ` Detector projection along the incident axis is ${formatNumber(geometry.detectorLongitudinalM, 3)} meters and perpendicular to it is ${formatNumber(geometry.detectorTransverseM, 3)} meters.`
    : "";
  const focusDescription = isAvailableNumber(result?.geometric_focus_m)
    ? ` Geometric focus is ${formatNumber(result.geometric_focus_m, 3)} meters, ${focusKind}.`
    : "";
  const guideDescription = showGuides
    ? `Guides are visible.${projectionDescription}${focusDescription}`
    : "Guides and distance labels are hidden.";
  const draftDescription = hasLocalDistanceDraft && result
    ? " The shown p and q are a draft; angle and focus still come from the previous calculation."
    : "";
  const ariaDescription = `Interactive ${config.geometry || "Bragg"} optical path. Rays travel from the source on the right to the ${config.material || "silicon"}(${reflection}) crystal and toward the detector on the ${detectorSide}. Source distance p is ${formatNumber(shownSource, 3)} meters. Detector distance q is ${formatNumber(shownDetector, 3)} meters.${draftDescription} ${guideDescription} Drag a blue plane within ${DISTANCE_MIN_M} to ${DISTANCE_MAX_M} meters, or use a numeric field for any positive distance.`;

  const plotlyConfig = useMemo(
    () => ({
      responsive: true,
      editable: true,
      edits: {
        annotationPosition: false,
        annotationTail: false,
        annotationText: false,
        axisTitleText: false,
        colorbarPosition: false,
        colorbarTitleText: false,
        legendPosition: false,
        legendText: false,
        shapePosition: true,
        titleText: false,
      },
      scrollZoom: true,
      doubleClick: "reset",
      displaylogo: false,
      displayModeBar: true,
      modeBarButtonsToRemove: ["select2d", "lasso2d"],
      toImageButtonOptions: {
        format: "png",
        filename: `dxas-${config.geometry || "bragg"}-${config.material || "Si"}${reflection}`,
        scale: 2,
      },
    }),
    [config.geometry, config.material, reflection],
  );

  return (
    <section
      className="optics-canvas-root optics-plot-root"
      data-testid="optics-plot-root"
      data-geometry={config.geometry || "bragg"}
      data-reflection={reflection}
      data-scale-mode={scaleMode}
      data-guides-visible={showGuides}
      data-inline-distance-inputs={showGuides && Boolean(labelPositions)}
      data-compact-plot={compactPlot}
      data-local-distance-draft={hasLocalDistanceDraft}
      data-dragging={preview?.target || "false"}
      data-source-x={geometry.source.x}
      data-crystal-x={geometry.crystal.x}
      data-detector-x={geometry.detector.x}
      aria-label="Interactive optical path"
    >
      <div className="optics-canvas-shell optics-plot-shell" ref={plotShellRef}>
        <div
          ref={plotStageRef}
          className="optics-plot-stage"
          data-testid="optics-plot"
          role="group"
          aria-label={ariaDescription}
        >
          <Suspense
            fallback={
              <div className="optics-plot-loading" role="status">
                <IconLoader2 className="icon-spin" aria-hidden="true" size={22} />
                Loading interactive optics…
              </div>
            }
          >
            <PlotlyFigure
              data={figure.data}
              layout={figure.layout}
              config={plotlyConfig}
              className="optics-plot-figure"
              style={{ width: "100%", height: "100%" }}
              useResizeHandler
              onInitialized={scheduleLabelPositionMeasure}
              onUpdate={scheduleLabelPositionMeasure}
              onAfterPlot={scheduleLabelPositionMeasure}
              onRelayouting={handleRelayouting}
              onRelayout={handleRelayout}
            />
          </Suspense>
        </div>

        {showGuides && labelPositions ? (
          <>
            <DistanceLabelInput
              target="source"
              value={shownSource}
              position={labelPositions.source}
              onCommit={commitDistance}
            />
            <DistanceLabelInput
              target="detector"
              value={shownDetector}
              position={labelPositions.detector}
              onCommit={commitDistance}
            />
          </>
        ) : null}

        <div className="optics-scale-switch" role="group" aria-label="Plot scale">
          <button
            type="button"
            className={scaleMode === SCALE_SCHEMATIC ? "is-active" : ""}
            aria-pressed={scaleMode === SCALE_SCHEMATIC}
            onClick={() => setScaleMode(SCALE_SCHEMATIC)}
          >
            Schematic
          </button>
          <button
            type="button"
            className={scaleMode === SCALE_PHYSICAL ? "is-active" : ""}
            aria-pressed={scaleMode === SCALE_PHYSICAL}
            onClick={() => setScaleMode(SCALE_PHYSICAL)}
          >
            Physical scale
          </button>
        </div>

        <label className="optics-guide-toggle">
          <input
            type="checkbox"
            checked={showGuides}
            onChange={(event) => setShowGuides(event.target.checked)}
          />
          Show guides and distances
        </label>

        <p className="optics-scale-note" role="note">
          {scaleMode === SCALE_PHYSICAL
            ? "Positions are in meters; device marks, crystal thickness, and ray envelope are illustrative."
            : "Distances are compressed in this schematic; the scattering angle is unchanged. Device marks and ray envelope are illustrative."}
          {hasLocalDistanceDraft && result
            ? " The shown p and q are a draft; angle and focus still come from the previous calculation."
            : ""}
          {distanceOutsideDragRange
            ? ` Drag handles operate from ${DISTANCE_MIN_M} to ${DISTANCE_MAX_M} m; use the numeric distance fields outside that range.`
            : ""}
          {focusOutsideInitialView
            ? ` ${focusKind === "virtual" ? "Virtual" : "Real"} focus at ${formatNumber(result.geometric_focus_m, 3)} m is outside the initial view; ${showGuides ? "use Plotly Autoscale or pan to inspect" : "turn on guides, then use Plotly Autoscale or pan to inspect"}.`
            : ""}
        </p>

        {showGuides && compactPlot && result ? (
          <div className="optics-guide-summary" aria-hidden="true">
            {isAvailableNumber(result.geometric_focus_m) ? (
              <span>{focusKind === "virtual" ? "Virtual" : "Real"} focus <i>f</i><sub>g</sub> {formatNumber(result.geometric_focus_m, 3)} m</span>
            ) : null}
            {isAvailableNumber(result.bragg_angle_deg) ? (
              <>
                <span>Along beam |<i>q</i>∥| {formatNumber(geometry.detectorLongitudinalM, 3)} m</span>
                <span>Across beam |<i>q</i>⊥| {formatNumber(geometry.detectorTransverseM, 3)} m</span>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="optics-distance-readouts" aria-label="Draggable optical distances">
          <div
            className={`optics-distance-chip${preview?.target === "source" ? " is-dragging" : ""}`}
            data-testid="source-distance-readout"
            role="spinbutton"
            tabIndex={0}
            aria-label="Source to crystal distance p"
            aria-valuemin={0}
            aria-valuenow={shownSource}
            aria-valuetext={`${formatNumber(shownSource, 4)} meters`}
            onKeyDown={(event) => handleDistanceKey("source", event)}
          >
            <span>Source</span>
            <strong><i>p</i> {formatNumber(shownSource, 3)} m</strong>
            <small>{isDistanceDraggable(shownSource) ? "drag blue plane" : "edit numeric p"}</small>
          </div>
          <div
            className={`optics-distance-chip${preview?.target === "detector" ? " is-dragging" : ""}`}
            data-testid="detector-distance-readout"
            role="spinbutton"
            tabIndex={0}
            aria-label="Crystal to detector distance q"
            aria-valuemin={0}
            aria-valuenow={shownDetector}
            aria-valuetext={`${formatNumber(shownDetector, 4)} meters`}
            onKeyDown={(event) => handleDistanceKey("detector", event)}
          >
            <span>Detector</span>
            <strong><i>q</i> {formatNumber(shownDetector, 3)} m</strong>
            <small>{isDistanceDraggable(shownDetector) ? "drag blue plane" : "edit numeric q"}</small>
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </section>
  );
}

export default OpticsCanvas;
