import test from "node:test";
import assert from "node:assert/strict";
import { finiteSeries } from "../src/lib/reflectivityData.js";

test("missing reflectivity samples are never converted into fabricated zeroes", () => {
  for (const missing of [null, undefined, "", " ", true, [], {}, NaN, Infinity]) {
    assert.equal(finiteSeries([0.1, missing, 0.2], 3), null);
  }
  assert.deepEqual(finiteSeries([0, 0.5, 1], 3), [0, 0.5, 1]);
  assert.equal(finiteSeries([0, 1], 3), null);
  assert.equal(finiteSeries([], 0), null);
});
