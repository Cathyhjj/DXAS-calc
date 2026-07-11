"""Production and local entry point for the DXASCalc web application."""

from __future__ import annotations

import os
from pathlib import Path

from dxascalc.web_api import create_app


PROJECT_ROOT = Path(__file__).resolve().parent
app = create_app(str(PROJECT_ROOT / "frontend" / "dist"))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5002")))
