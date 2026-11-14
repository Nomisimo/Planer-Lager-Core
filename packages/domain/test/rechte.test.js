import { test } from "node:test";
import assert from "node:assert/strict";
import { darf, noetigeStufe, EINGEBAUTE_ROLLEN, normalisiereRechte, bleibtAdmin, BEREICHE } from "../src/rechte.js";

const rolle = (n) => normalisiereRechte(EINGEBAUTE_ROLLEN.find((r) => r.name === n).rechte);

test("R-02 GET braucht r, POST und Formularseiten brauchen w", () => {
  assert.equal(noetigeStufe("GET", "/kunden/"), "r");
  for (const s of ["neu", "bearbeiten", "loeschen", "importieren", "hochladen", "pruefen"]) assert.equal(noetigeStufe("GET", `/kunden/1/${s}/`), "w");
  assert.equal(noetigeStufe("POST", "/api/scan/"), "w");
  assert.equal(noetigeStufe("DELETE", "/x"), "w");
});

test("R-03 Bereich verwaltung nur für Administratoren, auch wenn eine Rolle verwaltung r hätte", () => {
  assert.equal(darf(rolle("Administrator"), "verwaltung", "w"), true);
  assert.equal(darf(normalisiereRechte({ verwaltung: "r" }), "verwaltung", "r"), false);
  assert.equal(darf(rolle("Büro / Disposition"), "verwaltung", "r"), false);
});

test("R-01 Route ohne Bereich nur für Admin; R-06 eingebaute Rollen laut Tabelle 2.1", () => {
  assert.equal(darf(rolle("Lager / Techniker"), null, "r"), false);
  assert.equal(darf(rolle("Administrator"), null, "w"), true);
  const buero = rolle("Büro / Disposition");
  assert.equal(darf(buero, "kunden", "w"), true);
  assert.equal(darf(buero, "material", "w"), false);
  assert.equal(darf(buero, "material", "r"), true);
  const ap = rolle("Lager-Arbeitsplatz");
  assert.deepEqual(BEREICHE.filter((b) => ap[b]), ["geraete", "packen"]);
  assert.equal(darf(rolle("Anzeige (Bildschirm)"), "anzeige", "r"), true);
  assert.equal(darf(rolle("Anzeige (Bildschirm)"), "packen", "r"), false);
  assert.equal(darf(rolle("Anzeige (Bildschirm)"), "start", "r"), true);
});

test("R-07 letzter aktiver Administrator darf nicht herabgestuft, deaktiviert oder gelöscht werden", () => {
  const b = [{ id: 1, aktiv: true, admin: true }, { id: 2, aktiv: true, admin: false }, { id: 3, aktiv: false, admin: true }];
  assert.equal(bleibtAdmin(b, { id: 1, admin: false }), false);
  assert.equal(bleibtAdmin(b, { id: 1, aktiv: false }), false);
  assert.equal(bleibtAdmin(b, { loeschen: 1 }), false);
  assert.equal(bleibtAdmin(b, { id: 2, admin: true }), true);
  assert.equal(bleibtAdmin([...b, { id: 4, aktiv: true, admin: true }], { loeschen: 1 }), true);
});
