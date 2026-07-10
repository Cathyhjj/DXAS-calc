"""HTTP and optional static-serving boundary for the DXAS calculator.

The module deliberately contains no calculation logic. It validates transport
concerns, delegates to the public ``dxascalc`` API, serializes browser responses,
and can serve an explicitly supplied production frontend build.
"""

from __future__ import annotations

from dataclasses import fields
from pathlib import Path
from typing import Any

from flask import Flask, abort, jsonify, request, send_from_directory
from werkzeug.exceptions import BadRequest

from dxascalc import DXASConfig, InvalidConfigurationError, calculate


def _preset_payloads() -> list[dict[str, Any]]:
    """Return a fresh preset collection for each request.

    Keeping the data inside a factory avoids module-level mutable state and makes
    it safe for callers to modify a decoded response without affecting later
    requests.
    """

    return [
        {
            "id": "bragg-si111-legacy-safe",
            "name": "Bragg · Si(111)",
            "description": "Legacy-safe starting geometry for a silicon Bragg crystal.",
            "config": {
                "geometry": "bragg",
                "material": "Si",
                "h": 1,
                "k": 1,
                "l": 1,
                "energy_kev": 8.0,
                "source_distance_m": 1.2,
                "divergence_mrad": 1.2,
                "bending_radius_m": -2.0,
                "asymmetry_angle_deg": 0.0,
                "condition": "upper",
                "detector_distance_m": 1.5,
                "pixel_size_um": 55.0,
            },
        },
        {
            "id": "bragg-si220-example",
            "name": "Bragg · Si(220)",
            "description": "Allowed Si(220) reflection in Bragg geometry at 8 keV.",
            "config": {
                "geometry": "bragg",
                "material": "Si",
                "h": 2,
                "k": 2,
                "l": 0,
                "energy_kev": 8.0,
                "source_distance_m": 1.2,
                "divergence_mrad": 1.2,
                "bending_radius_m": -2.0,
                "asymmetry_angle_deg": 0.0,
                "condition": "upper",
                "detector_distance_m": 1.5,
                "pixel_size_um": 55.0,
            },
        },
        {
            "id": "bragg-si311-example",
            "name": "Bragg · Si(311)",
            "description": "Allowed Si(311) reflection in Bragg geometry at 8 keV.",
            "config": {
                "geometry": "bragg",
                "material": "Si",
                "h": 3,
                "k": 1,
                "l": 1,
                "energy_kev": 8.0,
                "source_distance_m": 1.2,
                "divergence_mrad": 1.2,
                "bending_radius_m": -2.0,
                "asymmetry_angle_deg": 0.0,
                "condition": "upper",
                "detector_distance_m": 1.5,
                "pixel_size_um": 55.0,
            },
        },
        {
            "id": "laue-si111-example",
            "name": "Laue · Si(111)",
            "description": "Transmission-geometry example using a symmetric silicon crystal.",
            "config": {
                "geometry": "laue",
                "material": "Si",
                "h": 1,
                "k": 1,
                "l": 1,
                "energy_kev": 8.0,
                "source_distance_m": 1.2,
                "divergence_mrad": 1.2,
                "bending_radius_m": 2.0,
                "asymmetry_angle_deg": 0.0,
                "condition": "lower",
                "detector_distance_m": 1.5,
                "pixel_size_um": 55.0,
            },
        },
        {
            "id": "laue-si220-example",
            "name": "Laue · Si(220)",
            "description": "Allowed Si(220) reflection in Laue geometry at 8 keV.",
            "config": {
                "geometry": "laue",
                "material": "Si",
                "h": 2,
                "k": 2,
                "l": 0,
                "energy_kev": 8.0,
                "source_distance_m": 1.2,
                "divergence_mrad": 1.2,
                "bending_radius_m": 2.0,
                "asymmetry_angle_deg": 0.0,
                "condition": "lower",
                "detector_distance_m": 1.5,
                "pixel_size_um": 55.0,
            },
        },
        {
            "id": "laue-si311-example",
            "name": "Laue · Si(311)",
            "description": "Allowed Si(311) reflection in Laue geometry at 8 keV.",
            "config": {
                "geometry": "laue",
                "material": "Si",
                "h": 3,
                "k": 1,
                "l": 1,
                "energy_kev": 8.0,
                "source_distance_m": 1.2,
                "divergence_mrad": 1.2,
                "bending_radius_m": 2.0,
                "asymmetry_angle_deg": 0.0,
                "condition": "lower",
                "detector_distance_m": 1.5,
                "pixel_size_um": 55.0,
            },
        },
    ]


