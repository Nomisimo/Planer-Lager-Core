import { test } from "node:test";
import assert from "node:assert/strict";
import { konflikte, ueberschneiden, icsKalender, ladungsGewicht } from "../src/index.js";

test("FA-37 Konflikterkennung: Doppelbuchung bei Überschneidung, angrenzend erlaubt, Abwesenheit ganztägig", () => {
  const neu = { beginn: "2027-05-01T08:00:00+02:00", ende: "2027-05-01T16:00:00+02:00" };
  assert.equal(ueberschneiden(neu.beginn, neu.ende, "2027-05-01T16:00:00+02:00", "2027-05-01T20:00:00+02:00"), false);
  assert.deepEqual(konflikte(neu, [{ beginn: "2027-05-01T16:00:00+02:00", ende: "2027-05-01T20:00:00+02:00" }]), []);
  const k = konflikte(neu, [{ id: 7, beginn: "2027-05-01T12:00:00+02:00", ende: "2027-05-01T18:00:00+02:00", projekt: "P-2027-002 Messe" }]);
  assert.equal(k.length, 1);
  assert.match(k[0], /^Doppelbuchung: schon eingeplant 01\.05\.2027 12:00 – 01\.05\.2027 18:00 \(P-2027-002 Messe\)\.$/);
  assert.deepEqual(konflikte({ ...neu, id: 7 }, [{ id: 7, beginn: neu.beginn, ende: neu.ende }]), [], "eigener Eintrag zählt nicht");
  assert.match(konflikte(neu, [], [{ von: "2027-04-28", bis: "2027-05-01", grund: "Urlaub" }])[0], /Nicht verfügbar 28\.04\.2027 – 01\.05\.2027 \(Urlaub\)/);
  assert.deepEqual(konflikte(neu, [], [{ von: "2027-05-02", bis: "2027-05-03" }]), []);
});

test("FA-37 Einsatzplan als iCalendar: UTC-Zeiten, Sonderzeichen maskiert, Zeilen gefaltet", () => {
  const ics = icsKalender("Einsätze Max", [{ uid: "einsatz-1@planer-lager", beginn: "2027-05-01T08:00:00+02:00", ende: "2027-05-01T16:00:00+02:00",
    titel: "P-2027-001 Stadtfest, Aufbau; Licht", ort: "Halle 1", beschreibung: "Zeile 1\nZeile 2 " + "x".repeat(80) }], new Date("2027-04-01T00:00:00Z"));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20270501T060000Z\r\nDTEND:20270501T140000Z/);
  assert.match(ics, /SUMMARY:P-2027-001 Stadtfest\\, Aufbau\; Licht/);
  assert.ok(ics.split("\r\n").every((z) => Buffer.byteLength(z) <= 75), "gefaltet");
  assert.match(ics, /END:VEVENT\r\nEND:VCALENDAR\r\n$/);
});

test("FA-38 Zuladung: Gewicht aus Menge × Artikelgewicht, Warnung bei Überladung, Artikel ohne Gewicht gezählt", () => {
  assert.deepEqual(ladungsGewicht([{ menge: 4, gewicht_kg: "12.5" }, { menge: 2, gewicht_kg: null }], 100), { kg: 50, ohneGewicht: 1, warnung: null });
  assert.match(ladungsGewicht([{ menge: 10, gewicht_kg: 12.5 }], 100).warnung, /Überladen: 125 kg bei 100 kg/);
});

test("FA-37 Ortszeit Berlin ↔ ISO, Sommer- und Winterzeit", async () => {
  const { berlinZuIso, isoZuBerlin } = await import("../src/zeit.js");
  assert.equal(berlinZuIso("2027-05-01T08:00"), "2027-05-01T06:00:00.000Z");
  assert.equal(berlinZuIso("2027-01-15T08:00"), "2027-01-15T07:00:00.000Z");
  assert.equal(berlinZuIso("2027-03-28T03:30"), "2027-03-28T01:30:00.000Z", "nach der Umstellung");
  assert.equal(berlinZuIso("quatsch"), null);
  assert.equal(isoZuBerlin("2027-05-01T06:00:00.000Z"), "2027-05-01T08:00");
  assert.equal(isoZuBerlin(berlinZuIso("2027-10-31T12:15")), "2027-10-31T12:15");
});
