import { IconGitCompare, IconRefresh, IconTrash } from "@tabler/icons-react";
import {
  compareModelProvenance,
  compareScientificInputs,
  formatComparisonDelta,
} from "../lib/comparisonData.js";
import { kevToEvInput } from "../lib/energyUnits.js";
import { formatValue, hasMetric, unavailableReason } from "../lib/formatMetrics.js";

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

function setupLabel(config) {
  if (!config) return "Unknown setup";
  return `${config.material}(${config.h}${config.k}${config.l}) · ${formatValue(
    kevToEvInput(config.energy_kev),
  )} eV · ${config.geometry === "laue" ? "Laue" : "Bragg"} · ${formatValue(
    config.crystal_thickness_um,
  )} µm`;
}

function MetricCell({ result, metric }) {
  const value = result?.[metric.key];
  if (hasMetric(value)) return `${formatValue(value)} ${metric.unit}`;
  const reason = unavailableReason(result, metric.key);
  return (
    <span title={reason}>
      Unavailable<span className="sr-only">. {reason}</span>
    </span>
  );
}

export function ComparisonPanel({
  baseline,
  current,
  currentConfig,
  canReplace = true,
  onReplace,
  onClear,
}) {
  if (!baseline) return null;
  const hasCurrentSnapshot = Boolean(current && currentConfig);
  const replaceEnabled = canReplace && hasCurrentSnapshot;
  const inputChanges = compareScientificInputs(baseline.config, currentConfig);
  const provenance = compareModelProvenance(baseline.result, current);
  const modelDifference = !provenance.sameReflectivity || !provenance.sameTotalMethod;

  return (
    <section className="comparison-panel" aria-labelledby="comparison-heading">
      <div className="comparison-panel__header comparison-header">
        <div className="comparison-panel__title">
          <span className="comparison-panel__icon" aria-hidden="true">
            <IconGitCompare size={19} stroke={1.8} />
          </span>
          <div>
            <p className="eyebrow">Setup comparison</p>
            <h2 id="comparison-heading">Calculated result vs baseline snapshot</h2>
          </div>
        </div>
        <div className="comparison-panel__actions">
          <button className="button button--quiet button--small" type="button" onClick={onReplace} disabled={!replaceEnabled}>
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
          <span>Latest calculated</span>
          <strong>{setupLabel(currentConfig)}</strong>
        </p>
      </div>
      {!replaceEnabled ? (
        <p className="comparison-panel__footnote" role="status">
          Viewing the last calculated snapshot. Replace the baseline when the current setup has a valid, completed result.
        </p>
      ) : null}

      <section className="comparison-panel__inputs" aria-labelledby="comparison-inputs-heading">
        <h3 id="comparison-inputs-heading">Changed scientific inputs</h3>
        {!hasCurrentSnapshot ? (
          <p className="comparison-panel__footnote">No calculated result is available to compare.</p>
        ) : inputChanges.length ? (
          <div className="comparison-table" role="table" aria-label="Input differences between calculated snapshots">
            <div className="comparison-table__row comparison-table__row--header" role="row">
              <span role="columnheader">Input</span>
              <span role="columnheader">Baseline</span>
              <span role="columnheader">Latest calculated</span>
              <span role="columnheader">Unit</span>
            </div>
            {inputChanges.map((change) => (
              <div className="comparison-table__row" role="row" key={change.key}>
                <strong role="cell">{change.label}</strong>
                <span role="cell">{change.baseline}</span>
                <span role="cell">{change.current}</span>
                <span role="cell">{change.unit || "—"}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="comparison-panel__footnote">Both calculated snapshots use the same inputs.</p>
        )}
      </section>

      <section className="comparison-panel__models" aria-labelledby="comparison-models-heading">
        <h3 id="comparison-models-heading">Model provenance</h3>
        <div className="comparison-table" role="table" aria-label="Model provenance of compared results">
          <div className="comparison-table__row comparison-table__row--header" role="row">
            <span role="columnheader">Model</span>
            <span role="columnheader">Baseline</span>
            <span role="columnheader">Latest calculated</span>
            <span role="columnheader">Match</span>
          </div>
          <div className="comparison-table__row" role="row">
            <strong role="cell">Crystal response</strong>
            <span role="cell">{provenance.baselineReflectivity}</span>
            <span role="cell">{provenance.currentReflectivity}</span>
            <span role="cell">{provenance.sameReflectivity ? "Same model" : "Different or unavailable"}</span>
          </div>
          <div className="comparison-table__row" role="row">
            <strong role="cell">Total resolution method</strong>
            <span role="cell">{provenance.baselineTotalMethod}</span>
            <span role="cell">{provenance.currentTotalMethod}</span>
            <span role="cell">{provenance.sameTotalMethod ? "Same method" : "Different or unavailable"}</span>
          </div>
        </div>
      </section>

      <div className="comparison-table comparison-body" role="table" aria-label="Comparison with saved baseline">
        <div className="comparison-table__row comparison-table__row--header comparison-row" role="row">
          <span role="columnheader">Metric</span>
          <span role="columnheader">Baseline</span>
          <span role="columnheader">Latest calculated</span>
          <span role="columnheader">Change</span>
        </div>
        {COMPARISON_METRICS.map((metric) => (
          <div className="comparison-table__row comparison-row" role="row" key={metric.key}>
            <strong role="cell">{metric.label}</strong>
            <span role="cell">
              <MetricCell result={baseline.result} metric={metric} />
            </span>
            <span role="cell">
              <MetricCell result={current} metric={metric} />
            </span>
            <span className="comparison-table__delta" role="cell">
              {formatComparisonDelta(
                current,
                baseline.result,
                metric.key,
                metric.unit,
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="comparison-panel__footnote comparison-footer">
        Detector sampling is an interval per pixel. Crystal and estimated total values are energy
        FWHM. Missing values have no delta. Crystal FWHM deltas require the same response model;
        total FWHM also requires the same resolution method.
        {modelDifference ? " Model provenance differs or is unavailable here." : ""}
      </p>
    </section>
  );
}
