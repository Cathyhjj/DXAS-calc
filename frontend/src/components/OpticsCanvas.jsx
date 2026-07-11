import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";

import {
  CRYSTAL_LINE_WIDTH,
  DISTANCE_MAX_M,
  DISTANCE_MIN_M,
  SCALE_PHYSICAL,
  SCALE_SCHEMATIC,
  buildOpticsGeometry,
  clamp,
  distanceChangeFromRelayout,
  finite,
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
  amber: "#b96a00",
});

function formatNumber(value, digits = 2) {
  const numeric = finite(value, 0);
  if (Math.abs(numeric) >= 1000) {
    return numeric.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  if (Math.abs(numeric) < 0.01 && numeric !== 0) return numeric.toExponential(1);
  return numeric.toFixed(digits);
}

function lineHalfLength(line) {
  return Math.hypot(line.x1 - line.x0, line.y1 - line.y0) / 2;
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

function makeFigure(geometry, config, result, scaleMode, shapeRevision) {
  const crystalCurve = buildCrystalCurve(geometry, config);
  const sourceHalf = lineHalfLength(geometry.sourceLine);
  const detectorHalf = lineHalfLength(geometry.detectorLine);
  const focusVisible = geometry.focusDisplay <= geometry.sceneSpan * 1.8;
  const angleMidpoint = geometry.angleArc[Math.floor(geometry.angleArc.length / 2)];
  const detectorLabel = {
    x: geometry.detector.x + geometry.detectorNormal.x * detectorHalf * 1.45,
    y: geometry.detector.y + geometry.detectorNormal.y * detectorHalf * 1.45,
  };
  const crystalLabel = {
    x: geometry.crystalNormal.x * geometry.crystalHalf * 1.85,
    y: geometry.crystalNormal.y * geometry.crystalHalf * 1.85,
  };

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
      hovertemplate: `Detector<br>q = ${formatNumber(geometry.detectorDistanceM, 4)} m<br>Beam = ${formatNumber(result?.detector_beam_width_mm, 3)} mm<extra></extra>`,
      meta: { role: "detector" },
    },
    ...(focusVisible
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
              symbol: result?.focus_kind === "virtual" ? "circle-open" : "circle",
              line: { color: COLORS.focus, width: 2 },
            },
            hovertemplate: `${result?.focus_kind === "virtual" ? "Virtual" : "Real"} focus<br>${formatNumber(result?.geometric_focus_m, 4)} m<extra></extra>`,
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
      text: `<b>Source</b><br><i>p</i> ${formatNumber(geometry.sourceDistanceM, 3)} m`,
    },
    {
      ...commonAnnotation,
      x: detectorLabel.x,
      y: detectorLabel.y,
      text: `<b>Detector</b><br><i>q</i> ${formatNumber(geometry.detectorDistanceM, 3)} m`,
    },
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
    ...(focusVisible
      ? [
          {
            ...commonAnnotation,
            x: geometry.focus.x,
            y: geometry.focus.y,
            xshift: 12,
            yshift: -15,
            xanchor: "left",
            text: `${result?.focus_kind === "virtual" ? "Virtual" : "Real"} focus`,
            font: { ...commonAnnotation.font, color: COLORS.diffracted },
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
        editable: true,
        layer: "above",
        line: { color: COLORS.incident, width: 7 },
        name: "source-handle",
      },
      {
        type: "line",
        xref: "x",
        yref: "y",
        ...geometry.detectorLine,
        editable: true,
        layer: "above",
        line: { color: COLORS.incident, width: 6 },
        name: "detector-handle",
      },
    ],
    annotations,
    editrevision: `optics-shapes-${shapeRevision}`,
    uirevision: `${scaleMode}-${config.geometry}-${config.condition}-${config.h}-${config.k}-${config.l}`,
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
  const [plotDistances, setPlotDistances] = useState(() => ({
    source: positiveDistance(config.source_distance_m, 1.2),
    detector: positiveDistance(config.detector_distance_m, 1.5),
  }));
  const [preview, setPreview] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [shapeRevision, setShapeRevision] = useState(0);
  const geometryRef = useRef(null);
  const lastCommittedRef = useRef({ source: null, detector: null });
  const commitSequenceRef = useRef(0);

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
    () => makeFigure(geometry, plotConfig, result, scaleMode, shapeRevision),
    [geometry, plotConfig, result, scaleMode, shapeRevision],
  );

  const commitDistance = useCallback(
    async (target, value) => {
      const next = Number(clamp(finite(value, DISTANCE_MIN_M), DISTANCE_MIN_M, DISTANCE_MAX_M).toFixed(4));
      setShapeRevision((current) => current + 1);
      if (Math.abs(finite(lastCommittedRef.current[target], -1) - next) < 1e-4) {
        setPreview(null);
        return;
      }
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
        const fallback = positiveDistance(
          target === "source" ? config.source_distance_m : config.detector_distance_m,
          target === "source" ? 1.2 : 1.5,
        );
        lastCommittedRef.current[target] = fallback;
        setPlotDistances((current) => ({ ...current, [target]: fallback }));
        setShapeRevision((current) => current + 1);
        setAnnouncement(`${label} could not be updated and was restored to ${formatNumber(fallback, 4)} meters.`);
      }
    },
    [config.detector_distance_m, config.source_distance_m, onDetectorDistanceChange, onSourceDistanceChange],
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
      const change = distanceChangeFromRelayout(update, geometryRef.current, scaleMode);
      if (change) commitDistance(change.target, change.value);
    },
    [commitDistance, scaleMode],
  );

  const handleDistanceKey = useCallback(
    (target, event) => {
      const current = plotDistances[target];
      const step = event.shiftKey ? Math.max(0.1, current * 0.1) : Math.max(0.01, current * 0.025);
      let next = current;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= step;
      else if (event.key === "ArrowRight" || event.key === "ArrowUp") next += step;
      else if (event.key === "Home") next = DISTANCE_MIN_M;
      else if (event.key === "End") next = DISTANCE_MAX_M;
      else return;
      event.preventDefault();
      commitDistance(target, next);
    },
    [commitDistance, plotDistances],
  );

  const shownSource = preview?.target === "source" ? preview.value : plotDistances.source;
  const shownDetector = preview?.target === "detector" ? preview.value : plotDistances.detector;
  const reflection = `${config.h ?? 1}${config.k ?? 1}${config.l ?? 1}`;
  const ariaDescription = `Interactive ${config.geometry || "Bragg"} optical path. Rays travel from the source on the right to the ${config.material || "silicon"}(${reflection}) crystal and toward the detector on the left. Source distance p is ${formatNumber(shownSource, 3)} meters. Detector distance q is ${formatNumber(shownDetector, 3)} meters. Drag either blue plane to change its distance, or use the corresponding numeric field.`;

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
      data-dragging={preview?.target || "false"}
      data-source-x={geometry.source.x}
      data-crystal-x={geometry.crystal.x}
      data-detector-x={geometry.detector.x}
      aria-label="Interactive optical path"
    >
      <div className="optics-canvas-shell optics-plot-shell">
        <div
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
              onRelayouting={handleRelayouting}
              onRelayout={handleRelayout}
            />
          </Suspense>
        </div>

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

        <div className="optics-distance-readouts" aria-label="Draggable optical distances">
          <div
            className={`optics-distance-chip${preview?.target === "source" ? " is-dragging" : ""}`}
            data-testid="source-distance-readout"
            role="slider"
            tabIndex={0}
            aria-label="Source to crystal distance p"
            aria-valuemin={DISTANCE_MIN_M}
            aria-valuemax={DISTANCE_MAX_M}
            aria-valuenow={shownSource}
            aria-valuetext={`${formatNumber(shownSource, 4)} meters`}
            onKeyDown={(event) => handleDistanceKey("source", event)}
          >
            <span>Source</span>
            <strong><i>p</i> {formatNumber(shownSource, 3)} m</strong>
            <small>drag blue plane</small>
          </div>
          <div
            className={`optics-distance-chip${preview?.target === "detector" ? " is-dragging" : ""}`}
            data-testid="detector-distance-readout"
            role="slider"
            tabIndex={0}
            aria-label="Crystal to detector distance q"
            aria-valuemin={DISTANCE_MIN_M}
            aria-valuemax={DISTANCE_MAX_M}
            aria-valuenow={shownDetector}
            aria-valuetext={`${formatNumber(shownDetector, 4)} meters`}
            onKeyDown={(event) => handleDistanceKey("detector", event)}
          >
            <span>Detector</span>
            <strong><i>q</i> {formatNumber(shownDetector, 3)} m</strong>
            <small>drag blue plane</small>
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </section>
  );
}

export default OpticsCanvas;
