import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tagesfaktor, positionSumme, angebotSumme, mengenschrittFehler, pruefePosition, reservierungsArt, reservierungsZeitraum,
  ueberschneidet, bestandVon, verfuegbarkeit, ueberbuchungHinweis, zeitrechner, packliste, angebotWechselErlaubt,
  angebotBearbeitbar, projektStatusNachAngebot, pruefeEinstellungen, mitStandard,
} from "../src/index.js";

test("FA-41 R-28 Akzeptanz: 4 Tage, Folgetag 50 %, Menge 2, 10 € = 2 × (1 + 3 × 0,5) × 10 = 50,00 €", () => {
  assert.equal(positionSumme({ art: "miete", menge: 2, tage: 4, folgetag_prozent: 50, einzelpreis: 1000 }), 5000);
});

test("R-28a Tagesfaktor: Miete > 1 Tag mit Folgetag, Miete 1 Tag = 1, Verkauf = 1, frei = Tage", () => {
  assert.equal(tagesfaktor("miete", 4, 50), 2.5);
  assert.equal(tagesfaktor("miete", 1, 50), 1);
  assert.equal(tagesfaktor("miete", 3, 0), 1);
  assert.equal(tagesfaktor("miete", 2, 100), 2);
  assert.equal(tagesfaktor("verkauf", 5, 50), 1);
  assert.equal(tagesfaktor("frei", 3, 50), 3);
  assert.equal(tagesfaktor("frei", 0, 50), 1);
});

test("R-28 Positionssumme kaufmännisch gerundet, gebrochene Mengen ohne Float-Fehler", () => {
  // 3 × (1 + 1 × 33 %) × 3,33 € = 3 × 1,33 × 333 = 1328,67 → 1329
  assert.equal(positionSumme({ art: "miete", menge: 3, tage: 2, folgetag_prozent: 33, einzelpreis: 333 }), 1329);
  // 0,5 × 1 × 1 Cent = 0,5 → 1 (halber Cent von 0 weg)
  assert.equal(positionSumme({ art: "verkauf", menge: 0.5, tage: 1, einzelpreis: 1 }), 1);
  // 2,55 × 1,15 € = 293,25 → 293
  assert.equal(positionSumme({ art: "frei", menge: 2.55, tage: 1, einzelpreis: 115 }), 293);
  assert.equal(positionSumme({ art: "verkauf", menge: 0.1, tage: 1, einzelpreis: 30 }), 3);
});

test("R-28b Angebotssumme: Rabatt auf Gesamtsumme gerundet, USt nur ohne Kleinunternehmer, Brutto", () => {
  const pos = [{ art: "miete", menge: 2, tage: 4, folgetag_prozent: 50, einzelpreis: 1000 }, { art: "frei", menge: 1, tage: 1, einzelpreis: 3333 }];
  const s = angebotSumme(pos, { rabatt_prozent: 10, ust_satz: 19 });
  assert.deepEqual(s, { zwischensumme: 8333, rabatt: 833, netto: 7500, ust: 1425, brutto: 8925 });
  const k = angebotSumme(pos, { rabatt_prozent: 2.5, kleinunternehmer: true, ust_satz: 19 });
  assert.equal(k.rabatt, 208); // 208,325 → 208
  assert.equal(k.ust, 0);
  assert.equal(k.brutto, k.netto);
  assert.equal(angebotSumme([], {}).brutto, 0);
  assert.equal(angebotSumme(pos, { ust_satz: 7 }).ust, 583); // 8333 × 7 % = 583,31
});

test("FA-41 Mengenschritt-Prüfung: nur Vielfache des Sets", () => {
  assert.equal(mengenschrittFehler(8, 4), null);
  assert.match(mengenschrittFehler(6, 4), /4er-Set vermietet\. Nimm 8 statt 6/);
  assert.match(mengenschrittFehler(2, 4), /Nimm 4 statt 2/);
  assert.equal(mengenschrittFehler(3, 1), null);
  assert.match(pruefePosition({ art: "miete", artikel_id: 1, menge: 5, tage: 1, einzelpreis: 0, mengenschritt: 4 }), /4er-Set/);
  assert.equal(pruefePosition({ art: "verkauf", artikel_id: 1, menge: 5, tage: 1, einzelpreis: 0, mengenschritt: 4 }), null);
  assert.match(pruefePosition({ art: "frei", menge: 1, tage: 1, einzelpreis: 0 }), /Bezeichnung/);
  assert.match(pruefePosition({ art: "miete", menge: 1, tage: 1, einzelpreis: 0 }), /Artikel/);
  assert.match(pruefePosition({ art: "frei", bezeichnung: "x", menge: 0, tage: 1, einzelpreis: 0 }), /Menge/);
  assert.match(pruefePosition({ art: "frei", bezeichnung: "x", menge: 1.234, tage: 1, einzelpreis: 0 }), /Nachkommastellen/);
  assert.match(pruefePosition({ art: "frei", bezeichnung: "x", menge: 1, tage: 0, einzelpreis: 0 }), /Tage/);
  assert.match(pruefePosition({ art: "frei", bezeichnung: "x", menge: 1, tage: 1, einzelpreis: -1 }), /Einzelpreis/);
  assert.match(pruefePosition({ art: "x" }), /Art/);
});

