import { test } from "node:test";
import assert from "node:assert/strict";
import { normalisiereCode, normalisiereProjektcode, naechsterGeraetecode, naechsteProjektnummer, praefixVorschlag } from "../src/codes.js";

test("R-22 normalisiert lt1, LT 1, lt-0001 zu LT-0001, anderes bleibt", () => {
  for (const e of ["lt1", "LT 1", "lt-0001", "LT0001", " Lt-1 "]) assert.equal(normalisiereCode(e), "LT-0001", e);
  assert.equal(normalisiereCode("abcd12345"), "ABCD-12345");
  assert.equal(normalisiereCode("B-123456-X"), "B-123456-X");
  assert.equal(normalisiereCode("4711-0815"), "4711-0815");
  assert.equal(normalisiereCode("abcde1"), "abcde1", "5 Buchstaben passen nicht");
});

test("R-23 Projektcode-Eingabe p2026-1 → P-2026-001, J 2026 12 → J-2026-012", () => {
  assert.equal(normalisiereProjektcode("p2026-1"), "P-2026-001");
  assert.equal(normalisiereProjektcode("P-2026-001"), "P-2026-001");
  assert.equal(normalisiereProjektcode("j 2026 0012"), "J-2026-012");
  assert.equal(normalisiereProjektcode("LT-0001"), null);
  assert.equal(normalisiereProjektcode("P-26-1"), null);
});

test("R-21 Gerätecode: max(letzte_nummer, vorhandene) + 1, nie wiederverwendet", () => {
  assert.deepEqual(naechsterGeraetecode("lt", 0, []), { code: "LT-0001", nummer: 1 });
  assert.deepEqual(naechsterGeraetecode("LT", 5, ["LT-0003"]), { code: "LT-0006", nummer: 6 });
  assert.deepEqual(naechsterGeraetecode("LT", 2, ["LT-0009", "LTX-0050", "MI-0100"]), { code: "LT-0010", nummer: 10 });
});

test("R-20 Projektnummer P-JJJJ-NNN, Jobs mit eigenem Zähler", () => {
  assert.equal(naechsteProjektnummer("P", 2026, []), "P-2026-001");
  assert.equal(naechsteProjektnummer("P", 2026, ["P-2026-001", "P-2026-007", "J-2026-020", "P-2025-099"]), "P-2026-008");
  assert.equal(naechsteProjektnummer("J", 2026, ["P-2026-001", "J-2026-020"]), "J-2026-021");
});

test("3.6 Kategorie: Präfix-Vorschlag aus dem Namen, eindeutig", () => {
  assert.equal(praefixVorschlag("Lautsprecher"), "LA");
  assert.equal(praefixVorschlag("Licht Technik"), "LT");
  assert.equal(praefixVorschlag("Lautsprecher", ["LA"]), "LAU");
  assert.match(praefixVorschlag("Ü"), /^[A-Z]{1,4}$/);
});
