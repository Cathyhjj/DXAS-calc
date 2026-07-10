# DXASCalc

DXASCalc is a validated, browser-based calculator for dispersive X-ray
absorption spectroscopy optics. It supports Bragg and Laue geometries, keeps
the bending-radius and focus sign conventions explicit, and explains geometry
states instead of displaying negative widths as if they were physical sizes.

## What the refactor changes

- A dependency-free calculation core in `dxascalc/` replaces UI-coupled,
  order-dependent calculations for the web application.
- Inputs and outputs use immutable, JSON-safe models with units in every field
  name.
- Invalid Miller indices, unreachable energies, zero radii, geometry
  singularities, and extreme JSON numbers return structured field errors.
- Signed orientation values are retained separately from non-negative display
  magnitudes.
- A Flask API and React interface are independently testable and run together
  as one deployable web service.
- The original Notebook calculator remains available as migration and research
  context; new web code does not import its widgets or file-writing workflow.

The scientific contract and unresolved Laue sign convention are documented in
[`docs/SCIENTIFIC_MODEL.md`](docs/SCIENTIFIC_MODEL.md).

## Run locally

Requirements: Python 3.9+ and Node.js 20.19.x or 22.12+ (the frontend build
toolchain does not support older Node releases).

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm ci --prefix frontend
npm run build --prefix frontend
python app.py
```

Open `http://localhost:5002`.

For frontend development, keep `python app.py` running and start Vite in a
second terminal:

```bash
npm run dev --prefix frontend
```

The development interface is available at `http://localhost:5173` and proxies
API calls to the local Flask process.

## Test and build

```bash
python -m unittest discover -s tests -v
npm run build --prefix frontend
```

Developers who install the optional test dependencies with
`pip install -e '.[dev]'` can run the same Python suite through `python -m pytest`.
Pytest discovery is restricted to `tests/`, so the archived sample project and
its optional scientific dependencies are not collected.

The characterization suite freezes representative Bragg and Laue results from
the previous `dxas_core.py` implementation, including upper/lower conditions,
positive/negative radii, asymmetric Ge(220), diamond-cubic reflection rules,
and error-boundary behavior.

## API

- `GET /api/health` — service health
- `GET /api/presets` — reviewed Bragg and Laue starting configurations
- `POST /api/calculate` — calculate one configuration

Validation failures return HTTP 422 with field-addressable issues:

```json
{
  "error": "invalid_configuration",
  "issues": [
    {
      "level": "error",
      "code": "energy_unreachable",
      "message": "Energy is below the Bragg limit for this material and reflection.",
      "field": "energy_kev"
    }
  ]
}
```

## Scientific scope

The current total-resolution model intentionally does not invent source-size or
intrinsic-crystal contributions. The interface reports detector sampling and
marks the missing terms as not modeled. The legacy XOPPY intrinsic-width
pipeline must be isolated and scientifically reviewed before it is enabled in a
multi-user service.

Authors: Juanjuan Huang and George Sterbinsky
Copyright © 2024, UChicago Argonne, LLC
