import { IconGitCompare, IconRefresh, IconTrash } from "@tabler/icons-react";

const COMPARISON_METRICS = [
  {
    key: "bent_energy_span_ev",
    label: "Energy span",
    unit: "eV",
  },
  {
    key: "detector_beam_width_mm",
    label: "Detector beam width",
    unit: "mm",
  },
  {
    key: "detector_sampling_ev_per_pixel",
    label: "Detector sampling",
    unit: "eV/px",
  },
  {
    key: "crystal_intrinsic_resolution_ev_fwhm",
    label: "Crystal intrinsic width",
    unit: "eV FWHM",
  },
  {
    key: "total_resolution_ev_fwhm",
    label: "Estimated total resolution",
    unit: "eV FWHM",
  },
];

function formatValue(value) {
  if (!Number.isFinite(Number(value))) return "—";
  const numeric = Number(value);
  if (Math.abs(numeric) >= 1000) return numeric.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Math.abs(numeric) >= 100) return numeric.toFixed(1);
  if (Math.abs(numeric) >= 10) return numeric.toFixed(2);
  return numeric.toFixed(3);
}

function formatDelta(current, baseline, unit) {
  const difference = Number(current) - Number(baseline);
  if (!Number.isFinite(difference)) return "—";
  const sign = difference > 0 ? "+" : "";
  return `${sign}${formatValue(difference)} ${unit}`;
}

function setupLabel(config) {
  if (!config) return "Unknown setup";
  return `${config.material}(${config.h}${config.k}${config.l}) · ${formatValue(
    config.energy_kev,
  )} keV · ${config.geometry === "laue" ? "Laue" : "Bragg"} · ${formatValue(
    config.crystal_thickness_um,
  )} µm`;
}

export function ComparisonPanel({
  baseline,
  current,
  currentConfig,
  onReplace,
  onClear,
}) {
  if (!baseline) return null;

  return (
    <section className="comparison-panel" aria-labelledby="comparison-heading">
      <div className="comparison-panel__header comparison-header">
        <div className="comparison-panel__title">
          <span className="comparison-panel__icon" aria-hidden="true">
            <IconGitCompare size={19} stroke={1.8} />
          </span>
          <div>
            <p className="eyebrow">Setup comparison</p>
            <h2 id="comparison-heading">Current result vs saved baseline</h2>
          </div>
        </div>
        <div className="comparison-panel__actions">
          <button className="button button--quiet button--small" type="button" onClick={onReplace}>
            <IconRefresh aria-hidden="true" size={15} />
            Replace baseline
          </button>
          <button
            className="icon-button icon-button--danger"
            type="button"
            onClick={onClear}
            aria-label="Clear saved comparison baseline"
            title="Clear baseline"
          >
            <IconTrash aria-hidden="true" size={17} />
          </button>
        </div>
      </div>

      <div className="comparison-panel__setups">
        <p>
          <span>Baseline</span>
          <strong>{setupLabel(baseline.config)}</strong>
        </p>
        <p>
          <span>Current</span>
          <strong>{setupLabel(currentConfig)}</strong>
        </p>
      </div>

      <div className="comparison-table comparison-body" role="table" aria-label="Comparison with saved baseline">
        <div className="comparison-table__row comparison-table__row--header comparison-row" role="row">
          <span role="columnheader">Metric</span>
          <span role="columnheader">Baseline</span>
          <span role="columnheader">Current</span>
          <span role="columnheader">Change</span>
        </div>
        {COMPARISON_METRICS.map((metric) => (
          <div className="comparison-table__row comparison-row" role="row" key={metric.key}>
            <strong role="cell">{metric.label}</strong>
            <span role="cell">
              {formatValue(baseline.result?.[metric.key])} {metric.unit}
            </span>
            <span role="cell">
              {formatValue(current?.[metric.key])} {metric.unit}
            </span>
            <span className="comparison-table__delta" role="cell">
              {formatDelta(
                current?.[metric.key],
                baseline.result?.[metric.key],
                metric.unit,
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="comparison-panel__footnote comparison-footer">
        Detector sampling is an interval per pixel. Crystal and estimated total values are energy
        FWHM and should be interpreted with the model assumptions.
      </p>
    </section>
  );
}
