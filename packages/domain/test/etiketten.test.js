import { test } from "node:test";
import assert from "node:assert/strict";
import { code128Werte, code128Module } from "../src/barcode.js";
import { laengeAusName, naechsteFreieFarbe, KABELFARBEN, kabelName } from "../src/kabel.js";
import { etikettSvg, STANDARD_VORLAGE, KABEL_VORLAGE, BEISPIEL, naechsteBestellnummer, bestellStatus, lieferSchluessel, csvCode, pruefeBestellung, pruefeVorlage, snap } from "../src/etiketten.js";

test("Code 128: Zeichensatz B mit Prüfzeichen, Ziffernblöcke in C, Start/Stopp-Muster", () => {
  // "ABC": Start B (104), 33, 34, 35; Prüfzeichen (104+33+68+105) % 103 = 1; Stopp 106
  assert.deepEqual(code128Werte("ABC"), [104, 33, 34, 35, 1, 106]);
  // "LT-0001": L T - in B, dann 0001 in C (99 = Code C, 0, 1)
  const w = code128Werte("LT-0001");
  assert.deepEqual(w.slice(0, 7), [104, 44, 52, 13, 99, 0, 1]);
  assert.equal(w.at(-1), 106);
  const m = code128Module("ABC");
  assert.equal(m.length, 6 * 6 + 1, "6 Symbole à 6 Breiten + Stopp mit 7");
  assert.equal(m.slice(0, 6).join(""), "211214", "Start B");
  assert.equal(m.reduce((a, b) => a + b, 0), 5 * 11 + 13);
  assert.throws(() => code128Werte("Ä"));
});

test("R-29 Länge aus Name: letzter Treffer, cm/100, nur Kategorien mit „kabel“", () => {
  assert.equal(laengeAusName("Schuko 5 m", "Stromkabel"), 5);
  assert.equal(laengeAusName("XLR 7,5m", "Audiokabel"), 7.5);
  assert.equal(laengeAusName("Patch 50cm", "Netzwerkkabel"), 0.5);
  assert.equal(laengeAusName("CEE 32A 3m auf 10 m", "Kabel"), 10);
  assert.equal(laengeAusName("Traverse 2 m", "Traversen"), null);
  assert.equal(laengeAusName("Kabel 5 mm", "Kabel"), null, "mm ist keine Meterangabe");
  assert.equal(laengeAusName("Typ1.5m", "Kabel"), null, "vor der Zahl Buchstabe/Punkt");
  assert.equal(laengeAusName("DMX 10 Meter", "DMX-Kabel"), 10);
});

test("R-29a Farbe: nächste freie aus 12, alle vergeben → leer", () => {
  assert.equal(KABELFARBEN.length, 12);
  assert.equal(naechsteFreieFarbe([]), "Rot");
  assert.equal(naechsteFreieFarbe(["Rot", "Blau"]), "Grün");
  assert.equal(naechsteFreieFarbe(KABELFARBEN.map((f) => f.name)), null);
  assert.equal(kabelName("Schuko", 7.5), "Schuko 7,5 m");
});

test("FA-10 Etikett: QR für alle, Barcode für Kabel, Kabeletikett zeigt Länge auf Farbfeld (kein Farbname)", () => {
  const qr = [[true, false], [false, true]];
  const s = etikettSvg(STANDARD_VORLAGE, { ...BEISPIEL, qr });
  assert.match(s, /width="62mm" height="29mm"/);
  assert.match(s, /<path d="M/);
  assert.match(s, />LT-0001</);
  assert.match(s, />5 m</);
  assert.ok(!/Blau/.test(s));
  const k = etikettSvg(KABEL_VORLAGE, BEISPIEL);
  assert.ok((k.match(/<rect x=/g) || []).length > 20, "Barcode-Striche");
  assert.match(k, /fill="#1e66d0"/);
  const ohneLaenge = etikettSvg(STANDARD_VORLAGE, { ...BEISPIEL, laenge_m: null });
  assert.ok(!/>5 m</.test(ohneLaenge));
});

test("FA-11 Designer-Hilfen: Vorlage prüfen, Raster", () => {
  assert.deepEqual(pruefeVorlage(STANDARD_VORLAGE), {});
  assert.ok(pruefeVorlage({ ...STANDARD_VORLAGE, breite_mm: 2 }).breite_mm);
  assert.ok(pruefeVorlage({ ...STANDARD_VORLAGE, elemente: [{ typ: "x", x: 0, y: 0, b: 1, h: 1 }] }).elemente);
  assert.equal(snap(3.26), 3.5);
  assert.equal(snap(3.24), 3);
});

test("R-67 Bestellung prüfen; EB-JJJJ-NNN; Status offen/teilweise/geliefert; R-68 CSV ohne Bindestrich; R-69 Abgleich", () => {
  const art = new Map([[1, { name: "Kabel 5 m", praefix: "KS" }], [2, { name: "Gaffa", verbrauch: true, praefix: "VB" }], [3, { name: "X", praefix: "" }]]);
  assert.equal(pruefeBestellung([{ artikel_id: 1, menge: 3 }], art), null);
  assert.match(pruefeBestellung([{ artikel_id: 1, menge: 501 }], art), /500/);
  assert.match(pruefeBestellung([{ artikel_id: 2, menge: 1 }], art), /Verbrauch/);
  assert.match(pruefeBestellung([{ artikel_id: 3, menge: 1 }], art), /Kürzel/);
  assert.equal(naechsteBestellnummer(2026, ["EB-2026-004", "EB-2025-010"]), "EB-2026-005");
  assert.deepEqual([bestellStatus(3, 0), bestellStatus(3, 1), bestellStatus(3, 3)], ["offen", "teilweise", "geliefert"]);
  assert.equal(csvCode("KS-0001", true), "KS0001");
  assert.equal(lieferSchluessel("ks0001"), lieferSchluessel("KS-0001"));
});

test("R-73 Zeilenpreis = Länge × Meterpreis kaufmännisch gerundet; 12 Standardlängen", async () => {
  const { zeilenpreis, STANDARD_LAENGEN } = await import("../src/kabel.js");
  assert.equal(zeilenpreis(7.5, 33), 248, "7,5 × 0,33 € = 2,475 € → 2,48 €");
  assert.equal(zeilenpreis(0.5, 25), 13);
  assert.equal(zeilenpreis(5, null), null);
  assert.deepEqual(STANDARD_LAENGEN, [0.5, 1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 50]);
});
