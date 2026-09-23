import { IconInfoCircle, IconMinus, IconPlus } from "@tabler/icons-react";

function finiteNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function decimalPlaces(value) {
  if (value === "" || value === null || value === undefined || value === "any") {
    return 0;
  }

  const [coefficient, exponentText] = String(value).toLowerCase().split("e");
  const exponent = Number(exponentText ?? 0);
  const fractionLength = coefficient.split(".")[1]?.length ?? 0;

  return Math.max(0, fractionLength - (Number.isFinite(exponent) ? exponent : 0));
}

function steppedValue({ value, step, min, max, direction }) {
  const numericStep = finiteNumber(step) ?? 1;
  const safeStep = numericStep > 0 ? numericStep : 1;
  const numericMin = finiteNumber(min);
  const numericMax = finiteNumber(max);
  const currentValue = finiteNumber(value) ?? numericMin ?? 0;
  const precision = Math.min(
    12,
    Math.max(
      decimalPlaces(value),
      decimalPlaces(safeStep),
      decimalPlaces(min),
      decimalPlaces(max),
    ),
  );
  const scale = 10 ** precision;
  const scaledCurrent = Math.round(currentValue * scale);
  const scaledStep = Math.round(safeStep * scale);
  let nextValue = (scaledCurrent + direction * scaledStep) / scale;

  if (numericMin !== null) {
    nextValue = Math.max(numericMin, nextValue);
  }
  if (numericMax !== null) {
    nextValue = Math.min(numericMax, nextValue);
  }

  return String(Number(nextValue.toFixed(precision)));
}

export function FieldControl({
  id,
  label,
  value,
  onChange,
  unit,
  type = "number",
  step,
  min,
  max,
  options,
  error,
  hint,
  disabled = false,
  inputMode = "decimal",
  className = "",
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const controlClassName = [
    "field-control",
    error ? "field-control--error" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const isCompact = className.split(/\s+/).includes("field-control--compact");
  const hasStepper = !options && type === "number" && !isCompact;
  const numericValue = finiteNumber(value);
  const numericMin = finiteNumber(min);
  const numericMax = finiteNumber(max);
  const decrementDisabled =
    disabled || (numericValue !== null && numericMin !== null && numericValue <= numericMin);
  const incrementDisabled =
    disabled || (numericValue !== null && numericMax !== null && numericValue >= numericMax);

  const changeByStep = (direction) => {
    onChange(steppedValue({ value, step, min, max, direction }));
  };

  return (
    <div className={controlClassName}>
      <div className="field-control__label-row field-label">
        <label className="field-control__label" htmlFor={id}>
          {label}
          {unit ? <span className="sr-only"> ({unit})</span> : null}
        </label>
        {hint ? (
          <span className="field-control__hint-icon" title={hint}>
            <IconInfoCircle aria-hidden="true" size={14} stroke={1.8} />
            <span className="sr-only">{hint}</span>
          </span>
        ) : null}
      </div>

      <div
        className={`field-control__input-shell field-input-wrap${
          hasStepper ? " field-control__input-shell--stepper" : ""
        }`}
      >
        {options ? (
          <select
            id={id}
            className="field-control__input field-control__select field-select"
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={error ? "true" : undefined}
            disabled={disabled}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            className={`field-control__input field-input${
              hasStepper ? " field-control__input--stepper" : ""
            }`}
            type={type}
            inputMode={inputMode}
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value)}
            step={step}
            min={min}
            max={max}
            aria-describedby={describedBy}
            aria-invalid={error ? "true" : undefined}
            disabled={disabled}
          />
        )}
        {unit ? (
          <span className="field-control__unit field-unit" aria-hidden="true">
            {unit}
          </span>
        ) : null}
        {hasStepper ? (
          <div className="field-control__step-buttons">
            <button
              className="field-control__step-button field-control__step-button--decrement"
              type="button"
              onClick={() => changeByStep(-1)}
              aria-label={`Decrease ${label}`}
              aria-controls={id}
              disabled={decrementDisabled}
            >
              <IconMinus aria-hidden="true" size={14} stroke={2} />
            </button>
            <button
              className="field-control__step-button field-control__step-button--increment"
              type="button"
              onClick={() => changeByStep(1)}
              aria-label={`Increase ${label}`}
              aria-controls={id}
              disabled={incrementDisabled}
            >
              <IconPlus aria-hidden="true" size={14} stroke={2} />
            </button>
          </div>
        ) : null}
      </div>

      {hint ? (
        <span className="sr-only" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <p className="field-control__error field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
