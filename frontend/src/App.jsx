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
  IconArrowBackUp,
  IconX,
} from "@tabler/icons-react";
import { AboutDialog } from "./components/AboutDialog.jsx";
import { ComparisonPanel } from "./components/ComparisonPanel.jsx";
import { InspectorSection } from "./components/InspectorSection.jsx";
import { FieldControl } from "./components/FieldControl.jsx";
import { DetectorDistanceControl } from "./components/DetectorDistanceControl.jsx";
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
import { requestCalculation, requestJson } from "./lib/apiClient.js";
import { browserStorage, readDraft, writeDraft } from "./lib/draftStorage.js";
import { DETECTOR_DISTANCE_MODES, sameBraggInputs } from "./lib/detectorProjection.js";
import { createCalculationSession, sameScientificConfig } from "./lib/calculationSession.js";
import { formatMetricDelta, formatValue, hasMetric, unavailableReason } from "./lib/formatMetrics.js";
import { formatComparisonDelta } from "./lib/comparisonData.js";
import { VersionBadge } from "./components/VersionBadge.jsx";

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

const FIELD_LABELS = {
  material: "Material", h: "Miller index h", k: "Miller index k", l: "Miller index l", hkl: "Reflection (h k l)",
  energy_kev: "Photon energy", crystal_thickness_um: "Physical thickness", polarization: "Polarization",
  source_distance_m: "Source–crystal distance p", source_size_um: "Source size FWHM", divergence_mrad: "Full angular divergence",
  bending_radius_m: "Bending radius R", asymmetry_angle_deg: "Asymmetry angle α", condition: "Condition",
  detector_distance_m: "Crystal–detector distance q", pixel_size_um: "Pixel size", geometry: "Diffraction geometry",
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
  const [restoredDraft] = useState(() => readDraft(browserStorage()));
  const [draftSaved, setDraftSaved] = useState(true);
  const [detectorDistanceMode, setDetectorDistanceMode] = useState(
    () => restoredDraft?.detectorDistanceMode ?? DETECTOR_DISTANCE_MODES.RAY,
  );
  const [mobileView, setMobileView] = useState("workbench");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [replacementUndo, setReplacementUndo] = useState(null);
  const workspaceRef = useRef(null);
  const workspaceDragRef = useRef(null);
  const [inspectorWidth, setInspectorWidth] = useState(null);
  const [sessionState, setSessionState] = useState(null);
  const sessionRef = useRef(null);
  if (sessionRef.current === null) {
    sessionRef.current = createCalculationSession(restoredDraft?.config ?? DEFAULT_CONFIG, requestCalculation, setSessionState);
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
  const [energyInputEv, setEnergyInputEv] = useState(() => restoredDraft?.energyInputEv ?? kevToEvInput(DEFAULT_CONFIG.energy_kev));
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
  const [fileMessage, setFileMessage] = useState(() => restoredDraft
    ? { kind: "success", text: "Restored your last inputs. Results are recalculated on opening." } : null);
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
  const thicknessEditedRef = useRef(restoredDraft?.thicknessEdited ?? false);
  const fileLoadSequenceRef = useRef(0);

  const defaultInspectorWidth = () => window.matchMedia("(max-width: 1250px)").matches ? 336 : 360;
  const inspectorWidthBounds = () => ({
    min: 260,
    max: Math.max(260, Math.min(620, (workspaceRef.current?.clientWidth ?? 1100) - 432)),
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
      const max = Math.max(260, Math.min(620, workspace.clientWidth - 432));
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

  useEffect(() => {
    setDraftSaved(writeDraft(browserStorage(), {
      config, energyInputEv, thicknessEdited: thicknessEditedRef.current,
      detectorDistanceMode,
    }));
  }, [config, energyInputEv, detectorDistanceMode]);

  useEffect(() => {
    if (draftSaved || !calculation.revision) return undefined;
    const warnBeforeLeaving = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [draftSaved, calculation.revision]);

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
    if (!fileMessage || fileMessage.kind === "error" || fileMessage.canUndo) return undefined;
    const timer = window.setTimeout(() => setFileMessage(null), 7000);
    return () => window.clearTimeout(timer);
  }, [fileMessage]);

  useEffect(() => {
    // CSS hides one pane on small screens; Plotly must measure its visible size
    // after switching back from Parameters.
    if (mobileView !== "workbench") return undefined;
    const frame = window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => window.cancelAnimationFrame(frame);
  }, [mobileView]);

  useEffect(() => {
    const handleShortcut = (event) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || aboutOpen || event.isComposing) return;
      event.preventDefault();
      const current = sessionRef.current.read();
      if (!current.pending || !sameScientificConfig(current.draft, current.pending.config)) void calculate(current.draft);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [aboutOpen, calculate]);

  useEffect(() => {
    const sequence = presetsSequenceRef.current + 1;
    presetsSequenceRef.current = sequence;
    const controller = new AbortController();

    async function loadPresets() {
      setPresetsLoading(true);
      setPresetsError("");
      try {
        const { ok, payload } = await requestJson("/api/presets", { signal: controller.signal, timeoutMs: 12000 });
        if (!ok || !Array.isArray(payload?.presets) || !payload.presets.every((preset) =>
          typeof preset?.id === "string" && typeof preset.name === "string" && sameScientificConfig(preset.config, preset.config))) {
          throw new Error("Preset list is unavailable.");
        }
        if (controller.signal.aborted || sequence !== presetsSequenceRef.current) return;
        setPresets(payload.presets);
        const defaultPreset = payload.presets.find(
          (preset) => preset.id === "bragg-si111-legacy-safe",
        );
        // A user may edit the draft before the preset catalog arrives. Keep
        // that draft labeled as custom rather than restoring the default name.
        if (sessionRef.current.read().revision === 0) {
          setSelectedPresetId(sameScientificConfig(sessionRef.current.read().draft, defaultPreset?.config) ? defaultPreset.id : "");
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
    return () => {
      controller.abort();
    };
  }, [catalogAttempt]);

  useEffect(() => {
    void calculate(configRef.current);
    return () => sessionRef.current.cancel();
  }, [calculate]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadAbsorptionEdges() {
      setEdgeCatalogLoading(true);
      setEdgeCatalogError("");
      try {
        const { ok, payload } = await requestJson("/api/absorption-edges", { signal: controller.signal, timeoutMs: 12000 });
        if (!ok || !Array.isArray(payload?.elements) || !payload.elements.every((element) => typeof element?.symbol === "string" && element.edges_kev && typeof element.edges_kev === "object")) {
          throw new Error("Element edge energies are unavailable.");
        }
        if (controller.signal.aborted) return;
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
  }, [catalogAttempt]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    menuRef.current?.querySelector(".overflow-menu__popover button")?.focus();
    function handleOutsidePointer(event) {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const items = Array.from(menuRef.current?.querySelectorAll(".overflow-menu__popover button") ?? []);
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
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
      setReplacementUndo(null);
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
      setReplacementUndo(null);
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
      setReplacementUndo({ config: { ...configRef.current }, energyInputEv, thicknessEdited: thicknessEditedRef.current });
      setFileMessage({ kind: "success", text: `Loaded ${preset.name}.`, canUndo: true });
      const next = cloneConfig(preset.config);
      thicknessEditedRef.current = false;
      commitConfig(next);
      setEnergyInputEv(kevToEvInput(next.energy_kev));
      setSelectedElement("");
      void calculate(next);
    },
    [calculate, commitConfig, presets, energyInputEv],
  );

  const handleDiagramDistanceChange = useCallback(
    async (field, distanceMeters) => {
      if (!["source_distance_m", "detector_distance_m"].includes(field)) return;
      const distance = Number(distanceMeters);
      if (!Number.isFinite(distance)) return;
      setReplacementUndo(null);
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
    setReplacementUndo({ config: { ...configRef.current }, energyInputEv, thicknessEdited: thicknessEditedRef.current });
    const next = cloneConfig(DEFAULT_CONFIG);
    thicknessEditedRef.current = false;
    commitConfig(next);
    setEnergyInputEv(kevToEvInput(next.energy_kev));
    setSelectedElement("");
    setSelectedEdge("K");
    setSelectedPresetId("bragg-si111-legacy-safe");
    setMenuOpen(false);
    setFileMessage({ kind: "success", text: "Default Bragg setup restored.", canUndo: true });
    void calculate(next);
  }, [calculate, commitConfig, energyInputEv]);

  const handleUndoReplacement = useCallback(() => {
    if (!replacementUndo) return;
    sessionRef.current.cancel();
    thicknessEditedRef.current = replacementUndo.thicknessEdited;
    commitConfig(replacementUndo.config);
    setEnergyInputEv(replacementUndo.energyInputEv);
    setSelectedElement("");
    setSelectedPresetId("");
    setReplacementUndo(null);
    setFileMessage({ kind: "success", text: "Previous inputs restored." });
    void calculate(replacementUndo.config);
  }, [calculate, commitConfig, replacementUndo]);

  const handleRevert = useCallback(() => {
    if (!calculatedConfig) return;
    sessionRef.current.cancel();
    thicknessEditedRef.current = true;
    commitConfig(cloneConfig(calculatedConfig));
    setEnergyInputEv(kevToEvInput(calculatedConfig.energy_kev));
    setSelectedElement("");
    setSelectedPresetId("");
    setReplacementUndo(null);
  }, [calculatedConfig, commitConfig]);

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
      setFileMessage({ kind: "success", text: `Configuration download started: ${filename}.` });
    } catch (error) {
      setFileMessage({ kind: "error", text: error.message || "Could not save this configuration." });
    }
  }, []);

  const handleLoadConfiguration = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const sequence = ++fileLoadSequenceRef.current;
    const revision = sessionRef.current.read().revision;
    try {
      if (file.size > 64 * 1024) {
        throw new Error("Configuration files must be smaller than 64 KB.");
      }
      const next = parseConfiguration(await file.text());
      if (sequence !== fileLoadSequenceRef.current) return;
      if (revision !== sessionRef.current.read().revision) {
        setFileMessage({ kind: "error", text: "Inputs changed while the file was opening. Load it again to replace them." });
        return;
      }
      setReplacementUndo({ config: { ...configRef.current }, energyInputEv, thicknessEdited: thicknessEditedRef.current });
      thicknessEditedRef.current = true;
      commitConfig(next);
      setEnergyInputEv(kevToEvInput(next.energy_kev));
      setSelectedElement("");
      setSelectedPresetId("");
      setFileMessage({ kind: "success", text: `Loaded ${file.name}.`, canUndo: true });
      void calculate(next);
    } catch (error) {
      if (sequence !== fileLoadSequenceRef.current) return;
      setFileMessage({ kind: "error", text: error.message || "Could not load this configuration." });
    }
  }, [calculate, commitConfig, energyInputEv]);

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
    setMobileView("parameters");
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
  const projectionAngleCurrent = braggAngleDeg !== null && sameBraggInputs(config, calculatedConfig);
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
            <p>Dispersive X-ray optics</p>
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
              Starting setup
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
                <option value="">{presetsLoading ? "Loading presets…" : "Custom setup"}</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </div>
            {presetsError ? (
              <span className="header-preset__error" id="preset-error" role="status">
                Presets unavailable. <button type="button" onClick={() => setCatalogAttempt((attempt) => attempt + 1)}>Retry</button>
              </span>
            ) : null}
          </div>
        </div>

        <div className="header-actions">
          <button className="button button--quiet configuration-action" type="button" onClick={() => configurationInputRef.current?.click()} title="Load input configuration">
            <IconUpload aria-hidden="true" size={17} /><span>Load</span>
          </button>
          <button className="button button--quiet configuration-action" type="button" onClick={handleSaveConfiguration} title="Save input configuration">
            <IconDownload aria-hidden="true" size={17} /><span>Save</span>
          </button>
          <button
            className="button button--primary primary-action"
            type="button"
            onClick={() => void calculate(configRef.current)}
            disabled={!canSubmit}
            aria-label={loading && !canSubmit ? "Calculating" : "Recalculate current setup"}
            title="Recalculate (Ctrl / ⌘ + Enter)"
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
        <button type="button" aria-pressed={mobileView === "workbench"} onClick={() => setMobileView("workbench")}>Optics &amp; results</button>
        <button type="button" aria-pressed={mobileView === "parameters"} onClick={() => setMobileView("parameters")}>Parameters {dirty ? <span className="unsaved-dot" aria-label="Changes not calculated" /> : null}</button>
      </nav>

      {fileMessage ? (
        <div className={`app-status ${fileMessage.kind}`} role={fileMessage.kind === "error" ? "alert" : "status"}>
          {fileMessage.kind === "error" ? <IconAlertTriangle aria-hidden="true" size={17} /> : <IconCheck aria-hidden="true" size={17} />}
          <span>{fileMessage.text}</span>
          {fileMessage.canUndo && replacementUndo ? <button className="text-button" type="button" onClick={handleUndoReplacement}><IconArrowBackUp aria-hidden="true" size={15} />Undo</button> : null}
          <button type="button" className="app-status__dismiss" onClick={() => setFileMessage(null)} aria-label="Dismiss configuration message">
            <IconX aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}

      <main id="workspace" className="app-main">
        <div className="workspace" ref={workspaceRef} data-mobile-view={mobileView}>
          <div className="workspace__main">
          <section id="optics-workbench-panel" className="canvas-panel" aria-labelledby="optics-workspace-heading">
            <div className="canvas-panel__topbar">
              <div>
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
                {loading ? <button className="text-button" type="button" onClick={() => sessionRef.current.cancel()} aria-label="Cancel calculation">Cancel</button> : null}
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
                    <button className="text-button" type="button" onClick={() => void calculate(configRef.current)} disabled={!canSubmit}>Retry calculation</button>
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
                            {FIELD_LABELS[field] ?? field.replaceAll("_", " ")}: {message}
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
              {result ? <OpticsCanvas
                config={displayedConfig}
                result={result}
                onSourceDistanceChange={handleSourceDistanceChange}
                onDetectorDistanceChange={handleDetectorDistanceChange}
              /> : (
                <div className="canvas-empty" role="status">
                  {loading ? <IconLoader2 className="icon-spin" aria-hidden="true" size={28} /> : <IconAtom2 aria-hidden="true" size={32} />}
                  <strong>{loading ? "Calculating your optical setup…" : "Calculate to view the optical path"}</strong>
                  <p>{loading ? "Preparing geometry and crystal response." : "Review the parameters, then recalculate. Your inputs are preserved."}</p>
                </div>
              )}
            </div>

            <div className="canvas-panel__footer">
              <p>
                <IconRulerMeasure aria-hidden="true" size={16} />
                <span>Drag the source or detector to adjust <em>p</em> or <em>q</em>; release to recalculate.</span>
              </p>
              {result ? (
                <dl className="geometry-readout" aria-label="Calculated geometry summary">
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
              <h2 id="results-heading">Calculated results</h2>
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
          <div className="results-strip__angles">
            <ResultMetric
              label="Bragg angle"
              value={formatValue(braggAngleDeg)}
              unit="°"
              note="θB · angle to crystal planes"
              delta={formatMetricDelta(
                braggAngleDeg,
                baseline?.result?.bragg_angle_deg,
                "°",
              )}
              accent="slate"
            />
            <ResultMetric
              label="Detector angle"
              value={formatValue(detectorAngleDeg)}
              unit="°"
              note="2θB · beam deflection"
              delta={formatMetricDelta(
                detectorAngleDeg,
                hasMetric(baseline?.result?.bragg_angle_deg)
                  ? 2 * Number(baseline.result.bragg_angle_deg)
                  : null,
                "°",
              )}
              accent="slate"
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
                <h2 id="inspector-heading">Parameters</h2>
              </div>
              <span className={`inspector__state${dirty ? " is-dirty" : ""}`} role="status">
                {fieldErrorCount ? `${fieldErrorCount} error${fieldErrorCount === 1 ? "" : "s"}` : serverError ? "Retry needed" : loading ? "Calculating" : dirty ? "Edited" : result ? "Up to date" : "Ready to calculate"}
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

                <fieldset className={`hkl-control${fieldErrors.hkl ? " hkl-control--error" : ""}`}
                  aria-invalid={Boolean(fieldErrors.hkl)} aria-describedby={fieldErrors.hkl ? "hkl-group-error" : undefined}>
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
                    <p className="hkl-control__error" id="hkl-group-error" role="alert">
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
                  <p id="edge-picker-hint">Choose an edge to fill the energy above.</p>
                  {edgeCatalogError ? <p id="edge-picker-error" className="edge-picker__error" role="status">Enter energy manually or <button type="button" className="text-button" onClick={() => setCatalogAttempt((attempt) => attempt + 1)}>retry edge list</button>.</p> : null}
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
                <DetectorDistanceControl
                  mode={detectorDistanceMode}
                  onModeChange={setDetectorDistanceMode}
                  qMeters={config.detector_distance_m}
                  braggAngleDeg={braggAngleDeg}
                  angleCurrent={projectionAngleCurrent}
                  onRayChange={(value) => handleFieldChange("detector_distance_m", value)}
                  onProjectedCommit={(qMeters) => handleFieldChange("detector_distance_m", qMeters)}
                  error={fieldErrors.detector_distance_m}
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
                {dirty && result ? <button className="text-button" type="button" onClick={handleRevert}><IconArrowBackUp aria-hidden="true" size={15} />Revert to calculated inputs</button> : null}
                <button className="button button--primary button--full" type="submit" disabled={!canSubmit}>
                  {loading && !canSubmit ? (
                    <IconLoader2 className="icon-spin" aria-hidden="true" size={18} />
                  ) : (
                    <IconRefresh aria-hidden="true" size={18} />
                  )}
                  {loading && !canSubmit ? "Calculating…" : "Recalculate setup"}
                </button>
                <p>{draftSaved ? "Inputs saved in this browser" : "Browser storage unavailable — use Save to keep inputs"}</p>
                <button className="text-button mobile-results-button" type="button" onClick={() => setMobileView("workbench")}>View optics &amp; results</button>
              </div>
            </form>
          </aside>
        </div>
      </main>

      <footer className="app-footer">
        <p>DXASCalc · Geometry, reflectivity, and resolution workspace</p>
        <p>Distances in m · thickness in µm · angles in degrees or mrad · energy in eV</p>
      </footer>

      <VersionBadge />

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
