# DXASCalc architecture

The refactor separates scientific behavior from HTTP and user-interface code.

```text
Web client
  -> JSON API and unit parsing
  -> immutable DXASConfig
  -> validation + pure calculate(config)
  -> CalculationResult + structured warnings
  -> charts, explanations, and export
```

## Boundaries

- `dxascalc/models.py` owns typed inputs, outputs, enums, issues, and JSON-safe
  conversion.
- `dxascalc/calculator.py` owns deterministic Bragg/Laue geometry calculations.
  It has no plotting, widgets, global state, network calls, or file I/O.
- `dxascalc/web_api.py` translates HTTP JSON to the domain contract. It must not
  reproduce formulas.
- `tests/` freezes legacy-compatible values, crystallographic selection rules,
  HTTP behavior, and invalid-input handling.
- `DXAS_calculator.py` remains a migration reference for Notebook users. New web
  code must not import its widget or external-program side effects.

The React frontend consumes only the JSON API. The production Flask entry point
may serve its compiled assets, but frontend code never imports or reimplements
the scientific formulas. This keeps visual iteration independent of scientific
calculations and allows the same core to be used from Python scripts or notebooks.
