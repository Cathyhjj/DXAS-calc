import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

import {
  CRYSTAL_LINE_WIDTH,
  SCALE_PHYSICAL,
  SCALE_SCHEMATIC,
  buildOpticsGeometry,
  distanceChangeFromRelayout,
  distanceRelayoutAction,
  distanceToDisplay,
  displayToDistance,
  focusPresentation,
  isDistanceDraggable,
  positiveDistance,
} from "../src/lib/opticsGeometry.js";

const baseConfig = {
  geometry: "bragg",
  condition: "upper",
  source_distance_m: 1.2,
  detector_distance_m: 1.5,
};
const baseResult = {
  bragg_angle_deg: 14.3078,
  crystal_rotation_deg: 14.3078,
  geometric_focus_m: 0.8,
  focus_kind: "real",
};

test("schematic distance mapping is monotonic and reversible", () => {
  const distances = [0.005, 0.05, 0.2, 1.2, 10, 50, 120];
  const displays = distances.map((distance) => distanceToDisplay(distance, SCALE_SCHEMATIC));
  for (let index = 1; index < displays.length; index += 1) {
    assert.ok(displays[index] > displays[index - 1]);
  }
  distances.forEach((distance, index) => {
    assert.ok(Math.abs(displayToDistance(displays[index], SCALE_SCHEMATIC) - distance) < 1e-9);
  });
});

test("physical coordinates retain positive p and q outside pointer limits", () => {
  for (const [p, q] of [[0.005, 120], [120, 0.005]]) {
    const config = { ...baseConfig, source_distance_m: p, detector_distance_m: q };
    const geometry = buildOpticsGeometry(config, baseResult, SCALE_PHYSICAL);
    assert.equal(positiveDistance(config.source_distance_m), p);
    assert.equal(positiveDistance(config.detector_distance_m), q);
    assert.equal(geometry.sourceDistanceM, p);
    assert.equal(geometry.detectorDistanceM, q);
    assert.equal(geometry.source.x, p);
    assert.ok(Math.abs(Math.hypot(geometry.detector.x, geometry.detector.y) - q) < 1e-10);
    assert.equal(distanceChangeFromRelayout({ "shapes[0].x0": 1 }, geometry, SCALE_PHYSICAL), null);
    assert.equal(distanceChangeFromRelayout({ "shapes[1].x0": 1 }, geometry, SCALE_PHYSICAL), null);
  }
  assert.equal(distanceToDisplay(0.005, SCALE_PHYSICAL), 0.005);
  assert.equal(displayToDistance(120, SCALE_PHYSICAL), 120);
  assert.equal(isDistanceDraggable(0.005), false);
  assert.equal(isDistanceDraggable(120), false);
  assert.equal(isDistanceDraggable(1.2), true);
});

test("real angle is drawn in all four geometry and condition combinations", () => {
  for (const theta of [0.5, 14.3078, 55, 70.295, 80, 89]) {
    for (const geometryType of ["bragg", "laue"]) {
      for (const condition of ["upper", "lower"]) {
        const geometry = buildOpticsGeometry(
          { ...baseConfig, geometry: geometryType, condition },
          { ...baseResult, bragg_angle_deg: theta },
          SCALE_PHYSICAL,
        );
        const radians = (theta * 2 * Math.PI) / 180;
        const side = geometryType === "bragg"
          ? (condition === "upper" ? 1 : -1)
          : (condition === "upper" ? -1 : 1);
        const context = `${geometryType} ${condition} θ=${theta}`;
        assert.equal(geometry.thetaDisplayDeg, theta, context);
        assert.equal(geometry.scatteringAngleDeg, theta * 2, context);
        assert.equal(buildOpticsGeometry(
          { ...baseConfig, geometry: geometryType, condition },
          { ...baseResult, bragg_angle_deg: theta },
          SCALE_SCHEMATIC,
        ).scatteringAngleDeg, theta * 2, `${context} schematic`);
        assert.ok(Math.abs(geometry.detector.x + baseConfig.detector_distance_m * Math.cos(radians)) < 1e-10, context);
        assert.ok(Math.abs(geometry.detector.y + side * baseConfig.detector_distance_m * Math.sin(radians)) < 1e-10, context);
        assert.ok(Math.abs(geometry.detectorProjection.x - geometry.detector.x) < 1e-12, context);
        assert.ok(Math.abs(geometry.detectorLongitudinalM - Math.abs(geometry.detector.x)) < 1e-10, context);
        assert.ok(Math.abs(geometry.detectorTransverseM - Math.abs(geometry.detector.y)) < 1e-10, context);
        const arcEnd = geometry.angleArc.at(-1);
        assert.ok(Math.abs(arcEnd.x - geometry.outgoingAxis.x * geometry.sceneSpan * 0.13) < 1e-10, context);
        assert.ok(Math.abs(arcEnd.y - geometry.outgoingAxis.y * geometry.sceneSpan * 0.13) < 1e-10, context);
        if (theta > 45) assert.ok(geometry.detector.x > 0, context);
      }
    }
  }
});

