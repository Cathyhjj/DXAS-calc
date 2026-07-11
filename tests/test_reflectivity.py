"""Numerical contracts for the intrinsic crystal-resolution helpers.

The tests in this module deliberately exercise the small, dependency-free
numerical boundary.  The optional XOP executable is platform dependent, so it
must not be required for the normal unit-test suite.
"""

from __future__ import annotations

import math
import json
import os
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

import dxascalc.reflectivity as reflectivity_module
from dxascalc import DXASConfig, GeometryType, calculate
from dxascalc.reflectivity import (
    ReflectivitySolution,
    combine_resolution_fwhm,
    enrich_with_intrinsic_resolution,
    interpolated_fwhm,
    source_size_resolution_ev_fwhm,
    xop_asymmetry_angle_deg,
)


class InterpolatedFwhmTests(unittest.TestCase):
    def test_interpolates_crossings_on_a_nonuniform_grid(self) -> None:
        # Half maximum is crossed at -2/3 and 1.25.  Using the first and last
        # sampled points above half maximum would instead report 1.5, which is
        # the grid-dependent behavior of the legacy implementation.
        x = (-3.0, -1.0, 0.0, 0.5, 2.0, 5.0)
        y = (0.0, 0.25, 1.0, 0.75, 0.25, 0.0)

        self.assertAlmostEqual(interpolated_fwhm(x, y), 23.0 / 12.0, places=12)

    def test_uses_the_contiguous_lobe_containing_the_global_peak(self) -> None:
        # Bent-crystal curves can contain Pendellosung side lobes.  A distant
        # side lobe above half maximum must not inflate the main peak FWHM.
        x = tuple(float(value) for value in range(-3, 8))
        y = (0.0, 0.25, 0.75, 1.0, 0.75, 0.25, 0.0, 0.3, 0.6, 0.3, 0.0)

        self.assertAlmostEqual(interpolated_fwhm(x, y), 3.0, places=12)

    def test_is_invariant_to_positive_intensity_scaling(self) -> None:
        x = (-2.0, -1.0, 0.0, 1.0, 2.0)
        normalized = (0.0, 0.5, 1.0, 0.5, 0.0)
        scaled = tuple(17.25 * value for value in normalized)

        self.assertAlmostEqual(
            interpolated_fwhm(x, normalized),
            interpolated_fwhm(x, scaled),
            places=12,
        )

    def test_rejects_curves_that_cannot_define_a_finite_fwhm(self) -> None:
        invalid_cases = (
            ((), ()),
            ((0.0, 1.0), (0.0, 1.0)),
            ((0.0, 1.0, 2.0), (0.0, 1.0)),
            ((0.0, 1.0, 1.0), (0.0, 1.0, 0.0)),
            ((0.0, 2.0, 1.0), (0.0, 1.0, 0.0)),
            ((0.0, 1.0, 2.0), (0.0, 0.0, 0.0)),
            ((0.0, 1.0, 2.0), (0.0, -1.0, 0.0)),
            ((0.0, 1.0, math.inf), (0.0, 1.0, 0.0)),
            ((0.0, 1.0, 2.0), (0.0, math.nan, 0.0)),
        )

        for x, y in invalid_cases:
            with self.subTest(x=x, y=y):
                with self.assertRaises(ValueError):
                    interpolated_fwhm(x, y)


class ResolutionCombinationTests(unittest.TestCase):
    def test_combines_independent_fwhm_terms_in_quadrature(self) -> None:
        self.assertAlmostEqual(combine_resolution_fwhm(3.0, 4.0), 5.0)
        self.assertAlmostEqual(
            combine_resolution_fwhm(0.6, 0.8, 0.0),
            1.0,
        )

    def test_empty_and_zero_terms_produce_zero(self) -> None:
        self.assertEqual(combine_resolution_fwhm(), 0.0)
        self.assertEqual(combine_resolution_fwhm(0.0, 0.0), 0.0)

    def test_rejects_negative_or_nonfinite_widths(self) -> None:
        for term in (-1.0, math.nan, math.inf, -math.inf):
            with self.subTest(term=term):
                with self.assertRaises(ValueError):
                    combine_resolution_fwhm(1.0, term)


