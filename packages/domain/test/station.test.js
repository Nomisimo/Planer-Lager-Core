import { test } from "node:test";
import assert from "node:assert/strict";
import { stationGesperrt, pinWartezeit, nachFehlversuch, stationDarf, pruefeArbeitsplatz, pruefeMitarbeiter } from "../src/index.js";

test("R-11a R-11b Sperre: ohne Mitarbeiter gesperrt, nach Sperrzeit ohne Eingabe gesperrt, Anzeige nie", () => {
  const jetzt = Date.parse("2027-05-01T10:00:00Z");
  assert.equal(stationGesperrt({ art: "packen", mitarbeiter_id: null }, jetzt), true);
  assert.equal(stationGesperrt({ art: "packen", mitarbeiter_id: 1, sperrzeit_minuten: 10, letzte_aktivitaet: "2027-05-01T09:55:00Z" }, jetzt), false);
  assert.equal(stationGesperrt({ art: "packen", mitarbeiter_id: 1, sperrzeit_minuten: 10, letzte_aktivitaet: "2027-05-01T09:49:00Z" }, jetzt), true);
  assert.equal(stationGesperrt({ art: "anzeige", mitarbeiter_id: null }, jetzt), false);
});

test("R-11c 5 falsche PINs in Folge → 30 s warten, danach neuer Versuch", () => {
  const jetzt = 1_000_000;
  assert.deepEqual(nachFehlversuch(0, jetzt), { fehlversuche: 1, gesperrtBis: null, rest: 4 });
  const f = nachFehlversuch(4, jetzt);
  assert.equal(f.fehlversuche, 0);
  assert.equal(f.gesperrtBis.getTime(), jetzt + 30_000);
  assert.equal(pinWartezeit({ gesperrt_bis: f.gesperrtBis }, jetzt + 10_000), 20);
  assert.equal(pinWartezeit({ gesperrt_bis: f.gesperrtBis }, jetzt + 31_000), 0);
});

test("R-11d ERLAUBT-Muster: Station-Seiten, Scan/Vermisst/Prüfung, Packen/Rückgabe/Verladen, Gerätedetail, Packliste; sonst nicht", () => {
  for (const [m, p] of [["GET", "/api/v1/station/zustand"], ["POST", "/api/v1/abmelden"], ["POST", "/api/v1/scan"], ["POST", "/api/v1/vermisst"], ["POST", "/api/v1/pruefung"],
    ["GET", "/api/v1/projekte/3/packstatus"], ["GET", "/api/v1/projekte/3/rueckgabe"], ["POST", "/api/v1/projekte/3/verladen"], ["POST", "/api/v1/projekte/3/packen-oeffnen"],
    ["GET", "/api/v1/geraete/7"], ["GET", "/api/v1/geraete/code/LI-0001"], ["GET", "/api/v1/angebote/2/packliste.pdf"], ["GET", "/api/v1/anzeige/zonen"]])
    assert.equal(stationDarf("packen", m, p).erlaubt, true, `${m} ${p}`);
  for (const [m, p] of [["GET", "/api/v1/kunden"], ["POST", "/api/v1/projekte/3/status"], ["GET", "/api/v1/verwaltung/arbeitsplaetze"], ["DELETE", "/api/v1/geraete/7"], ["GET", "/api/v1/projekte"]])
    assert.equal(stationDarf("rueckgabe", m, p).erlaubt, false, `${m} ${p}`);
  assert.equal(stationDarf("packen", "GET", "/api/v1/station/zustand").sperrfrei, true);
  assert.equal(stationDarf("packen", "POST", "/api/v1/scan").sperrfrei, false);
  assert.equal(stationDarf("anzeige", "POST", "/api/v1/scan").erlaubt, false, "Anzeige nur Anzeige");
  assert.equal(stationDarf("anzeige", "GET", "/api/v1/anzeige/zonen").erlaubt, true);
  assert.equal(stationDarf("anzeige", "GET", "/api/v1/anzeige/zonen").sperrfrei, true);
  assert.equal(stationDarf("packen", "GET", "/api/v1/anzeige/zonen").sperrfrei, false, "Lagerplatz zeigt Projektdaten erst entsperrt");
});

test("FA-25 Eingaben Arbeitsplatz/Mitarbeiter: Packplatz braucht Zone, Funktionstest nur Rückgabe, PIN 4–8 Ziffern", () => {
  assert.equal(pruefeArbeitsplatz({ name: "P1", art: "packen" }).fehler.ladezone_id !== undefined, true);
  assert.deepEqual(pruefeArbeitsplatz({ name: " R ", art: "rueckgabe", funktionstest: true }).werte,
    { name: "R", art: "rueckgabe", sperrzeit_minuten: 10, ladezone_id: null, funktionstest: true, aktiv: true });
  assert.equal(pruefeArbeitsplatz({ name: "P", art: "packen", ladezone_id: "3", funktionstest: true }).werte.funktionstest, false);
  assert.ok(pruefeArbeitsplatz({ name: "x", art: "kaffee", sperrzeit_minuten: 0 }).fehler.art);
  assert.equal(pruefeMitarbeiter({ name: "Lea", pin: "123" }).fehler.pin !== undefined, true);
  assert.equal(pruefeMitarbeiter({ name: "Lea", pin: "" }).werte.pin, "");
  assert.equal(pruefeMitarbeiter({ name: "Lea" }).werte.pin, undefined);
});
