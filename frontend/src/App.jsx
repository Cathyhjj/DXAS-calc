import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconAtom2,
  IconBook2,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCircleDashed,
  IconDeviceDesktop,
  IconDotsVertical,
  IconGitCompare,
  IconInfoCircle,
  IconLoader2,
  IconRefresh,
  IconRulerMeasure,
  IconX,
} from "@tabler/icons-react";
import { ComparisonPanel } from "./components/ComparisonPanel.jsx";
import { FieldControl } from "./components/FieldControl.jsx";
import { OpticsCanvas } from "./components/OpticsCanvas.jsx";
import { ResultMetric } from "./components/ResultMetric.jsx";

const DEFAULT_CONFIG = Object.freeze({
  geometry: "bragg",
  material: "Si",
  h: 1,
  k: 1,
  l: 1,
  energy_kev: 8,
  source_distance_m: 1.2,
  divergence_mrad: 1.2,
  bending_radius_m: -2,
  asymmetry_angle_deg: 0,
  condition: "upper",
  detector_distance_m: 1.5,
  pixel_size_um: 55,
});

const NUMERIC_FIELDS = [
  "h",
  "k",
  "l",
  "energy_kev",
  "source_distance_m",
  "divergence_mrad",
  "bending_radius_m",
  "asymmetry_angle_deg",
  "detector_distance_m",
  "pixel_size_um",
];

const MATERIAL_OPTIONS = [
  { value: "Si", label: "Silicon (Si)" },
  { value: "Ge", label: "Germanium (Ge)" },
];

const CONDITION_OPTIONS = [
  { value: "upper", label: "Upper" },
  { value: "lower", label: "Lower" },
];

function cloneConfig(config) {
  return { ...config };
}

function canvasSafeConfig(config) {
  const safe = { ...DEFAULT_CONFIG, ...config };
  for (const field of NUMERIC_FIELDS) {
    const numeric = Number(safe[field]);
    safe[field] = Number.isFinite(numeric) ? numeric : DEFAULT_CONFIG[field];
  }
  return safe;
}

function formatValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const magnitude = Math.abs(numeric);
  if (magnitude === 0) return "0.000";
  if (magnitude >= 1000) {
    return numeric.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  if (magnitude >= 100) return numeric.toFixed(1);
  if (magnitude >= 10) return numeric.toFixed(2);
  if (magnitude >= 1) return numeric.toFixed(3);
  if (magnitude >= 0.01) return numeric.toFixed(4);
  return numeric.toExponential(2);
}

function formatMetricDelta(current, baseline, unit) {
  if (!baseline) return null;
  const currentValue = Number(current);
  const baselineValue = Number(baseline);
  if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue)) return null;
  const difference = currentValue - baselineValue;
  const sign = difference > 0 ? "+" : "";
  return `${sign}${formatValue(difference)} ${unit} vs baseline`;
}

function InspectorSection({ id, title, icon: Icon, expanded, onToggle, children }) {
  return (
    <section className={`inspector-section${expanded ? " inspector-section--open" : ""}`}>
      <button
        className="inspector-section__toggle"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`${id}-content`}
      >
        <span className="inspector-section__title">
          <Icon aria-hidden="true" size={17} stroke={1.8} />
          {title}
        </span>
        {expanded ? (
          <IconChevronUp aria-hidden="true" size={17} />
        ) : (
          <IconChevronDown aria-hidden="true" size={17} />
        )}
      </button>
      <div className="inspector-section__content" id={`${id}-content`} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}