test("signed API focus remains on the correct side at its physical distance", () => {
  for (const signedFocus of [4.25, -4.25]) {
    const geometry = buildOpticsGeometry(
      baseConfig,
      { ...baseResult, geometric_focus_m: signedFocus, focus_kind: signedFocus < 0 ? "virtual" : "real" },
      SCALE_PHYSICAL,
    );
    assert.equal(geometry.focusDistanceM, Math.abs(signedFocus));
    assert.equal(geometry.focusDisplay, Math.abs(signedFocus));
    assert.equal(geometry.signedFocusM, signedFocus);
    assert.ok(Math.abs(geometry.focus.x - geometry.outgoingAxis.x * signedFocus) < 1e-10);
    assert.ok(Math.abs(geometry.focus.y - geometry.outgoingAxis.y * signedFocus) < 1e-10);
  }
});

test("finite offscreen focus remains in plot data without expanding the initial physical view", () => {
  for (const signedFocus of [120, -120]) {
    const result = {
      ...baseResult,
      geometric_focus_m: signedFocus,
      focus_kind: signedFocus < 0 ? "virtual" : "real",
    };
    const geometry = buildOpticsGeometry(baseConfig, result, SCALE_PHYSICAL);
    assert.deepEqual(focusPresentation(geometry, result), {
      render: true,
      outsideInitialView: true,
    });
    assert.ok(geometry.focus.x < geometry.xRange[0] || geometry.focus.x > geometry.xRange[1]);
    assert.ok(Math.max(...geometry.xRange.map(Math.abs)) < 10);
  }

  const geometry = buildOpticsGeometry(baseConfig, baseResult, SCALE_PHYSICAL);
  assert.deepEqual(focusPresentation(geometry, null), {
    render: false,
    outsideInitialView: false,
  });
  assert.deepEqual(focusPresentation(geometry, { geometric_focus_m: Infinity }), {
    render: false,
    outsideInitialView: false,
  });
});

