# DXASCalc scientific model contract

This document records the behavior that the refactored calculator preserves and
the assumptions that the user interface must communicate. It is deliberately
separate from presentation code so scientific decisions can be reviewed without
changing the web application.

## Units

Public inputs use units that beamline users commonly enter:

| Quantity | Public unit | Internal unit |
| --- | --- | --- |
| Photon energy | keV | keV |
| Source and detector distances | m | m |
| Full angular divergence | mrad | rad |
| Bending radius | m | m |
| Asymmetry angle | degree | rad |
| Detector pixel size | µm | m |

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

`detector_sampling_ev_per_pixel` is the energy interval sampled by one pixel.
It is **not** the total instrument energy resolution. Total resolution also
requires validated contributions from source size and crystal intrinsic width.
Until those adapters are reviewed and enabled, the UI must label detector
sampling precisely and must not claim an overall FWHM resolution.

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
- a distance or pixel size is non-positive;
- the full divergence is not in the non-periodic geometric domain between zero
  and pi radians;
- the bending radius is zero;
- the crystal footprint, focus, or detector-sampling equation approaches a
  singularity.

Validation errors are structured (`field`, `code`, `message`) so the web app can
place each message beside the control that needs attention.

## Optional intrinsic-width workflow

The legacy XOPPY pipeline is not part of the request-safe core. It currently
hard-codes parts of a Si configuration and writes fixed filenames in the current
directory. Before enabling it for a multi-user web service it must:

1. map every scientific input explicitly;
2. run in an isolated temporary directory per request;
3. record dependency and input provenance;
4. have timeout and concurrency controls;
5. be validated against reviewed reference datasets.