test("R-24 Reservierung: angenommen fest (außer Projekt abgeschlossen/storniert), versendet vorgemerkt bis gueltig_bis", () => {
  const heute = "2026-11-14";
  assert.equal(reservierungsArt({ status: "angenommen" }, { status: "bestaetigt" }, heute), "fest");
  assert.equal(reservierungsArt({ status: "angenommen" }, { status: "abgeschlossen" }, heute), null);
  assert.equal(reservierungsArt({ status: "angenommen" }, { status: "storniert" }, heute), null);
  assert.equal(reservierungsArt({ status: "versendet", gueltig_bis: "2026-11-14" }, { status: "anfrage" }, heute), "vorgemerkt");
  assert.equal(reservierungsArt({ status: "versendet", gueltig_bis: null }, { status: "anfrage" }, heute), "vorgemerkt");
  assert.equal(reservierungsArt({ status: "versendet", gueltig_bis: "2026-11-13" }, { status: "anfrage" }, heute), null);
  assert.equal(reservierungsArt({ status: "entwurf" }, { status: "anfrage" }, heute), null);
  assert.equal(reservierungsArt({ status: "abgelehnt" }, { status: "anfrage" }, heute), null);
});

test("R-25 Zeitraum und Überschneidung (Grenzen inklusive, fehlendes Datum = immer)", () => {
  assert.deepEqual(reservierungsZeitraum({ beginn: "2026-12-01", ende: null }), { von: "2026-12-01", bis: "2026-12-01" });
  assert.deepEqual(reservierungsZeitraum({ beginn: null, ende: null }), { von: null, bis: null });
  const a = { von: "2026-12-01", bis: "2026-12-03" };
  assert.ok(ueberschneidet(a, { von: "2026-12-03", bis: "2026-12-05" }));
  assert.ok(ueberschneidet(a, { von: "2026-11-01", bis: "2026-12-01" }));
  assert.ok(!ueberschneidet(a, { von: "2026-12-04", bis: "2026-12-05" }));
  assert.ok(!ueberschneidet(a, { von: "2026-11-01", bis: "2026-11-30" }));
  assert.ok(ueberschneidet(a, { von: null, bis: null }));
});

test("R-26 R-17 Bestand: Leistung unbegrenzt, Verbrauch = bestand, sonst einsatzfähige Geräte", () => {
  assert.equal(bestandVon({ ist_leistung: true }, 0), null);
  assert.equal(bestandVon({ verbrauch: true, bestand: 40 }, 0), 40);
  assert.equal(bestandVon({}, 7), 7);
});

test("R-27 FA-42 Verfügbar = Bestand − überschneidende Reservierungen außer eigenem Angebot; negativ = Hinweis, kein Block", () => {
  const res = [
    { angebot_id: 1, menge: 4, von: "2026-12-01", bis: "2026-12-03" },
    { angebot_id: 2, menge: 3, von: "2026-12-02", bis: "2026-12-02" },
    { angebot_id: 3, menge: 5, von: "2027-01-01", bis: "2027-01-02" },
  ];
  const z = { von: "2026-12-02", bis: "2026-12-04" };
  assert.deepEqual(verfuegbarkeit(6, res, z), { bestand: 6, reserviert: 7, verfuegbar: -1 });
  assert.deepEqual(verfuegbarkeit(6, res, z, 1), { bestand: 6, reserviert: 3, verfuegbar: 3 });
  assert.equal(verfuegbarkeit(null, res, z).verfuegbar, null);
  assert.match(ueberbuchungHinweis(5, verfuegbarkeit(6, res, z, 1)), /Überbucht: 2 fehlen.*Speichern geht trotzdem/);
  assert.equal(ueberbuchungHinweis(3, verfuegbarkeit(6, res, z, 1)), null);
  assert.equal(ueberbuchungHinweis(99, verfuegbarkeit(null, res, z)), null);
});

