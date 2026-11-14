import { test } from "node:test";
import assert from "node:assert/strict";
import { mitStandard, pruefeEinstellungen, EINSTELLUNGEN_STANDARD } from "../src/einstellungen.js";

test("FA-48 Einstellungen: Standardwerte laut 3.14 und Prüfung beim Speichern", () => {
  const e = mitStandard(null);
  assert.equal(e.tag_stunden_standard, 8);
  assert.equal(e.tag_stunden_erweitert, 10);
  assert.equal(e.angebot_gueltig_tage, 14);
  assert.equal(e.zeit_prozent_planung, 30);
  assert.equal(e.zeit_basis_stundensatz, 6000);
  assert.equal(e.backup_behalten, 14);
  assert.equal(mitStandard({ firma: { name: "X" } }).firma.ort, "");
  assert.equal(pruefeEinstellungen({ angebot_gueltig_tage: 0 }, EINSTELLUNGEN_STANDARD).ok, false);
  assert.equal(pruefeEinstellungen({ tag_stunden_erweitert: 6 }, EINSTELLUNGEN_STANDARD).ok, false);
  assert.equal(pruefeEinstellungen({ unbekannt: 1 }, EINSTELLUNGEN_STANDARD).ok, false);
  const ok = pruefeEinstellungen({ angebot_gueltig_tage: 30, firma: { name: "Verleih GmbH" } }, EINSTELLUNGEN_STANDARD);
  assert.equal(ok.ok, true);
  assert.equal(ok.werte.firma.name, "Verleih GmbH");
});
