import { lazy, Suspense, useMemo } from "react";
import { IconActivity, IconLoader2 } from "@tabler/icons-react";

const PlotlyFigure = lazy(() => import("./PlotlyFigure.jsx"));

const COLORS = Object.freeze({
  selected: "#6d35b5",
  sigma: "#2f80ed",
  pi: "#d16b32",
  grid: "#ece8e2",
  muted: "#667085",
});

function finiteSeries(values, length) {
  if (!Array.isArray(values) || values.length !== length) return null;
  const series = values.map(Number);
  return series.every(Number.isFinite) ? series : null;
}

function polarizationLabel(polarization) {
  if (polarization === "sigma") return "σ selected";
  if (polarization === "pi") return "π selected";
  return "Unpolarized average";
}

function modelLabel(model) {
  if (!model) return "Model pending";
  return String(model).replaceAll("_", " ");
}

function hasMetric(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

export function ReflectivityPlot({ result, config }) {
  const figure = useMemo(() => {
    const curve = result?.reflectivity_curve;
    const x = Array.isArray(curve?.x) ? curve.x.map(Number) : [];
    if (!x.length || !x.every(Number.isFinite)) return null;

    const selected = finiteSeries(curve.selected, x.length);
    const sigma = finiteSeries(curve.sigma, x.length);
    const pi = finiteSeries(curve.pi, x.length);
    if (!selected && !sigma && !pi) return null;

    const polarization = config?.polarization || "unpolarized";
    const traces = [];

    if (selected) {
      traces.push({
        type: "scatter",
        mode: "lines",
        name: polarizationLabel(polarization),
        x,
        y: selected,
        line: { color: COLORS.selected, width: 3 },
        hovertemplate: "%{x:.4f} eV<br>R = %{y:.4f}<extra>%{fullData.name}</extra>",
      });
    }

    if (sigma && polarization !== "sigma") {
      traces.push({
        type: "scatter",
        mode: "lines",
        name: "σ polarization",
        x,
        y: sigma,
        line: { color: COLORS.sigma, width: 1.7, dash: "dot" },
        hovertemplate: "%{x:.4f} eV<br>Rσ = %{y:.4f}<extra></extra>",
      });
    }

    if (pi && polarization !== "pi") {
      traces.push({
        type: "scatter",
        mode: "lines",
        name: "π polarization",
        x,
        y: pi,
        line: { color: COLORS.pi, width: 1.7, dash: "dash" },
        hovertemplate: "%{x:.4f} eV<br>Rπ = %{y:.4f}<extra></extra>",
      });
    }

    return {
      data: traces,
      layout: {
        autosize: true,
        margin: { l: 56, r: 20, t: 16, b: 52 },
        paper_bgcolor: "#ffffff",
        plot_bgcolor: "#fffefd",
        font: { family: "Inter, sans-serif", color: COLORS.muted, size: 11 },
        hovermode: "x unified",
        showlegend: traces.length > 1,
        legend: {
          orientation: "h",
          x: 0,
          xanchor: "left",
          y: 1.02,
          yanchor: "bottom",
          font: { size: 10 },
        },
        xaxis: {
          title: { text: "Energy offset (eV)", standoff: 10 },
          gridcolor: COLORS.grid,
          zerolinecolor: "#c9c2cf",
          showline: true,
          linecolor: "#d7d3cd",
          mirror: true,
        },
        yaxis: {
          title: { text: "Reflectivity", standoff: 8 },
          rangemode: "tozero",
          gridcolor: COLORS.grid,
          zeroline: false,
          showline: true,
          linecolor: "#d7d3cd",
          mirror: true,
        },
      },
    };
  }, [config?.polarization, result?.reflectivity_curve]);

  const reflection = `${config?.h ?? 1}${config?.k ?? 1}${config?.l ?? 1}`;
  const displayedPoints = Number(result?.reflectivity_curve?.display_points);
  const sourcePoints = Number(result?.reflectivity_curve?.source_points);
  const plotSamplingNote = Number.isFinite(displayedPoints)
    && Number.isFinite(sourcePoints)
    && sourcePoints > displayedPoints
    ? `Plot displays ${displayedPoints.toLocaleString()} evenly sampled points from the ${sourcePoints.toLocaleString()}-point calculation.`
    : null;
  const plotConfig = useMemo(
    () => ({
      responsive: true,
      scrollZoom: true,
      doubleClick: "reset",
      displaylogo: false,
      displayModeBar: true,
      modeBarButtonsToRemove: ["select2d", "lasso2d"],
      toImageButtonOptions: {
        format: "png",
        filename: `dxas-reflectivity-${config?.material || "Si"}${reflection}`,
        scale: 2,
      },
    }),
    [config?.material, reflection],
  );

  return (
    <section className="reflectivity-panel" aria-labelledby="reflectivity-heading">
      <div className="reflectivity-panel__header">
        <div>
          <p className="eyebrow">Crystal response</p>
          <h2 id="reflectivity-heading">Interactive intrinsic reflectivity</h2>
          <p>
            Pan, zoom, or hover to inspect the {config?.material || "crystal"}({reflection}) profile.
          </p>
        </div>
        <div className="reflectivity-panel__stats" aria-label="Reflectivity summary">
          <span>
            Crystal FWHM
            <strong>{hasMetric(result?.crystal_intrinsic_resolution_ev_fwhm)
              ? `${Number(result.crystal_intrinsic_resolution_ev_fwhm).toPrecision(4)} eV`
              : "—"}</strong>
          </span>
          <span>
            Angular FWHM
            <strong>{hasMetric(result?.crystal_intrinsic_width_urad_fwhm)
              ? `${Number(result.crystal_intrinsic_width_urad_fwhm).toPrecision(4)} µrad`
              : "—"}</strong>
          </span>
          <span>
            Peak R
            <strong>{hasMetric(result?.reflectivity_peak)
              ? Number(result.reflectivity_peak).toFixed(3)
              : "—"}</strong>
          </span>
          <span>
            Integrated R
            <strong>{hasMetric(result?.reflectivity_integrated)
              ? `${Number(result.reflectivity_integrated).toPrecision(4)} eV`
              : "—"}</strong>
          </span>
        </div>
      </div>

      <div className="reflectivity-panel__plot">
        {figure ? (
          <Suspense
            fallback={
              <div className="reflectivity-panel__placeholder" role="status">
                <IconLoader2 className="icon-spin" aria-hidden="true" size={22} />
                Loading reflectivity profile…
              </div>
            }
          >
            <PlotlyFigure
              data={figure.data}
              layout={figure.layout}
              config={plotConfig}
              className="reflectivity-plotly-figure"
              style={{ width: "100%", height: "100%" }}
              useResizeHandler
            />
          </Suspense>
        ) : (
          <div className="reflectivity-panel__placeholder">
            <IconActivity aria-hidden="true" size={23} stroke={1.7} />
            <div>
              <strong>Reflectivity profile unavailable</strong>
              <p>Recalculate after reviewing the crystal inputs.</p>
            </div>
          </div>
        )}
      </div>

      {plotSamplingNote ? <p className="reflectivity-panel__sampling-note">{plotSamplingNote}</p> : null}

      <p className="reflectivity-panel__model-note">
        <strong>Model:</strong> {modelLabel(result?.reflectivity_model)}. Bragg calculations use the
        bent-crystal multilamellar response and Laue calculations use Penning–Polder when the XOP
        solver is available; any fallback is named here. Inspect the assumptions before using the
        estimated total FWHM as an experimental prediction.
      </p>
    </section>
  );
}