function AboutDialog({ onClose, closeButtonRef, dialogRef }) {
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="about-dialog dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        aria-describedby="about-dialog-description"
        tabIndex={-1}
      >
        <div className="about-dialog__header dialog-header">
          <div className="about-dialog__mark" aria-hidden="true">
            <IconBook2 size={21} stroke={1.8} />
          </div>
          <div>
            <p className="eyebrow">About this model</p>
            <h2 id="about-dialog-title">DXASCalc</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button icon-action"
            type="button"
            onClick={onClose}
            aria-label="Close About dialog"
          >
            <IconX aria-hidden="true" size={19} />
          </button>
        </div>
        <div className="about-dialog__body dialog-body" id="about-dialog-description">
          <p>
            DXASCalc explores dispersive X-ray absorption geometry for bent-crystal Bragg and
            Laue setups. The calculation reports geometry, energy span, beam size, and detector
            sampling from the validated JSON API.
          </p>
          <div className="about-dialog__notice">
            <IconInfoCircle aria-hidden="true" size={18} stroke={1.8} />
            <p>
              Detector sampling is not total instrument energy resolution. Source-size and
              intrinsic-crystal contributions are not yet modeled, so no total resolution is
              reported.
            </p>
          </div>
          <p>
            Widths and spans are shown as magnitudes. Signed values remain part of the result for
            orientation, and a negative bending radius is a valid curvature convention.
          </p>
        </div>
        <div className="about-dialog__footer dialog-footer">
          <button className="button button--primary dialog-action" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}

