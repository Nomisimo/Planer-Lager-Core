import { test } from "node:test";
import assert from "node:assert/strict";
import { zoneFrei, prioritaet, verteilung, zuweisenPruefen, pruefeZone, zonenSortiert } from "../src/index.js";

test("3.10 Ladezone: frei = plaetze - belegt; Eingaben prüfen", () => {
  assert.equal(zoneFrei({ plaetze: 2, belegt: 1 }), 1);
  assert.equal(zoneFrei({ plaetze: 1, belegt: 3 }), 0);
  assert.deepEqual(pruefeZone({ bezeichnung: " Zone A ", plaetze: 2, flaeche_m2: "12,5" }).werte,
    { bezeichnung: "Zone A", plaetze: 2, flaeche_m2: 12.5, beschreibung: "", aktiv: true, reihenfolge: 0 });
  const f = pruefeZone({ bezeichnung: "", plaetze: 0, flaeche_m2: "x" }).fehler;
  assert.deepEqual(Object.keys(f).sort(), ["bezeichnung", "flaeche_m2", "plaetze"]);
  assert.deepEqual(zonenSortiert([{ bezeichnung: "B", reihenfolge: 1 }, { bezeichnung: "A", reihenfolge: 2 }, { bezeichnung: "C", reihenfolge: 1 }]).map((z) => z.bezeichnung), ["B", "C", "A"]);
});

test("R-55 Priorität: Bestätigt/Läuft, nicht gepackt, nach Beginn (ohne zuletzt), Anlegedatum, Nummer", () => {
  const p = [
    { id: 1, nummer: "P-2027-010", status: "bestaetigt", beginn: null, erstellt: "2027-01-01" },
    { id: 2, nummer: "P-2027-002", status: "laeuft", beginn: "2027-05-02", erstellt: "2027-01-05" },
    { id: 3, nummer: "P-2027-003", status: "bestaetigt", beginn: "2027-05-01", erstellt: "2027-01-09" },
    { id: 4, nummer: "P-2027-004", status: "bestaetigt", beginn: "2027-05-01", erstellt: "2027-01-02" },
    { id: 5, nummer: "P-2027-005", status: "anfrage", beginn: "2027-04-01" },
    { id: 6, nummer: "P-2027-006", status: "laeuft", beginn: "2027-04-01", gepackt_am: "2027-03-30" },
    { id: 7, nummer: "P-2027-001", status: "bestaetigt", beginn: "2027-05-01", erstellt: "2027-01-02" },
  ];
  assert.deepEqual(prioritaet(p).map((x) => x.id), [7, 4, 3, 2, 1]);
});

test("R-56 Zuweisen: nicht abgeschlossen/storniert, Zone aktiv, schon drin → nichts, voll → Text", () => {
  const z = { id: 9, bezeichnung: "Zone A", aktiv: true, plaetze: 1, belegt: 1 };
  assert.deepEqual(zuweisenPruefen({ status: "laeuft", ladezone_id: 9 }, z), { nichts: true });
  assert.equal(zuweisenPruefen({ status: "laeuft" }, z).text, "Die Ladezone Zone A ist voll (1 von 1 Plätzen belegt).");
  assert.match(zuweisenPruefen({ status: "storniert" }, { ...z, belegt: 0 }).text, /stornierte/);
  assert.match(zuweisenPruefen({ status: "bestaetigt" }, { ...z, belegt: 0, aktiv: false }).text, /nicht aktiv/);
  assert.equal(zuweisenPruefen({ status: "bestaetigt" }, { ...z, belegt: 0 }), null);
});

test("R-58 Automatische Verteilung: Priorität auf nächste freie aktive Zone, bis keine frei ist", () => {
  const projekte = [
    { id: 1, nummer: "P-1", status: "bestaetigt", beginn: "2027-05-03" },
    { id: 2, nummer: "P-2", status: "bestaetigt", beginn: "2027-05-01" },
    { id: 3, nummer: "P-3", status: "laeuft", beginn: "2027-05-02", ladezone_id: 10 },
    { id: 4, nummer: "P-4", status: "bestaetigt", beginn: "2027-05-04" },
  ];
  const zonen = [{ id: 10, bezeichnung: "A", aktiv: true, plaetze: 2, belegt: 1, reihenfolge: 1 },
    { id: 11, bezeichnung: "B", aktiv: false, plaetze: 5, belegt: 0, reihenfolge: 2 },
    { id: 12, bezeichnung: "C", aktiv: true, plaetze: 1, belegt: 0, reihenfolge: 3 }];
  assert.deepEqual(verteilung(projekte, zonen), [{ projektId: 2, zoneId: 10 }, { projektId: 1, zoneId: 12 }]);
  assert.deepEqual(verteilung(projekte, []), []);
});