class XopConventionMappingTests(unittest.TestCase):
    def test_bragg_uses_the_application_asymmetry_angle_directly(self) -> None:
        self.assertAlmostEqual(
            xop_asymmetry_angle_deg(GeometryType.BRAGG, 7.25),
            7.25,
        )
        self.assertAlmostEqual(
            xop_asymmetry_angle_deg(GeometryType.BRAGG, -3.0),
            -3.0,
        )

    def test_symmetric_laue_maps_to_ninety_degrees_in_xop(self) -> None:
        self.assertAlmostEqual(
            xop_asymmetry_angle_deg(GeometryType.LAUE, 0.0),
            90.0,
        )
        self.assertAlmostEqual(
            xop_asymmetry_angle_deg(GeometryType.LAUE, 7.25),
            82.75,
        )
        self.assertAlmostEqual(
            xop_asymmetry_angle_deg(GeometryType.LAUE, -3.0),
            93.0,
        )


class SourceSizeResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = DXASConfig(
            energy_kev=8.0,
            source_distance_m=1.2,
            source_size_um=1.5,
        )

    def test_matches_angular_source_fwhm_dispersion_with_explicit_units(self) -> None:
        bragg_angle_deg = 14.308610318658809
        source_angle_rad = 1.5e-6 / 1.2
        expected_ev = (
            8000.0
            * source_angle_rad
            / math.tan(math.radians(bragg_angle_deg))
        )

        self.assertAlmostEqual(
            source_size_resolution_ev_fwhm(self.config, bragg_angle_deg),
            expected_ev,
            places=12,
        )

    def test_zero_source_size_is_the_point_source_limit(self) -> None:
        self.assertEqual(
            source_size_resolution_ev_fwhm(
                replace(self.config, source_size_um=0.0),
                14.308610318658809,
            ),
            0.0,
        )

    def test_scales_with_source_size_and_inverse_source_distance(self) -> None:
        base = source_size_resolution_ev_fwhm(
            self.config,
            14.308610318658809,
        )
        twice_size = source_size_resolution_ev_fwhm(
            replace(self.config, source_size_um=3.0),
            14.308610318658809,
        )
        twice_distance = source_size_resolution_ev_fwhm(
            replace(self.config, source_distance_m=2.4),
            14.308610318658809,
        )

        self.assertAlmostEqual(twice_size, 2.0 * base, places=12)
        self.assertAlmostEqual(twice_distance, 0.5 * base, places=12)


