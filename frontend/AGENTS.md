# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Selected DXASCalc direction

- The user selected visual option 2: the geometry-first beamline canvas.
- Source visual truth: the selected “Geometry-First Beamline Canvas” mock; the current local comparison evidence is recorded in the project-root `design-qa.md`.
- Preserve the large source–crystal–focus–detector visualization, the narrow right-side parameter inspector, and the top Bragg/Laue and preset controls. On desktop, keep the results, crystal response, and model coverage in the left column so the Crystal, Geometry, and Detector inspector continues down the right side without being cut off by a full-width band.
- Keep the warm off-white Dr. XAS palette, muted violet actions, blue/violet optics rays, restrained borders, and compact scientific typography.
- Scientific trust wins over invented values: distinguish detector sampling (eV/px) from source, intrinsic-crystal, and estimated-total energy FWHM. Show resolution values only when the validated API returns them, name the combination/model assumptions, and fall back to an explicit unavailable state.
- Expose source size, physical crystal thickness, and polarization inputs. Use a thin 50 µm Laue default and preserve a thickness the user manually edits when switching geometry.
- Show the API-provided σ, π, and selected intrinsic reflectivity response in an interactive Plotly figure, with the reported response model and bent-crystal limitations visible nearby.
- Mirror the complete optics diagram so the source is on the right, the crystal stays central, and the detector is normally on the left; rays travel right-to-left.
- Use an interactive Plotly optics figure. The source and detector are draggable and update the source-crystal distance `p` and crystal-detector distance `q`; dragging previews locally and releasing triggers the validated backend calculation.
- Default to a compressed schematic scale for readability and provide a physical-scale toggle. Preserve the numeric inputs as the accessible, precise alternative to pointer dragging.
- Show source-to-crystal distance p and crystal-to-detector distance q directly beside their corresponding ray segments, with clear dimension guides and values in meters.
- Make the p and q boxes on the optics diagram directly editable; typed distances must use the same validated recalculation path as dragging the source and detector.
- Provide a checkbox in the optics canvas to show or hide distance labels and construction guides. When shown, dashed ray extensions locate a virtual focus and dashed perpendicular projections show the detector's longitudinal and transverse components.
- Make the workbench/inspector divider and the Crystal, Geometry, and Detector section boundaries draggable for resizing on desktop; keep the stacked narrow-screen layout in natural content flow.
- Show and edit photon energy in eV in the interface, including element-edge selection and setup comparison; retain the `energy_kev` API and saved-file field with explicit UI conversion.
