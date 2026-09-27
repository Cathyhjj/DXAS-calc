import { useEffect, useRef, useState } from "react";
import { FieldControl } from "./FieldControl.jsx";
import {
  DETECTOR_DISTANCE_MODES,
  detectorDistanceFromProjection,
  detectorProjectionFactor,
  projectedDetectorDistance,
} from "../lib/detectorProjection.js";

const DISTANCE_OPTIONS = [
  { value: DETECTOR_DISTANCE_MODES.RAY, label: "q (along ray)" },
  { value: DETECTOR_DISTANCE_MODES.PARALLEL, label: "|q∥| (along beam)" },
  { value: DETECTOR_DISTANCE_MODES.PERPENDICULAR, label: "|q⊥| (across beam)" },
];

const PROJECTION_LABELS = {
  [DETECTOR_DISTANCE_MODES.PARALLEL]: "Along beam projection |q∥|",
  [DETECTOR_DISTANCE_MODES.PERPENDICULAR]: "Across beam projection |q⊥|",
};

function formatDistance(value) {
  return Number.isFinite(value) ? Number(value.toPrecision(10)).toString() : "";
}

function formatSummaryDistance(value) {
  return Number.isFinite(value) ? Number(value.toPrecision(6)).toString() : "";
}

export function DetectorDistanceControl({
  mode,
  onModeChange,
  qMeters,
  braggAngleDeg,
  angleCurrent,
  onRayChange,
  onProjectedCommit,
  error,
}) {
  const factor = detectorProjectionFactor(mode, braggAngleDeg);
  const projectionReady = angleCurrent && factor !== null;
  const projectedValue = projectionReady
    ? projectedDetectorDistance(qMeters, mode, braggAngleDeg)
    : null;
  const [draft, setDraft] = useState(() => formatDistance(projectedValue));
  const [inputError, setInputError] = useState("");
  const focusedRef = useRef(false);
  const changedRef = useRef(false);
  const cancelBlurRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(formatDistance(projectedValue));
    setInputError("");
    changedRef.current = false;
  }, [mode, projectedValue]);

  function commitProjection() {
    if (!changedRef.current || !projectionReady) return;
    changedRef.current = false;
    const q = detectorDistanceFromProjection(draft, mode, braggAngleDeg);
    if (q === null) {
      setDraft(formatDistance(projectedValue));
      setInputError("Enter a finite projection distance greater than 0 m; previous distance restored.");
      return;
    }
    setInputError("");
    setDraft(formatDistance(Number(draft)));
    onProjectedCommit(q);
  }

  return (
    <div className="detector-distance-controls">
      <FieldControl
        id="detector-distance-mode"
        label="Define by"
        value={mode}
        onChange={onModeChange}
        options={DISTANCE_OPTIONS}
      />
      {mode === DETECTOR_DISTANCE_MODES.RAY ? (
        <FieldControl
          id="detector-distance"
          label="Crystal–detector distance q"
          unit="m"
          value={qMeters}
          onChange={onRayChange}
          step="0.01"
          error={error}
          hint="The distance along the diffracted ray. You can also edit q on the diagram or drag the detector plane."
        />
      ) : (
        <FieldControl
          id="detector-distance"
          label={PROJECTION_LABELS[mode]}
          unit="m"
          type="text"
          value={draft}
          onChange={(value) => {
            changedRef.current = true;
            setDraft(value);
            setInputError("");
          }}
          onFocus={(event) => {
            focusedRef.current = true;
            setInputError("");
            event.currentTarget.select();
          }}
          onBlur={() => {
            focusedRef.current = false;
            if (cancelBlurRef.current) {
              cancelBlurRef.current = false;
              return;
            }
            commitProjection();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              cancelBlurRef.current = true;
              changedRef.current = false;
              setDraft(formatDistance(projectedValue));
              setInputError("");
              event.currentTarget.blur();
            }
          }}
          disabled={!projectionReady || projectedValue === null}
          error={inputError || error}
          hint="Enter the magnitude shown by the dashed projection guide. Press Enter or leave the field to set q, then recalculate the setup."
        />
      )}
      {mode !== DETECTOR_DISTANCE_MODES.RAY ? (
        <p className="detector-distance-controls__note" role="status">
          {!angleCurrent
            ? "Calculate the current material, reflection, and energy before entering a projection."
            : factor === null
              ? "This projection is zero at the current 2θ and cannot determine q. Choose another distance."
              : projectedValue === null
                ? "Enter a valid q first, then choose a projection."
                : `At 2θ = ${(2 * braggAngleDeg).toFixed(2)}°, equivalent q = ${formatSummaryDistance(Number(qMeters))} m. Changing the angle keeps q fixed.`}
        </p>
      ) : null}
    </div>
  );
}
