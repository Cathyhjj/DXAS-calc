from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Optional
import unittest

from dxascalc.web_api import create_app


class WebApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()

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
            },
        )
        self.assertTrue(
            any(preset["config"]["geometry"] == "laue" for preset in presets)
        )

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
