import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconAtom2,
  IconBook2,
  IconCheck,
  IconChevronDown,
  IconCircleDashed,
  IconDeviceDesktop,
  IconDotsVertical,
  IconDownload,
  IconGitCompare,
  IconInfoCircle,
  IconLoader2,
  IconRefresh,
  IconRulerMeasure,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { AboutDialog } from "./components/AboutDialog.jsx";
import { ComparisonPanel } from "./components/ComparisonPanel.jsx";
import { InspectorSection } from "./components/InspectorSection.jsx";
import { FieldControl } from "./components/FieldControl.jsx";
import { OpticsCanvas } from "./components/OpticsCanvas.jsx";
import { ReflectivityPlot } from "./components/ReflectivityPlot.jsx";
import { ResultMetric } from "./components/ResultMetric.jsx";
import {
  DEFAULT_CONFIG,
  NUMERIC_FIELDS,
  configurationFilename,
  parseConfiguration,
  serializeConfiguration,
} from "./lib/configurationFile.js";
import { evInputToKev, kevToEvInput } from "./lib/energyUnits.js";
import { requestCalculation } from "./lib/apiClient.js";
import { createCalculationSession, sameScientificConfig } from "./lib/calculationSession.js";
import { formatMetricDelta, formatValue, hasMetric, unavailableReason } from "./lib/formatMetrics.js";
import { formatComparisonDelta } from "./lib/comparisonData.js";

const MATERIAL_OPTIONS = [
  { value: "Si", label: "Silicon (Si)" },
  { value: "Ge", label: "Germanium (Ge)" },
];

const CONDITION_OPTIONS = [
  { value: "upper", label: "Upper" },
  { value: "lower", label: "Lower" },
];

const POLARIZATION_OPTIONS = [
  { value: "unpolarized", label: "Unpolarized (σ + π)" },
  { value: "sigma", label: "Sigma (σ)" },
  { value: "pi", label: "Pi (π)" },
];

const EDGE_OPTIONS = ["K", "L1", "L2", "L3"];

function defaultThicknessForGeometry(geometry) {
  return geometry === "laue" ? 50 : 200;
}

function cloneConfig(config) {
  const source = config || {};
  const geometry = source.geometry || DEFAULT_CONFIG.geometry;
  return {
    ...DEFAULT_CONFIG,
    crystal_thickness_um: Object.prototype.hasOwnProperty.call(source, "crystal_thickness_um")
      ? source.crystal_thickness_um
      : defaultThicknessForGeometry(geometry),
    ...source,
  };
}

function canvasSafeConfig(config) {
  const safe = { ...DEFAULT_CONFIG, ...config };
  for (const field of NUMERIC_FIELDS) {
    const numeric = Number(safe[field]);
    safe[field] = Number.isFinite(numeric) ? numeric : DEFAULT_CONFIG[field];
  }
  return safe;
}

const FIELD_SECTIONS = {
  geometry: "geometry", source_distance_m: "geometry", source_size_um: "geometry",
  divergence_mrad: "geometry", bending_radius_m: "geometry",
  asymmetry_angle_deg: "geometry", condition: "geometry",
  detector_distance_m: "detector", pixel_size_um: "detector",
};

const FIELD_IDS = {
  material: "material", h: "h-index", k: "k-index", l: "l-index", hkl: "h-index",
  energy_kev: "energy", crystal_thickness_um: "crystal-thickness",
  polarization: "polarization", source_distance_m: "source-distance",
  source_size_um: "source-size", divergence_mrad: "divergence",
  bending_radius_m: "bending-radius", asymmetry_angle_deg: "asymmetry-angle",
  condition: "condition", detector_distance_m: "detector-distance",
  pixel_size_um: "pixel-size",
};

function resolutionMethodLabel(method) {
  if (!method) return "Combined estimate";
  const normalized = String(method).toLowerCase();
  if (normalized.includes("quadrature") || normalized.includes("root_sum_square")) {
    return "Quadrature estimate";
  }
  if (normalized.includes("convol")) return "Convolved response";
  return String(method).replaceAll("_", " ");
}

