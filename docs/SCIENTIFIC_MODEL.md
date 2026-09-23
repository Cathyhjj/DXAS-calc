# DXASCalc scientific model contract

This document records the behavior that the refactored calculator preserves and
the assumptions that the user interface must communicate. It is deliberately
separate from presentation code so scientific decisions can be reviewed without
changing the web application.

## Units

The desktop web interface accepts photon energy in eV. The JSON API and v1
saved configuration files retain `energy_kev` in keV; conversion happens at the
interface boundary. Other public inputs use the units below:

| Quantity | Public unit | Internal unit |
| --- | --- | --- |
| Photon energy | eV in web UI; keV in API and saved files | keV |
| Source and detector distances | m | m |
| Full angular divergence | mrad | rad |
| Bending radius | m | m |
| Asymmetry angle | degree | rad |
| Detector pixel size | µm | m |
| Source-size FWHM | µm | m/rad contribution |
| Crystal thickness | µm | cm for XOP |

Results include the unit in each field name. Width-like display values are
non-negative magnitudes. A second `*_signed_*` field preserves the orientation
or dispersion sign used by the legacy equations.

## Bending-radius sign

The sign of the bending radius is part of the model and must not be discarded:

- positive and negative radii describe opposite curvature orientations;
- zero is invalid;
- the UI must accept both signs and explain the selected convention;
- a negative signed span or beam width is not rendered as a negative physical
  size. It is exposed separately as an orientation signal.

The previous Streamlit form rejected negative radii even though the original
Notebook calculator used them. That regression is intentionally removed.

## Focus and image orientation

`geometric_focus_m` is signed. A positive focus is on the outgoing-beam side;
a negative value describes a virtual focus. If a positive detector distance is
beyond a positive focus, the signed image scale changes sign and the result is
marked `image_inverted=true`. The UI should describe this state in words rather
than presenting a negative beam size as an error.

## Resolution terminology

`detector_sampling_ev_per_pixel` is the energy interval sampled by one pixel;
it is not itself the total instrument energy resolution. The web API enriches
the pure geometry result with a crystal reflectivity profile, a Gaussian
source-size contribution, and a one-pixel detector top-hat. The reported
`total_resolution_ev_fwhm` is the interpolated FWHM after numerical convolution
of those three response functions.

The total remains a model estimate, not a measured line-spread function. The
Laue result warns that a separate detector-space Borrmann-fan broadening term
is not included.

If an enrichment term overflows or cannot be computed, the API preserves valid
geometry and crystal metrics, returns `null` for unavailable resolution terms,
and includes a specific warning. It does not substitute zero or infer a total
from the remaining terms. Responses are encoded as strict JSON without
non-finite numeric literals.

## Legacy compatibility and unresolved assumptions

The refactored Bragg and Laue geometry formulas preserve the numerical behavior
already migrated into `dxas_core.py`. This is a compatibility baseline, not an
experimental validation claim.

In particular, the Laue bent-span equation currently uses

```text
effective divergence = divergence + footprint / bending radius
```

because that is the executable legacy behavior. A nearby legacy comment says it
may need a minus sign. This convention remains explicit in every Laue result's
assumptions until it is resolved against trusted experimental or literature
reference cases.

## Validation boundary

The calculation layer rejects configurations before evaluating formulas when:

- all Miller indices are zero;
- a Si or Ge reflection is systematically absent in the diamond-cubic lattice
  (indices must be all odd, or all even with a sum divisible by four);
- the requested energy cannot satisfy Bragg's law for the selected plane;
- a distance, pixel size, or crystal thickness is non-positive;
- source size is negative, or polarization is not sigma, pi, or unpolarized;
- the full divergence is not in the non-periodic geometric domain between zero
  and pi radians;
- the bending radius is zero;
- the crystal footprint, focus, or detector-sampling equation approaches a
  singularity.

Validation errors are structured (`field`, `code`, `message`) so the web app can
place each message beside the control that needs attention.

## Crystal reflectivity and intrinsic-width workflow

The enabled adapter maps material, reflection, energy, geometry, asymmetry,
thickness, meridional radius, and polarization into XOPPY `diff_pat`. Every run
uses a private temporary directory, an argument-list subprocess with a timeout,
bounded solver and full-enrichment concurrency with a finite queue wait, and a
32-entry cache keyed by scientific inputs. Bragg uses XOP's multilamellar
bent-crystal model; Laue uses its Penning–Polder model.
In XOP's convention,
symmetric Bragg maps to a 0° plane/surface angle and symmetric Laue maps to 90°.
The physical crystal cut is independent of the selected upper/lower diffraction
branch.

The current elasticity mapping retains the legacy isotropic Poisson ratio 0.22,
an effectively flat sagittal radius, and the meridional radius magnitude. The
application's radius sign mirrors the energy-offset axis. If `diff_pat` cannot
run, crystalpy provides an explicitly labeled flat-perfect-crystal fallback;
that fallback does not claim bending-strain broadening.

The reported intrinsic width uses linearly interpolated half-height crossings
around the connected lobe containing the global maximum. This avoids including
disconnected Pendellösung side lobes in the main-peak FWHM. The sigma and pi
curves, selected-polarization curve, peak, and energy-integrated reflectivity
are returned with the result so the modeled response is inspectable.

Production scans use 10001 angular samples, giving 0.1 microradian spacing for
the default Bragg range. Fine-grid regression references must agree within 1%;
this prevents narrow gaps between multilamellar fringe components—especially
for Si(220)—from being phase-missed and inflating the connected-main-lobe FWHM.
All scalar metrics and response convolutions use these full-resolution arrays.
The JSON plotting curve is evenly sampled to at most 2501 points for responsive
Plotly interaction and reports both its displayed and source sample counts.
Source and pixel response functions are applied as zero-padded linear
convolutions using NumPy FFTs, avoiding input-dependent quadratic Python loops.

Production pins XOPPY 1.0.53, xraylib 4.2.0, crystalpy 0.0.25, and six 1.17.0.
The response model string also records the solver versions used at runtime. Reference fixtures
cover Si(111), Si(220), and Si(311) in Bragg and Laue geometries. The scientific
basis and model boundary follow the
[official XOP crystal guidance](https://ftp.esrf.fr/scisoft/xop2.3/doc/WebHelp/functions/x_ray_optics.htm),
the [ID24 energy-resolution treatment](https://journals.iucr.org/s/issues/2016/01/00/ie5146/),
and the response-convolution method described by
[Huang et al.](https://www.nature.com/articles/s41598-020-65225-4).
