from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Optional
import unittest

from dxascalc.web_api import create_app


class WebApiTests(unittest.TestCase):
    def setUp(self):
        # Keep transport-contract tests independent of the optional, external
        # XOP executable.  A dedicated test below injects deterministic
        # intrinsic-resolution data at this same boundary.
        self.app = create_app(resolution_enricher=lambda _config, result: result)
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()

    def test_calculate_serializes_injected_intrinsic_resolution(self):
        captured = []

        def deterministic_enricher(config, result):
            captured.append((config, result))
            curve = {
                "x_axis": "energy_offset_ev",
                "x": [-2.0, 0.0, 2.0],
                "sigma": [0.0, 0.8, 0.0],
                "pi": [0.0, 0.6, 0.0],
                "selected": [0.0, 0.6, 0.0],
            }
            return replace(
                result,
                source_size_resolution_ev_fwhm=0.2,
                crystal_intrinsic_resolution_ev_fwhm=1.1,
                crystal_intrinsic_width_urad_fwhm=34.0,
                total_resolution_ev_fwhm=1.35,
                total_resolution_method="numerical_convolution",
                reflectivity_curve=curve,
                reflectivity_peak=0.6,
                reflectivity_integrated=1.2,
                reflectivity_model="test-fixture",
            )

        app = create_app(resolution_enricher=deterministic_enricher)
        app.config.update(TESTING=True)
        response = app.test_client().post(
            "/api/calculate",
            json={
                "geometry": "laue",
                "material": "Si",
                "h": 3,
                "k": 1,
                "l": 1,
                "source_size_um": 2.0,
                "crystal_thickness_um": 50.0,
                "polarization": "pi",
            },
        )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        result = response.get_json()["result"]
        self.assertEqual(len(captured), 1)
        config, base_result = captured[0]
        self.assertEqual(config.geometry.value, "laue")
        self.assertEqual((config.h, config.k, config.l), (3, 1, 1))
        self.assertEqual(config.source_size_um, 2.0)
        self.assertEqual(config.crystal_thickness_um, 50.0)
        self.assertEqual(config.polarization.value, "pi")
        self.assertIsNone(base_result.crystal_intrinsic_resolution_ev_fwhm)

        self.assertEqual(result["source_size_resolution_ev_fwhm"], 0.2)
        self.assertEqual(result["crystal_intrinsic_resolution_ev_fwhm"], 1.1)
        self.assertEqual(result["crystal_intrinsic_width_urad_fwhm"], 34.0)
        self.assertEqual(result["total_resolution_ev_fwhm"], 1.35)
        self.assertEqual(result["total_resolution_method"], "numerical_convolution")
        self.assertEqual(result["reflectivity_peak"], 0.6)
        self.assertEqual(result["reflectivity_integrated"], 1.2)
        self.assertEqual(result["reflectivity_model"], "test-fixture")
        self.assertEqual(
            result["reflectivity_curve"],
            {
                "x_axis": "energy_offset_ev",
                "x": [-2.0, 0.0, 2.0],
                "sigma": [0.0, 0.8, 0.0],
                "pi": [0.0, 0.6, 0.0],
                "selected": [0.0, 0.6, 0.0],
            },
        )

    def assert_invalid_configuration(
        self,
        response,
        *,
        code: Optional[str] = None,
        field: Optional[str] = None,
    ):
        self.assertEqual(response.status_code, 422, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["error"], "invalid_configuration")
        self.assertTrue(body["issues"])
        self.assertTrue(
            all(
                {"level", "code", "message", "field"} <= issue.keys()
                for issue in body["issues"]
            )
        )
        if code is not None:
            matching = [issue for issue in body["issues"] if issue["code"] == code]
            self.assertTrue(
                matching,
                f"missing issue code {code!r}; got {body['issues']!r}",
            )
            if field is not None:
                self.assertEqual(matching[0]["field"], field)
        return body

    def test_health_endpoint(self):
        response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "ok"})

    def test_presets_include_legacy_safe_bragg_and_laue(self):
        response = self.client.get("/api/presets")

        self.assertEqual(response.status_code, 200)
        presets = response.get_json()["presets"]
        by_id = {preset["id"]: preset for preset in presets}

        legacy = by_id["bragg-si111-legacy-safe"]["config"]
        self.assertEqual(
            legacy,
            {
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
                "source_size_um": 1.5,
                "crystal_thickness_um": 200.0,
                "polarization": "unpolarized",
            },
        )
        self.assertTrue(
            any(preset["config"]["geometry"] == "laue" for preset in presets)
        )
        laue = by_id["laue-si111-example"]["config"]
        self.assertEqual(laue["crystal_thickness_um"], 50.0)
        self.assertEqual(laue["source_size_um"], 1.5)
        self.assertEqual(laue["polarization"], "unpolarized")

    def test_presets_include_allowed_si220_and_si311_in_both_geometries(self):
        response = self.client.get("/api/presets")

        self.assertEqual(response.status_code, 200)
        presets = response.get_json()["presets"]
        by_id = {preset["id"]: preset for preset in presets}

        expected = {
            "bragg-si220-example": (
                "bragg",
                (2, 2, 0),
                -2.0,
                "upper",
                200.0,
            ),
            "bragg-si311-example": (
                "bragg",
                (3, 1, 1),
                -2.0,
                "upper",
                200.0,
            ),
            "laue-si220-example": ("laue", (2, 2, 0), 2.0, "lower", 50.0),
            "laue-si311-example": ("laue", (3, 1, 1), 2.0, "lower", 50.0),
        }
        self.assertEqual(len(presets), len(by_id), "preset ids must be unique")
        self.assertTrue(expected.keys() <= by_id.keys())

        for preset_id, (
            geometry,
            hkl,
            radius,
            condition,
            thickness,
        ) in expected.items():
            with self.subTest(preset_id=preset_id):
                config = by_id[preset_id]["config"]
                self.assertEqual(config["geometry"], geometry)
                self.assertEqual(
                    (config["h"], config["k"], config["l"]),
                    hkl,
                )
                self.assertEqual(config["energy_kev"], 8.0)
                self.assertEqual(config["bending_radius_m"], radius)
                self.assertEqual(config["condition"], condition)
                self.assertEqual(config["source_size_um"], 1.5)
                self.assertEqual(config["crystal_thickness_um"], thickness)
                self.assertEqual(config["polarization"], "unpolarized")

                calculation = self.client.post("/api/calculate", json=config)
                self.assertEqual(
                    calculation.status_code,
                    200,
                    calculation.get_data(as_text=True),
                )
                result = calculation.get_json()["result"]
                self.assertGreater(result["bragg_angle_deg"], 0.0)
                self.assertLess(result["bragg_angle_deg"], 90.0)

    def test_empty_json_uses_default_calculation(self):
        response = self.client.post("/api/calculate", json={})

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(set(body), {"result"})
        self.assertGreater(body["result"]["d_spacing_angstrom"], 0)
        self.assertGreater(body["result"]["bragg_angle_deg"], 0)
        self.assertIsInstance(body["result"]["warnings"], list)
        self.assertIsInstance(body["result"]["assumptions"], list)

    def test_invalid_configuration_returns_structured_issues(self):
        response = self.client.post("/api/calculate", json={"energy_kev": -1})

        self.assert_invalid_configuration(
            response,
            code="invalid_energy",
            field="energy_kev",
        )

    def test_forbidden_reflection_returns_structured_issue(self):
        response = self.client.post(
            "/api/calculate",
            json={"material": "Si", "h": 2, "k": 2, "l": 2},
        )

        self.assert_invalid_configuration(
            response,
            code="forbidden_reflection",
            field="hkl",
        )

    def test_divergence_outside_nonperiodic_domain_is_rejected(self):
        response = self.client.post(
            "/api/calculate",
            json={"divergence_mrad": 7000},
        )

        self.assert_invalid_configuration(
            response,
            code="invalid_divergence",
            field="divergence_mrad",
        )

    def test_intrinsic_resolution_inputs_are_validated_at_the_api_boundary(self):
        cases = (
            (
                {"source_size_um": -0.01},
                "invalid_source_size",
                "source_size_um",
            ),
            (
                {"source_size_um": float("inf")},
                "invalid_source_size",
                "source_size_um",
            ),
            (
                {"crystal_thickness_um": 0.0},
                "invalid_crystal_thickness",
                "crystal_thickness_um",
            ),
            (
                {"crystal_thickness_um": float("nan")},
                "invalid_crystal_thickness",
                "crystal_thickness_um",
            ),
            (
                {"polarization": "circular"},
                "invalid_polarization",
                "polarization",
            ),
        )

        for payload, code, field in cases:
            with self.subTest(payload=payload):
                response = self.client.post("/api/calculate", json=payload)
                self.assert_invalid_configuration(
                    response,
                    code=code,
                    field=field,
                )

        point_source = self.client.post(
            "/api/calculate",
            json={"source_size_um": 0.0},
        )
        self.assertEqual(
            point_source.status_code,
            200,
            point_source.get_data(as_text=True),
        )

    def test_malformed_json_is_a_400_not_a_server_error(self):
        response = self.client.post(
            "/api/calculate",
            data='{"energy_kev":',
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        body = response.get_json()
        self.assertEqual(body["error"], "invalid_json")
        self.assertIsInstance(body["message"], str)

    def test_non_object_json_payloads_are_structured_422_errors(self):
        for payload in ([], "not an object", 17):
            with self.subTest(payload=payload):
                response = self.client.post("/api/calculate", json=payload)
                self.assert_invalid_configuration(
                    response,
                    code="invalid_payload_type",
                    field=None,
                )

    def test_unknown_config_key_is_a_structured_422_error(self):
        response = self.client.post(
            "/api/calculate",
            json={"unexpected_key": 123},
        )

        self.assert_invalid_configuration(
            response,
            code="unknown_field",
            field="unexpected_key",
        )
        self.assertIn("unexpected_key", response.get_json()["issues"][0]["message"])

    def test_numeric_strings_are_coerced_and_calculated(self):
        response = self.client.post(
            "/api/calculate",
            json={
                "geometry": "LAUE",
                "material": "ge",
                "h": "2",
                "k": "2",
                "l": "0",
                "energy_kev": "12.5",
                "source_distance_m": "8.75",
                "divergence_mrad": "1.35",
                "bending_radius_m": "-3.4",
                "asymmetry_angle_deg": "7.25",
                "condition": "LOWER",
                "detector_distance_m": "0.45",
                "pixel_size_um": "75",
                "source_size_um": "2.5",
                "crystal_thickness_um": "50",
                "polarization": "PI",
            },
        )

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        result = response.get_json()["result"]
        self.assertAlmostEqual(result["d_spacing_angstrom"], 1.9975766568519968)
        self.assertAlmostEqual(result["bragg_angle_deg"], 14.375144198160534)
        self.assertAlmostEqual(result["crystal_rotation_deg"], 97.12514419816054)

    def test_extreme_json_numbers_are_structured_422_errors(self):
        huge_400 = 10**400
        huge_200 = 10**200
        cases = (
            ({"energy_kev": float("nan")}, "invalid_energy", "energy_kev"),
            ({"energy_kev": float("inf")}, "invalid_energy", "energy_kev"),
            ({"energy_kev": float("-inf")}, "invalid_energy", "energy_kev"),
            ({"energy_kev": huge_400}, "invalid_energy", "energy_kev"),
            (
                {"source_distance_m": huge_400},
                "invalid_source_distance",
                "source_distance_m",
            ),
            ({"h": huge_400}, "invalid_hkl", "h"),
            ({"h": huge_200}, "invalid_hkl", "h"),
            ({"h": 1e200}, "invalid_hkl", "h"),
            ({"pixel_size_um": 5e-324}, "invalid_pixel_size", "pixel_size_um"),
        )

        for payload, code, field in cases:
            with self.subTest(code=code, field=field, value=payload[field]):
                response = self.client.post("/api/calculate", json=payload)
                self.assert_invalid_configuration(
                    response,
                    code=code,
                    field=field,
                )

        # Python's JSON decoder accepts an overflowing exponent as infinity;
        # it must still be validated by the calculation boundary, not become a
        # raw OverflowError or a 500 response.
        response = self.client.post(
            "/api/calculate",
            data='{"energy_kev": 1e400}',
            content_type="application/json",
        )
        self.assert_invalid_configuration(
            response,
            code="invalid_energy",
            field="energy_kev",
        )

    def test_non_json_request_is_rejected(self):
        response = self.client.post(
            "/api/calculate",
            data="energy_kev=8",
            content_type="text/plain",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "invalid_json")

    def test_app_does_not_serve_static_files_by_default(self):
        self.assertIsNone(self.app.static_folder)
        self.assertNotIn(
            "static", {rule.endpoint for rule in self.app.url_map.iter_rules()}
        )

    def test_optional_frontend_serves_assets_and_spa_routes(self):
        with TemporaryDirectory() as temporary_directory:
            build_directory = Path(temporary_directory)
            (build_directory / "assets").mkdir()
            (build_directory / "index.html").write_text(
                "<!doctype html><title>DXAS React app</title>",
                encoding="utf-8",
            )
            (build_directory / "assets" / "app.js").write_text(
                "window.DXAS_APP = true;",
                encoding="utf-8",
            )

            app = create_app(str(build_directory))
            app.config.update(TESTING=True)
            client = app.test_client()

            index_response = client.get("/")
            self.assertEqual(index_response.status_code, 200)
            self.assertIn(b"DXAS React app", index_response.data)
            index_response.close()

            asset_response = client.get("/assets/app.js")
            self.assertEqual(asset_response.status_code, 200)
            self.assertEqual(asset_response.data, b"window.DXAS_APP = true;")
            asset_response.close()

            for missing_asset in (
                "/assets/not-built.js",
                "/assets/not-built",
                "/brand/not-built.png",
                "/favicon.ico",
            ):
                with self.subTest(missing_asset=missing_asset):
                    missing_response = client.get(missing_asset)
                    self.assertEqual(missing_response.status_code, 404)
                    self.assertNotIn(b"DXAS React app", missing_response.data)
                    missing_response.close()

            spa_response = client.get("/calculator/setup")
            self.assertEqual(spa_response.status_code, 200)
            self.assertIn(b"DXAS React app", spa_response.data)
            spa_response.close()

    def test_spa_fallback_never_swallows_api_routes(self):
        with TemporaryDirectory() as temporary_directory:
            build_directory = Path(temporary_directory)
            (build_directory / "index.html").write_text(
                "<!doctype html><title>should not be an API response</title>",
                encoding="utf-8",
            )

            app = create_app(str(build_directory))
            app.config.update(TESTING=True)
            client = app.test_client()

            self.assertEqual(client.get("/api/health").status_code, 200)
            unknown_api_response = client.get("/api/not-a-real-endpoint")
            self.assertEqual(unknown_api_response.status_code, 404)
            self.assertNotIn(b"should not be an API response", unknown_api_response.data)


if __name__ == "__main__":
    unittest.main()
