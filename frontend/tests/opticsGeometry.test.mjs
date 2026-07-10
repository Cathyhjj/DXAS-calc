import assert from "node:assert/strict";
import test from "node:test";

import {
  CRYSTAL_LINE_WIDTH,
  SCALE_PHYSICAL,
  SCALE_SCHEMATIC,
  buildOpticsGeometry,
  distanceChangeFromRelayout,
  distanceToDisplay,
  displayToDistance,
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
  const distances = [0.05, 0.2, 1.2, 10, 50];
  const displays = distances.map((distance) => distanceToDisplay(distance, SCALE_SCHEMATIC));
  for (let index = 1; index < displays.length; index += 1) {
    assert.ok(displays[index] > displays[index - 1]);
  }
  distances.forEach((distance, index) => {
    assert.ok(Math.abs(displayToDistance(displays[index], SCALE_SCHEMATIC) - distance) < 1e-9);
  });
});

test("physical mode uses metre coordinates", () => {
  const geometry = buildOpticsGeometry(baseConfig, baseResult, SCALE_PHYSICAL);
  assert.equal(geometry.source.x, baseConfig.source_distance_m);
  assert.ok(Math.abs(Math.hypot(geometry.detector.x, geometry.detector.y) - baseConfig.detector_distance_m) < 1e-9);
  assert.ok(geometry.source.x > geometry.crystal.x);
  assert.ok(geometry.detector.x < geometry.crystal.x);
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

test("pan and zoom relayout events do not change a distance", () => {
  const geometry = buildOpticsGeometry(baseConfig, baseResult, SCALE_PHYSICAL);
  assert.equal(
    distanceChangeFromRelayout({ "xaxis.range[0]": -2, "xaxis.range[1]": 3 }, geometry, SCALE_PHYSICAL),
    null,
  );
});