test("R-28c FA-45 Zeitrechner: Tagessatz bis 8 h, erweitert bis 10 h, darüber Überstunden", () => {
  const e = { tag_stunden_standard: 8, tag_stunden_erweitert: 10 };
  const p = { tagessatz: 40000, erweitert: 50000 };
  assert.equal(zeitrechner(6, p, e).summe, 40000);
  assert.equal(zeitrechner(8, p, e).stufe, "standard");
  assert.equal(zeitrechner(8.5, p, e).summe, 50000);
  assert.equal(zeitrechner(10, p, e).stufe, "erweitert");
  const u = zeitrechner(12, p, e);
  assert.deepEqual([u.stufe, u.ueberstunden, u.ueberstundenSatz, u.summe], ["ueberstunden", 2, 5000, 60000]);
  assert.equal(zeitrechner(12, { tagessatz: 40000 }, e).summe, 48000); // ohne erweiterten Satz: Tagessatz weiter
  assert.equal(zeitrechner(3.5, { tagessatz: 4500, zeitmodell: "stunde" }, e).summe, 15750);
  assert.equal(zeitrechner(14, { tagessatz: 25000, zeitmodell: "pauschale" }, e).summe, 25000);
});

test("R-51 R-52 R-53 R-54 Packliste: zusammengezählt, ohne Leistungen/freie, sortiert, ist/gepackt, Sets, Case-Inhalt", () => {
  const artikel = new Map([
    [1, { id: 1, name: "Spot", kategorie: "Licht", mengenschritt: 4 }],
    [2, { id: 2, name: "Gaffa", kategorie: "Verbrauch", verbrauch: true, einheit: "Rolle" }],
    [3, { id: 3, name: "Techniker", kategorie: "Personal", ist_leistung: true }],
    [4, { id: 4, name: "Spot-Case", kategorie: "Cases", ist_case: true, inhalt: { name: "Spot" }, soll_inhalt: 4 }],
    [5, { id: 5, name: "Akku", kategorie: "Licht" }],
  ]);
  const pos = [
    { art: "miete", artikel_id: 1, menge: 4 }, { art: "miete", artikel_id: 1, menge: 4 },
    { art: "verkauf", artikel_id: 2, menge: 3 }, { art: "miete", artikel_id: 3, menge: 1 },
    { art: "frei", artikel_id: null, menge: 1 }, { art: "miete", artikel_id: 4, menge: 2 }, { art: "miete", artikel_id: 5, menge: 2 },
  ];
  const z = packliste(pos, artikel, new Map([[1, { ist: 8, gepackt: 8 }], [5, { ist: 2, gepackt: 1 }]]));
  assert.deepEqual(z.map((x) => x.artikel), ["Spot-Case", "Akku", "Spot", "Gaffa"]);
  const spot = z.find((x) => x.artikel === "Spot");
  assert.deepEqual([spot.soll, spot.ist, spot.gepackt, spot.fertig, spot.set.text], [8, 8, 8, true, "2 × 4er-Set"]);
  const akku = z.find((x) => x.artikel === "Akku");
  assert.deepEqual([akku.fertig, akku.set], [false, undefined]);
  const gaffa = z.find((x) => x.artikel === "Gaffa");
  assert.deepEqual([gaffa.ist, gaffa.gepackt, gaffa.fertig], [null, null, null]);
  assert.equal(z.find((x) => x.artikel === "Spot-Case").inhalt.text, "Inhalt: Spot × 4");
  // kein Vielfaches → keine Set-Zeile
  assert.equal(packliste([{ art: "miete", artikel_id: 1, menge: 6 }], artikel)[0].set, undefined);
});

test("4.2 Angebotsstatus: Übergänge, Bearbeitbarkeit, Projektstatus-Folge", () => {
  assert.ok(angebotWechselErlaubt("entwurf", "versendet"));
  assert.ok(!angebotWechselErlaubt("entwurf", "angenommen"));
  assert.ok(angebotWechselErlaubt("versendet", "versendet"));
  assert.ok(angebotWechselErlaubt("versendet", "angenommen"));
  assert.ok(angebotWechselErlaubt("versendet", "abgelehnt"));
  assert.ok(!angebotWechselErlaubt("angenommen", "abgelehnt"));
  assert.ok(angebotBearbeitbar("entwurf") && angebotBearbeitbar("versendet"));
  assert.ok(!angebotBearbeitbar("angenommen") && !angebotBearbeitbar("abgelehnt"));
  assert.equal(projektStatusNachAngebot("anfrage", "versendet"), "angebot_gesendet");
  assert.equal(projektStatusNachAngebot("bestaetigt", "versendet"), null);
  assert.equal(projektStatusNachAngebot("angebot_gesendet", "angenommen"), "bestaetigt");
  assert.equal(projektStatusNachAngebot("laeuft", "angenommen"), null);
});

test("3.14 Einstellungen Kleinunternehmer/USt-Satz: Standard und Prüfung", () => {
  assert.equal(mitStandard({}).kleinunternehmer, false);
  assert.equal(mitStandard({}).ust_satz, 19);
  assert.ok(pruefeEinstellungen({ ust_satz: 7 }, {}).ok);
  assert.ok(!pruefeEinstellungen({ ust_satz: 120 }, {}).ok);
  assert.ok(!pruefeEinstellungen({ kleinunternehmer: "ja" }, {}).ok);
});
