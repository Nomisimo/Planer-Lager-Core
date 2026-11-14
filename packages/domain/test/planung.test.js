import { test } from "node:test";
import assert from "node:assert/strict";
import { planungsKontext, herzschlag, timerMinuten, satzBasis, zeitBetrag, pruefeZeiteintrag, minutenAus, dauerText } from "../src/index.js";

test("R-62 R-63 Kontext: Projektseite = Planung, Packen/Rückgabe/Status/Zone/Verladen/Anzeige nie, neutrale Seiten", () => {
  assert.deepEqual(planungsKontext("/projekte/7"), { projekt: 7 });
  assert.deepEqual(planungsKontext("/projekte/7/dateien"), { projekt: 7 });
  for (const s of ["packen", "rueckgabe", "status", "zone", "verladen", "anzeige"]) assert.deepEqual(planungsKontext(`/projekte/7/${s}`), { planung: false }, s);
  assert.deepEqual(planungsKontext("/projekte/7/packen", 7), { planung: false }, "auch mit Projekt-Angabe");
  for (const s of ["/zeiterfassung", "/material/3", "/geraete", "/suche?q=x", "/kalender", "/design"]) assert.deepEqual(planungsKontext(s), { neutral: true }, s);
  assert.deepEqual(planungsKontext("/kunden"), { planung: false });
  assert.deepEqual(planungsKontext("/angebote/4", 9), { projekt: 9 });
  assert.deepEqual(planungsKontext("/angebote/4"), { neutral: true });
  assert.deepEqual(planungsKontext("/angebote"), { planung: false });
});

test("R-63 Herzschlag: gleiches Projekt/neutral → weiter; anderes Projekt/Nicht-Planung → Stopp jetzt; 300 s ohne Aktivität → Stopp bei letzter Aktivität", () => {
  const t0 = Date.parse("2027-05-01T10:00:00Z");
  const timer = { projekt_id: 7, laeuft_seit: new Date(t0), zuletzt_aktiv: new Date(t0 + 60_000) };
  assert.equal(herzschlag(timer, { projekt: 7 }, t0 + 120_000).aktion, "weiter");
  assert.equal(herzschlag(timer, { neutral: true }, t0 + 120_000).aktion, "weiter");
  const a = herzschlag(timer, { projekt: 8 }, t0 + 120_000);
  assert.deepEqual([a.aktion, a.ende.getTime(), a.grund], ["stopp", t0 + 120_000, "anderes_projekt"]);
  assert.equal(herzschlag(timer, { planung: false }, t0 + 120_000).grund, "keine_planung");
  const l = herzschlag(timer, { projekt: 7 }, t0 + 60_000 + 301_000);
  assert.deepEqual([l.aktion, l.ende.getTime(), l.grund], ["stopp", t0 + 60_000, "leerlauf"]);
  assert.equal(timerMinuten(new Date(t0), new Date(t0 + 89 * 60_000 + 40_000)), 90);
});

test("R-66 Satz: Posten je Stunde → Preis, sonst Tagessatz ÷ Standardstunden, ohne Posten Ersatzsatz; × Planungsprozent", () => {
  const e = { tag_stunden_standard: 8, zeit_basis_stundensatz: 6000 };
  assert.equal(satzBasis({ zeitmodell: "stunde", preis_tag: 7500 }, e), 7500);
  assert.equal(satzBasis({ zeitmodell: "tag", preis_tag: 64000 }, e), 8000);
  assert.equal(satzBasis({ zeitmodell: "tag", preis_tag: 50001 }, e), 6250, "kaufmännisch gerundet");
  assert.equal(satzBasis(null, e), 6000);
  assert.equal(zeitBetrag(90, 8000, 30), 3600, "1,5 h × 80 € × 30 % = 36 €");
  assert.equal(zeitBetrag(7, 6000, 30), 210);
  assert.equal(zeitBetrag(1, 3333, 30), 17, "16,665 → 17 Cent");
});

test("R-65 Nachbuchen: Eingaben, Dauer-Text", () => {
  assert.deepEqual(Object.keys(pruefeZeiteintrag({}).fehler).sort(), ["datum", "minuten", "projekt_id"]);
  assert.deepEqual(pruefeZeiteintrag({ projekt_id: "3", datum: "2027-05-01", minuten: 90, beschreibung: " Lichtplan " }).werte,
    { projekt_id: 3, datum: "2027-05-01", minuten: 90, beschreibung: "Lichtplan" });
  assert.equal(minutenAus("1:30"), 90);
  assert.equal(minutenAus("1,5"), 90);
  assert.equal(minutenAus("45"), 45);
  assert.ok(Number.isNaN(minutenAus("abc")));
  assert.equal(dauerText(125), "2:05 h");
});
