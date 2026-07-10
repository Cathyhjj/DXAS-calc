export function ResultMetric({
  label,
  value,
  unit,
  note,
  delta,
  accent = "violet",
  unavailable = false,
}) {
  return (
    <article
      className={`result-metric result-metric--${accent}${
        unavailable ? " result-metric--unavailable" : ""
      }`}
    >
      <div className="result-metric__label-row result-label">
        <h3>{label}</h3>
      </div>
      <output className={`result-metric__value result-value${unavailable ? " muted" : ""}`}>
        <span>{value}</span>
        {unit ? <small className="result-unit">{unit}</small> : null}
      </output>
      <p className="result-metric__note result-note">{note}</p>
      {delta ? <p className="result-metric__delta">{delta}</p> : null}
    </article>
  );
}