def _invalid_json_response(message: str):
    return (
        jsonify(
            {
                "error": "invalid_json",
                "message": message,
            }
        ),
        400,
    )


def create_app(static_folder: str | None = None) -> Flask:
    """Create the API, optionally with a built single-page application.

    ``static_folder`` is disabled by default so importing the calculation API
    never exposes files implicitly.  When a Vite build directory is supplied,
    explicit routes serve real build artifacts and fall back to ``index.html``
    for client-side routes.  API paths are always excluded from that fallback.
    """

    # Always disable Flask's implicit ``/<path:filename>`` static rule.  The
    # explicit routes below can then distinguish SPA navigation from /api URLs.
    app = Flask(__name__, static_folder=None)
    frontend_root = (
        Path(static_folder).resolve() if static_folder is not None else None
    )
    if frontend_root is not None:
        # Retain the conventional Flask attribute for introspection without
        # registering Flask's broad implicit static route.
        app.static_folder = str(frontend_root)

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.get("/api/presets")
    def presets():
        return jsonify({"presets": _preset_payloads()})

    @app.post("/api/calculate")
    def calculate_endpoint():
        if not request.is_json:
            return _invalid_json_response(
                "Request body must be JSON with Content-Type application/json."
            )

        try:
            payload = request.get_json()
        except BadRequest:
            return _invalid_json_response("Request body contains malformed JSON.")

        if not isinstance(payload, dict):
            return (
                jsonify(
                    {
                        "error": "invalid_configuration",
                        "issues": [
                            {
                                "level": "error",
                                "code": "invalid_payload_type",
                                "message": "Configuration must be a JSON object.",
                                "field": None,
                            }
                        ],
                    }
                ),
                422,
            )

        try:
            config = DXASConfig.from_mapping(payload)
        except TypeError as exc:
            known_fields = {item.name for item in fields(DXASConfig)}
            unknown_fields = sorted(set(payload) - known_fields)
            if unknown_fields:
                issues = [
                    {
                        "level": "error",
                        "code": "unknown_field",
                        "message": "Unknown configuration field: %s." % field_name,
                        "field": field_name,
                    }
                    for field_name in unknown_fields
                ]
            else:
                issues = [
                    {
                        "level": "error",
                        "code": "invalid_configuration_shape",
                        "message": str(exc),
                        "field": None,
                    }
                ]
            return (
                jsonify(
                    {
                        "error": "invalid_configuration",
                        "issues": issues,
                    }
                ),
                422,
            )

        try:
            result = calculate(config)
        except InvalidConfigurationError as exc:
            return (
                jsonify(
                    {
                        "error": "invalid_configuration",
                        "issues": [issue.to_dict() for issue in exc.issues],
                    }
                ),
                422,
            )

        return jsonify({"result": result.to_dict()})

    if frontend_root is not None:

        def send_index():
            return send_from_directory(str(frontend_root), "index.html")

        @app.get("/")
        def frontend_index():
            return send_index()

        @app.get("/<path:frontend_path>")
        def frontend_asset_or_route(frontend_path: str):
            if frontend_path == "api" or frontend_path.startswith("api/"):
                abort(404)

            candidate = (frontend_root / frontend_path).resolve()
            try:
                candidate.relative_to(frontend_root)
            except ValueError:
                abort(404)

            if candidate.is_file():
                return send_from_directory(str(frontend_root), frontend_path)

            # Missing build artifacts must stay 404s. Returning index.html with
            # a 200 for a stale JavaScript or image URL hides deployment errors
            # and makes the browser try to parse HTML as the requested asset.
            asset_roots = ("assets", "brand")
            looks_like_asset = (
                frontend_path in asset_roots
                or frontend_path.startswith(tuple(root + "/" for root in asset_roots))
                or bool(Path(frontend_path).suffix)
            )
            if looks_like_asset:
                abort(404)

            return send_index()

    return app


__all__ = ("create_app",)
