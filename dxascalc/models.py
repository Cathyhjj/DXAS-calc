"""Typed, serializable domain models for DXAS calculations.

This module intentionally depends only on the Python standard library so the
calculation core can be reused by a web API, a command-line application, or a
notebook without pulling in a UI or numerical-computing stack.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Mapping, Optional, Tuple, Type, TypeVar


class GeometryType(str, Enum):
    """Supported diffraction geometries."""

    BRAGG = "bragg"
    LAUE = "laue"


class Material(str, Enum):
    """Crystal materials with lattice constants supported by the core."""

    SI = "Si"
    GE = "Ge"


class Condition(str, Enum):
    """Legacy upper/lower asymmetric-cut convention."""

    UPPER = "upper"
    LOWER = "lower"


class Polarization(str, Enum):
    """Incident polarization used to select the reported crystal response."""

    SIGMA = "sigma"
    PI = "pi"
    UNPOLARIZED = "unpolarized"


EnumT = TypeVar("EnumT", bound=Enum)


def _enum_if_known(enum_type: Type[EnumT], value: Any) -> Any:
    """Coerce friendly enum strings while leaving invalid input inspectable.

    ``calculate`` owns structured validation.  Keeping an unrecognized value
    here lets it return a ``CalculationIssue`` instead of leaking an enum
    constructor exception from an HTTP form boundary.
    """

    if isinstance(value, enum_type):
        return value
    if isinstance(value, str):
        normalized = value.strip()
        for member in enum_type:
            if normalized.lower() in (member.name.lower(), str(member.value).lower()):
                return member
    return value


def _int_if_possible(value: Any) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            parsed = float(value.strip())
        except (ValueError, OverflowError):
            return value
        if parsed.is_integer():
            return int(parsed)
    return value


def _float_if_possible(value: Any) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        try:
            return float(value)
        except OverflowError:
            return value
    if isinstance(value, str):
        try:
            return float(value.strip())
        except (ValueError, OverflowError):
            return value
    return value


@dataclass(frozen=True)
class DXASConfig:
    """Complete user input for one deterministic DXAS calculation.

    The defaults represent the safe, historically used Bragg/Si(111)
    starting point in the refactored application.  A negative bending radius
    is valid and carries physical orientation information; zero is rejected
    by :func:`dxascalc.calculate`.
    """

    geometry: GeometryType = GeometryType.BRAGG
    material: Material = Material.SI
    h: int = 1
    k: int = 1
    l: int = 1
    energy_kev: float = 8.0
    source_distance_m: float = 1.2
    divergence_mrad: float = 1.2
    bending_radius_m: float = -2.0
    asymmetry_angle_deg: float = 0.0
    condition: Condition = Condition.UPPER
    detector_distance_m: float = 1.5
    pixel_size_um: float = 55.0
    source_size_um: float = 1.5
    crystal_thickness_um: float = 200.0
    polarization: Polarization = Polarization.UNPOLARIZED

    @classmethod
    def from_mapping(cls, mapping: Mapping[str, Any]) -> "DXASConfig":
        """Build a config from JSON/form-like values.

        Missing fields use the dataclass defaults, enum names and values are
        accepted case-insensitively, and numeric strings are converted when
        unambiguous.  Unknown keys are rejected to surface spelling mistakes.
        Values that cannot be converted remain intact so ``calculate`` can
        report them as structured validation issues.
        """

        if not isinstance(mapping, Mapping):
            raise TypeError("DXASConfig.from_mapping expects a mapping")

        known_fields = {
            "geometry",
            "material",
            "h",
            "k",
            "l",
            "energy_kev",
            "source_distance_m",
            "divergence_mrad",
            "bending_radius_m",
            "asymmetry_angle_deg",
            "condition",
            "detector_distance_m",
            "pixel_size_um",
            "source_size_um",
            "crystal_thickness_um",
            "polarization",
        }
        unknown = sorted(set(mapping) - known_fields)
        if unknown:
            raise TypeError("Unknown DXASConfig field(s): " + ", ".join(unknown))

        values: Dict[str, Any] = cls().to_dict()
        values.update(mapping)

        values["geometry"] = _enum_if_known(GeometryType, values["geometry"])
        values["material"] = _enum_if_known(Material, values["material"])
        values["condition"] = _enum_if_known(Condition, values["condition"])
        values["polarization"] = _enum_if_known(
            Polarization, values["polarization"]
        )

        for name in ("h", "k", "l"):
            values[name] = _int_if_possible(values[name])
        for name in (
            "energy_kev",
            "source_distance_m",
            "divergence_mrad",
            "bending_radius_m",
            "asymmetry_angle_deg",
            "detector_distance_m",
            "pixel_size_um",
            "source_size_um",
            "crystal_thickness_um",
        ):
            values[name] = _float_if_possible(values[name])

        return cls(**values)

    def to_dict(self) -> Dict[str, Any]:
        """Return a JSON-safe representation using enum values."""

        return {
            "geometry": self.geometry.value
            if isinstance(self.geometry, GeometryType)
            else self.geometry,
            "material": self.material.value
            if isinstance(self.material, Material)
            else self.material,
            "h": self.h,
            "k": self.k,
            "l": self.l,
            "energy_kev": self.energy_kev,
            "source_distance_m": self.source_distance_m,
            "divergence_mrad": self.divergence_mrad,
            "bending_radius_m": self.bending_radius_m,
            "asymmetry_angle_deg": self.asymmetry_angle_deg,
            "condition": self.condition.value
            if isinstance(self.condition, Condition)
            else self.condition,
            "detector_distance_m": self.detector_distance_m,
            "pixel_size_um": self.pixel_size_um,
            "source_size_um": self.source_size_um,
            "crystal_thickness_um": self.crystal_thickness_um,
            "polarization": self.polarization.value
            if isinstance(self.polarization, Polarization)
            else self.polarization,
        }


@dataclass(frozen=True)
class CalculationIssue:
    """One machine-readable validation issue or non-fatal warning."""

    level: str
    code: str
    message: str
    field: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "level": self.level,
            "code": self.code,
            "message": self.message,
            "field": self.field,
        }


@dataclass(frozen=True)
class CalculationResult:
    """Serializable scientific outputs for one valid configuration.

    Quantities with explicit ``*_signed_*`` companions are non-negative display
    magnitudes.  ``geometric_focus_m`` retains the legacy signed distance;
    ``focus_kind`` provides the corresponding real/virtual label.
    """

    d_spacing_angstrom: float
    wavelength_angstrom: float
    bragg_angle_deg: float
    crystal_rotation_deg: float
    incident_beam_width_mm: float
    crystal_footprint_mm: float
    flat_energy_span_ev: float
    bent_energy_span_ev: float
    bent_energy_span_signed_ev: float
    effective_angular_span_mrad: float
    effective_angular_span_signed_mrad: float
    geometric_focus_m: float
    detector_beam_width_mm: float
    detector_beam_width_signed_mm: float
    detector_sampling_ev_per_pixel: float
    detector_sampling_signed_ev_per_pixel: float
    image_inverted: bool
    focus_kind: str
    source_size_resolution_ev_fwhm: Optional[float] = None
    crystal_intrinsic_resolution_ev_fwhm: Optional[float] = None
    crystal_intrinsic_width_urad_fwhm: Optional[float] = None
    total_resolution_ev_fwhm: Optional[float] = None
    total_resolution_method: Optional[str] = None
    reflectivity_curve: Optional[Dict[str, Any]] = None
    reflectivity_peak: Optional[float] = None
    reflectivity_integrated: Optional[float] = None
    reflectivity_model: Optional[str] = None
    warnings: Tuple[CalculationIssue, ...] = field(default_factory=tuple)
    assumptions: Tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> Dict[str, Any]:
        """Return a JSON-safe result without dataclass/enum internals."""

        return {
            "d_spacing_angstrom": self.d_spacing_angstrom,
            "wavelength_angstrom": self.wavelength_angstrom,
            "bragg_angle_deg": self.bragg_angle_deg,
            "crystal_rotation_deg": self.crystal_rotation_deg,
            "incident_beam_width_mm": self.incident_beam_width_mm,
            "crystal_footprint_mm": self.crystal_footprint_mm,
            "flat_energy_span_ev": self.flat_energy_span_ev,
            "bent_energy_span_ev": self.bent_energy_span_ev,
            "bent_energy_span_signed_ev": self.bent_energy_span_signed_ev,
            "effective_angular_span_mrad": self.effective_angular_span_mrad,
            "effective_angular_span_signed_mrad": self.effective_angular_span_signed_mrad,
            "geometric_focus_m": self.geometric_focus_m,
            "detector_beam_width_mm": self.detector_beam_width_mm,
            "detector_beam_width_signed_mm": self.detector_beam_width_signed_mm,
            "detector_sampling_ev_per_pixel": self.detector_sampling_ev_per_pixel,
            "detector_sampling_signed_ev_per_pixel": self.detector_sampling_signed_ev_per_pixel,
            "image_inverted": self.image_inverted,
            "focus_kind": self.focus_kind,
            "source_size_resolution_ev_fwhm": self.source_size_resolution_ev_fwhm,
            "crystal_intrinsic_resolution_ev_fwhm": self.crystal_intrinsic_resolution_ev_fwhm,
            "crystal_intrinsic_width_urad_fwhm": self.crystal_intrinsic_width_urad_fwhm,
            "total_resolution_ev_fwhm": self.total_resolution_ev_fwhm,
            "total_resolution_method": self.total_resolution_method,
            "reflectivity_curve": self.reflectivity_curve,
            "reflectivity_peak": self.reflectivity_peak,
            "reflectivity_integrated": self.reflectivity_integrated,
            "reflectivity_model": self.reflectivity_model,
            "warnings": [warning.to_dict() for warning in self.warnings],
            "assumptions": list(self.assumptions),
        }
