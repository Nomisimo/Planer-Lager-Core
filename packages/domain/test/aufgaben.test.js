import { test } from "node:test";
import assert from "node:assert/strict";
import { naechsterTermin, faelligeRegel, pruefeRegel, rhythmusText } from "../src/index.js";

test("FA-40 Rhythmus: täglich, wöchentlich, monatlich (Monatsende), jährlich", () => {
  assert.equal(naechsterTermin("2026-11-14", "taeglich"), "2026-11-15");
  assert.equal(naechsterTermin("2026-11-14", "woechentlich", 2), "2026-11-28");
  assert.equal(naechsterTermin("2027-01-31", "monatlich"), "2027-02-28");
  assert.equal(naechsterTermin("2028-02-29", "jaehrlich"), "2029-02-28");
  assert.equal(rhythmusText("woechentlich", 2), "alle 2 Wochen");
  assert.equal(rhythmusText("monatlich", 1), "monatlich");
});

test("FA-40 Fällige Regel: Vorlauf, nichts vor der Zeit, verpasste Termine ergeben eine Aufgabe", () => {
  const r = { rhythmus: "woechentlich", alle: 1, naechste: "2026-11-20", vorlauf_tage: 0 };
  assert.deepEqual(faelligeRegel(r, "2026-11-14"), { termin: null, naechste: "2026-11-20" });
  assert.deepEqual(faelligeRegel({ ...r, vorlauf_tage: 7 }, "2026-11-14"), { termin: "2026-11-20", naechste: "2026-11-27" });
  assert.deepEqual(faelligeRegel(r, "2026-12-05"), { termin: "2026-12-04", naechste: "2026-12-11" }, "drei verpasst → nur der jüngste");
  assert.deepEqual(Object.keys(pruefeRegel({ text: "", rhythmus: "stündlich", alle: 0, naechste: "x" })).sort(), ["alle", "naechste", "rhythmus", "text"]);
  assert.deepEqual(pruefeRegel({ text: "Akkus laden", rhythmus: "monatlich", naechste: "2026-12-01" }), {});
});
