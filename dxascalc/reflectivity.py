"""Request-safe crystal reflectivity and resolution calculations.

The geometry core remains dependency-free and subprocess-free.  This module is
the optional scientific enrichment boundary used by the web API: it runs XOP's
``diff_pat`` executable in a private temporary directory, parses the sigma/pi
profiles, and numerically convolves the selected crystal response with source
and detector response functions.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from functools import lru_cache
from importlib import metadata as package_metadata
import inspect
import math
from numbers import Real
from pathlib import Path
import platform
import subprocess
import tempfile
import threading
from typing import Callable, Sequence, Tuple

import numpy as np

from .models import (
    CalculationIssue,
    CalculationResult,
    DXASConfig,
    GeometryType,
    Material,
    Polarization,
)


_XOP_TIMEOUT_SECONDS = 15.0
# The default ±500 µrad Bragg scan needs at most 0.1 µrad spacing to resolve
# narrow below-half gaps between multilamellar fringe components. Coarser grids
# can phase-miss those gaps and bias the connected-main-lobe FWHM by several
# percent, especially for Si(220).
_SCAN_POINTS = 10_001
_MAX_SERIALIZED_CURVE_POINTS = 2_501
_MAX_SCAN_HALF_WIDTH_URAD = 20_000.0
_MAX_KERNEL_POINTS = 4_097
_CACHE_SIZE = 32
_SOLVER_CONCURRENCY = threading.BoundedSemaphore(value=2)
_SOLVER_ACQUIRE_TIMEOUT_SECONDS = 2.0
_ENRICHMENT_CONCURRENCY = threading.BoundedSemaphore(value=2)
_ENRICHMENT_ACQUIRE_TIMEOUT_SECONDS = 2.0


class ReflectivityUnavailableError(RuntimeError):
    """Raised when neither the XOP nor flat-crystal fallback can run."""


@dataclass(frozen=True)
class ReflectivitySolution:
    """Immutable, cache-safe crystal response on an energy-offset grid."""

    energy_offset_ev: Tuple[float, ...]
    sigma: Tuple[float, ...]
    pi: Tuple[float, ...]
    selected: Tuple[float, ...]
    model: str
    warning_messages: Tuple[Tuple[str, str], ...] = ()


ReflectivitySolver = Callable[..., ReflectivitySolution]


def _invoke_solver(
    solver: ReflectivitySolver,
    config: DXASConfig,
    bragg_angle_deg: float,
) -> ReflectivitySolution:
    """Support compact one-argument test/adaptor solvers and full solvers."""

    try:
        signature = inspect.signature(solver)
        signature.bind(config, bragg_angle_deg)
    except (TypeError, ValueError):
        return solver(config)
    return solver(config, bragg_angle_deg)


def _finite_float(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise ValueError(f"{label} must be a finite real number")
    converted = float(value)
    if not math.isfinite(converted):
        raise ValueError(f"{label} must be a finite real number")
    return converted


def _package_version(distribution_name: str) -> str:
    try:
        return package_metadata.version(distribution_name)
    except package_metadata.PackageNotFoundError:
        return "unknown"


def interpolated_fwhm(
    x_values: Sequence[float], y_values: Sequence[float]
) -> float:
    """Return the linearly interpolated FWHM of the global-maximum lobe.

    A disconnected secondary lobe is intentionally ignored, even when it also
    crosses half maximum.  This keeps Pendellösung side lobes from inflating the
    intrinsic width.  Curves must be finite, non-negative and sampled on a
    strictly increasing grid with both half-height crossings inside the grid.
    """

    if len(x_values) != len(y_values) or len(x_values) < 3:
        raise ValueError("FWHM requires matching x/y arrays with at least 3 points")

    x = [_finite_float(value, "x") for value in x_values]
    y = [_finite_float(value, "y") for value in y_values]
    if any(right <= left for left, right in zip(x, x[1:])):
        raise ValueError("FWHM x values must be strictly increasing")
    if any(value < 0.0 for value in y):
        raise ValueError("FWHM y values must be non-negative")

    peak = max(y)
    if peak <= 0.0:
        raise ValueError("FWHM curve must have a positive maximum")
    peak_index = max(range(len(y)), key=y.__getitem__)
    half = peak / 2.0

    left_inside = peak_index
    while left_inside > 0 and y[left_inside - 1] >= half:
        left_inside -= 1
    right_inside = peak_index
    while right_inside + 1 < len(y) and y[right_inside + 1] >= half:
        right_inside += 1
    if left_inside == 0 or right_inside == len(y) - 1:
        raise ValueError("FWHM half-height crossings fall outside the sampled grid")

    def crossing(x0: float, y0: float, x1: float, y1: float) -> float:
        if y1 == y0:
            return (x0 + x1) / 2.0
        return x0 + (half - y0) * (x1 - x0) / (y1 - y0)

    left = crossing(
        x[left_inside - 1],
        y[left_inside - 1],
        x[left_inside],
        y[left_inside],
    )
    right = crossing(
        x[right_inside],
        y[right_inside],
        x[right_inside + 1],
        y[right_inside + 1],
    )
    width = right - left
    if not math.isfinite(width) or width <= 0.0:
        raise ValueError("FWHM is not positive and finite")
    return width


def combine_resolution_fwhm(*terms_ev: float) -> float:
    """Return the root-sum-square Gaussian-equivalent FWHM estimate."""

    total = 0.0
    for term in terms_ev:
        value = _finite_float(term, "resolution term")
        if value < 0.0:
            raise ValueError("resolution terms must be non-negative")
        total += value * value
    return math.sqrt(total)


def xop_asymmetry_angle_deg(
    geometry: GeometryType | str, app_asymmetry_angle_deg: float
) -> float:
    """Map the app's symmetry-relative angle to XOP's surface-plane angle.

    XOP defines asymmetry between the Bragg planes and crystal surface, making
    symmetric Bragg 0 degrees and symmetric Laue 90 degrees.  The app uses zero
    as the symmetric setting in both geometries.
    """

    angle = _finite_float(app_asymmetry_angle_deg, "asymmetry angle")
    value = geometry.value if isinstance(geometry, GeometryType) else str(geometry)
    value = value.strip().lower()
    if value == GeometryType.BRAGG.value:
        return angle
    if value == GeometryType.LAUE.value:
        return 90.0 - angle
    raise ValueError("geometry must be 'bragg' or 'laue'")


def source_size_resolution_ev_fwhm(
    config: DXASConfig, bragg_angle_deg: float
) -> float:
    """Convert a Gaussian source-size FWHM to energy FWHM at the crystal."""

    theta = math.radians(_finite_float(bragg_angle_deg, "Bragg angle"))
    tangent = math.tan(theta)
    if tangent == 0.0 or not math.isfinite(tangent):
        raise ValueError("Bragg angle cannot be converted to source resolution")
    source_rad = (
        _finite_float(config.source_size_um, "source size")
        * 1.0e-6
        / _finite_float(config.source_distance_m, "source distance")
    )
    return abs(float(config.energy_kev) * 1000.0 * source_rad / tangent)


def _select_curve(
    sigma: Sequence[float], pi: Sequence[float], polarization: str
) -> Tuple[float, ...]:
    if polarization == Polarization.SIGMA.value:
        return tuple(float(value) for value in sigma)
    if polarization == Polarization.PI.value:
        return tuple(float(value) for value in pi)
    if polarization == Polarization.UNPOLARIZED.value:
        return tuple((float(s) + float(p)) / 2.0 for s, p in zip(sigma, pi))
    raise ValueError("Unknown polarization")


def _scan_half_width_urad(thickness_um: float, radius_m: float) -> float:
    # Across the thickness, meridional bending changes plane orientation by
    # approximately t/R.  Leave broad baseline margins for the Darwin profile.
    curvature_width = abs(float(thickness_um) / float(radius_m))
    requested = max(400.0, 200.0 + 3.0 * curvature_width)
    return min(requested, _MAX_SCAN_HALF_WIDTH_URAD)


def _parse_diff_pat(path: Path) -> Tuple[Tuple[float, ...], Tuple[float, ...], Tuple[float, ...]]:
    angle: list[float] = []
    sigma: list[float] = []
    pi: list[float] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        pieces = stripped.split()
        if len(pieces) < 7:
            continue
        try:
            row = [float(value) for value in pieces[:7]]
        except ValueError:
            continue
        if not all(math.isfinite(value) for value in row):
            continue
        angle.append(row[0])
        # diff_pat columns are p then s.  Tiny negative numerical noise is not
        # a physical negative intensity and is clamped at zero.
        pi.append(max(0.0, row[5]))
        sigma.append(max(0.0, row[6]))
    if len(angle) < 3:
        raise ReflectivityUnavailableError("XOP diff_pat returned no usable profile")
    return tuple(angle), tuple(sigma), tuple(pi)


def _xop_input(
    *,
    geometry_index: int,
    thickness_um: float,
    asymmetry_angle_deg: float,
    energy_ev: float,
    scan_half_width_urad: float,
    radius_m: float,
) -> str:
    # XOP units: thickness/radii in cm, angular scan in microradians.
    values = (
        "xcrystal.bra",
        str(2 if geometry_index == 0 else 3),  # Bragg multilamellar / Laue Penning-Polder
        str(geometry_index),  # 0 Bragg diffraction, 1 Laue diffraction
        f"{thickness_um * 1.0e-4:.12g}",
        f"{asymmetry_angle_deg:.12g}",
        "3",  # angular scan (SCAN=2 in XOPPY's zero-based wrapper)
        f"{energy_ev:.12g}",
        "1",  # microradians
        f"{-scan_half_width_urad:.12g}",
        f"{scan_half_width_urad:.12g}",
        str(_SCAN_POINTS),
        "1000000000",  # effectively flat sagittal radius, cm
        f"{abs(radius_m) * 100.0:.12g}",  # meridional radius, cm
        "0",
        "0",  # isotropic elastic model
        "0.22",  # Poisson ratio used by the legacy calculator
    )
    return "\n".join(values) + "\n"


def _solve_with_xop(
    *,
    material: str,
    h: int,
    k: int,
    l: int,
    energy_ev: float,
    geometry: str,
    asymmetry_angle_deg: float,
    thickness_um: float,
    radius_m: float,
    polarization: str,
    bragg_angle_deg: float,
) -> ReflectivitySolution:
    try:
        import xraylib  # type: ignore[import-not-found]
        from xoppylib.crystals.tools import bragg_calc2  # type: ignore[import-not-found]
        from xoppylib.xoppy_util import locations  # type: ignore[import-not-found]
    except Exception as exc:
        raise ReflectivityUnavailableError(
            "XOPPY/xraylib reflectivity dependencies are unavailable"
        ) from exc

    geometry_index = 0 if geometry == GeometryType.BRAGG.value else 1
    xop_angle = xop_asymmetry_angle_deg(geometry, asymmetry_angle_deg)
    scan_half = _scan_half_width_urad(thickness_um, radius_m)
    executable_name = "diff_pat.exe" if platform.system() == "Windows" else "diff_pat"
    executable = Path(locations.home_bin()) / executable_name
    if not executable.is_file():
        raise ReflectivityUnavailableError(f"XOP executable not found: {executable}")

    with tempfile.TemporaryDirectory(prefix="dxas-reflectivity-") as temporary:
        workdir = Path(temporary)
        preprocessor = workdir / "xcrystal.bra"
        energy_margin = min(100.0, max(10.0, energy_ev * 0.05))
        try:
            bragg_calc2(
                descriptor=material,
                hh=h,
                kk=k,
                ll=l,
                temper=1.0,
                emin=max(1.0, energy_ev - energy_margin),
                emax=energy_ev + energy_margin,
                estep=max(0.2, energy_margin / 100.0),
                ANISO_SEL=0,
                fileout=str(preprocessor),
                material_constants_library=xraylib,
                verbose=False,
            )
            completed = subprocess.run(
                [str(executable)],
                input=_xop_input(
                    geometry_index=geometry_index,
                    thickness_um=thickness_um,
                    asymmetry_angle_deg=xop_angle,
                    energy_ev=energy_ev,
                    scan_half_width_urad=scan_half,
                    radius_m=radius_m,
                ),
                text=True,
                cwd=workdir,
                capture_output=True,
                timeout=_XOP_TIMEOUT_SECONDS,
                check=False,
            )
        except (OSError, subprocess.SubprocessError, ValueError) as exc:
            raise ReflectivityUnavailableError(f"XOP reflectivity run failed: {exc}") from exc
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout).strip()[-500:]
            raise ReflectivityUnavailableError(
                f"XOP diff_pat exited with status {completed.returncode}: {detail}"
            )
        output = workdir / "diff_pat.dat"
        if not output.is_file():
            raise ReflectivityUnavailableError("XOP diff_pat did not create diff_pat.dat")
        angle_urad, sigma_raw, pi_raw = _parse_diff_pat(output)

    tangent = math.tan(math.radians(bragg_angle_deg))
    direction = -1.0 if radius_m >= 0.0 else 1.0
    energy_offset = tuple(
        direction * energy_ev * value * 1.0e-6 / tangent for value in angle_urad
    )
    ordered = sorted(zip(energy_offset, sigma_raw, pi_raw), key=lambda row: row[0])
    x = tuple(row[0] for row in ordered)
    sigma = tuple(row[1] for row in ordered)
    pi = tuple(row[2] for row in ordered)
    selected = _select_curve(sigma, pi, polarization)
    # Validate that the requested scan captures a complete principal lobe.
    interpolated_fwhm(x, selected)

    warning_messages: list[Tuple[str, str]] = []
    if scan_half >= _MAX_SCAN_HALF_WIDTH_URAD:
        warning_messages.append(
            (
                "reflectivity_scan_capped",
                "The adaptive XOP angular scan reached its safety cap; inspect the curve for clipped wings.",
            )
        )
    if max(max(sigma), max(pi)) > 1.05:
        warning_messages.append(
            (
                "reflectivity_above_unity",
                "The bent-crystal approximation produced peak intensity above unity; the curve is reported without renormalization.",
            )
        )
    label = "Bragg multilamellar" if geometry_index == 0 else "Laue Penning-Polder"
    return ReflectivitySolution(
        energy_offset_ev=x,
        sigma=sigma,
        pi=pi,
        selected=selected,
        model=(
            f"XOPPY {_package_version('xoppylib')} / xraylib "
            f"{_package_version('xraylib')} diff_pat bent perfect-crystal "
            f"{label} diffraction"
        ),
        warning_messages=tuple(warning_messages),
    )


def _solve_with_crystalpy(
    *,
    material: str,
    h: int,
    k: int,
    l: int,
    energy_ev: float,
    geometry: str,
    asymmetry_angle_deg: float,
    thickness_um: float,
    radius_m: float,
    polarization: str,
    bragg_angle_deg: float,
    primary_error: Exception,
) -> ReflectivitySolution:
    try:
        from crystalpy.util.calc_xcrystal import (  # type: ignore[import-not-found]
            calc_xcrystal_angular_scan,
        )
    except Exception as exc:
        raise ReflectivityUnavailableError(
            f"XOP failed ({primary_error}); crystalpy fallback is unavailable"
        ) from exc

    scan_half = _scan_half_width_urad(thickness_um, radius_m)
    xop_angle = xop_asymmetry_angle_deg(geometry, asymmetry_angle_deg)
    geometry_index = 0 if geometry == GeometryType.BRAGG.value else 1
    try:
        data, _setup, deviations = calc_xcrystal_angular_scan(
            crystal_name=material,
            miller_h=h,
            miller_k=k,
            miller_l=l,
            thickness=thickness_um * 1.0e-6,
            asymmetry_angle=math.radians(xop_angle),
            geometry_type_index=geometry_index,
            energy=energy_ev,
            angle_deviation_min=-scan_half * 1.0e-6,
            angle_deviation_max=scan_half * 1.0e-6,
            angle_deviation_points=_SCAN_POINTS,
            calculation_strategy_flag=1,
        )
        sigma_raw = tuple(max(0.0, float(v)) for v in data["intensityS"])
        pi_raw = tuple(max(0.0, float(v)) for v in data["intensityP"])
        tangent = math.tan(math.radians(bragg_angle_deg))
        direction = -1.0 if radius_m >= 0.0 else 1.0
        energy_offset = tuple(
            direction * energy_ev * float(value) / tangent for value in deviations
        )
        ordered = sorted(zip(energy_offset, sigma_raw, pi_raw), key=lambda row: row[0])
        x = tuple(row[0] for row in ordered)
        sigma = tuple(row[1] for row in ordered)
        pi = tuple(row[2] for row in ordered)
        selected = _select_curve(sigma, pi, polarization)
        interpolated_fwhm(x, selected)
    except Exception as exc:
        raise ReflectivityUnavailableError(
            f"XOP failed ({primary_error}); crystalpy fallback failed ({exc})"
        ) from exc
    label = "Bragg" if geometry_index == 0 else "Laue"
    return ReflectivitySolution(
        energy_offset_ev=x,
        sigma=sigma,
        pi=pi,
        selected=selected,
        model=(
            f"crystalpy {_package_version('crystalpy')} / xraylib "
            f"{_package_version('xraylib')} flat perfect-crystal {label} fallback"
        ),
        warning_messages=(
            (
                "flat_crystal_reflectivity_fallback",
                "XOP bent-crystal calculation failed; this fallback curve is flat-crystal dynamical diffraction and omits bending-strain broadening.",
            ),
        ),
    )


@lru_cache(maxsize=_CACHE_SIZE)
def _solve_cached(
    material: str,
    h: int,
    k: int,
    l: int,
    energy_ev: float,
    geometry: str,
    asymmetry_angle_deg: float,
    thickness_um: float,
    radius_m: float,
    polarization: str,
    bragg_angle_deg: float,
) -> ReflectivitySolution:
    arguments = dict(
        material=material,
        h=h,
        k=k,
        l=l,
        energy_ev=energy_ev,
        geometry=geometry,
        asymmetry_angle_deg=asymmetry_angle_deg,
        thickness_um=thickness_um,
        radius_m=radius_m,
        polarization=polarization,
        bragg_angle_deg=bragg_angle_deg,
    )
    acquired = _SOLVER_CONCURRENCY.acquire(
        timeout=_SOLVER_ACQUIRE_TIMEOUT_SECONDS
    )
    if not acquired:
        raise ReflectivityUnavailableError(
            "The reflectivity solver is busy; retry this configuration shortly."
        )
    try:
        try:
            return _solve_with_xop(**arguments)
        except Exception as primary_error:
            return _solve_with_crystalpy(primary_error=primary_error, **arguments)
    finally:
        _SOLVER_CONCURRENCY.release()


def solve_crystal_reflectivity(
    config: DXASConfig, bragg_angle_deg: float
) -> ReflectivitySolution:
    """Calculate and cache the selected bent-crystal reflectivity response."""

    material = config.material.value if isinstance(config.material, Material) else str(config.material)
    geometry = config.geometry.value if isinstance(config.geometry, GeometryType) else str(config.geometry).lower()
    polarization = (
        config.polarization.value
        if isinstance(config.polarization, Polarization)
        else str(config.polarization).lower()
    )
    return _solve_cached(
        material,
        int(config.h),
        int(config.k),
        int(config.l),
        float(config.energy_kev) * 1000.0,
        geometry,
        float(config.asymmetry_angle_deg),
        float(config.crystal_thickness_um),
        float(config.bending_radius_m),
        polarization,
        float(bragg_angle_deg),
    )


def _trapezoid_integral(x: Sequence[float], y: Sequence[float]) -> float:
    return sum(
        (x1 - x0) * (y0 + y1) / 2.0
        for x0, x1, y0, y1 in zip(x, x[1:], y, y[1:])
    )


def _serialized_curve(solution: ReflectivitySolution) -> dict[str, object]:
    """Return a bounded plotting payload without changing scientific metrics.

    The solver's full-resolution arrays continue to drive FWHM, integration,
    and convolution. Plotly only needs a representative profile, and bounding
    this JSON payload keeps interactive rendering responsive.
    """

    source_points = len(solution.energy_offset_ev)
    if source_points <= _MAX_SERIALIZED_CURVE_POINTS:
        indices = tuple(range(source_points))
    else:
        final_index = source_points - 1
        final_display_index = _MAX_SERIALIZED_CURVE_POINTS - 1
        indices = tuple(
            round(display_index * final_index / final_display_index)
            for display_index in range(_MAX_SERIALIZED_CURVE_POINTS)
        )

    return {
        "x_axis": "energy_offset_ev",
        "x": [solution.energy_offset_ev[index] for index in indices],
        "sigma": [solution.sigma[index] for index in indices],
        "pi": [solution.pi[index] for index in indices],
        "selected": [solution.selected[index] for index in indices],
        "display_points": len(indices),
        "source_points": source_points,
    }


def _convolve_same(values: Sequence[float], kernel: Sequence[float]) -> Tuple[float, ...]:
    """Return the legacy zero-padded same correlation using FFT convolution."""

    if len(values) == 0 or len(kernel) == 0:
        raise ValueError("convolution requires non-empty values and kernel")
    value_array = np.asarray(values, dtype=np.float64)
    # The legacy loop is a correlation. Reversing the kernel maps it exactly to
    # a linear convolution, including for a future non-symmetric response.
    kernel_array = np.asarray(tuple(reversed(kernel)), dtype=np.float64)
    full_length = value_array.size + kernel_array.size - 1
    fft_length = 1 << (full_length - 1).bit_length()
    full = np.fft.irfft(
        np.fft.rfft(value_array, fft_length)
        * np.fft.rfft(kernel_array, fft_length),
        fft_length,
    )[:full_length]
    center = len(kernel) // 2
    start = len(kernel) - 1 - center
    output = full[start : start + len(values)]
    # Inputs are non-negative physical response functions. FFT roundoff can
    # create tiny negative tails that must not invalidate the FWHM contract.
    output = np.maximum(output, 0.0)
    return tuple(float(value) for value in output)


def _gaussian_kernel(dx: float, fwhm: float) -> Tuple[float, ...]:
    if fwhm <= 0.0:
        return (1.0,)
    sigma = fwhm / (2.0 * math.sqrt(2.0 * math.log(2.0)))
    half_points = max(1, int(math.ceil(4.5 * sigma / dx)))
    if 2 * half_points + 1 > _MAX_KERNEL_POINTS:
        raise ValueError(
            "Source response is too broad for the current reflectivity grid; reduce source size or use a longer source distance."
        )
    values = [
        math.exp(-0.5 * ((offset * dx) / sigma) ** 2)
        for offset in range(-half_points, half_points + 1)
    ]
    normalization = sum(values)
    return tuple(value / normalization for value in values)


def _top_hat_kernel(dx: float, width: float) -> Tuple[float, ...]:
    if width <= 0.0:
        return (1.0,)
    half_points = max(1, int(math.ceil((width / 2.0 + dx / 2.0) / dx)))
    if 2 * half_points + 1 > _MAX_KERNEL_POINTS:
        raise ValueError(
            "Detector response is too broad for the current reflectivity grid; adjust detector geometry or pixel size."
        )
    weights: list[float] = []
    for offset in range(-half_points, half_points + 1):
        bin_left = offset * dx - dx / 2.0
        bin_right = offset * dx + dx / 2.0
        overlap = max(0.0, min(bin_right, width / 2.0) - max(bin_left, -width / 2.0))
        weights.append(overlap / dx)
    normalization = sum(weights)
    if normalization <= 0.0:
        return (1.0,)
    return tuple(value / normalization for value in weights)


def _enrich_with_intrinsic_resolution_unbounded(
    config: DXASConfig,
    result: CalculationResult,
    solver: ReflectivitySolver = solve_crystal_reflectivity,
) -> CalculationResult:
    """Add crystal/source/total resolution to an already valid core result.

    Solver failure is non-fatal: geometry results remain available and carry a
    structured warning explaining why resolution could not be calculated.
    """

    try:
        solution = _invoke_solver(solver, config, result.bragg_angle_deg)
    except Exception as exc:
        issue = CalculationIssue(
            level="warning",
            code="reflectivity_unavailable",
            message=f"Crystal reflectivity could not be calculated: {exc}",
            field=None,
        )
        return replace(
            result,
            reflectivity_model="unavailable",
            warnings=result.warnings + (issue,),
            assumptions=result.assumptions
            + ("Total resolution is unavailable when no crystal response can be calculated.",),
        )

    x = solution.energy_offset_ev
    selected = solution.selected
    curve = _serialized_curve(solution)
    warnings = list(result.warnings)
    for code, message in solution.warning_messages:
        warnings.append(CalculationIssue("warning", code, message, None))
    geometry_value = (
        config.geometry.value
        if isinstance(config.geometry, GeometryType)
        else str(config.geometry).lower()
    )
    if geometry_value == GeometryType.LAUE.value:
        warnings.append(
            CalculationIssue(
                level="warning",
                code="laue_borrmann_spatial_broadening_not_modeled",
                message=(
                    "The Laue crystal diffraction profile includes thickness effects, "
                    "but a separate detector-space Borrmann-fan broadening term is not modeled."
                ),
                field="crystal_thickness_um",
            )
        )
    try:
        intrinsic_ev = interpolated_fwhm(x, selected)
        theta = math.radians(result.bragg_angle_deg)
        intrinsic_urad = (
            intrinsic_ev
            * math.tan(theta)
            / (float(config.energy_kev) * 1000.0)
            * 1.0e6
        )
        source_ev = source_size_resolution_ev_fwhm(config, result.bragg_angle_deg)
        dx_values = [right - left for left, right in zip(x, x[1:])]
        dx = sum(dx_values) / len(dx_values)
        reflectivity_peak = max(selected)
        reflectivity_integrated = _trapezoid_integral(x, selected)
    except Exception as exc:
        issue = CalculationIssue(
            level="warning",
            code="intrinsic_resolution_failed",
            message=f"The reflectivity curve could not define an intrinsic FWHM: {exc}",
            field=None,
        )
        return replace(
            result,
            reflectivity_curve=curve,
            reflectivity_model=solution.model,
            warnings=tuple(warnings) + (issue,),
        )

    try:
        gaussian_kernel = _gaussian_kernel(dx, source_ev)
        detector_kernel = _top_hat_kernel(dx, result.detector_sampling_ev_per_pixel)
        # Convolution broadens beyond the reflectivity scan.  Explicit zero
        # padding prevents valid broad responses from losing half-height
        # crossings at the original XOP grid boundaries.
        padding = len(gaussian_kernel) // 2 + len(detector_kernel) // 2 + 4
        padded_selected = (0.0,) * padding + tuple(selected) + (0.0,) * padding
        total_x = (
            tuple(x[0] - dx * offset for offset in range(padding, 0, -1))
            + tuple(x)
            + tuple(x[-1] + dx * offset for offset in range(1, padding + 1))
        )
        source_broadened = _convolve_same(padded_selected, gaussian_kernel)
        total_response = _convolve_same(source_broadened, detector_kernel)
        total_ev = interpolated_fwhm(total_x, total_response)
    except Exception as exc:
        warnings.append(
            CalculationIssue(
                level="warning",
                code="resolution_enrichment_failed",
                message=f"Crystal response was calculated, but resolution broadening failed safely: {exc}",
                field=None,
            )
        )
        return replace(
            result,
            source_size_resolution_ev_fwhm=source_ev,
            crystal_intrinsic_resolution_ev_fwhm=intrinsic_ev,
            crystal_intrinsic_width_urad_fwhm=intrinsic_urad,
            reflectivity_curve=curve,
            reflectivity_peak=reflectivity_peak,
            reflectivity_integrated=reflectivity_integrated,
            reflectivity_model=solution.model,
            warnings=tuple(warnings),
            assumptions=result.assumptions
            + ("Total resolution is unavailable because response convolution could not be completed.",),
        )

    return replace(
        result,
        source_size_resolution_ev_fwhm=source_ev,
        crystal_intrinsic_resolution_ev_fwhm=intrinsic_ev,
        crystal_intrinsic_width_urad_fwhm=intrinsic_urad,
        total_resolution_ev_fwhm=total_ev,
        total_resolution_method=(
            "numerical convolution: crystal response * Gaussian source FWHM * one-pixel detector top-hat"
        ),
        reflectivity_curve=curve,
        reflectivity_peak=reflectivity_peak,
        reflectivity_integrated=reflectivity_integrated,
        reflectivity_model=solution.model,
        warnings=tuple(warnings),
        assumptions=result.assumptions
        + (
            "XOP asymmetry is measured between Bragg planes and crystal surface: symmetric Bragg maps to 0 degrees and symmetric Laue to 90 degrees; the crystal cut is independent of the upper/lower diffraction branch.",
            "The XOP bent-crystal run uses the meridional radius magnitude, an effectively flat sagittal radius, isotropic elasticity, and Poisson ratio 0.22; radius sign mirrors the energy axis.",
            "Source size is a Gaussian spatial FWHM whose angular width is source_size / source_distance.",
            "Detector response is a one-pixel top-hat with width detector_sampling_ev_per_pixel.",
            "Reflectivity integrated intensity is reported over energy offset and therefore has eV units.",
        ),
    )


def enrich_with_intrinsic_resolution(
    config: DXASConfig,
    result: CalculationResult,
    solver: ReflectivitySolver = solve_crystal_reflectivity,
) -> CalculationResult:
    """Enrich geometry while bounding the full solver-and-convolution path."""

    acquired = _ENRICHMENT_CONCURRENCY.acquire(
        timeout=_ENRICHMENT_ACQUIRE_TIMEOUT_SECONDS
    )
    if not acquired:
        issue = CalculationIssue(
            level="warning",
            code="resolution_enrichment_busy",
            message="The crystal-resolution service is busy; retry this configuration shortly.",
            field=None,
        )
        return replace(
            result,
            reflectivity_model="unavailable",
            warnings=result.warnings + (issue,),
            assumptions=result.assumptions
            + ("Total resolution is temporarily unavailable while the bounded enrichment workers are busy.",),
        )
    try:
        return _enrich_with_intrinsic_resolution_unbounded(config, result, solver)
    finally:
        _ENRICHMENT_CONCURRENCY.release()


__all__ = [
    "ReflectivitySolution",
    "ReflectivityUnavailableError",
    "combine_resolution_fwhm",
    "enrich_with_intrinsic_resolution",
    "interpolated_fwhm",
    "solve_crystal_reflectivity",
    "source_size_resolution_ev_fwhm",
    "xop_asymmetry_angle_deg",
]