export function App() {
  const workspaceRef = useRef(null);
  const workspaceDragRef = useRef(null);
  const [inspectorWidth, setInspectorWidth] = useState(null);
  const [sessionState, setSessionState] = useState(null);
  const sessionRef = useRef(null);
  if (sessionRef.current === null) {
    sessionRef.current = createCalculationSession(DEFAULT_CONFIG, requestCalculation, setSessionState);
  }
  const calculation = sessionState ?? sessionRef.current.read();
  const config = calculation.draft;
  const calculatedConfig = calculation.accepted?.canonicalConfig ?? null;
  const result = calculation.accepted?.result ?? null;
  const loading = Boolean(calculation.pending);
  const dirty = result ? !calculation.isCurrent : calculation.revision > 0;
  const fieldErrors = calculation.error?.fieldErrors ?? {};
  const generalIssues = calculation.error?.generalIssues ?? [];
  const serverError = calculation.error?.kind === "failed" ? calculation.error.message : "";
  const [energyInputEv, setEnergyInputEv] = useState(() => kevToEvInput(DEFAULT_CONFIG.energy_kev));
  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [presetsError, setPresetsError] = useState("");
  const [edgeElements, setEdgeElements] = useState([]);
  const [edgeCatalogLoading, setEdgeCatalogLoading] = useState(true);
  const [edgeCatalogError, setEdgeCatalogError] = useState("");
  const [selectedEdge, setSelectedEdge] = useState("K");
  const [selectedElement, setSelectedElement] = useState("");
  const [baseline, setBaseline] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fileMessage, setFileMessage] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [sections, setSections] = useState({
    crystal: true,
    geometry: true,
    detector: true,
  });

  const configRef = useRef(config);
  const presetsSequenceRef = useRef(0);
  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);
  const configurationInputRef = useRef(null);
  const aboutCloseButtonRef = useRef(null);
  const aboutDialogRef = useRef(null);
  const comparisonRef = useRef(null);
  const thicknessEditedRef = useRef(false);

  const defaultInspectorWidth = () => window.matchMedia("(max-width: 1180px)").matches ? 310 : 324;
  const inspectorWidthBounds = () => ({
    min: 260,
    max: Math.max(260, Math.min(620, (workspaceRef.current?.clientWidth ?? 1100) - 428)),
  });
  const resizeInspector = (nextWidth) => {
    const { min, max } = inspectorWidthBounds();
    const width = Math.round(Math.min(max, Math.max(min, nextWidth)));
    workspaceRef.current?.style.setProperty("--inspector-width", `${width}px`);
    setInspectorWidth(width);
  };
  const resetInspectorWidth = () => {
    workspaceRef.current?.style.removeProperty("--inspector-width");
    setInspectorWidth(null);
  };

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (workspace.clientWidth <= 900) return;
      const width = Number.parseFloat(workspace.style.getPropertyValue("--inspector-width"));
      if (!Number.isFinite(width)) return;
      const max = Math.max(260, Math.min(620, workspace.clientWidth - 428));
      if (width > max) {
        workspace.style.setProperty("--inspector-width", `${max}px`);
        setInspectorWidth(max);
      }
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  const closeAboutDialog = useCallback(() => {
    setAboutOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  const commitConfig = useCallback((nextConfig) => {
    configRef.current = nextConfig;
    sessionRef.current.edit(nextConfig);
  }, []);

  const calculate = useCallback(async (candidate) => {
    const outcome = await sessionRef.current.submit(candidate);
    if (outcome.kind === "invalid" && outcome.owned) {
      const nextSections = {};
      for (const issue of outcome.issues) {
        if (issue?.field) nextSections[FIELD_SECTIONS[issue.field] ?? "crystal"] = true;
      }
      if (Object.keys(nextSections).length) {
        setSections((previous) => ({ ...previous, ...nextSections }));
      }
    }
    return outcome;
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
        // A user may edit the draft before the preset catalog arrives. Keep
        // that draft labeled as custom rather than restoring the default name.
        if (sessionRef.current.read().revision === 0) {
          setSelectedPresetId(defaultPreset?.id || "");
        }
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
      sessionRef.current.cancel();
    };
  }, [calculate]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadAbsorptionEdges() {
      try {
        const response = await fetch("/api/absorption-edges", { signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.elements)) {
          throw new Error("Element edge energies are unavailable.");
        }
        setEdgeElements(payload.elements);
        setEdgeCatalogError("");
      } catch (error) {
        if (error?.name !== "AbortError") {
          setEdgeCatalogError(error?.message || "Element edge energies are unavailable.");
        }
      } finally {
        if (!controller.signal.aborted) setEdgeCatalogLoading(false);
      }
    }
    void loadAbsorptionEdges();
    return () => controller.abort();
  }, []);

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
    if (loading) {
      const currentRequest = sameScientificConfig(config, calculation.pending?.config);
      return { kind: "loading", label: currentRequest ? "Calculating" : "Calculating previous setup" };
    }
    if (serverError || generalIssues.length || Object.keys(fieldErrors).length) {
      return { kind: "error", label: "Setup needs attention" };
    }
    if (dirty) return { kind: "dirty", label: "Changes not calculated" };
    if (result && calculation.isCurrent) return { kind: "success", label: "Calculation ready" };
    return { kind: "idle", label: "Waiting for calculation" };
  }, [calculation.isCurrent, calculation.pending, config, dirty, fieldErrors, generalIssues.length, loading, result, serverError]);

  const handleFieldChange = useCallback(
    (field, value) => {
      if (field === "crystal_thickness_um") thicknessEditedRef.current = true;
      const next = { ...configRef.current, [field]: value };
      commitConfig(next);
      setSelectedPresetId("");
    },
    [commitConfig],
  );

  const availableEdgeElements = useMemo(
    () => edgeElements.filter((element) => Number(element.edges_kev?.[selectedEdge]) > 0),
    [edgeElements, selectedEdge],
  );

  const handleEdgeChange = useCallback((edge) => {
    setSelectedEdge(edge);
    if (!selectedElement) return;
    const element = edgeElements.find((item) => item.symbol === selectedElement);
    const energy = Number(element?.edges_kev?.[edge]);
    if (!Number.isFinite(energy) || energy <= 0) {
      setSelectedElement("");
      return;
    }
    setEnergyInputEv(kevToEvInput(energy));
    handleFieldChange("energy_kev", energy);
  }, [edgeElements, handleFieldChange, selectedElement]);

  const handleElementChange = useCallback((symbol) => {
    setSelectedElement(symbol);
    if (!symbol) return;
    const element = edgeElements.find((item) => item.symbol === symbol);
    const energy = Number(element?.edges_kev?.[selectedEdge]);
    if (Number.isFinite(energy) && energy > 0) {
      setEnergyInputEv(kevToEvInput(energy));
      handleFieldChange("energy_kev", energy);
    }
  }, [edgeElements, handleFieldChange, selectedEdge]);

  const handleGeometryChange = useCallback(
    (geometry) => {
      if (configRef.current.geometry === geometry) return;
      const next = {
        ...configRef.current,
        geometry,
        ...(thicknessEditedRef.current
          ? {}
          : { crystal_thickness_um: defaultThicknessForGeometry(geometry) }),
      };
      commitConfig(next);
      setSelectedPresetId("");
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
      thicknessEditedRef.current = false;
      commitConfig(next);
      setEnergyInputEv(kevToEvInput(next.energy_kev));
      setSelectedElement("");
      void calculate(next);
    },
    [calculate, commitConfig, presets],
  );

  const handleDiagramDistanceChange = useCallback(
    async (field, distanceMeters) => {
      if (!["source_distance_m", "detector_distance_m"].includes(field)) return;
      const distance = Number(distanceMeters);
      if (!Number.isFinite(distance)) return;
      const next = { ...configRef.current, [field]: distance };
      commitConfig(next);
      setSelectedPresetId("");
      const outcome = await calculate(next);
      return outcome.kind === "accepted" && outcome.isCurrent;
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
    thicknessEditedRef.current = false;
    commitConfig(next);
    setEnergyInputEv(kevToEvInput(next.energy_kev));
    setSelectedElement("");
    setSelectedEdge("K");
    setSelectedPresetId("bragg-si111-legacy-safe");
    setMenuOpen(false);
    setFileMessage(null);
    void calculate(next);
  }, [calculate, commitConfig]);

  const handleSaveConfiguration = useCallback(() => {
    setMenuOpen(false);
    try {
      const contents = serializeConfiguration(configRef.current);
      const filename = configurationFilename(configRef.current);
      const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setFileMessage({ kind: "success", text: `Input configuration saved as ${filename}. Loading it later will recalculate the result.` });
    } catch (error) {
      setFileMessage({ kind: "error", text: error.message || "Could not save this configuration." });
    }
  }, []);

  const handleLoadConfiguration = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 64 * 1024) {
        throw new Error("Configuration files must be smaller than 64 KB.");
      }
      const next = parseConfiguration(await file.text());
      thicknessEditedRef.current = true;
      commitConfig(next);
      setEnergyInputEv(kevToEvInput(next.energy_kev));
      setSelectedElement("");
      setSelectedPresetId("");
      setFileMessage({ kind: "success", text: `Loaded ${file.name}.` });
      void calculate(next);
    } catch (error) {
      setFileMessage({ kind: "error", text: error.message || "Could not load this configuration." });
    }
  }, [calculate, commitConfig]);

  const saveCurrentAsBaseline = useCallback(() => {
    if (!result || !calculatedConfig || !calculation.isCurrent || loading || calculation.error) return;
    setBaseline({ result, config: cloneConfig(calculatedConfig) });
  }, [calculatedConfig, calculation.error, calculation.isCurrent, loading, result]);

  const handleCompare = useCallback(() => {
    if (!baseline) saveCurrentAsBaseline();
    window.requestAnimationFrame(() => {
      comparisonRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [baseline, saveCurrentAsBaseline]);

  const toggleSection = useCallback((section) => {
    setSections((previous) => ({ ...previous, [section]: !previous[section] }));
  }, []);

  const focusErrorField = useCallback((field) => {
    setSections((previous) => ({ ...previous, [FIELD_SECTIONS[field] ?? "crystal"]: true }));
    window.requestAnimationFrame(() => {
      const target = field === "geometry"
        ? document.querySelector(".geometry-switch button")
        : document.getElementById(FIELD_IDS[field]);
      target?.focus();
    });
  }, []);

  const fieldErrorCount = Object.keys(fieldErrors).length;
  const hasStaleResult = Boolean(result && (dirty || fieldErrorCount || serverError));
  const canSetBaseline = Boolean(result && calculatedConfig && calculation.isCurrent && !loading && !calculation.error);
  const canSubmit = !loading || !sameScientificConfig(config, calculation.pending?.config);
  const resultSnapshotLabel = calculatedConfig
    ? `${calculatedConfig.material}(${calculatedConfig.h}${calculatedConfig.k}${calculatedConfig.l}), ${formatValue(Number(calculatedConfig.energy_kev) * 1000)} eV`
    : null;
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
  const hasDetectorSampling = hasMetric(result?.detector_sampling_ev_per_pixel);
  const hasSourceResolution = hasMetric(result?.source_size_resolution_ev_fwhm);
  const hasCrystalResolution = hasMetric(result?.crystal_intrinsic_resolution_ev_fwhm);
  const hasTotalResolution = hasMetric(result?.total_resolution_ev_fwhm);
  const braggAngleDeg = hasMetric(result?.bragg_angle_deg) ? Number(result.bragg_angle_deg) : null;
  const detectorAngleDeg = braggAngleDeg === null ? null : 2 * braggAngleDeg;
  const comparedTotalDelta = baseline
    ? formatComparisonDelta(result, baseline.result, "total_resolution_ev_fwhm", "eV FWHM")
    : null;
  const totalDelta = comparedTotalDelta === "—" || comparedTotalDelta === null
    ? null
    : comparedTotalDelta.startsWith("Different")
      ? comparedTotalDelta
      : `${comparedTotalDelta} vs baseline`;

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
            disabled={!canSubmit}
            aria-label={loading && !canSubmit ? "Calculating" : "Recalculate current setup"}
          >
            {loading ? (
              <IconLoader2 className="icon-spin" aria-hidden="true" size={18} />
            ) : (
              <IconRefresh aria-hidden="true" size={18} />
            )}
            <span>{loading && !canSubmit ? "Calculating" : "Recalculate"}</span>
          </button>
          <button
            className="button button--outline secondary-action"
            type="button"
            onClick={handleCompare}
            disabled={!baseline && !canSetBaseline}
            aria-label={baseline ? "View comparison" : "Set current result as comparison baseline"}
          >
            <IconGitCompare aria-hidden="true" size={18} />
            <span>{baseline ? "View comparison" : "Set baseline"}</span>
          </button>
          <div className="overflow-menu" ref={menuRef}>
            <input
              ref={configurationInputRef}
              className="sr-only"
              type="file"
              accept=".json,application/json"
              tabIndex={-1}
              aria-label="Choose a DXASCalc configuration file"
              onChange={(event) => void handleLoadConfiguration(event)}
            />
            <button
              ref={menuButtonRef}
              className="icon-button icon-button--bordered icon-action"
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? "Close application menu" : "Open application menu"}
              aria-expanded={menuOpen}
              aria-controls="application-menu"
            >
              <IconDotsVertical aria-hidden="true" size={20} />
            </button>
            {menuOpen ? (
              <div className="overflow-menu__popover" id="application-menu">
                <button type="button" onClick={handleSaveConfiguration}>
                  <IconDownload aria-hidden="true" size={16} />
                  Save input configuration
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    configurationInputRef.current?.click();
                  }}
                >
                  <IconUpload aria-hidden="true" size={16} />
                  Load configuration
                </button>
                <button type="button" onClick={handleReset}>
                  <IconRefresh aria-hidden="true" size={16} />
                  Reset default setup
                </button>
                <button
                  type="button"
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

      <nav className="mobile-section-nav" aria-label="Workspace sections">
        <a href="#setup-inspector-panel">Parameters</a>
        <a href="#results-heading">Results</a>
      </nav>

      {fileMessage ? (
        <div className={`app-status ${fileMessage.kind}`} role={fileMessage.kind === "error" ? "alert" : "status"}>
          {fileMessage.kind === "error" ? <IconAlertTriangle aria-hidden="true" size={17} /> : <IconCheck aria-hidden="true" size={17} />}
          <span>{fileMessage.text}</span>
          <button type="button" className="app-status__dismiss" onClick={() => setFileMessage(null)} aria-label="Dismiss configuration message">
            <IconX aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}

      <main id="workspace" className="app-main">
        <div className="workspace" ref={workspaceRef}>
          <div className="workspace__main">
          <section id="optics-workbench-panel" className="canvas-panel" aria-labelledby="optics-workspace-heading">
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

              {fieldErrorCount ? (
                <div className="calculation-message calculation-message--error" role="alert">
                  <IconAlertTriangle aria-hidden="true" size={19} stroke={1.8} />
                  <div>
                    <strong>Review {fieldErrorCount} setup {fieldErrorCount === 1 ? "field" : "fields"}</strong>
                    <ul className="calculation-message__fields">
                      {Object.entries(fieldErrors).map(([field, message]) => (
                        <li key={field}>
                          <button type="button" onClick={() => focusErrorField(field)}>
                            {field.replaceAll("_", " ")}: {message}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {result ? <small>The optics and metrics show the last accepted result.</small> : null}
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
                    <dt>Detector angle</dt>
                    <dd>{detectorAngleDeg === null ? "—" : `${formatValue(detectorAngleDeg)}°`}</dd>
                  </div>
                  <div>
                    <dt>Focus</dt>
                    <dd>
                      {hasMetric(result.geometric_focus_m) ? `${formatValue(result.geometric_focus_m)} m` : "Unavailable"} · {result.focus_kind}
                    </dd>
                  </div>
                  <div>
                    <dt>Image</dt>
                    <dd>{result.image_inverted ? "Inverted" : "Upright"}</dd>
                  </div>
                </dl>
              ) : null}
            </div>
            {resultSnapshotLabel ? (
              <p className={`result-snapshot${hasStaleResult ? " result-snapshot--stale" : ""}`}>
                Calculated: {resultSnapshotLabel}. {hasStaleResult ? "Showing previous result; changes are not calculated." : "Matches the current inputs."}
              </p>
            ) : null}
          </section>

        <section className="results-strip" aria-labelledby="results-heading">
          <div className="results-strip__heading">
            <div>
              <p className="eyebrow">Calculated outputs</p>
              <h2 id="results-heading">Detector-ready summary</h2>
            </div>
            {resultSnapshotLabel ? <span>{hasStaleResult ? "Showing previous result" : `Calculated: ${resultSnapshotLabel}`}</span> : null}
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
              label="Estimated total resolution"
              value={!result ? "—" : hasTotalResolution ? formatValue(result.total_resolution_ev_fwhm) : "Unavailable"}
              unit={hasTotalResolution ? "eV FWHM" : undefined}
              note={!result
                ? "Waiting for calculation"
                : hasTotalResolution
                ? `${resolutionMethodLabel(result?.total_resolution_method)} · source + crystal + pixel interval`
                : unavailableReason(result, "total_resolution_ev_fwhm")}
              delta={totalDelta}
              accent="muted"
              unavailable={Boolean(result && !hasTotalResolution)}
            />
          </div>
        </section>

        <div className="comparison-region" ref={comparisonRef}>
          <ComparisonPanel
            baseline={baseline}
            current={result}
            currentConfig={calculatedConfig}
            canReplace={canSetBaseline}
            onReplace={saveCurrentAsBaseline}
            onClear={() => setBaseline(null)}
          />
        </div>

        <ReflectivityPlot result={result} config={calculatedConfig || displayedConfig} />

        <section className="coverage-panel" aria-labelledby="coverage-heading">
          <div className="coverage-panel__intro">
            <p className="eyebrow">Scientific completeness</p>
            <h2 id="coverage-heading">Resolution model coverage</h2>
            <p>
              The detector interval, finite-source FWHM, and intrinsic crystal FWHM are reported
              separately. Total resolution is an estimate using the method named in the result.
            </p>
          </div>

          <ul className="coverage-grid" aria-label="Resolution model coverage status">
            <li className={`coverage-item ${hasDetectorSampling ? "coverage-item--calculated" : "coverage-item--pending"}`}>
              <span className="coverage-item__icon" aria-hidden="true">
                {hasDetectorSampling ? <IconCheck size={18} stroke={2} /> : <IconCircleDashed size={18} stroke={1.8} />}
              </span>
              <div>
                <strong>Detector sampling</strong>
                <span>{hasDetectorSampling ? "Calculated" : "Unavailable"}</span>
                <small>{hasDetectorSampling
                  ? `${formatValue(result.detector_sampling_ev_per_pixel)} eV/px`
                  : result ? unavailableReason(result, "detector_sampling_ev_per_pixel") : "Waiting for calculation"}</small>
              </div>
            </li>
            <li
              className={`coverage-item ${
                hasSourceResolution ? "coverage-item--calculated" : "coverage-item--pending"
              }`}
            >
              <span className="coverage-item__icon" aria-hidden="true">
                {hasSourceResolution ? (
                  <IconCheck size={18} stroke={2} />
                ) : (
                  <IconCircleDashed size={18} stroke={1.8} />
                )}
              </span>
              <div>
                <strong>Source-size contribution</strong>
                <span>{hasSourceResolution ? "Calculated FWHM" : "Unavailable"}</span>
                <small>
                  {hasSourceResolution
                    ? `${formatValue(result.source_size_resolution_ev_fwhm)} eV`
                    : unavailableReason(result, "source_size_resolution_ev_fwhm")}
                </small>
              </div>
            </li>
            <li
              className={`coverage-item ${
                hasCrystalResolution ? "coverage-item--calculated" : "coverage-item--pending"
              }`}
            >
              <span className="coverage-item__icon" aria-hidden="true">
                {hasCrystalResolution ? (
                  <IconCheck size={18} stroke={2} />
                ) : (
                  <IconCircleDashed size={18} stroke={1.8} />
                )}
              </span>
              <div>
                <strong>Crystal intrinsic width</strong>
                <span>{hasCrystalResolution ? "Calculated FWHM" : "Unavailable"}</span>
                <small>
                  {hasCrystalResolution
                    ? `${formatValue(result.crystal_intrinsic_resolution_ev_fwhm)} eV`
                    : unavailableReason(result, "crystal_intrinsic_resolution_ev_fwhm")}
                </small>
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
                  Total resolution uses {resolutionMethodLabel(result?.total_resolution_method).toLowerCase()};
                  contributions may not be Gaussian in a real bent-crystal instrument.
                </li>
                {(calculatedConfig || displayedConfig).geometry === "laue" ? (
                  <li>
                    The Laue intrinsic profile is thickness-sensitive. A Borrmann-fan spatial
                    contribution is not separately included in total resolution unless explicitly
                    named by the model; strain and fabrication broadening are also not implied.
                  </li>
                ) : null}
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
                  <div>
                    <dt>Crystal intrinsic FWHM</dt>
                    <dd>{formatValue(result.crystal_intrinsic_resolution_ev_fwhm)} eV</dd>
                  </div>
                  <div>
                    <dt>Source-size FWHM</dt>
                    <dd>{formatValue(result.source_size_resolution_ev_fwhm)} eV</dd>
                  </div>
                </dl>
              ) : null}
            </div>
          </details>
        </section>

          </div>

          <div
            className="workspace__resizer"
            role="separator"
            tabIndex={0}
            aria-label="Resize optics workbench and setup inspector"
            aria-orientation="vertical"
            aria-controls="optics-workbench-panel setup-inspector-panel"
            aria-valuemin={inspectorWidthBounds().min}
            aria-valuemax={inspectorWidthBounds().max}
            aria-valuenow={inspectorWidth ?? defaultInspectorWidth()}
            title="Drag to resize the workbench and inspector; double-click to reset"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              workspaceDragRef.current = {
                startX: event.clientX,
                startWidth: event.currentTarget.nextElementSibling.getBoundingClientRect().width,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              if (!workspaceDragRef.current) return;
              resizeInspector(workspaceDragRef.current.startWidth + workspaceDragRef.current.startX - event.clientX);
            }}
            onPointerUp={() => {
              if (!workspaceDragRef.current) return;
              workspaceDragRef.current = null;
              window.dispatchEvent(new Event("resize"));
            }}
            onPointerCancel={() => { workspaceDragRef.current = null; }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 48 : 16;
              const current = inspectorWidth ?? defaultInspectorWidth();
              if (event.key === "ArrowLeft") resizeInspector(current + step);
              else if (event.key === "ArrowRight") resizeInspector(current - step);
              else if (event.key === "Home") resizeInspector(inspectorWidthBounds().min);
              else if (event.key === "End") resizeInspector(inspectorWidthBounds().max);
              else return;
              event.preventDefault();
              window.dispatchEvent(new Event("resize"));
            }}
            onDoubleClick={() => {
              resetInspectorWidth();
              window.dispatchEvent(new Event("resize"));
            }}
          >
            <span aria-hidden="true" />
          </div>

          <aside id="setup-inspector-panel" className="inspector" aria-labelledby="inspector-heading">
            <div className="inspector__header">
              <div>
                <p className="eyebrow">Configuration</p>
                <h2 id="inspector-heading">Setup inspector</h2>
              </div>
              <span className={`inspector__state${dirty ? " is-dirty" : ""}`} role="status">
                {fieldErrorCount ? `${fieldErrorCount} error${fieldErrorCount === 1 ? "" : "s"}` : loading ? "Calculating" : dirty ? "Changes not calculated" : result ? "Synced" : "Waiting"}
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
                  unit="eV"
                  value={energyInputEv}
                  onChange={(value) => {
                    setSelectedElement("");
                    setEnergyInputEv(value);
                    handleFieldChange("energy_kev", evInputToKev(value));
                  }}
                  step="1"
                  error={fieldErrors.energy_kev}
                  hint="Photon energy is entered in electronvolts (eV)."
                />
                <div className="edge-picker">
                  <div className="edge-picker__fields">
                    <label className="edge-picker__field" htmlFor="edge-select">
                      Edge
                      <select
                        id="edge-select"
                        className="field-select"
                        value={selectedEdge}
                        onChange={(event) => handleEdgeChange(event.target.value)}
                      >
                        {EDGE_OPTIONS.map((edge) => <option key={edge} value={edge}>{edge}</option>)}
                      </select>
                    </label>
                    <label className="edge-picker__field" htmlFor="element-select">
                      Element
                      <select
                        id="element-select"
                        className="field-select"
                        value={selectedElement}
                        onChange={(event) => handleElementChange(event.target.value)}
                        disabled={edgeCatalogLoading || Boolean(edgeCatalogError)}
                        aria-describedby={edgeCatalogError ? "edge-picker-error" : "edge-picker-hint"}
                      >
                        <option value="">{edgeCatalogLoading ? "Loading elements…" : "Custom energy"}</option>
                        {availableEdgeElements.map((element) => (
                          <option key={element.symbol} value={element.symbol}>
                            {element.symbol} (Z={element.atomic_number})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p id="edge-picker-hint">Choose an absorption edge to fill the energy, or edit the eV value directly.</p>
                  {edgeCatalogError ? <p id="edge-picker-error" className="edge-picker__error" role="status">{edgeCatalogError} Enter energy manually.</p> : null}
                </div>
                <FieldControl
                  id="crystal-thickness"
                  label="Physical thickness"
                  unit="µm"
                  value={config.crystal_thickness_um}
                  onChange={(value) => handleFieldChange("crystal_thickness_um", value)}
                  step={config.geometry === "laue" ? "5" : "10"}
                  min="0.1"
                  error={fieldErrors.crystal_thickness_um}
                  hint="Physical path thickness used by the intrinsic reflectivity model. Laue transmission crystals are typically much thinner."
                />
                <FieldControl
                  id="polarization"
                  label="Polarization"
                  value={config.polarization}
                  onChange={(value) => handleFieldChange("polarization", value)}
                  options={POLARIZATION_OPTIONS}
                  error={fieldErrors.polarization}
                  hint="Unpolarized reports the average of the σ and π reflectivity profiles."
                />
                <div className={`model-callout model-callout--${config.geometry}`}>
                  <IconInfoCircle aria-hidden="true" size={16} stroke={1.8} />
                  <p>
                    {config.geometry === "laue" ? (
                      <>
                        <strong>Laue transmission:</strong> thickness strongly changes the
                        Penning–Polder profile. The 50 µm default is intentionally thin. A
                        Borrmann-fan spatial contribution is not separately included in the total
                        unless the result assumptions explicitly say it is.
                      </>
                    ) : (
                      <>
                        <strong>Bragg reflection:</strong> the primary intrinsic response uses the
                        XOP bent-crystal multilamellar model. Any fallback model is named with the
                        result.
                      </>
                    )}
                  </p>
                </div>
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
                  id="source-size"
                  label="Source size FWHM"
                  unit="µm"
                  value={config.source_size_um}
                  onChange={(value) => handleFieldChange("source_size_um", value)}
                  step="0.1"
                  min="0"
                  error={fieldErrors.source_size_um}
                  hint="Effective source size in the dispersive plane, treated as a spatial FWHM."
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
                <button className="button button--primary button--full" type="submit" disabled={!canSubmit}>
                  {loading && !canSubmit ? (
                    <IconLoader2 className="icon-spin" aria-hidden="true" size={18} />
                  ) : (
                    <IconRefresh aria-hidden="true" size={18} />
                  )}
                  {loading && !canSubmit ? "Calculating…" : "Recalculate setup"}
                </button>
                <p>{hasStaleResult ? `Previous result: ${resultSnapshotLabel}.` : "Inputs are checked by the calculation API."}</p>
              </div>
            </form>
          </aside>
        </div>
      </main>

      <footer className="app-footer">
        <p>DXASCalc · Geometry, reflectivity, and resolution workspace</p>
        <p>Distances in m · thickness in µm · angles in degrees or mrad · energy in eV</p>
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
