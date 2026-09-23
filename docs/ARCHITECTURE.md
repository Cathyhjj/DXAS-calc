# DXASCalc architecture

The refactor separates scientific behavior from HTTP and user-interface code.

```text
Web client
  -> JSON API and unit parsing
  -> immutable DXASConfig
  -> validation + pure calculate(config)
  -> optional isolated crystal-response enrichment
  -> CalculationResult + structured warnings
  -> charts, explanations, and export
```

## Boundaries

- `dxascalc/models.py` owns typed inputs, outputs, enums, issues, and JSON-safe
  conversion.
- `dxascalc/calculator.py` owns deterministic Bragg/Laue geometry calculations.
  It has no plotting, widgets, global state, network calls, or file I/O.
- `dxascalc/reflectivity.py` owns numerical curve analysis, source/detector
  response convolution, and the isolated XOP subprocess adapter. External
  execution is never imported into the geometry calculator.
- `dxascalc/web_api.py` translates HTTP JSON to the domain contract. It must not
  reproduce formulas; it composes the pure geometry result with the injectable
  resolution enricher.
- `tests/` freezes legacy-compatible values, crystallographic selection rules,
  HTTP behavior, and invalid-input handling.
- `DXAS_calculator.py` remains a migration reference for Notebook users. New web
  code must not import its widget or external-program side effects.

The React frontend consumes only the JSON API. The production Flask entry point
may serve its compiled assets, but frontend code never imports or reimplements
the scientific formulas. The XOP adapter runs each request in its own temporary
directory, bounds the complete enrichment path, and uses a 32-entry cache for
successful XOP crystal configurations; a flat-crystal fallback after a temporary
solver failure is retried on a later request. Dragging source/detector distances
therefore reuses a successful unchanged reflectivity calculation. FFT response convolution keeps
valid broad kernels from blocking a web worker. This keeps visual iteration
independent of scientific calculations
and allows the same pure geometry core to be used from Python scripts or
notebooks without requiring the external solver.

## Frontend calculation ownership

`frontend/src/lib/calculationSession.js` owns the editable draft, a monotonic
revision, the pending request with its submitted input snapshot, and the latest
accepted result with its canonical scientific inputs. Request IDs prevent older
responses from replacing newer results; the revision prevents errors from an
old request attaching to a changed draft. A result is current only when every
canonical scientific input matches the accepted snapshot. Returning an input
to the accepted value restores currency without recalculating.

The React app owns view state (plot scale and guides, pane sizes, open sections)
and one optional comparison baseline copied from a current accepted result.
Numeric edits and edge choices remain drafts until Recalculate. Geometry,
preset, file load, and diagram p/q commits submit through the same session.
The last accepted geometry, metrics, reflectivity curve, warnings, and model
provenance remain together while a changed draft is visibly stale. Display-only
actions do not submit to `/api/calculate`.
