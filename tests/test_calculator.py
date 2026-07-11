"""Contract and numerical-regression tests for the public DXAS calculator API.

The golden values below were generated from the legacy ``dxas_core.py``
implementation before the public API was introduced.  They are intentionally
hard-coded so a change to an optics formula cannot silently update its own
expected result.
"""

from __future__ import annotations

from dataclasses import replace
import json
import math
import unittest

from dxascalc import (
    Condition,
    DXASConfig,
    GeometryType,
    InvalidConfigurationError,
    Material,
    calculate,
)


class CalculatorContractTests(unittest.TestCase):
    maxDiff = None

    def setUp(self) -> None:
        self.base = DXASConfig(
            geometry=GeometryType.BRAGG,
            material=Material.SI,
            h=1,
            k=1,
            l=1,
            energy_kev=8.333,
            source_distance_m=35.0,
            divergence_mrad=2.0,
            bending_radius_m=2.0,
            asymmetry_angle_deg=0.0,
            condition=Condition.UPPER,
            detector_distance_m=1.0,
            pixel_size_um=55.0,
        )

    def assertClose(self, actual: float, expected: float) -> None:
        self.assertTrue(
            math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-12),
            f"{actual!r} != {expected!r} within rel_tol=1e-10",
        )

    def assertIssue(
        self,
        config: DXASConfig,
        expected_code: str,
        expected_field: str,
    ) -> None:
        with self.assertRaises(InvalidConfigurationError) as caught:
            calculate(config)

        error = caught.exception
        self.assertIsInstance(error, ValueError)
        self.assertIsInstance(error.issues, tuple)
        self.assertGreater(len(error.issues), 0)

        matching = [issue for issue in error.issues if issue.code == expected_code]
        self.assertTrue(
            matching,
            f"missing issue code {expected_code!r}; got "
            f"{[issue.code for issue in error.issues]!r}",
        )
        issue = matching[0]
        self.assertEqual(issue.level, "error")
        self.assertEqual(issue.field, expected_field)
        self.assertIsInstance(issue.message, str)
        self.assertTrue(issue.message.strip())
        self.assertEqual(
            issue.to_dict(),
            {
                "level": "error",
                "code": expected_code,
                "message": issue.message,
                "field": expected_field,
            },
        )
        json.dumps([item.to_dict() for item in error.issues])

    def test_bragg_and_laue_upper_and_lower_golden_values(self) -> None:
        common = {
            "d_spacing_angstrom": 3.1355893119688578,
            "wavelength_angstrom": 1.4878726509060363,
            "bragg_angle_deg": 13.724623862086823,
            "incident_beam_width_mm": 70.00002333334267,
            "flat_energy_span_ev": 68.23921286008029,
        }
        cases = (
            (
                GeometryType.BRAGG,
                Condition.UPPER,
                {
                    "crystal_rotation_deg": 13.724623862086823,
                    "crystal_footprint_mm": 295.0404725403632,
                    "bent_energy_span_signed_ev": -4965.093189145051,
                    "effective_angular_span_signed_mrad": -145.5202362701816,
                    "geometric_focus_m": 0.23887493384706757,
                    "focus_kind": "real",
                    "detector_beam_width_signed_mm": -223.0404485403536,
                    "detector_sampling_signed_ev_per_pixel": 1.2243524759302606,
                },
            ),
            (
                GeometryType.BRAGG,
                Condition.LOWER,
                {
                    "crystal_rotation_deg": -13.724623862086823,
                    "crystal_footprint_mm": 295.0404725403632,
                    "bent_energy_span_signed_ev": 5101.571614865211,
                    "effective_angular_span_signed_mrad": 149.52023627018164,
                    "geometric_focus_m": -0.23565820030374887,
                    "focus_kind": "virtual",
                    "detector_beam_width_signed_mm": -367.04049654037277,
                    "detector_sampling_signed_ev_per_pixel": -0.7644563514443791,
                },
            ),
            (
                GeometryType.LAUE,
                Condition.UPPER,
                {
                    "crystal_rotation_deg": 76.27537613791317,
                    "crystal_footprint_mm": 72.05746240713462,
                    "bent_energy_span_signed_ev": 1297.5253416995035,
                    "effective_angular_span_signed_mrad": 38.02873120356731,
                    "geometric_focus_m": 0.9452122774390006,
                    "focus_kind": "real",
                    "detector_beam_width_signed_mm": -4.57217780660584,
                    "detector_sampling_signed_ev_per_pixel": -15.608293642991491,
                },
            ),
            (
                GeometryType.LAUE,
                Condition.LOWER,
                {
                    "crystal_rotation_deg": 103.72462386208683,
                    "crystal_footprint_mm": 72.05746240713462,
                    "bent_energy_span_signed_ev": 1297.5253416995035,
                    "effective_angular_span_signed_mrad": 38.02873120356731,
                    "geometric_focus_m": 0.9452122774390006,
                    "focus_kind": "real",
                    "detector_beam_width_signed_mm": -4.57217780660584,
                    "detector_sampling_signed_ev_per_pixel": -15.608293642991491,
                },
            ),
        )

        for geometry, condition, expected in cases:
            with self.subTest(geometry=geometry.value, condition=condition.value):
                result = calculate(
                    replace(self.base, geometry=geometry, condition=condition)
                )
                for field, value in {**common, **expected}.items():
                    if isinstance(value, float):
                        self.assertClose(getattr(result, field), value)
                    else:
                        self.assertEqual(getattr(result, field), value)

                # Every user-facing magnitude is non-negative while its signed
                # partner retains the legacy orientation/curvature information.
                self.assertClose(
                    result.bent_energy_span_ev,
                    abs(result.bent_energy_span_signed_ev),
                )
                self.assertClose(
                    result.effective_angular_span_mrad,
                    abs(result.effective_angular_span_signed_mrad),
                )
                self.assertClose(
                    result.detector_beam_width_mm,
                    abs(result.detector_beam_width_signed_mm),
                )
                self.assertClose(
                    result.detector_sampling_ev_per_pixel,
                    abs(result.detector_sampling_signed_ev_per_pixel),
                )

    def test_nonzero_asymmetry_ge_220_upper_and_lower_golden_values(self) -> None:
        """Exercise sign-sensitive branches hidden by the symmetric Si(111) case."""

        config = DXASConfig(
            geometry=GeometryType.BRAGG,
            material=Material.GE,
            h=2,
            k=2,
            l=0,
            energy_kev=12.5,
            source_distance_m=8.75,
            divergence_mrad=1.35,
            bending_radius_m=-3.4,
            asymmetry_angle_deg=7.25,
            condition=Condition.UPPER,
            detector_distance_m=0.45,
            pixel_size_um=75.0,
        )
        common = {
            "d_spacing_angstrom": 1.9975766568519968,
            "wavelength_angstrom": 0.991875424,
            "bragg_angle_deg": 14.375144198160534,
            "incident_beam_width_mm": 11.812501794023765,
            "flat_energy_span_ev": 65.84235357157092,
        }
        cases = (
            (
                GeometryType.BRAGG,
                Condition.UPPER,
                {
                    "crystal_rotation_deg": 21.625144198160534,
                    "crystal_footprint_mm": 32.05280465508781,
                    "effective_angular_span_signed_mrad": 10.777295486790534,
                    "bent_energy_span_signed_ev": 525.6314814715244,
                    "geometric_focus_m": -0.19677369628998725,
                    "detector_beam_width_signed_mm": 26.156222438632128,
                    "detector_sampling_signed_ev_per_pixel": 1.5071886318009904,
                    "focus_kind": "virtual",
                    "image_inverted": False,
                },
            ),
            (
                GeometryType.BRAGG,
                Condition.LOWER,
                {
                    "crystal_rotation_deg": -7.125144198160534,
                    "crystal_footprint_mm": 95.23373408669103,
                    "effective_angular_span_signed_mrad": -26.659921790203242,
                    "bent_energy_span_signed_ev": -1300.2607382970295,
                    "geometric_focus_m": 0.6419760618054857,
                    "detector_beam_width_signed_mm": -7.070379695610245,
                    "detector_sampling_signed_ev_per_pixel": 13.792690006849808,
                    "focus_kind": "real",
                    "image_inverted": False,
                },
            ),
            (
                GeometryType.LAUE,
                Condition.UPPER,
                {
                    "crystal_rotation_deg": 68.37485580183947,
                    "crystal_footprint_mm": 12.706877320588596,
                    "effective_angular_span_signed_mrad": -2.387316858996646,
                    "bent_energy_span_signed_ev": -116.43448942031797,
                    "geometric_focus_m": -2.0586945657625013,
                    "detector_beam_width_signed_mm": 17.52527471167053,
                    "detector_sampling_signed_ev_per_pixel": -0.49828529653281806,
                    "focus_kind": "virtual",
                    "image_inverted": False,
                },
            ),
            (
                GeometryType.LAUE,
                Condition.LOWER,
                {
                    "crystal_rotation_deg": 97.12514419816054,
                    "crystal_footprint_mm": 11.904432584916703,
                    "effective_angular_span_signed_mrad": -2.151303701446089,
                    "bent_energy_span_signed_ev": -104.92362885217975,
                    "geometric_focus_m": -1.9577757427468525,
                    "detector_beam_width_signed_mm": 15.523933756925347,
                    "detector_sampling_signed_ev_per_pixel": -0.5069122483470362,
                    "focus_kind": "virtual",
                    "image_inverted": False,
                },
            ),
        )

        for geometry, condition, expected in cases:
            with self.subTest(geometry=geometry.value, condition=condition.value):
                result = calculate(
                    replace(config, geometry=geometry, condition=condition)
                )
                for field, value in {**common, **expected}.items():
                    if isinstance(value, bool) or isinstance(value, str):
                        self.assertEqual(getattr(result, field), value)
                    else:
                        self.assertClose(getattr(result, field), value)

                self.assertClose(
                    result.bent_energy_span_ev,
                    abs(result.bent_energy_span_signed_ev),
                )
                self.assertClose(
                    result.effective_angular_span_mrad,
                    abs(result.effective_angular_span_signed_mrad),
                )
                self.assertClose(
                    result.detector_beam_width_mm,
                    abs(result.detector_beam_width_signed_mm),
                )
                self.assertClose(
                    result.detector_sampling_ev_per_pixel,
                    abs(result.detector_sampling_signed_ev_per_pixel),
                )

    def test_positive_and_negative_bending_radius_preserve_signed_results(self) -> None:
        cases = (
            (
                GeometryType.BRAGG,
                2.0,
                -4965.093189145051,
                -145.5202362701816,
                0.23887493384706757,
                "real",
            ),
            (
                GeometryType.BRAGG,
                -2.0,
                5101.571614865211,
                149.5202362701816,
                -0.23565820030374887,
                "virtual",
            ),
            (
                GeometryType.LAUE,
                2.0,
                1297.5253416995035,
                38.02873120356731,
                0.9452122774390006,
                "real",
            ),
            (
                GeometryType.LAUE,
                -2.0,
                -1161.0469159793429,
                -34.02873120356731,
                -0.9991801243479558,
                "virtual",
            ),
        )

        for geometry, radius, bent, angular, focus, focus_kind in cases:
            with self.subTest(geometry=geometry.value, radius=radius):
                result = calculate(
                    replace(
                        self.base,
                        geometry=geometry,
                        bending_radius_m=radius,
                    )
                )
                self.assertClose(result.bent_energy_span_signed_ev, bent)
                self.assertClose(result.effective_angular_span_signed_mrad, angular)
                self.assertClose(result.geometric_focus_m, focus)
                self.assertEqual(result.focus_kind, focus_kind)
                self.assertClose(result.bent_energy_span_ev, abs(bent))
                self.assertClose(result.effective_angular_span_mrad, abs(angular))

    def test_past_focus_sets_image_inverted_without_negative_display_width(self) -> None:
        before_focus = calculate(replace(self.base, detector_distance_m=0.1))
        past_focus = calculate(replace(self.base, detector_distance_m=1.0))
        virtual_focus = calculate(
            replace(self.base, condition=Condition.LOWER, detector_distance_m=1.0)
        )

        self.assertFalse(before_focus.image_inverted)
        self.assertGreater(before_focus.detector_beam_width_signed_mm, 0.0)
        self.assertTrue(past_focus.image_inverted)
        self.assertLess(past_focus.detector_beam_width_signed_mm, 0.0)
        self.assertGreater(past_focus.detector_beam_width_mm, 0.0)
        self.assertClose(
            past_focus.detector_beam_width_mm,
            abs(past_focus.detector_beam_width_signed_mm),
        )

        # Inversion describes a negative focus magnification, not the sign of
        # the projected width.  A virtual-focus Bragg/lower result retains its
        # negative legacy width orientation but is not a past-focus image.
        self.assertEqual(virtual_focus.focus_kind, "virtual")
        self.assertLess(virtual_focus.geometric_focus_m, 0.0)
        self.assertLess(virtual_focus.detector_beam_width_signed_mm, 0.0)
        self.assertFalse(virtual_focus.image_inverted)

    def test_config_defaults_and_json_safe_mapping_round_trip(self) -> None:
        default = DXASConfig()
        self.assertEqual(default.geometry, GeometryType.BRAGG)
        self.assertEqual(default.material, Material.SI)
        self.assertEqual((default.h, default.k, default.l), (1, 1, 1))
        self.assertEqual(default.energy_kev, 8.0)
        self.assertEqual(default.source_distance_m, 1.2)
        self.assertEqual(default.divergence_mrad, 1.2)
        self.assertEqual(default.bending_radius_m, -2.0)
        self.assertEqual(default.asymmetry_angle_deg, 0.0)
        self.assertEqual(default.condition, Condition.UPPER)
        self.assertEqual(default.detector_distance_m, 1.5)
        self.assertEqual(default.pixel_size_um, 55.0)
        self.assertEqual(default.source_size_um, 1.5)
        self.assertEqual(default.crystal_thickness_um, 200.0)
        self.assertEqual(default.polarization.value, "unpolarized")

        payload = replace(
            default,
            geometry=GeometryType.LAUE,
            material=Material.GE,
            h=2,
            k=2,
            l=0,
            energy_kev=12.5,
            condition=Condition.LOWER,
        ).to_dict()
        self.assertEqual(payload["geometry"], GeometryType.LAUE.value)
        self.assertEqual(payload["material"], Material.GE.value)
        self.assertEqual(payload["condition"], Condition.LOWER.value)
        json.dumps(payload)

        restored = DXASConfig.from_mapping(payload)
        self.assertEqual(restored.to_dict(), payload)

    def test_result_to_dict_is_complete_and_json_safe(self) -> None:
        result = calculate(self.base)
        payload = result.to_dict()
        expected_keys = {
            "d_spacing_angstrom",
            "wavelength_angstrom",
            "bragg_angle_deg",
            "crystal_rotation_deg",
            "incident_beam_width_mm",
            "crystal_footprint_mm",
            "flat_energy_span_ev",
            "bent_energy_span_ev",
            "bent_energy_span_signed_ev",
            "effective_angular_span_mrad",
            "effective_angular_span_signed_mrad",
            "geometric_focus_m",
            "detector_beam_width_mm",
            "detector_beam_width_signed_mm",
            "detector_sampling_ev_per_pixel",
            "detector_sampling_signed_ev_per_pixel",
            "source_size_resolution_ev_fwhm",
            "crystal_intrinsic_resolution_ev_fwhm",
            "crystal_intrinsic_width_urad_fwhm",
            "total_resolution_ev_fwhm",
            "total_resolution_method",
            "reflectivity_curve",
            "reflectivity_peak",
            "reflectivity_integrated",
            "reflectivity_model",
            "image_inverted",
            "focus_kind",
            "warnings",
            "assumptions",
        }
        self.assertEqual(set(payload), expected_keys)
        for unavailable in (
            "source_size_resolution_ev_fwhm",
            "crystal_intrinsic_resolution_ev_fwhm",
            "crystal_intrinsic_width_urad_fwhm",
            "total_resolution_ev_fwhm",
            "total_resolution_method",
            "reflectivity_curve",
            "reflectivity_peak",
            "reflectivity_integrated",
            "reflectivity_model",
        ):
            self.assertIsNone(payload[unavailable])
        self.assertIsInstance(payload["warnings"], list)
        self.assertIsInstance(payload["assumptions"], list)
        json.dumps(payload)

    def test_invalid_scalar_and_crystal_inputs_are_structured(self) -> None:
        cases = (
            (
                replace(self.base, h=0, k=0, l=0),
                "invalid_hkl",
                "hkl",
            ),
            (
                replace(self.base, energy_kev=0.1),
                "energy_unreachable",
                "energy_kev",
            ),
            (
                replace(self.base, bending_radius_m=0.0),
                "zero_bending_radius",
                "bending_radius_m",
            ),
            (
                replace(self.base, source_distance_m=0.0),
                "invalid_source_distance",
                "source_distance_m",
            ),
            (
                replace(self.base, detector_distance_m=0.0),
                "invalid_detector_distance",
                "detector_distance_m",
            ),
            (
                replace(self.base, pixel_size_um=0.0),
                "invalid_pixel_size",
                "pixel_size_um",
            ),
            (
                replace(self.base, divergence_mrad=0.0),
                "invalid_divergence",
                "divergence_mrad",
            ),
            (
                replace(self.base, source_size_um=-0.001),
                "invalid_source_size",
                "source_size_um",
            ),
            (
                replace(self.base, crystal_thickness_um=0.0),
                "invalid_crystal_thickness",
                "crystal_thickness_um",
            ),
            (
                replace(self.base, polarization="circular"),
                "invalid_polarization",
                "polarization",
            ),
        )

        for config, code, field in cases:
            with self.subTest(code=code):
                self.assertIssue(config, code, field)

        # A zero-width source is the valid point-source limit; unlike crystal
        # thickness it must not be rejected by the model boundary.
        result = calculate(replace(self.base, source_size_um=0.0))
        self.assertGreater(result.d_spacing_angstrom, 0.0)

    def test_diamond_cubic_reflection_selection_rules(self) -> None:
        allowed = (
            (Material.SI, (-1, 1, 1)),
            (Material.GE, (2, -2, 0)),
            (Material.SI, (-4, 0, 0)),
        )
        for material, (h, k, l) in allowed:
            with self.subTest(kind="allowed", material=material, hkl=(h, k, l)):
                result = calculate(
                    replace(self.base, material=material, h=h, k=k, l=l)
                )
                self.assertGreater(result.d_spacing_angstrom, 0.0)

        forbidden = (
            (Material.SI, (1, 0, 0)),
            (Material.GE, (2, 2, 2)),
            (Material.SI, (-2, -2, -2)),
            (Material.GE, (1, -1, 0)),
        )
        for material, (h, k, l) in forbidden:
            with self.subTest(kind="forbidden", material=material, hkl=(h, k, l)):
                self.assertIssue(
                    replace(self.base, material=material, h=h, k=k, l=l),
                    "forbidden_reflection",
                    "hkl",
                )

    def test_divergence_must_stay_in_nonperiodic_domain(self) -> None:
        for divergence_mrad in (math.pi * 1000.0, 7000.0):
            with self.subTest(divergence_mrad=divergence_mrad):
                self.assertIssue(
                    replace(self.base, divergence_mrad=divergence_mrad),
                    "invalid_divergence",
                    "divergence_mrad",
                )

    def test_extreme_numeric_inputs_raise_structured_errors(self) -> None:
        huge_400 = 10**400
        huge_200 = 10**200
        cases = (
            (
                replace(self.base, energy_kev=huge_400),
                "invalid_energy",
                "energy_kev",
            ),
            (
                replace(self.base, source_distance_m=huge_400),
                "invalid_source_distance",
                "source_distance_m",
            ),
            (
                replace(self.base, h=huge_400),
                "invalid_hkl",
                "h",
            ),
            (
                replace(self.base, h=huge_200),
                "invalid_hkl",
                "h",
            ),
            (
                replace(self.base, pixel_size_um=5e-324),
                "invalid_pixel_size",
                "pixel_size_um",
            ),
            (
                replace(self.base, source_size_um=float("inf")),
                "invalid_source_size",
                "source_size_um",
            ),
            (
                replace(self.base, crystal_thickness_um=float("nan")),
                "invalid_crystal_thickness",
                "crystal_thickness_um",
            ),
        )

        for config, code, field in cases:
            with self.subTest(code=code, field=field):
                self.assertIssue(config, code, field)

    def test_rotation_focus_projection_and_detector_singularities_are_structured(
        self,
    ) -> None:
        # For the base Si(111), 8.333 keV configuration these values put the
        # named denominator at zero.  Keeping them explicit makes the edge-case
        # contract independent of implementation helpers.
        cases = (
            (
                replace(
                    self.base,
                    asymmetry_angle_deg=-13.724623862086823,
                ),
                "singular_crystal_rotation",
                "asymmetry_angle_deg",
            ),
            (
                replace(
                    self.base,
                    bending_radius_m=295.0403741935325,
                ),
                "singular_focus",
                "bending_radius_m",
            ),
            (
                replace(
                    self.base,
                    geometry=GeometryType.LAUE,
                    energy_kev=2.7959729759790046,
                ),
                "singular_laue_projection",
                "energy_kev",
            ),
            (
                replace(
                    self.base,
                    detector_distance_m=0.23887493384706757,
                ),
                "singular_detector_beam",
                "detector_distance_m",
            ),
        )

        for config, code, field in cases:
            with self.subTest(code=code):
                self.assertIssue(config, code, field)


if __name__ == "__main__":
    unittest.main()