class ResolutionEnrichmentTests(unittest.TestCase):
    @staticmethod
    def _deterministic_solver(_config: DXASConfig) -> ReflectivitySolution:
        return ReflectivitySolution(
            energy_offset_ev=(-2.0, -1.0, 0.0, 1.0, 2.0),
            sigma=(0.0, 0.4, 0.8, 0.4, 0.0),
            pi=(0.0, 0.5, 1.0, 0.5, 0.0),
            selected=(0.0, 0.5, 1.0, 0.5, 0.0),
            model="deterministic-test-model",
            warning_messages=(),
        )

    def test_enrichment_derives_crystal_metrics_and_serializable_curve(self) -> None:
        config = DXASConfig(source_size_um=0.0, polarization="pi")
        base = calculate(config)
        result = enrich_with_intrinsic_resolution(
            config,
            base,
            solver=self._deterministic_solver,
        )

        self.assertAlmostEqual(
            result.crystal_intrinsic_resolution_ev_fwhm,
            2.0,
            places=12,
        )
        expected_angular_width_urad = (
            2.0
            / (
                config.energy_kev
                * 1000.0
                / math.tan(math.radians(base.bragg_angle_deg))
            )
            * 1e6
        )
        self.assertAlmostEqual(
            result.crystal_intrinsic_width_urad_fwhm,
            expected_angular_width_urad,
            places=10,
        )
        self.assertEqual(result.source_size_resolution_ev_fwhm, 0.0)
        self.assertEqual(result.reflectivity_peak, 1.0)
        self.assertAlmostEqual(result.reflectivity_integrated, 2.0, places=12)
        self.assertEqual(result.reflectivity_model, "deterministic-test-model")
        self.assertIn("convolution", result.total_resolution_method)
        self.assertGreaterEqual(result.total_resolution_ev_fwhm, 2.0)
        self.assertEqual(
            result.reflectivity_curve,
            {
                "x_axis": "energy_offset_ev",
                "x": [-2.0, -1.0, 0.0, 1.0, 2.0],
                "sigma": [0.0, 0.4, 0.8, 0.4, 0.0],
                "pi": [0.0, 0.5, 1.0, 0.5, 0.0],
                "selected": [0.0, 0.5, 1.0, 0.5, 0.0],
                "display_points": 5,
                "source_points": 5,
            },
        )

    def test_finite_source_broadens_total_but_not_crystal_intrinsic_width(self) -> None:
        point_config = DXASConfig(source_size_um=0.0)
        finite_config = replace(point_config, source_size_um=15.0)
        point = enrich_with_intrinsic_resolution(
            point_config,
            calculate(point_config),
            solver=self._deterministic_solver,
        )
        finite = enrich_with_intrinsic_resolution(
            finite_config,
            calculate(finite_config),
            solver=self._deterministic_solver,
        )

        self.assertEqual(
            point.crystal_intrinsic_resolution_ev_fwhm,
            finite.crystal_intrinsic_resolution_ev_fwhm,
        )
        self.assertGreater(finite.source_size_resolution_ev_fwhm, 0.0)
        self.assertGreater(
            finite.total_resolution_ev_fwhm,
            point.total_resolution_ev_fwhm,
        )

    def test_solver_failure_preserves_geometry_and_reports_unavailable(self) -> None:
        def failing_solver(
            _config: DXASConfig,
        ) -> ReflectivitySolution:
            raise RuntimeError("synthetic solver failure")

        config = DXASConfig()
        base = calculate(config)
        result = enrich_with_intrinsic_resolution(
            config,
            base,
            solver=failing_solver,
        )

        self.assertEqual(result.d_spacing_angstrom, base.d_spacing_angstrom)
        self.assertEqual(result.reflectivity_model, "unavailable")
        self.assertIsNone(result.crystal_intrinsic_resolution_ev_fwhm)
        self.assertIsNone(result.total_resolution_ev_fwhm)
        issue = next(
            warning
            for warning in result.warnings
            if warning.code == "reflectivity_unavailable"
        )
        self.assertIn("synthetic solver failure", issue.message)

    def test_total_convolution_failure_keeps_valid_intrinsic_results(self) -> None:
        # An enormous but finite detector pixel trips the convolution safety
        # cap.  The crystal solution is still valid and must remain available
        # even though a total instrument FWHM cannot be reported.
        config = DXASConfig(pixel_size_um=1.0e8, source_size_um=0.0)
        result = enrich_with_intrinsic_resolution(
            config,
            calculate(config),
            solver=self._deterministic_solver,
        )

        self.assertAlmostEqual(
            result.crystal_intrinsic_resolution_ev_fwhm,
            2.0,
            places=12,
        )
        self.assertIsNotNone(result.reflectivity_curve)
        self.assertEqual(result.reflectivity_peak, 1.0)
        self.assertIsNone(result.total_resolution_ev_fwhm)
        self.assertTrue(
            any(
                warning.code == "resolution_enrichment_failed"
                for warning in result.warnings
            )
        )

    def test_laue_result_discloses_unmodeled_borrmann_spatial_term(self) -> None:
        config = DXASConfig(
            geometry=GeometryType.LAUE,
            bending_radius_m=2.0,
            crystal_thickness_um=50.0,
        )
        result = enrich_with_intrinsic_resolution(
            config,
            calculate(config),
            solver=self._deterministic_solver,
        )

        warning = next(
            item
            for item in result.warnings
            if item.code == "laue_borrmann_spatial_broadening_not_modeled"
        )
        self.assertEqual(warning.field, "crystal_thickness_um")
        self.assertIsNotNone(result.crystal_intrinsic_resolution_ev_fwhm)


