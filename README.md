# DXASCalc Web

DXASCalc Web calculates spectrometer properties for Dispersive X-ray Absorption Spectroscopy (DXAS), with a modern UI style inspired by EasyXASCalc.

## What changed

- Added a browser-based app using **Streamlit**.
- Added a clean card-based light theme (muted purple/blue accents, gradient header, scientific dashboard layout).
- Preserved core Bragg and Laue optics formulas in a standalone module for app use.
- Added Render deployment config.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run web_app.py
```

Then open `http://localhost:8501`.

## Deploy to Render

1. Push this repository to GitHub.
2. In Render, create a **Blueprint** and point it to this repo.
3. Render will detect `render.yaml` and provision the web service.
4. After deploy completes, open the generated `.onrender.com` URL.

### Manual Render settings (if not using Blueprint)

- **Environment**: Python
- **Build command**: `pip install -r requirements.txt`
- **Start command**:
  `streamlit run web_app.py --server.port $PORT --server.address 0.0.0.0`

## Scientific model notes

The web app currently includes the core geometry and energy spread calculations (Bragg/Laue) from this repository's original Python workflow. The notebook-only interactive widgets and external diffraction-pattern pipeline are intentionally not required by the deployed web runtime.

## Original project context

Author: Juanjuan Huang & George Sterbinsky  
Copyright © 2024, UChicago Argonne, LLC
