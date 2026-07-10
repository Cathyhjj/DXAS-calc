"""Pure-Python DXAS geometry and energy-dispersion calculations."""

from __future__ import annotations

import math
from numbers import Integral, Real
from typing import Any, Iterable, List, Optional, Tuple, Type, TypeVar

from .models import (
    CalculationIssue,
    CalculationResult,
    Condition,
    DXASConfig,
    GeometryType,
    Material,
)


ANGSTROM_KEV = 12.3984428
_LATTICE_CONSTANT_ANGSTROM = {
    Material.SI: 5.431,
    Material.GE: 5.65,
}
_ABS_TOL = 1.0e-12
_MAX_ABS_MILLER_INDEX = 10_000
_MAX_DIVERGENCE_MRAD = math.pi * 1000.0


class InvalidConfigurationError(ValueError):
    """Raised when a configuration cannot produce a finite physical result."""

    def __init__(self, issues: Iterable[CalculationIssue]):
        self.issues: Tuple[CalculationIssue, ...] = tuple(issues)
        if not self.issues:
            raise ValueError("InvalidConfigurationError requires at least one issue")
        detail = "; ".join(issue.message for issue in self.issues)
        super().__init__("Invalid DXAS configuration: " + detail)


EnumT = TypeVar("EnumT")


def _coerce_enum(enum_type: Type[EnumT], value: Any) -> Optional[EnumT]:
    if isinstance(value, enum_type):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        for member in enum_type:  # type: ignore[union-attr]
            if normalized in (member.name.lower(), str(member.value).lower()):
                return member
    return None


def _error(code: str, message: str, field: Optional[str]) -> CalculationIssue:
    return CalculationIssue(level="error", code=code, message=message, field=field)


def _warning(code: str, message: str, field: Optional[str]) -> CalculationIssue:
    return CalculationIssue(level="warning", code=code, message=message, field=field)


def _finite_real(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, Real):
        return False
    try:
        converted = float(value)
    except (TypeError, ValueError, OverflowError):
        return False
    return math.isfinite(converted)


def _diamond_reflection_allowed(h: int, k: int, l: int) -> bool:
    """Return whether an ideal diamond-cubic Si/Ge reflection is allowed.

    The face-centered sublattice requires all indices to have the same parity.
    The diamond basis additionally extinguishes all-even reflections unless the
    index sum is divisible by four.  Python's modulo semantics preserve both
    tests for negative Miller indices.
    """

    parities = (h % 2, k % 2, l % 2)
    if not (parities[0] == parities[1] == parities[2]):
        return False
    if parities[0] == 1:
        return True
    return (h + k + l) % 4 == 0


def _validate(config: DXASConfig) -> Tuple[GeometryType, Material, Condition]:
    issues: List[CalculationIssue] = []

    geometry = _coerce_enum(GeometryType, config.geometry)
    if geometry is None:
        issues.append(
            _error(
                "invalid_geometry",
                "Geometry must be 'bragg' or 'laue'.",
                "geometry",
            )
        )

    material = _coerce_enum(Material, config.material)
    if material is None:
        issues.append(
            _error(
                "invalid_material",
                "Material must be 'Si' or 'Ge'.",
                "material",
            )
        )

    condition = _coerce_enum(Condition, config.condition)
    if condition is None:
        issues.append(
            _error(
                "invalid_condition",
                "Condition must be 'upper' or 'lower'.",
                "condition",
            )
        )

    hkl_valid = True
    for field_name in ("h", "k", "l"):
        value = getattr(config, field_name)
        if isinstance(value, bool) or not isinstance(value, Integral):
            hkl_valid = False
            issues.append(
                _error(
                    "invalid_hkl",
                    "Miller indices h, k, and l must be integers.",
                    field_name,
                )
            )
        elif abs(value) > _MAX_ABS_MILLER_INDEX:
            hkl_valid = False
            issues.append(
                _error(
                    "invalid_hkl",
                    (
                        "Miller indices must be between -%d and %d."
                        % (_MAX_ABS_MILLER_INDEX, _MAX_ABS_MILLER_INDEX)
                    ),
                    field_name,
                )
            )
    if hkl_valid:
        hkl_is_zero = config.h == 0 and config.k == 0 and config.l == 0
        if hkl_is_zero:
            issues.append(
                _error(
                    "invalid_hkl",
                    "Miller indices (h, k, l) cannot all be zero.",
                    "hkl",
                )
            )
        elif material is not None and not _diamond_reflection_allowed(
            config.h, config.k, config.l
        ):
            issues.append(
                _error(
                    "forbidden_reflection",
                    (
                        "This reflection is systematically absent for diamond-cubic "
                        "Si and Ge. Use all-odd indices, or all-even indices whose "
                        "sum is divisible by four."
                    ),
                    "hkl",
                )
            )

    positive_fields = (
        (
            "energy_kev",
            "invalid_energy",
            "Energy must be a finite value greater than zero.",
        ),
        (
            "source_distance_m",
            "invalid_source_distance",
            "Source-to-crystal distance must be a finite value greater than zero.",
        ),
        (
            "detector_distance_m",
            "invalid_detector_distance",
            "Detector-to-crystal distance must be a finite value greater than zero.",
        ),
        (
            "pixel_size_um",
            "invalid_pixel_size",
            "Detector pixel size must be a finite value greater than zero.",
        ),
    )
    for field_name, code, message in positive_fields:
        value = getattr(config, field_name)
        if not _finite_real(value) or float(value) <= 0.0:
            issues.append(_error(code, message, field_name))

    divergence = config.divergence_mrad
    if (
        not _finite_real(divergence)
        or float(divergence) <= 0.0
        or float(divergence) >= _MAX_DIVERGENCE_MRAD
    ):
        issues.append(
            _error(
                "invalid_divergence",
                (
                    "Full divergence must be finite, greater than zero, and less "
                    "than pi radians (%.6g mrad)." % _MAX_DIVERGENCE_MRAD
                ),
                "divergence_mrad",
            )
        )

    radius = config.bending_radius_m
    if not _finite_real(radius) or float(radius) == 0.0:
        issues.append(
            _error(
                "zero_bending_radius",
                "Bending radius must be finite and non-zero; negative radii are valid.",
                "bending_radius_m",
            )
        )

    if not _finite_real(config.asymmetry_angle_deg):
        issues.append(
            _error(
                "invalid_asymmetry_angle",
                "Asymmetry angle must be finite.",
                "asymmetry_angle_deg",
            )
        )

    if issues:
        raise InvalidConfigurationError(issues)

    # The checks above prove these optionals are concrete enum members.
    return geometry, material, condition  # type: ignore[return-value]


