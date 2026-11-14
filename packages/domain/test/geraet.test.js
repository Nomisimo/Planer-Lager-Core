import { test } from "node:test";
import assert from "node:assert/strict";
import { GESPERRT, istEinsatzfaehig, uebergangErlaubt, loeschSperre } from "../src/geraet.js";
import { artikeltyp, wendeArtAn, sollInhalt, bestandNiedrig, pruefeArtikel } from "../src/artikel.js";
import { pruefstatus, plusMonate } from "../src/pruefung.js";

test("R-16 gesperrt = vermisst, defekt, ausgemustert, verkauft", () => {
  assert.deepEqual([...GESPERRT].sort(), ["ausgemustert", "defekt", "verkauft", "vermisst"]);
});
test("R-17 einsatzfähig = im Lager, zugeordnet, gepackt", () => {
  for (const s of ["lager", "zugeordnet", "gepackt"]) assert.equal(istEinsatzfaehig(s), true);
  for (const s of ["vermisst", "defekt", "reparatur", "ausgemustert", "verkauft"]) assert.equal(istEinsatzfaehig(s), false);
});
test("Zustandsmodell 4.3 Gerät: erlaubte und verbotene Übergänge", () => {
  assert.equal(uebergangErlaubt("lager", "zugeordnet"), true);
  assert.equal(uebergangErlaubt("vermisst", "lager"), true);
  assert.equal(uebergangErlaubt("vermisst", "gepackt"), false);
  assert.equal(uebergangErlaubt("gepackt", "defekt"), true);
  assert.equal(uebergangErlaubt("defekt", "lager"), true);
  assert.equal(uebergangErlaubt("ausgemustert", "lager"), false, "endgültig");
});
test("R-19 Löschen: im Projekt verweigert (außer vermisst/ausgemustert); SOLL: mit Verlauf nie", () => {
  assert.match(loeschSperre({ code: "LT-0001", projekt_id: 3, status: "zugeordnet" }, 0), /Projekt zugeordnet/);
  assert.equal(loeschSperre({ code: "LT-0001", projekt_id: 3, status: "vermisst" }, 0), null);
  assert.match(loeschSperre({ code: "LT-0001", projekt_id: null, status: "lager" }, 2), /Mustere es stattdessen aus/);
  assert.equal(loeschSperre({ code: "LT-0001", projekt_id: null, status: "lager" }, 0), null);
});
test("3.7 Artikeltyp in Reihenfolge Dienstleistung, Case, Verbrauch, n-er-Set, Artikel; Soll-Inhalt Case", () => {
  assert.equal(artikeltyp({ ist_leistung: true, ist_case: true }), "Dienstleistung");
  assert.equal(artikeltyp({ ist_case: true, verbrauch: true }), "Case");
  assert.equal(artikeltyp({ verbrauch: true, mengenschritt: 4 }), "Verbrauch");
  assert.equal(artikeltyp({ mengenschritt: 4 }), "nur 4er-Set");
  assert.equal(artikeltyp({}), "Artikel");
  assert.equal(sollInhalt({ ist_case: true, verpackungseinheit: 6 }, { mengenschritt: 4 }), 4);
  assert.equal(sollInhalt({ ist_case: true, verpackungseinheit: 6 }, { mengenschritt: 1 }), 6);
});
test("R-71 Art setzt Kennzeichen, Verbrauch/Leistung leeren laenge_m", () => {
  const w = wendeArtAn({ laenge_m: 5, ist_case: true }, "verbrauch");
  assert.deepEqual([w.verbrauch, w.ist_case, w.ist_leistung, w.laenge_m], [true, false, false, null]);
  assert.equal(wendeArtAn({ laenge_m: 5 }, "leistung").laenge_m, null);
  assert.equal(wendeArtAn({ laenge_m: 5 }, "kabel").laenge_m, 5);
  assert.equal(wendeArtAn({}, "case").ist_case, true);
});
test("FA-01 Warnzeichen bei Bestand ≤ Mindestbestand (nur Verbrauch); Artikelprüfung", () => {
  assert.equal(bestandNiedrig({ verbrauch: true, bestand: 5, mindestbestand: 5 }), true);
  assert.equal(bestandNiedrig({ verbrauch: true, bestand: 6, mindestbestand: 5 }), false);
  assert.equal(bestandNiedrig({ verbrauch: false, bestand: 0, mindestbestand: 5 }), false);
  assert.deepEqual(Object.keys(pruefeArtikel({ name: "", preis_tag: 1.5 })).sort(), ["kategorie_id", "name", "preis_tag"]);
  assert.deepEqual(pruefeArtikel({ name: "X", kategorie_id: 1, preis_tag: 150 }), {});
});
test("5.10 Prüfstatus: keine, offen, überfällig, bald (≤ 30 Tage), ok; Monatsende", () => {
  const a = { pruefpflichtig: true, pruef_intervall_monate: 12 };
  assert.equal(plusMonate("2025-01-31", 1), "2025-02-28");
  assert.equal(plusMonate("2024-01-31", 1), "2024-02-29");
  assert.equal(plusMonate("2025-02-28", 12), "2026-02-28");
  assert.equal(pruefstatus({ pruefpflichtig: false }, null).status, "keine");
  assert.equal(pruefstatus(a, null).status, "offen");
  assert.deepEqual(pruefstatus(a, "2025-11-13", "2026-11-14"), { status: "ueberfaellig", naechste: "2026-11-13" });
  assert.equal(pruefstatus(a, "2025-12-14", "2026-11-14").status, "bald");
  assert.equal(pruefstatus(a, "2025-12-15", "2026-11-14").status, "ok");
  assert.equal(pruefstatus(a, "2025-11-14", "2026-11-14").status, "bald", "heute fällig = bald, nicht überfällig");
});
