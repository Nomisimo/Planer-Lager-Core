import { test } from "node:test";
import assert from "node:assert/strict";
import { fristEnde, loeschbarkeit, anonymisiert } from "../src/datenschutz.js";

test("NFA-03 Aufbewahrungsfristen ab Jahresende: Rechnung 10 Jahre, Angebot 6 Jahre; längste Frist entscheidet", () => {
  assert.equal(fristEnde("rechnung", "2020-03-15"), "2031-01-01");
  assert.equal(fristEnde("angebot", "2020-12-31"), "2027-01-01");
  const l = loeschbarkeit([{ art: "angebot", datum: "2019-05-01", nummer: "A-1" }, { art: "rechnung", datum: "2019-06-01", nummer: "R-1" }], "2026-11-14");
  assert.equal(l.erlaubt, false);
  assert.equal(l.ab, "2030-01-01");
  assert.deepEqual(l.sperrt.map((s) => s.nummer), ["R-1"], "abgelaufene Angebotsfrist sperrt nicht mehr");
  assert.equal(loeschbarkeit([{ art: "angebot", datum: "2019-05-01" }], "2026-11-14").erlaubt, true);
  assert.equal(loeschbarkeit([], "2026-11-14").erlaubt, true);
  assert.deepEqual(Object.values(anonymisiert(5)).filter(Boolean), ["Kunde gelöscht (Nr. 5)"]);
});
