"""Core DXAS calculation models for web applications."""

from __future__ import annotations

from dataclasses import dataclass
import math


ANGSTROM_KEV = 12.3984428


@dataclass
class CrystalBase:
    energy_kev: float
    h: int
    k: int
    l: int
    p_m: float
    divergence_rad: float
    r_m: float
    crystal: str = "Si"

    @property
    def lattice_constant(self) -> float:
        if self.crystal == "Si":
            return 5.431
        if self.crystal == "Ge":
            return 5.65
        raise ValueError("Unsupported crystal. Use Si or Ge.")

    @property
    def d_spacing(self) -> float:
        return self.lattice_constant / math.sqrt(self.h**2 + self.k**2 + self.l**2)

    @property
    def wavelength_angstrom(self) -> float:
        return ANGSTROM_KEV / self.energy_kev

    @property
    def theta0(self) -> float:
        return math.asin(self.wavelength_angstrom / (2.0 * self.d_spacing))

    @property
    def beam_size_mm(self) -> float:
        return 2.0 * self.p_m * 1000.0 * math.tan(self.divergence_rad / 2.0)

    @property
    def energy_spread_flat_ev(self) -> float:
        spread_kev = self.energy_kev * self.divergence_rad / math.tan(self.theta0)
        return spread_kev * 1000.0

    def energy_from_delta_theta_ev(self, delta_theta: float) -> float:
        return delta_theta * self.energy_kev / math.tan(self.theta0) * 1000.0


@dataclass
class BraggCrystal(CrystalBase):
    asymmetry_rad: float = 0.0
    condition: str = "upper"

    @property
    def crystal_rotation(self) -> float:
        sign = 1.0 if self.condition == "upper" else -1.0
        return self.asymmetry_rad + sign * self.theta0

    @property
    def footprint_mm(self) -> float:
        return self.beam_size_mm / math.sin(self.crystal_rotation)

    @property
    def energy_spread_bent_ev(self) -> float:
        delta_bent = self.footprint_mm / 1000.0 / self.r_m
        delta_theta = self.divergence_rad - delta_bent
        return self.energy_from_delta_theta_ev(delta_theta)

    @property
    def geometric_focus_m(self) -> float:
        theta = self.theta0 if self.condition == "upper" else -self.theta0
        numerator = math.sin(theta - self.asymmetry_rad)
        denominator = 2.0 / self.r_m - math.sin(theta + self.asymmetry_rad) / self.p_m
        return numerator / denominator

    def bragg_size_mm(self, det2crys_m: float) -> float:
        size_m = (
            (self.geometric_focus_m - det2crys_m)
            / self.geometric_focus_m
            * self.footprint_mm
            / 1000.0
            * math.sin(self.theta0)
        )
        return size_m * 1000.0

    def detector_resolution_ev_per_px(self, det2crys_m: float, pixel_um: float = 55.0) -> float:
        bragg_size_m = self.bragg_size_mm(det2crys_m) / 1000.0
        return self.energy_spread_bent_ev / (bragg_size_m / (pixel_um / 1e6))


@dataclass
class LaueCrystal(CrystalBase):
    asymmetry_rad: float = 0.0
    condition: str = "lower"
    poisson_ratio: float = 0.22

    @property
    def crystal_rotation(self) -> float:
        if self.condition == "upper":
            return 0.5 * math.pi - (self.asymmetry_rad + self.theta0)
        return 0.5 * math.pi - (self.asymmetry_rad - self.theta0)

    @property
    def footprint_mm(self) -> float:
        return self.beam_size_mm / math.sin(self.crystal_rotation)

    @property
    def energy_spread_bent_ev(self) -> float:
        delta_bent = self.footprint_mm / 1000.0 / self.r_m
        delta_theta = self.divergence_rad + delta_bent
        return self.energy_from_delta_theta_ev(delta_theta)

    @property
    def geometric_focus_m(self) -> float:
        theta = self.theta0 if self.condition == "upper" else -self.theta0
        numerator = math.cos(self.asymmetry_rad - theta)
        denominator = 2.0 / self.r_m + math.cos(self.asymmetry_rad + theta) / self.p_m
        return numerator / denominator

    def laue_size_mm(self, det2crys_m: float) -> float:
        theta = self.theta0 if self.condition == "upper" else -self.theta0
        exit_size_vertical = (math.cos(self.asymmetry_rad - theta) / math.cos(2.0 * theta)) * self.footprint_mm / 1000.0
        size_m = (self.geometric_focus_m - det2crys_m) / self.geometric_focus_m * exit_size_vertical
        return size_m * 1000.0

    def detector_resolution_ev_per_px(self, det2crys_m: float, pixel_um: float = 55.0) -> float:
        laue_size_m = self.laue_size_mm(det2crys_m) / 1000.0
        return self.energy_spread_bent_ev / (laue_size_m / (pixel_um / 1e6))
