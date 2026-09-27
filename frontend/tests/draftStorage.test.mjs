import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/lib/configurationFile.js";
import { readDraft, writeDraft } from "../src/lib/draftStorage.js";

function storage() {
  let value = null;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}

test("a refresh retains unfinished numbers and manually selected thickness", () => {
  const store = storage();
  const draft = { config: { ...DEFAULT_CONFIG, energy_kev: "", h: "1.5" }, energyInputEv: "", thicknessEdited: true };
  assert.equal(writeDraft(store, draft), true);
  assert.deepEqual(readDraft(store), draft);
});

test("blocked storage and corrupt or incompatible drafts never break startup", () => {
  const blocked = { getItem() { throw new Error("Denied"); }, setItem() { throw new Error("Quota"); } };
  assert.equal(readDraft(blocked), null);
  assert.equal(writeDraft(blocked, {}), false);
  for (const value of ["{", JSON.stringify({ version: 99 }), JSON.stringify({ version: 1, config: {} })]) {
    assert.equal(readDraft({ getItem: () => value }), null);
  }
});

test("only bounded, known input fields can be restored; results are not saved", () => {
  const store = storage();
  writeDraft(store, { config: DEFAULT_CONFIG, energyInputEv: "8000", thicknessEdited: false, result: { large: true } });
  assert.equal(store.getItem().includes("result"), false);
  for (const config of [{ ...DEFAULT_CONFIG, unknown: 1 }, { ...DEFAULT_CONFIG, source_distance_m: null }, { ...DEFAULT_CONFIG, material: "unknown" }]) {
    assert.equal(readDraft({ getItem: () => JSON.stringify({ version: 1, config }) }), null);
  }
});

test("a stale saved eV display cannot disagree with the restored keV inputs", () => {
  const store = storage();
  writeDraft(store, { config: DEFAULT_CONFIG, energyInputEv: "9000", thicknessEdited: false });
  assert.equal(readDraft(store).energyInputEv, "8000");
});
