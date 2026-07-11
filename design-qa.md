# DXASCalc design QA

- Source visual truth: `/Users/juanjuanhuang/.codex/generated_images/019f4a40-70e7-7243-b212-4a8679df6a86/exec-cfd42abe-003a-473b-89a0-8b44bc82e7c2.png`
- Browser-rendered production implementation: `/tmp/dxas-production-final-v3.png`
- Full-view comparison: `/tmp/dxas-design-comparison-final.png`
- Focused inspector comparison: `/tmp/dxas-inspector-comparison-final.png`
- Mobile production implementation: `/tmp/dxas-production-mobile.png`
- Desktop viewport: 1440 × 1024
- Tablet viewport: 820 × 900
- Mobile viewport: 390 × 844
- Desktop state: Bragg, Si(111), 8.0 keV, p = 1.2 m, divergence = 1.2 mrad, R = -2.0 m, q = 1.5 m, 55 µm pixels

The generated source is a visual concept, not a validated calculation fixture. Its illustrative state uses p = 35 m, R = +2 m, and a signed negative detector distance. The implementation intentionally keeps the validated legacy-safe preset and a positive physical crystal-to-detector distance. Visual structure was compared at a normalized 1440 × 1024 frame; calculated rays, warnings, and metric values were not forced to match scientifically inconsistent mock values.

## Full-view comparison evidence

The source and final implementation were opened together in `/tmp/dxas-design-comparison-final.png`. The final screen preserves the selected hierarchy: compact branded header, Bragg/Laue and preset controls, dominant source–crystal–focus–detector canvas, narrow right inspector, four-metric result band, and full-width model-coverage band. The implementation also restores the Rowland circle, radius construction, angle/focus labels, movable detector, zoom/reset controls, and compact plus/minus field controls.

## Focused region evidence

The two inspectors were opened together in `/tmp/dxas-inspector-comparison-final.png`. Section hierarchy, left-label/right-control rows, compact numeric fields, units, steppers, violet section headings, borders, and density match the source direction. Intentional product differences are retained: energy is grouped with the crystal configuration, calculated detector values are read-only outputs rather than editable inputs, and unmodeled resolution terms are never presented as calculated.

## Required fidelity surfaces

- Fonts and typography: Inter is bundled locally at 400/500/600/700 weights. Hierarchy, tabular values, wrapping, and compact labels were checked at desktop and mobile. Small secondary text was darkened to meet practical contrast needs.
- Spacing and layout rhythm: the extra workbench and inspector title bands were removed from visual flow; the inspector now fits its 670 px desktop rail with `clientHeight === scrollHeight`, and the document has no horizontal overflow at 390, 820, or 1440 px.
- Colors and visual tokens: warm white surfaces, muted violet controls, blue detector accents, subtle gray construction lines, green status, amber errors, borders, and dividers map closely to the source palette.
- Image quality and asset fidelity: the supplied Dr. XAS raster logo is used directly. Tabler provides all UI icons. The optics view is a high-DPI functional canvas tied to real inputs, not placeholder artwork; it remains sharp at the tested viewports.
- Copy and content: labels use explicit units and scientifically accurate language. Detector sampling is distinguished from total resolution, and source-size/crystal contributions remain clearly marked as not modeled.

## Interaction, accessibility, and responsive checks

- Bragg/Laue recalculation, preset loading, plus/minus steppers, setup comparison, field validation, detector keyboard control, menu Escape behavior, About-dialog focus containment, and focus restoration were exercised in the in-app browser.
- The energy stepper changed 8.0 to 8.1 without floating-point artifacts.
- A detector distance of 100 m remained labeled as 100 m in the canvas/accessibility description while the draggable control retained its documented 0.05–50 m manipulation range.
- Si(100) produced a field-level systematic-absence error while the last valid result remained visibly marked as stale.
- The About dialog cycled Shift+Tab/Tab between its first and last controls, closed on Escape, and restored focus to the application-menu trigger.
- At 390 px, document width equaled viewport width, all h/k/l inputs stayed inside the inspector, header actions retained accessible names, and no anonymous buttons remained.
- Browser console warnings/errors checked: none.

## Comparison history

### Pass 1 — blocked

- P1: extra workbench/status and inspector-header chrome compressed the main optical geometry and created nested scrolling.
- P1: the canvas omitted the Rowland-circle/radius construction and the inspector lacked compact plus/minus controls.
- P1: mobile header actions had no accessible names, h/k/l fields overflowed, and canvas labels collided with the legend.
- P2: dialog focus escaped to the page; pale 8–10 px secondary text had insufficient contrast; results were left-aligned and visually busier than the source.

### Fixes applied

- Moved calculation status into a light canvas overlay, moved generic virtual-focus guidance into advanced assumptions, visually hid the redundant inspector header, and compacted the rail so it no longer scrolls internally.
- Added Rowland circle, radius label, richer source readout, source-like legend terminology, contextual inversion notice, and truthful detector-distance labeling outside the drag range.
- Added accessible numeric steppers, stable rounding, dialog focus containment, Escape/focus restoration, explicit mobile action names, an explicit desktop reflection-control grid column, mobile h/k/l shrink rules, and compact mobile results.
- Centered the metric hierarchy and strengthened secondary/status contrast while preserving truthful unmodeled states.

### Pass 2 — passed

The final full-view and focused comparisons show no remaining actionable P0, P1, or P2 mismatch. Remaining differences are P3 or intentional scientific/product constraints: the validated default values differ from the illustrative mock; the status pill remains as a low-salience operational cue; and the footer sits just below the 1024 px viewport while the generated source file itself is 1058 px high.

## Follow-up polish

- P3: consolidate the duplicated legacy/current CSS rule blocks when a broader stylesheet cleanup is desired.
- P3: add automated component/accessibility screenshot checks if the frontend gains a test runner.

final result: passed