export function App() {
  const [config, setConfig] = useState(() => cloneConfig(DEFAULT_CONFIG));
  const [calculatedConfig, setCalculatedConfig] = useState(null);
  const [result, setResult] = useState(null);
  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [presetsError, setPresetsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [generalIssues, setGeneralIssues] = useState([]);
  const [serverError, setServerError] = useState("");
  const [baseline, setBaseline] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [sections, setSections] = useState({
    crystal: true,
    geometry: true,
    detector: true,
  });

  const configRef = useRef(config);
  const calculationAbortRef = useRef(null);
  const calculationSequenceRef = useRef(0);
  const presetsSequenceRef = useRef(0);
  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);
  const aboutCloseButtonRef = useRef(null);
  const aboutDialogRef = useRef(null);
  const comparisonRef = useRef(null);

  const closeAboutDialog = useCallback(() => {
    setAboutOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  const commitConfig = useCallback((nextConfig) => {
    configRef.current = nextConfig;
    setConfig(nextConfig);
  }, []);

  const calculate = useCallback(async (candidate) => {
    const requestConfig = cloneConfig(candidate);
    const sequence = calculationSequenceRef.current + 1;
    calculationSequenceRef.current = sequence;
    calculationAbortRef.current?.abort();
    const controller = new AbortController();
    calculationAbortRef.current = controller;

    setLoading(true);
    setServerError("");
    setGeneralIssues([]);

    try {
      const response = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestConfig),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);

      if (sequence !== calculationSequenceRef.current) return false;

      if (response.status === 422) {
        const issues = Array.isArray(payload?.issues) ? payload.issues : [];
        const nextFieldErrors = {};
        const nextGeneralIssues = [];
        for (const issue of issues) {
          if (issue?.field) {
            nextFieldErrors[issue.field] = nextFieldErrors[issue.field]
              ? `${nextFieldErrors[issue.field]} ${issue.message}`
              : issue.message;
          } else if (issue?.message) {
            nextGeneralIssues.push(issue.message);
          }
        }
        setFieldErrors(nextFieldErrors);
        setGeneralIssues(
          nextGeneralIssues.length ? nextGeneralIssues : ["Review the highlighted setup values."],
        );
        setDirty(true);
        return false;
      }

      if (!response.ok || !payload?.result) {
        throw new Error(payload?.message || "The calculation service returned an unexpected response.");
      }

      setResult(payload.result);
      setCalculatedConfig(requestConfig);
      setFieldErrors({});
      setGeneralIssues([]);
      setDirty(false);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      if (sequence === calculationSequenceRef.current) {
        setServerError(error?.message || "Unable to reach the calculation service.");
      }
      return false;
    } finally {
      if (sequence === calculationSequenceRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const sequence = presetsSequenceRef.current + 1;
    presetsSequenceRef.current = sequence;
    const controller = new AbortController();

    async function loadPresets() {
      setPresetsLoading(true);
      setPresetsError("");
      try {
        const response = await fetch("/api/presets", { signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.presets)) {
          throw new Error("Preset list is unavailable.");
        }
        if (sequence !== presetsSequenceRef.current) return;
        setPresets(payload.presets);
        const defaultPreset = payload.presets.find(
          (preset) => preset.id === "bragg-si111-legacy-safe",
        );
        setSelectedPresetId(defaultPreset?.id || "");
      } catch (error) {
        if (error?.name !== "AbortError" && sequence === presetsSequenceRef.current) {
          setPresetsError(error?.message || "Preset list is unavailable.");
        }
      } finally {
        if (sequence === presetsSequenceRef.current) setPresetsLoading(false);
      }
    }

    void loadPresets();
    void calculate(DEFAULT_CONFIG);

    return () => {
      controller.abort();
      calculationAbortRef.current?.abort();
    };
  }, [calculate]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function handleOutsidePointer(event) {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }
    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!aboutOpen) return undefined;
    aboutCloseButtonRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAboutDialog();
        return;
      }

      if (event.key !== "Tab") return;

      const dialog = aboutDialogRef.current;
      if (!dialog) return;

      const focusableElements = Array.from(
        dialog.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true" && element.tabIndex >= 0);

      if (!focusableElements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === firstElement || !dialog.contains(activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (activeElement === lastElement || !dialog.contains(activeElement))) {
        event.preventDefault();
        firstElement.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [aboutOpen, closeAboutDialog]);

  const displayedConfig = useMemo(
    () => canvasSafeConfig(calculatedConfig || config),
    [calculatedConfig, config],
  );

  const calculationStatus = useMemo(() => {
    if (loading) return { kind: "loading", label: "Calculating" };
    if (serverError || generalIssues.length || Object.keys(fieldErrors).length) {
      return { kind: "error", label: "Setup needs attention" };
    }
    if (dirty) return { kind: "dirty", label: "Changes not calculated" };
    if (result) return { kind: "success", label: "Calculation ready" };
    return { kind: "idle", label: "Waiting for calculation" };
  }, [dirty, fieldErrors, generalIssues.length, loading, result, serverError]);

  const handleFieldChange = useCallback(
    (field, value) => {
      const next = { ...configRef.current, [field]: value };
      commitConfig(next);
      setSelectedPresetId("");
      setDirty(true);
      setServerError("");
      setGeneralIssues([]);
      setFieldErrors((previous) => {
        const updated = { ...previous };
        delete updated[field];
        if (["h", "k", "l"].includes(field)) delete updated.hkl;
        return updated;
      });
    },
    [commitConfig],
  );

  const handleGeometryChange = useCallback(
    (geometry) => {
      if (configRef.current.geometry === geometry) return;
      const next = { ...configRef.current, geometry };
      commitConfig(next);
      setSelectedPresetId("");
      setDirty(true);
      setFieldErrors((previous) => {
        const updated = { ...previous };
        delete updated.geometry;
        return updated;
      });
      void calculate(next);
    },
    [calculate, commitConfig],
  );

  const handlePresetChange = useCallback(
    (presetId) => {
      setSelectedPresetId(presetId);
      const preset = presets.find((item) => item.id === presetId);
      if (!preset?.config) return;
      const next = cloneConfig(preset.config);
      commitConfig(next);
      setDirty(true);
      setFieldErrors({});
      setGeneralIssues([]);
      setServerError("");
      void calculate(next);
    },
    [calculate, commitConfig, presets],
  );

  const handleDiagramDistanceChange = useCallback(
    async (field, distanceMeters) => {
      if (!["source_distance_m", "detector_distance_m"].includes(field)) return;
      const distance = Number(distanceMeters);
      if (!Number.isFinite(distance)) return;
      const previousValue = configRef.current[field];
      const next = { ...configRef.current, [field]: Number(distance.toFixed(4)) };
      commitConfig(next);
      setSelectedPresetId("");
      setDirty(true);
      setServerError("");
      setGeneralIssues([]);
      setFieldErrors((previous) => {
        const updated = { ...previous };
        delete updated[field];
        return updated;
      });
      const success = await calculate(next);
      if (!success && configRef.current[field] === next[field]) {
        commitConfig({ ...configRef.current, [field]: previousValue });
      }
      return success;
    },
    [calculate, commitConfig],
  );

  const handleSourceDistanceChange = useCallback(
    (distanceMeters) => handleDiagramDistanceChange("source_distance_m", distanceMeters),
    [handleDiagramDistanceChange],
  );

  const handleDetectorDistanceChange = useCallback(
    (distanceMeters) => handleDiagramDistanceChange("detector_distance_m", distanceMeters),
    [handleDiagramDistanceChange],
  );

  const handleReset = useCallback(() => {
    const next = cloneConfig(DEFAULT_CONFIG);
    commitConfig(next);
    setSelectedPresetId("bragg-si111-legacy-safe");
    setMenuOpen(false);
    setFieldErrors({});
    setGeneralIssues([]);
    setServerError("");
    setDirty(true);
    void calculate(next);
  }, [calculate, commitConfig]);

  const saveCurrentAsBaseline = useCallback(() => {
    if (!result || !calculatedConfig) return;
    setBaseline({ result, config: cloneConfig(calculatedConfig) });
  }, [calculatedConfig, result]);

  const handleCompare = useCallback(() => {
    if (!baseline) saveCurrentAsBaseline();
    window.requestAnimationFrame(() => {
      comparisonRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [baseline, saveCurrentAsBaseline]);

  const toggleSection = useCallback((section) => {
    setSections((previous) => ({ ...previous, [section]: !previous[section] }));
  }, []);

  const fieldErrorCount = Object.keys(fieldErrors).length;
  const hasStaleResult = Boolean(result && (dirty || fieldErrorCount || serverError));
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  const contextualWarningCodes = new Set([
    "reversed_energy_span",
    "detector_image_inverted",
    "virtual_focus",
  ]);
  const bannerWarnings = warnings.filter(
    (warning) => !contextualWarningCodes.has(warning.code),
  );
  const assumptions = Array.isArray(result?.assumptions) ? result.assumptions : [];

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand brand-lockup" href="#workspace" aria-label="DXASCalc home">
          <img className="brand__logo brand-logo" src="/brand/dr-xas-logo.png" alt="Dr. XAS" />
          <span className="brand__copy brand-copy">
            <h1>DXASCalc</h1>
            <p>Dispersive X-ray absorption geometry calculator</p>
          </span>
        </a>

        <div className="header-controls">
          <div className="geometry-switch mode-switch" role="group" aria-label="Diffraction geometry">
            <button
              type="button"
              className={config.geometry === "bragg" ? "is-active active" : ""}
              onClick={() => handleGeometryChange("bragg")}
              aria-pressed={config.geometry === "bragg"}
            >
              Bragg
            </button>
            <button
              type="button"
              className={config.geometry === "laue" ? "is-active active" : ""}
              onClick={() => handleGeometryChange("laue")}
              aria-pressed={config.geometry === "laue"}
            >
              Laue
            </button>
          </div>

          <div className="header-preset header-control-group">
            <label className="header-control-label" htmlFor="preset-select">
              Example preset
            </label>
            <div className="header-preset__select-wrap">
              <select
                className="preset-select"
                id="preset-select"
                value={selectedPresetId}
                onChange={(event) => handlePresetChange(event.target.value)}
                disabled={presetsLoading || !presets.length}
                aria-describedby={presetsError ? "preset-error" : undefined}
              >
                <option value="">Custom setup</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </div>
            {presetsError ? (
              <span className="header-preset__error" id="preset-error" role="status">
                {presetsError}
              </span>
            ) : null}
          </div>
        </div>

        <div className="header-actions">
          <button
            className="button button--primary primary-action"
            type="button"
            onClick={() => void calculate(configRef.current)}
            disabled={loading}
            aria-label={loading ? "Calculating" : "Recalculate"}
          >
            {loading ? (
              <IconLoader2 className="icon-spin" aria-hidden="true" size={18} />
            ) : (
              <IconRefresh aria-hidden="true" size={18} />
            )}
            <span>{loading ? "Calculating" : "Recalculate"}</span>
          </button>
          <button
            className={`button button--outline secondary-action${baseline ? " button--active" : ""}`}
            type="button"
            onClick={handleCompare}
            disabled={!result || loading}
            aria-pressed={Boolean(baseline)}
            aria-label="Compare setup"
          >
            <IconGitCompare aria-hidden="true" size={18} />
            <span>Compare setup</span>
          </button>
          <div className="overflow-menu" ref={menuRef}>
            <button
              ref={menuButtonRef}
              className="icon-button icon-button--bordered icon-action"
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Open application menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls="application-menu"
            >
              <IconDotsVertical aria-hidden="true" size={20} />
            </button>
            {menuOpen ? (
              <div className="overflow-menu__popover" id="application-menu" role="menu">
                <button type="button" role="menuitem" onClick={handleReset}>
                  <IconRefresh aria-hidden="true" size={16} />
                  Reset default setup
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setAboutOpen(true);
                  }}
                >
                  <IconBook2 aria-hidden="true" size={16} />
                  About DXASCalc
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main id="workspace" className="app-main">
        <div className="workspace">
          <section className="canvas-panel" aria-labelledby="optics-workspace-heading">
            <div className="canvas-panel__topbar">
              <div>
                <p className="eyebrow">Interactive ray geometry</p>
                <h2 id="optics-workspace-heading">Optics workbench</h2>
              </div>
              <div
                className={`calculation-status calculation-status--${calculationStatus.kind}`}
                role="status"
                aria-live="polite"
              >
                {calculationStatus.kind === "loading" ? (
                  <IconLoader2 className="icon-spin" aria-hidden="true" size={15} />
                ) : calculationStatus.kind === "success" ? (
                  <IconCheck aria-hidden="true" size={15} />
                ) : calculationStatus.kind === "error" ? (
                  <IconAlertTriangle aria-hidden="true" size={15} />
                ) : (
                  <IconCircleDashed aria-hidden="true" size={15} />
                )}
                {calculationStatus.label}
              </div>
            </div>

            <div className="canvas-panel__messages">
              {serverError || generalIssues.length ? (
                <div className="calculation-message calculation-message--error" role="alert">
                  <IconAlertTriangle aria-hidden="true" size={19} stroke={1.8} />
                  <div>
                    <strong>Calculation could not be updated</strong>
                    <p>{serverError || generalIssues.join(" ")}</p>
                    {result ? <small>The diagram and metrics show the last valid result.</small> : null}
                  </div>
                </div>
              ) : null}

              {bannerWarnings.length ? (
                <div className="calculation-message calculation-message--warning" role="status">
                  <IconAlertTriangle aria-hidden="true" size={19} stroke={1.8} />
                  <div>
                    <strong>
                      {bannerWarnings.length === 1 ? "Model notice" : "Model notices"}
                    </strong>
                    <ul>
                      {bannerWarnings.map((warning) => (
                        <li key={`${warning.code}-${warning.field || "global"}`}>
                          {warning.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </div>

            <div className={`canvas-panel__viewport${hasStaleResult ? " is-stale" : ""}`}>
              <OpticsCanvas
                config={displayedConfig}
                result={result}
                onSourceDistanceChange={handleSourceDistanceChange}
                onDetectorDistanceChange={handleDetectorDistanceChange}
              />
              {!result && loading ? (
                <div className="canvas-panel__loading" role="status">
                  <IconLoader2 className="icon-spin" aria-hidden="true" size={24} />
                  Preparing the optics model…
                </div>
              ) : null}
            </div>

            <div className="canvas-panel__footer">
              <p>
                <IconRulerMeasure aria-hidden="true" size={16} />
                Drag the source or detector to adjust <em>p</em> or <em>q</em>; release to recalculate.
              </p>
              {result ? (
                <dl className="geometry-readout" aria-label="Calculated geometry summary">
                  <div>
                    <dt>Bragg angle</dt>
                    <dd>{formatValue(result.bragg_angle_deg)}°</dd>
                  </div>
                  <div>
                    <dt>Focus</dt>
                    <dd>
                      {formatValue(result.geometric_focus_m)} m · {result.focus_kind}
                    </dd>
                  </div>
                  <div>
                    <dt>Image</dt>
                    <dd>{result.image_inverted ? "Inverted" : "Upright"}</dd>
                  </div>
                </dl>
              ) : null}
            </div>
          </section>

          <aside className="inspector" aria-labelledby="inspector-heading">
            <div className="inspector__header">
              <div>
                <p className="eyebrow">Configuration</p>
                <h2 id="inspector-heading">Setup inspector</h2>
              </div>
              <span className={`inspector__state${dirty ? " is-dirty" : ""}`}>
                {fieldErrorCount ? `${fieldErrorCount} error${fieldErrorCount === 1 ? "" : "s"}` : dirty ? "Edited" : "Synced"}
              </span>
            </div>

            <form
              className="inspector__form"
              onSubmit={(event) => {
                event.preventDefault();
                void calculate(configRef.current);
              }}
              noValidate
            >
              <InspectorSection
                id="crystal"
                title="Crystal"
                icon={IconAtom2}
                expanded={sections.crystal}
                onToggle={() => toggleSection("crystal")}
              >
                <FieldControl
                  id="material"
                  label="Material"
                  value={config.material}
                  onChange={(value) => handleFieldChange("material", value)}
                  options={MATERIAL_OPTIONS}
                  error={fieldErrors.material}
                />

                <fieldset className={`hkl-control${fieldErrors.hkl ? " hkl-control--error" : ""}`}>
                  <legend>
                    Reflection (h k l)
                    <span className="field-control__hint-icon" title="Miller indices must be integers and cannot all be zero.">
                      <IconInfoCircle aria-hidden="true" size={14} stroke={1.8} />
                      <span className="sr-only">
                        Miller indices must be integers and cannot all be zero.
                      </span>
                    </span>
                  </legend>
                  <div className="hkl-control__inputs">
                    <FieldControl
                      id="h-index"
                      label="h"
                      value={config.h}
                      onChange={(value) => handleFieldChange("h", value)}
                      step="1"
                      inputMode="numeric"
                      error={fieldErrors.h}
                      className="field-control--compact"
                    />
                    <FieldControl
                      id="k-index"
                      label="k"
                      value={config.k}
                      onChange={(value) => handleFieldChange("k", value)}
                      step="1"
                      inputMode="numeric"
                      error={fieldErrors.k}
                      className="field-control--compact"
                    />
                    <FieldControl
                      id="l-index"
                      label="l"
                      value={config.l}
                      onChange={(value) => handleFieldChange("l", value)}
                      step="1"
                      inputMode="numeric"
                      error={fieldErrors.l}
                      className="field-control--compact"
                    />
                  </div>
                  {fieldErrors.hkl ? (
                    <p className="hkl-control__error" role="alert">
                      {fieldErrors.hkl}
                    </p>
                  ) : null}
                </fieldset>

                <FieldControl
                  id="energy"
                  label="Photon energy"
                  unit="keV"
                  value={config.energy_kev}
                  onChange={(value) => handleFieldChange("energy_kev", value)}
                  step="0.1"
                  error={fieldErrors.energy_kev}
                />
              </InspectorSection>

              <InspectorSection
                id="geometry"
                title="Geometry"
                icon={IconAdjustmentsHorizontal}
                expanded={sections.geometry}
                onToggle={() => toggleSection("geometry")}
              >
                <FieldControl
                  id="source-distance"
                  label="Source–crystal distance p"
                  unit="m"
                  value={config.source_distance_m}
                  onChange={(value) => handleFieldChange("source_distance_m", value)}
                  step="0.01"
                  error={fieldErrors.source_distance_m}
                  hint="You can also drag the source plane in the Plotly diagram."
                />
                <FieldControl
                  id="divergence"
                  label="Full angular divergence"
                  unit="mrad"
                  value={config.divergence_mrad}
                  onChange={(value) => handleFieldChange("divergence_mrad", value)}
                  step="0.1"
                  error={fieldErrors.divergence_mrad}
                  hint="The model treats this as the full angular span, not a half-angle."
                />
                <FieldControl
                  id="bending-radius"
                  label="Bending radius R"
                  unit="m"
                  value={config.bending_radius_m}
                  onChange={(value) => handleFieldChange("bending_radius_m", value)}
                  step="0.1"
                  error={fieldErrors.bending_radius_m}
                  hint="Positive and negative radii represent opposite curvature orientations; zero is invalid."
                />
                <FieldControl
                  id="asymmetry-angle"
                  label="Asymmetry angle α"
                  unit="deg"
                  value={config.asymmetry_angle_deg}
                  onChange={(value) => handleFieldChange("asymmetry_angle_deg", value)}
                  step="0.1"
                  error={fieldErrors.asymmetry_angle_deg}
                />
                <FieldControl
                  id="condition"
                  label="Condition"
                  value={config.condition}
                  onChange={(value) => handleFieldChange("condition", value)}
                  options={CONDITION_OPTIONS}
                  error={fieldErrors.condition}
                />
              </InspectorSection>

              <InspectorSection
                id="detector"
                title="Detector"
                icon={IconDeviceDesktop}
                expanded={sections.detector}
                onToggle={() => toggleSection("detector")}
              >
                <FieldControl
                  id="detector-distance"
                  label="Crystal–detector distance q"
                  unit="m"
                  value={config.detector_distance_m}
                  onChange={(value) => handleFieldChange("detector_distance_m", value)}
                  step="0.01"
                  error={fieldErrors.detector_distance_m}
                  hint="You can also drag the detector plane in the Plotly diagram."
                />
                <FieldControl
                  id="pixel-size"
                  label="Pixel size"
                  unit="µm"
                  value={config.pixel_size_um}
                  onChange={(value) => handleFieldChange("pixel_size_um", value)}
                  step="1"
                  error={fieldErrors.pixel_size_um}
                />
                {result ? (
                  <div className="detector-readout" aria-label="Detector calculation readout">
                    <div>
                      <span>Beam width</span>
                      <strong>{formatValue(result.detector_beam_width_mm)} mm</strong>
                    </div>
                    <div>
                      <span>Sampling</span>
                      <strong>{formatValue(result.detector_sampling_ev_per_pixel)} eV/px</strong>
                    </div>
                  </div>
                ) : null}
              </InspectorSection>

              <div className="inspector__submit">
                <button className="button button--primary button--full" type="submit" disabled={loading}>
                  {loading ? (
                    <IconLoader2 className="icon-spin" aria-hidden="true" size={18} />
                  ) : (
                    <IconRefresh aria-hidden="true" size={18} />
                  )}
                  {loading ? "Calculating…" : "Recalculate setup"}
                </button>
                <p>Values are sent to the validated calculation API.</p>
              </div>
            </form>
          </aside>
        </div>

        <section className="results-strip" aria-labelledby="results-heading">
          <div className="results-strip__heading">
            <div>
              <p className="eyebrow">Calculated outputs</p>
              <h2 id="results-heading">Detector-ready summary</h2>
            </div>
            {hasStaleResult ? <span>Showing last valid result</span> : null}
          </div>
          <div className="results-strip__metrics">
            <ResultMetric
              label="Energy span"
              value={formatValue(result?.bent_energy_span_ev)}
              unit="eV"
              note="Bent-crystal span · magnitude"
              delta={formatMetricDelta(
                result?.bent_energy_span_ev,
                baseline?.result?.bent_energy_span_ev,
                "eV",
              )}
              accent="violet"
            />
            <ResultMetric
              label="Beam width"
              value={formatValue(result?.detector_beam_width_mm)}
              unit="mm"
              note="At detector · magnitude"
              delta={formatMetricDelta(
                result?.detector_beam_width_mm,
                baseline?.result?.detector_beam_width_mm,
                "mm",
              )}
              accent="blue"
            />
            <ResultMetric
              label="Detector sampling"
              value={formatValue(result?.detector_sampling_ev_per_pixel)}
              unit="eV/px"
              note="Energy interval per pixel"
              delta={formatMetricDelta(
                result?.detector_sampling_ev_per_pixel,
                baseline?.result?.detector_sampling_ev_per_pixel,
                "eV/px",
              )}
              accent="slate"
            />
            <ResultMetric
              label="Total resolution"
              value="Not calculated"
              note="Source and crystal terms are not modeled"
              accent="muted"
              unavailable
            />
          </div>
        </section>

        <section className="coverage-panel" aria-labelledby="coverage-heading">
          <div className="coverage-panel__intro">
            <p className="eyebrow">Scientific completeness</p>
            <h2 id="coverage-heading">Resolution model coverage</h2>
            <p>
              Detector sampling is calculated. A total instrument resolution cannot be combined
              until source-size and intrinsic-crystal contributions are modeled and validated.
            </p>
          </div>

          <ul className="coverage-grid" aria-label="Resolution model coverage status">
            <li className="coverage-item coverage-item--calculated">
              <span className="coverage-item__icon" aria-hidden="true">
                <IconCheck size={18} stroke={2} />
              </span>
              <div>
                <strong>Detector sampling</strong>
                <span>Calculated</span>
                <small>{formatValue(result?.detector_sampling_ev_per_pixel)} eV/px</small>
              </div>
            </li>
            <li className="coverage-item coverage-item--pending">
              <span className="coverage-item__icon" aria-hidden="true">
                <IconCircleDashed size={18} stroke={1.8} />
              </span>
              <div>
                <strong>Source-size contribution</strong>
                <span>Not modeled</span>
                <small>Required for total resolution</small>
              </div>
            </li>
            <li className="coverage-item coverage-item--pending">
              <span className="coverage-item__icon" aria-hidden="true">
                <IconCircleDashed size={18} stroke={1.8} />
              </span>
              <div>
                <strong>Crystal intrinsic width</strong>
                <span>Not modeled</span>
                <small>Required for total resolution</small>
              </div>
            </li>
          </ul>

          <details className="assumptions-panel">
            <summary>
              <span>
                <IconInfoCircle aria-hidden="true" size={17} />
                Advanced assumptions
              </span>
              <IconChevronDown className="assumptions-panel__chevron" aria-hidden="true" size={17} />
            </summary>
            <div className="assumptions-panel__body">
              <ul>
                {assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
                {warnings.map((warning) => (
                  <li key={`warning-${warning.code}-${warning.field || "global"}`}>
                    {warning.message}
                  </li>
                ))}
                <li>
                  Detector sampling is an energy interval per pixel, not a total instrument FWHM.
                </li>
                <li>
                  Displayed widths and spans are non-negative magnitudes; signed companions retain
                  orientation information in the API result.
                </li>
              </ul>
              {result ? (
                <dl className="assumption-readout">
                  <div>
                    <dt>d-spacing</dt>
                    <dd>{formatValue(result.d_spacing_angstrom)} Å</dd>
                  </div>
                  <div>
                    <dt>Wavelength</dt>
                    <dd>{formatValue(result.wavelength_angstrom)} Å</dd>
                  </div>
                  <div>
                    <dt>Crystal rotation</dt>
                    <dd>{formatValue(result.crystal_rotation_deg)}°</dd>
                  </div>
                  <div>
                    <dt>Crystal footprint</dt>
                    <dd>{formatValue(result.crystal_footprint_mm)} mm</dd>
                  </div>
                </dl>
              ) : null}
            </div>
          </details>
        </section>

        <div ref={comparisonRef}>
          <ComparisonPanel
            baseline={baseline}
            current={result}
            currentConfig={calculatedConfig}
            onReplace={saveCurrentAsBaseline}
            onClear={() => setBaseline(null)}
          />
        </div>
      </main>

      <footer className="app-footer">
        <p>DXASCalc · Geometry and detector sampling workspace</p>
        <p>Distances in m · angles in degrees or mrad · energy in keV/eV</p>
      </footer>

      {aboutOpen ? (
        <AboutDialog
          closeButtonRef={aboutCloseButtonRef}
          dialogRef={aboutDialogRef}
          onClose={closeAboutDialog}
        />
      ) : null}
    </div>
  );
}