def _raise_singularity(code: str, message: str, field: str) -> None:
    raise InvalidConfigurationError((_error(code, message, field),))


def _finite_result(value: float, field: str, label: str) -> float:
    if not math.isfinite(value):
        raise InvalidConfigurationError(
            (
                _error(
                    "non_finite_result",
                    "%s is not finite for this configuration." % label,
                    field,
                ),
            )
        )
    return value


def _near_zero(value: float, scale: float = 1.0) -> bool:
    return abs(value) <= _ABS_TOL * max(1.0, abs(scale))


def calculate(config: DXASConfig) -> CalculationResult:
    """Calculate DXAS outputs without mutating input or external state.

    The equations intentionally preserve the formulas in ``dxas_core.py``.
    Fields with explicit signed companions expose absolute display magnitudes
    alongside legacy signs.  Geometric focus retains its signed distance and
    also exposes the real/virtual classification through ``focus_kind``.
    """

    if not isinstance(config, DXASConfig):
        raise InvalidConfigurationError(
            (
                _error(
                    "invalid_configuration",
                    "calculate expects a DXASConfig instance.",
                    None,
                ),
            )
        )

    geometry, material, condition = _validate(config)

    h = int(config.h)
    k = int(config.k)
    l = int(config.l)
    energy_kev = float(config.energy_kev)
    source_distance_m = float(config.source_distance_m)
    divergence_rad = float(config.divergence_mrad) / 1000.0
    bending_radius_m = float(config.bending_radius_m)
    asymmetry_rad = math.radians(float(config.asymmetry_angle_deg))
    detector_distance_m = float(config.detector_distance_m)
    pixel_size_m = float(config.pixel_size_um) / 1.0e6
    if not math.isfinite(pixel_size_m) or pixel_size_m <= 0.0:
        raise InvalidConfigurationError(
            (
                _error(
                    "invalid_pixel_size",
                    "Detector pixel size is too small to represent safely in meters.",
                    "pixel_size_um",
                ),
            )
        )

    hkl_norm = math.sqrt(float(h * h + k * k + l * l))
    d_spacing = _LATTICE_CONSTANT_ANGSTROM[material] / hkl_norm
    wavelength = ANGSTROM_KEV / energy_kev
    bragg_argument = wavelength / (2.0 * d_spacing)

    if bragg_argument > 1.0 + _ABS_TOL:
        minimum_energy = ANGSTROM_KEV / (2.0 * d_spacing)
        raise InvalidConfigurationError(
            (
                _error(
                    "energy_unreachable",
                    (
                        "Energy is below the Bragg limit for this material and "
                        "reflection (minimum %.6g keV)." % minimum_energy
                    ),
                    "energy_kev",
                ),
            )
        )
    bragg_argument = min(1.0, max(-1.0, bragg_argument))
    theta0 = math.asin(bragg_argument)
    tangent_theta0 = math.tan(theta0)
    if _near_zero(tangent_theta0):
        _raise_singularity(
            "singular_bragg_angle",
            "Bragg angle is too close to zero for the dispersion relation.",
            "energy_kev",
        )

    divergence_half = divergence_rad / 2.0
    if _near_zero(math.cos(divergence_half)):
        _raise_singularity(
            "singular_divergence",
            "Divergence places tan(divergence / 2) at a singularity.",
            "divergence_mrad",
        )
    incident_width_signed = _finite_result(
        2.0 * source_distance_m * 1000.0 * math.tan(divergence_half),
        "divergence_mrad",
        "Incident beam width",
    )
    if incident_width_signed <= 0.0:
        raise InvalidConfigurationError(
            (
                _error(
                    "invalid_divergence",
                    "Divergence must produce a positive incident beam width.",
                    "divergence_mrad",
                ),
            )
        )

    if geometry is GeometryType.BRAGG:
        condition_sign = 1.0 if condition is Condition.UPPER else -1.0
        crystal_rotation = asymmetry_rad + condition_sign * theta0
    else:
        if condition is Condition.UPPER:
            crystal_rotation = 0.5 * math.pi - (asymmetry_rad + theta0)
        else:
            crystal_rotation = 0.5 * math.pi - (asymmetry_rad - theta0)

    rotation_sine = math.sin(crystal_rotation)
    if _near_zero(rotation_sine):
        _raise_singularity(
            "singular_crystal_rotation",
            "Crystal rotation makes the beam footprint undefined.",
            "asymmetry_angle_deg",
        )

    footprint_signed_mm = _finite_result(
        incident_width_signed / rotation_sine,
        "asymmetry_angle_deg",
        "Crystal footprint",
    )
    footprint_signed_m = footprint_signed_mm / 1000.0

    flat_energy_signed_ev = _finite_result(
        energy_kev * divergence_rad / tangent_theta0 * 1000.0,
        "divergence_mrad",
        "Flat-crystal energy span",
    )

    if geometry is GeometryType.BRAGG:
        effective_angular_signed_rad = (
            divergence_rad - footprint_signed_m / bending_radius_m
        )
    else:
        # Deliberately preserved from dxas_core.py.  See the assumption added
        # below: the Laue sign convention still needs experimental validation.
        effective_angular_signed_rad = (
            divergence_rad + footprint_signed_m / bending_radius_m
        )
    effective_angular_signed_rad = _finite_result(
        effective_angular_signed_rad,
        "bending_radius_m",
        "Effective angular span",
    )
    bent_energy_signed_ev = _finite_result(
        energy_kev * effective_angular_signed_rad / tangent_theta0 * 1000.0,
        "bending_radius_m",
        "Bent-crystal energy span",
    )

    signed_theta = theta0 if condition is Condition.UPPER else -theta0
    if geometry is GeometryType.BRAGG:
        focus_numerator = math.sin(signed_theta - asymmetry_rad)
        first_denominator_term = 2.0 / bending_radius_m
        second_denominator_term = (
            math.sin(signed_theta + asymmetry_rad) / source_distance_m
        )
        focus_denominator = first_denominator_term - second_denominator_term
    else:
        focus_numerator = math.cos(asymmetry_rad - signed_theta)
        first_denominator_term = 2.0 / bending_radius_m
        second_denominator_term = (
            math.cos(asymmetry_rad + signed_theta) / source_distance_m
        )
        focus_denominator = first_denominator_term + second_denominator_term

    focus_scale = abs(first_denominator_term) + abs(second_denominator_term)
    if _near_zero(focus_denominator, focus_scale):
        _raise_singularity(
            "singular_focus",
            "Geometric-focus denominator is zero for this configuration.",
            "bending_radius_m",
        )
    signed_focus_m = _finite_result(
        focus_numerator / focus_denominator,
        "bending_radius_m",
        "Geometric focus",
    )
    if _near_zero(signed_focus_m):
        _raise_singularity(
            "singular_focus",
            "Geometric focus is zero, so detector magnification is undefined.",
            "asymmetry_angle_deg",
        )

    detector_magnification = _finite_result(
        (signed_focus_m - detector_distance_m) / signed_focus_m,
        "detector_distance_m",
        "Detector magnification",
    )
    if geometry is GeometryType.BRAGG:
        detector_width_signed_m = (
            detector_magnification * footprint_signed_m * math.sin(theta0)
        )
    else:
        laue_projection = math.cos(2.0 * theta0)
        if _near_zero(laue_projection):
            _raise_singularity(
                "singular_laue_projection",
                "Laue detector projection is singular at cos(2 theta) = 0.",
                "energy_kev",
            )
        exit_size_signed_m = (
            math.cos(asymmetry_rad - signed_theta)
            / laue_projection
            * footprint_signed_m
        )
        detector_width_signed_m = detector_magnification * exit_size_signed_m

    detector_width_signed_m = _finite_result(
        detector_width_signed_m,
        "detector_distance_m",
        "Detector beam width",
    )
    detector_width_signed_mm = detector_width_signed_m * 1000.0
    detector_width_scale_m = max(abs(footprint_signed_m), pixel_size_m)
    if _near_zero(detector_width_signed_m, detector_width_scale_m):
        _raise_singularity(
            "singular_detector_beam",
            "Detector is at the geometric focus, where beam width is zero.",
            "detector_distance_m",
        )

    pixels_across_beam_signed = detector_width_signed_m / pixel_size_m
    sampling_signed = _finite_result(
        bent_energy_signed_ev / pixels_across_beam_signed,
        "detector_distance_m",
        "Detector energy sampling",
    )

    # Image orientation follows optical magnification.  The detector-width
    # sign additionally contains the crystal-footprint orientation, so using
    # it here would incorrectly mark the Bragg lower/virtual-focus case as an
    # inverted image.
    image_inverted = detector_magnification < 0.0
    focus_kind = "real" if signed_focus_m > 0.0 else "virtual"

    warnings: List[CalculationIssue] = []
    if effective_angular_signed_rad < 0.0:
        warnings.append(
            _warning(
                "reversed_energy_span",
                "The signed bent-crystal energy span is negative; the display uses its magnitude.",
                "bending_radius_m",
            )
        )
    if image_inverted:
        warnings.append(
            _warning(
                "detector_image_inverted",
                "Detector magnification is negative, indicating an inverted image.",
                "detector_distance_m",
            )
        )
    if focus_kind == "virtual":
        warnings.append(
            _warning(
                "virtual_focus",
                "The geometric focus is negative; a negative value represents virtual focus.",
                "bending_radius_m",
            )
        )

    assumptions = [
        "Incident divergence is the full angular span, not a half-angle.",
        "Energy spans use the linearized dispersion relation deltaE = E * deltaTheta / tan(thetaB).",
        "The source is treated as a point source and distances follow the legacy DXASCalc geometry.",
    ]
    if geometry is GeometryType.BRAGG:
        assumptions.append(
            "Bragg bent-crystal angular span follows the legacy minus formula: divergence - footprint / radius."
        )
    else:
        assumptions.append(
            "Laue bent-crystal angular span follows the legacy plus formula: divergence + footprint / radius; this sign convention has not been experimentally finalized."
        )

    result = CalculationResult(
        d_spacing_angstrom=_finite_result(
            d_spacing, "hkl", "Crystal d-spacing"
        ),
        wavelength_angstrom=_finite_result(
            wavelength, "energy_kev", "X-ray wavelength"
        ),
        bragg_angle_deg=_finite_result(
            math.degrees(theta0), "energy_kev", "Bragg angle"
        ),
        crystal_rotation_deg=_finite_result(
            math.degrees(crystal_rotation),
            "asymmetry_angle_deg",
            "Crystal rotation",
        ),
        incident_beam_width_mm=abs(incident_width_signed),
        crystal_footprint_mm=abs(footprint_signed_mm),
        flat_energy_span_ev=abs(flat_energy_signed_ev),
        bent_energy_span_ev=abs(bent_energy_signed_ev),
        bent_energy_span_signed_ev=bent_energy_signed_ev,
        effective_angular_span_mrad=abs(effective_angular_signed_rad * 1000.0),
        effective_angular_span_signed_mrad=effective_angular_signed_rad * 1000.0,
        geometric_focus_m=signed_focus_m,
        detector_beam_width_mm=abs(detector_width_signed_mm),
        detector_beam_width_signed_mm=detector_width_signed_mm,
        detector_sampling_ev_per_pixel=abs(sampling_signed),
        detector_sampling_signed_ev_per_pixel=sampling_signed,
        image_inverted=image_inverted,
        focus_kind=focus_kind,
        warnings=tuple(warnings),
        assumptions=tuple(assumptions),
    )

    # A final invariant check protects future formula edits from leaking NaN or
    # infinity into JSON, while retaining field-specific checks above.
    for field_name, value in result.to_dict().items():
        if isinstance(value, float) and not math.isfinite(value):
            raise InvalidConfigurationError(
                (
                    _error(
                        "non_finite_result",
                        "%s is not finite for this configuration." % field_name,
                        field_name,
                    ),
                )
            )
    return result
