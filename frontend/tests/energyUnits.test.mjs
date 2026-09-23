import assert from "node:assert/strict";
import test from "node:test";

import { evInputToKev, kevToEvInput } from "../src/lib/energyUnits.js";

test("calculator keV values display as eV input values", () => {
  assert.equal(kevToEvInput(8), "8000");
  assert.equal(kevToEvInput(6.539), "6539"); // Mn K edge
  assert.equal(kevToEvInput(8.4005), "8400.5");
});

test("manual eV input converts to keV for the calculator and saved configuration", () => {
  assert.equal(evInputToKev("8400.5"), 8.4005);
  assert.equal(evInputToKev("6539"), 6.539);
  assert.equal(kevToEvInput(evInputToKev("8400.5")), "8400.5");
});

test("blank inputs stay invalid while zero and negative values reach validation", () => {
  assert.equal(evInputToKev(""), "");
  assert.equal(evInputToKev("   "), "");
  assert.equal(kevToEvInput(""), "");
  assert.equal(kevToEvInput("   "), "");
  assert.equal(evInputToKev("0"), 0);
  assert.equal(evInputToKev("-1000"), -1);
  assert.equal(kevToEvInput(0), "0");
  assert.equal(kevToEvInput(-1), "-1000");
});