@unittest.skipUnless(
    os.environ.get("DXASCALC_RUN_XOP_INTEGRATION") == "1",
    "set DXASCALC_RUN_XOP_INTEGRATION=1 to run external XOP regressions",
)
class XopReferenceIntegrationTests(unittest.TestCase):
    """Opt-in regression against independently recorded ``diff_pat`` output."""

    def test_si_reflections_match_xop_diff_pat_v1_8_reference(self) -> None:
        fixture_path = (
            Path(__file__).parent
            / "fixtures"
            / "xop_diff_pat_v1_8_reference.json"
        )
        reference = json.loads(fixture_path.read_text(encoding="utf-8"))
        relative_tolerance = reference["relative_tolerance"]

        for case in reference["cases"]:
            with self.subTest(case=case["id"]):
                config = DXASConfig.from_mapping(case["config"])
                result = enrich_with_intrinsic_resolution(config, calculate(config))

                self.assertIn("xop", result.reflectivity_model.lower())
                for field in (
                    "crystal_intrinsic_width_urad_fwhm",
                    "crystal_intrinsic_resolution_ev_fwhm",
                    "reflectivity_peak",
                ):
                    actual = getattr(result, field)
                    self.assertIsNotNone(actual)
                    self.assertTrue(math.isfinite(actual))
                    self.assertTrue(
                        math.isclose(
                            actual,
                            case[field],
                            rel_tol=relative_tolerance,
                            abs_tol=1e-12,
                        ),
                        f"{case['id']} {field}: {actual!r} != {case[field]!r}",
                    )

                curve = result.reflectivity_curve
                self.assertEqual(curve["x_axis"], "energy_offset_ev")
                lengths = {
                    len(curve[name])
                    for name in ("x", "sigma", "pi", "selected")
                }
                self.assertEqual(len(lengths), 1)
                self.assertEqual(lengths.pop(), 2501)
                self.assertEqual(curve["display_points"], 2501)
                self.assertEqual(curve["source_points"], 10001)
                for sigma, pi, selected in zip(
                    curve["sigma"],
                    curve["pi"],
                    curve["selected"],
                ):
                    self.assertAlmostEqual(selected, (sigma + pi) / 2.0)


class ReflectivityResourceBoundTests(unittest.TestCase):
    def test_full_resolution_solution_cache_has_a_bounded_memory_footprint(self) -> None:
        self.assertEqual(reflectivity_module._solve_cached.cache_info().maxsize, 32)

    def test_fft_convolution_preserves_the_legacy_same_correlation(self) -> None:
        with mock.patch.object(
            reflectivity_module.np.fft,
            "rfft",
            wraps=reflectivity_module.np.fft.rfft,
        ) as rfft:
            actual = reflectivity_module._convolve_same(
                (1.0, 2.0, 3.0, 4.0),
                (0.2, 0.3, 0.5),
            )

        expected = (1.3, 2.3, 3.3, 1.8)
        for actual_value, expected_value in zip(actual, expected):
            self.assertAlmostEqual(actual_value, expected_value, places=12)
        self.assertEqual(rfft.call_count, 2)

    def test_busy_enrichment_fails_fast_and_permits_are_released(self) -> None:
        semaphore = reflectivity_module._ENRICHMENT_CONCURRENCY
        original_timeout = reflectivity_module._ENRICHMENT_ACQUIRE_TIMEOUT_SECONDS
        self.assertTrue(semaphore.acquire(timeout=0.0))
        self.assertTrue(semaphore.acquire(timeout=0.0))
        reflectivity_module._ENRICHMENT_ACQUIRE_TIMEOUT_SECONDS = 0.01
        try:
            config = DXASConfig()
            busy = enrich_with_intrinsic_resolution(config, calculate(config))
        finally:
            reflectivity_module._ENRICHMENT_ACQUIRE_TIMEOUT_SECONDS = original_timeout
            semaphore.release()
            semaphore.release()

        self.assertTrue(
            any(warning.code == "resolution_enrichment_busy" for warning in busy.warnings)
        )

        def failing_solver(_config: DXASConfig) -> ReflectivitySolution:
            raise RuntimeError("expected failure")

        for _ in range(3):
            failed = enrich_with_intrinsic_resolution(
                config,
                calculate(config),
                solver=failing_solver,
            )
            self.assertTrue(
                any(warning.code == "reflectivity_unavailable" for warning in failed.warnings)
            )
            self.assertFalse(
                any(warning.code == "resolution_enrichment_busy" for warning in failed.warnings)
            )


if __name__ == "__main__":
    unittest.main()
