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
- The geometry-first Plotly workbench mirrors the beamline right-to-left,
  supports schematic and physical scales, and lets users drag the source or
  detector to update `p` or `q` before recalculating through the validated API.
- Crystal-response calculations expose the sigma, pi, and selected
  polarization curves, their interpolated FWHM, and the finite-source
  contribution. Bragg uses XOP's bent-crystal multilamellar model and Laue
  uses its Penning-Polder model.
- Estimated total energy resolution is the FWHM of a numerical convolution of
  the crystal response, a Gaussian source-size response, and a one-pixel
  detector response. Detector sampling remains separately labeled in eV/px.
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
npm test --prefix frontend
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
- `GET /api/presets` — reviewed Bragg and Laue starting configurations for Si(111), Si(220), and Si(311)
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

The web calculation keeps the deterministic geometry core separate from the
XOP-backed crystal-response adapter. Each XOP request runs in an isolated
temporary directory with a timeout, and reusable crystal curves are cached by
their scientific inputs in a bounded 32-entry cache. Scalar metrics retain the
full 10001-point solver resolution while Plotly receives at most 2501 evenly
sampled display points. The complete enrichment path has bounded concurrency,
and response convolution uses NumPy FFTs. Source size is interpreted as a spatial FWHM in the
dispersive plane; detector sampling is modeled as a one-pixel top-hat response,
not as a Gaussian detector FWHM.

The reported total is therefore a model estimate rather than a measured
instrument line-spread function. In particular, the Laue estimate does not add
a separate Borrmann-fan spatial contribution, and neither geometry includes
fabrication strain or a measured detector PSF unless those effects are already
represented by the selected XOP response. See
[`docs/SCIENTIFIC_MODEL.md`](docs/SCIENTIFIC_MODEL.md) for the complete
assumptions and provenance.

Authors: Juanjuan Huang and George Sterbinsky
Copyright © 2024, UChicago Argonne, LLC
