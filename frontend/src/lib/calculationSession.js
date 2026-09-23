import { DEFAULT_CONFIG, NUMERIC_FIELDS } from "./configurationFile.js";

const ENUM_VALUES = {
  geometry: ["bragg", "laue"],
  material: ["Si", "Ge"],
  polarization: ["unpolarized", "sigma", "pi"],
  condition: ["upper", "lower"],
};

// Inputs keep their editable strings. This representation is used only to decide
// whether an accepted result describes the current scientific parameters.
export function canonicalConfig(config) {
  if (!config || typeof config !== "object") return null;
  const canonical = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const value = config[key];
    if (NUMERIC_FIELDS.includes(key)) {
      if (value === null || value === undefined || String(value).trim() === "") return null;
      const number = Number(value);
      if (!Number.isFinite(number)) return null;
      if (["h", "k", "l"].includes(key) && !Number.isInteger(number)) return null;
      canonical[key] = number;
    } else {
      if (!ENUM_VALUES[key]?.includes(value)) return null;
      canonical[key] = value;
    }
  }
  return canonical;
}

export function sameScientificConfig(left, right) {
  const a = canonicalConfig(left);
  const b = canonicalConfig(right);
  return Boolean(a && b && Object.keys(DEFAULT_CONFIG).every((key) => a[key] === b[key]));
}

function splitIssues(issues) {
  const fieldErrors = {};
  const generalIssues = [];
  for (const issue of issues) {
    if (issue?.field && issue?.message) {
      fieldErrors[issue.field] = fieldErrors[issue.field]
        ? `${fieldErrors[issue.field]} ${issue.message}`
        : issue.message;
    } else if (issue?.message) {
      generalIssues.push(issue.message);
    }
  }
  if (!generalIssues.length && !Object.keys(fieldErrors).length) {
    generalIssues.push("Review the setup values.");
  }
  return { fieldErrors, generalIssues };
}

export function createCalculationSession(initialDraft, request, notify = () => {}) {
  let sequence = 0;
  let controller = null;
  let state = {
    draft: { ...initialDraft },
    revision: 0,
    pending: null,
    accepted: null,
    error: null,
  };

  function read() {
    const isCurrent = Boolean(
      state.accepted && sameScientificConfig(state.draft, state.accepted.canonicalConfig),
    );
    return { ...state, isCurrent };
  }

  function update(next) {
    state = next;
    notify(read());
  }

  function edit(nextDraft) {
    update({
      ...state,
      draft: { ...nextDraft },
      revision: state.revision + 1,
      error: null,
    });
    return read();
  }

  async function submit(candidate = state.draft) {
    const requestConfig = { ...candidate };
    const submittedRevision = state.revision;
    const id = ++sequence;
    controller?.abort();
    controller = new AbortController();
    const activeController = controller;
    update({
      ...state,
      pending: {
        id,
        submittedRevision,
        config: requestConfig,
        canonicalConfig: canonicalConfig(requestConfig),
      },
      error: null,
    });

    try {
      const response = await request(requestConfig, activeController.signal);
      if (id !== sequence) return { kind: "superseded", id };
      const owned = state.revision === submittedRevision;
      if (response.status === 422) {
        const issues = Array.isArray(response.payload?.issues) ? response.payload.issues : [];
        update({
          ...state,
          pending: null,
          error: owned ? { kind: "invalid", ...splitIssues(issues), id } : null,
        });
        return { kind: "invalid", id, owned, issues };
      }
      if (!response.ok || !response.payload?.result) {
        const issueMessages = Array.isArray(response.payload?.issues)
          ? response.payload.issues.map((issue) => issue?.message).filter(Boolean)
          : [];
        throw new Error(
          response.payload?.message
          || issueMessages.join(" ")
          || "The calculation service returned an unexpected response.",
        );
      }
      const accepted = {
        requestId: id,
        canonicalConfig: canonicalConfig(requestConfig),
        result: response.payload.result,
      };
      update({ ...state, pending: null, accepted, error: null });
      return { kind: "accepted", id, isCurrent: read().isCurrent };
    } catch (failure) {
      if (id !== sequence || failure?.name === "AbortError") {
        if (id === sequence) update({ ...state, pending: null });
        return { kind: "superseded", id };
      }
      const owned = state.revision === submittedRevision;
      update({
        ...state,
        pending: null,
        error: owned ? {
          kind: "failed",
          message: failure?.message || "Unable to reach the calculation service.",
          id,
        } : null,
      });
      return { kind: "failed", id, owned };
    } finally {
      if (controller === activeController) controller = null;
    }
  }

  function cancel() {
    sequence += 1;
    controller?.abort();
    controller = null;
    update({ ...state, pending: null });
  }

  return { read, edit, submit, cancel };
}
