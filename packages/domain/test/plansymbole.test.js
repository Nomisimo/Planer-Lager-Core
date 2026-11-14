import { test } from "node:test";
import assert from "node:assert/strict";
import { piktogrammVon, symbolSvg, symbolbibliothekGraphml, svgDateiname, plansymbolGueltig, PIKTOGRAMME } from "../src/plansymbole.js";
import { pruefeArtikel } from "../src/artikel.js";

test("FA-53 Piktogramm je Artikel: gesetzt, sonst aus Name/Kategorie/Art; ungültiges Symbol abgelehnt", () => {
  assert.equal(piktogrammVon({ name: "Robe T1", plansymbol: "movinghead" }), "movinghead");
  assert.equal(piktogrammVon({ name: "d&b E8 Top" }), "lautsprecher");
  assert.equal(piktogrammVon({ name: "Shure SM58" }), "mikrofon");
  assert.equal(piktogrammVon({ name: "Lampen-Tasche", ist_case: true }), "case");
  assert.equal(piktogrammVon({ name: "XLR 10 m", laenge_m: 10 }), "kabel");
  assert.equal(piktogrammVon({ name: "LED PAR 64", kategorie: "Licht" }), "led");
  assert.equal(piktogrammVon({ name: "Irgendwas" }), "sonstiges");
  assert.ok(plansymbolGueltig("") && plansymbolGueltig("kabel") && !plansymbolGueltig("toString") && !plansymbolGueltig("<svg>"));
  assert.match(pruefeArtikel({ name: "X", kategorie_id: 1, plansymbol: "rakete" }).plansymbol, /Plan-Symbol/);
  assert.equal(Object.keys(PIKTOGRAMME).length >= 20, true);
});

test("FA-53 SVG und yEd-GraphML: gültiges XML, Name maskiert, eine Ressource je Artikel", () => {
  const a = [{ id: 7, name: "Scheinwerfer <Profil> & Co" }, { id: 12, name: "Mischpult X32" }];
  const svg = symbolSvg(a[0]);
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /Scheinwerfer &lt;Profil&gt; &amp; Co/);
  assert.equal(svgDateiname({ id: 7, name: "Bühne Groß / 2x1" }), "0007-Buhne-Gross-2x1.svg");
  const g = symbolbibliothekGraphml(a);
  assert.match(g, /xmlns:y="http:\/\/www.yworks.com\/xml\/graphml"/);
  assert.equal((g.match(/<y:SVGNode>/g) || []).length, 2);
  assert.equal((g.match(/<y:Resource id=/g) || []).length, 2);
  assert.ok(!g.includes("<Profil>"), "Inhalt maskiert");
});