test("Plotly keeps offscreen real and virtual focus markers and labels for pan or autoscale", async () => {
  const server = await createServer({
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  try {
    const { makeOpticsFigure } = await server.ssrLoadModule("/src/components/OpticsCanvas.jsx");
    for (const signedFocus of [120, -120]) {
      const result = {
        ...baseResult,
        geometric_focus_m: signedFocus,
        focus_kind: signedFocus < 0 ? "virtual" : "real",
      };
      const geometry = buildOpticsGeometry(baseConfig, result, SCALE_PHYSICAL);
      const figure = makeOpticsFigure(geometry, baseConfig, result, SCALE_PHYSICAL, 0, true, false);
      const marker = figure.data.find((trace) => trace.meta?.role === "focus");
      const label = figure.layout.annotations.find((annotation) => annotation.text?.includes("focus"));
      assert.deepEqual(marker.x, [geometry.focus.x]);
      assert.deepEqual(marker.y, [geometry.focus.y]);
      assert.equal(label.x, geometry.focus.x);
      assert.equal(label.y, geometry.focus.y);
      assert.deepEqual(figure.layout.xaxis.range, geometry.xRange);
      assert.deepEqual(figure.layout.yaxis.range, geometry.yRange);
      const extension = figure.data.find((trace) => trace.meta?.role === "virtual-focus-guide");
      if (signedFocus < 0) {
        assert.ok(extension.x.includes(geometry.focus.x));
        assert.ok(extension.y.includes(geometry.focus.y));
      } else {
        assert.equal(extension, undefined);
      }
    }
  } finally {
    await server.close();
  }
});

test("physical mode uses metre coordinates", () => {
  const geometry = buildOpticsGeometry(baseConfig, baseResult, SCALE_PHYSICAL);
  assert.equal(geometry.source.x, baseConfig.source_distance_m);
  assert.ok(Math.abs(Math.hypot(geometry.detector.x, geometry.detector.y) - baseConfig.detector_distance_m) < 1e-9);
  assert.ok(geometry.source.x > geometry.crystal.x);
  assert.ok(geometry.detector.x < geometry.crystal.x);
});

test("detector projection components use the physical q and Bragg angle", () => {
  const geometry = buildOpticsGeometry(baseConfig, baseResult, SCALE_PHYSICAL);
  const schematic = buildOpticsGeometry(baseConfig, baseResult, SCALE_SCHEMATIC);
  const angle = (baseResult.bragg_angle_deg * 2 * Math.PI) / 180;
  assert.equal(geometry.detectorProjection.x, geometry.detector.x);
  assert.equal(geometry.detectorProjection.y, 0);
  assert.ok(Math.abs(geometry.detectorLongitudinalM - baseConfig.detector_distance_m * Math.cos(angle)) < 1e-12);
  assert.ok(Math.abs(geometry.detectorTransverseM - baseConfig.detector_distance_m * Math.sin(angle)) < 1e-12);
  assert.ok(Math.abs(Math.hypot(geometry.detectorLongitudinalM, geometry.detectorTransverseM) - baseConfig.detector_distance_m) < 1e-12);
  assert.equal(schematic.detectorLongitudinalM, geometry.detectorLongitudinalM);
  assert.equal(schematic.detectorTransverseM, geometry.detectorTransverseM);
});

test("Laue preserves the opposite upper/lower branch and a thinner crystal", () => {
  const bragg = buildOpticsGeometry(baseConfig, baseResult, SCALE_PHYSICAL);
  const laue = buildOpticsGeometry(
    { ...baseConfig, geometry: "laue" },
    { ...baseResult, crystal_rotation_deg: 75.6922 },
    SCALE_PHYSICAL,
  );
  assert.equal(Math.sign(bragg.detector.y), -Math.sign(laue.detector.y));
  assert.ok(CRYSTAL_LINE_WIDTH.laue <= CRYSTAL_LINE_WIDTH.bragg * 0.35);
});

test("all Si reflections keep the mirrored ordering and distinct Laue rotations", () => {
  const reflections = [
    { hkl: "111", theta: 14.3078 },
    { hkl: "220", theta: 23.8012 },
    { hkl: "311", theta: 28.2436 },
  ];
  const laueTangents = [];

  for (const { hkl, theta } of reflections) {
    for (const geometryType of ["bragg", "laue"]) {
      for (const condition of ["upper", "lower"]) {
        const sign = condition === "upper" ? 1 : -1;
        const rotation = geometryType === "bragg"
          ? sign * theta
          : condition === "upper" ? 90 - theta : 90 + theta;
        const geometry = buildOpticsGeometry(
          { ...baseConfig, geometry: geometryType, condition },
          { ...baseResult, bragg_angle_deg: theta, crystal_rotation_deg: rotation },
          SCALE_PHYSICAL,
        );
        assert.ok(geometry.source.x > geometry.crystal.x, `${geometryType} ${hkl} source`);
        assert.ok(geometry.detector.x < geometry.crystal.x, `${geometryType} ${hkl} detector`);
        const expectedYSign = geometryType === "laue" ? sign : -sign;
        assert.equal(Math.sign(geometry.detector.y), expectedYSign, `${geometryType} ${hkl} ${condition}`);
        if (geometryType === "laue" && condition === "upper") {
          laueTangents.push(`${geometry.crystalTangent.x.toFixed(6)},${geometry.crystalTangent.y.toFixed(6)}`);
        }
      }
    }
  }

  assert.equal(new Set(laueTangents).size, reflections.length);
});

test("source shape relayout becomes a p change", () => {
  const geometry = buildOpticsGeometry(baseConfig, baseResult, SCALE_PHYSICAL);
  const change = distanceChangeFromRelayout(
    { "shapes[0].x0": 2.4, "shapes[0].x1": 2.4 },
    geometry,
    SCALE_PHYSICAL,
  );
  assert.deepEqual(change, {
    target: "source",
    field: "source_distance_m",
    value: 2.4,
  });
});

test("pointer drag bounds do not change physical data bounds", () => {
  const geometry = buildOpticsGeometry(baseConfig, baseResult, SCALE_PHYSICAL);
  assert.equal(distanceChangeFromRelayout(
    { "shapes[0].x0": 120, "shapes[0].x1": 120 }, geometry, SCALE_PHYSICAL,
  ).value, 50);
  assert.equal(distanceChangeFromRelayout(
    { "shapes[0].x0": 0.005, "shapes[0].x1": 0.005 }, geometry, SCALE_PHYSICAL,
  ).value, 0.05);
  assert.equal(distanceToDisplay(120, SCALE_PHYSICAL), 120);
  assert.equal(distanceToDisplay(0.005, SCALE_PHYSICAL), 0.005);
});

test("detector relayout projects the moved plane onto the outgoing axis", () => {
  const geometry = buildOpticsGeometry(baseConfig, baseResult, SCALE_PHYSICAL);
  const desiredDistance = 2.75;
  const center = {
    x: geometry.outgoingAxis.x * desiredDistance + geometry.detectorNormal.x * 0.4,
    y: geometry.outgoingAxis.y * desiredDistance + geometry.detectorNormal.y * 0.4,
  };
  const half = 0.2;
  const change = distanceChangeFromRelayout(
    {
      "shapes[1].x0": center.x - geometry.detectorNormal.x * half,
      "shapes[1].y0": center.y - geometry.detectorNormal.y * half,
      "shapes[1].x1": center.x + geometry.detectorNormal.x * half,
      "shapes[1].y1": center.y + geometry.detectorNormal.y * half,
    },
    geometry,
    SCALE_PHYSICAL,
  );
  assert.equal(change.field, "detector_distance_m");
  assert.ok(Math.abs(change.value - desiredDistance) < 1e-4);
});

test("perpendicular-only handle moves reset Plotly shapes instead of changing p or q", () => {
  const geometry = buildOpticsGeometry(baseConfig, baseResult, SCALE_PHYSICAL);
  const source = geometry.sourceLine;
  assert.deepEqual(distanceRelayoutAction({
    "shapes[0].y0": source.y0 + 0.4,
    "shapes[0].y1": source.y1 + 0.4,
  }, geometry, SCALE_PHYSICAL), { kind: "reset", target: "source" });

  const detector = geometry.detectorLine;
  const transverseMove = {
    x: geometry.detectorNormal.x * 0.4,
    y: geometry.detectorNormal.y * 0.4,
  };
  assert.deepEqual(distanceRelayoutAction({
    "shapes[1].x0": detector.x0 + transverseMove.x,
    "shapes[1].x1": detector.x1 + transverseMove.x,
    "shapes[1].y0": detector.y0 + transverseMove.y,
    "shapes[1].y1": detector.y1 + transverseMove.y,
  }, geometry, SCALE_PHYSICAL), { kind: "reset", target: "detector" });

  assert.deepEqual(distanceRelayoutAction({
    "shapes[0].x0": 2.4,
    "shapes[0].x1": 2.4,
  }, geometry, SCALE_PHYSICAL), {
    kind: "commit",
    change: { target: "source", field: "source_distance_m", value: 2.4 },
  });
  assert.equal(distanceRelayoutAction({ "xaxis.range[0]": -2 }, geometry, SCALE_PHYSICAL), null);
});

test("pan and zoom relayout events do not change a distance", () => {
  const geometry = buildOpticsGeometry(baseConfig, baseResult, SCALE_PHYSICAL);
  assert.equal(
    distanceChangeFromRelayout({ "xaxis.range[0]": -2, "xaxis.range[1]": 3 }, geometry, SCALE_PHYSICAL),
    null,
  );
});
