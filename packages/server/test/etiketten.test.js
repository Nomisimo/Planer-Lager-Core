import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, admin, lager;
before(async () => {
  s = await starteTestServer();
  admin = await s.als("admin");
  lager = await s.als("lager", "Lager / Techniker");
});
after(async () => { await s.ende(); });

const kat = async (name, praefix) => (await admin("POST", "/api/v1/kategorien", { name, praefix })).json;
const artikel = async (w) => (await admin("POST", "/api/v1/artikel", w)).json;

test("R-29 Länge aus Name nur in Kabel-Kategorien, letzter Treffer, cm", async () => {
  const k = await kat("Stromkabel", "SK");
  const t = await kat("Traversen", "TV");
  assert.equal((await artikel({ name: "Schuko 3x1,5 5 m", kategorie_id: k.id })).artikel.laenge_m, 5);
  assert.equal((await artikel({ name: "Patch 50cm", kategorie_id: k.id })).artikel.laenge_m, 0.5);
  assert.equal((await artikel({ name: "Traverse 2 m", kategorie_id: t.id })).artikel.laenge_m, null);
});

test("R-29a Farbe je Länge beim ersten Auftreten, bleibt für immer; alle 12 vergeben → leer mit Hinweis; FA-12 Tabelle", async () => {
  const k = await kat("DMX-Kabel", "DK");
  const a5 = (await artikel({ name: "DMX 5 m", kategorie_id: k.id })).artikel;
  const { rows } = await s.db.pool.query("SELECT laenge_m, farbcode FROM kabel_laenge ORDER BY erstellt, laenge_m");
  assert.deepEqual(rows.slice(0, 2).map((r) => r.farbcode), ["Rot", "Blau"], "5 m zuerst (Rot), dann 0,5 m (Blau)");
  assert.equal(a5.farbcode, "Rot");
  await assert.rejects(s.db.pool.query("UPDATE kabel_laenge SET farbcode = 'Grün' WHERE laenge_m = 5"), /bleibt fest/);
  for (const l of [1, 2, 3, 7.5, 10, 15, 20, 25, 30, 50]) await artikel({ name: `DMX ${String(l).replace(".", ",")} m`, kategorie_id: k.id });
  const voll = (await artikel({ name: "DMX 100 m", kategorie_id: k.id })).artikel;
  assert.equal(voll.farbcode, "");
  const f = (await lager("GET", "/api/v1/kabel/farben")).json;
  assert.equal(f.zeilen.length, 13);
  assert.equal(f.zeilen.find((z) => z.laenge_m === 7.5).text, "7,5 m");
  assert.match(f.hinweis, /Alle 12 Farben/);
  assert.equal(new Set(f.zeilen.filter((z) => z.farbcode).map((z) => z.farbcode)).size, 12);
});

test("FA-12 Längen aus Namen neu erkennen", async () => {
  const k = await kat("Lautsprecherkabel", "LK");
  const a = (await artikel({ name: "Speakon 10 m", kategorie_id: k.id })).artikel;
  await s.db.pool.query("UPDATE artikel SET laenge_m = NULL, farbcode = '' WHERE id = $1", [a.id]);
  assert.equal((await lager("POST", "/api/v1/kabel/neu-erkennen", {})).status, 403);
  const r = await admin("POST", "/api/v1/kabel/neu-erkennen", {});
  assert.ok(r.json.geaendert >= 1);
  const neu = (await admin("GET", `/api/v1/artikel/${a.id}`)).json;
  assert.deepEqual([neu.laenge_m, neu.farbcode], [10, (await s.db.pool.query("SELECT farbcode FROM kabel_laenge WHERE laenge_m = 10")).rows[0].farbcode]);
});

test("R-73 T-01 Kabel-Assistent: „Kabel 5 m“, 3 Stück, Etiketten bestellen → 1 Artikel mit Länge und Farbe, 3 fortlaufende Codes, 0 Geräte", async () => {
  const k = await kat("Kabel Test", "KT");
  const r = await admin("POST", "/api/v1/kabel/assistent", { art: "Kabel", kategorie_id: k.id, kennzeichnung: "bestellen", zeilen: [{ laenge_m: 5, preis_tag: 250, anzahl: 3 }] });
  assert.equal(r.status, 200, r.json.text);
  assert.equal(r.json.artikel.length, 1);
  const a = (await admin("GET", `/api/v1/artikel/${r.json.artikel[0].id}`)).json;
  assert.deepEqual([a.name, a.laenge_m, a.preis_tag, a.geraete.length], ["Kabel 5 m", 5, 250, 0]);
  assert.ok(a.farbcode);
  assert.deepEqual(r.json.bestellung.codes, ["KT-0001", "KT-0002", "KT-0003"]);
  assert.match(r.json.bestellung.nummer, /^EB-\d{4}-\d{3}$/);
  // bestehende Namen werden nicht doppelt angelegt; qr legt Geräte an
  const z = await admin("POST", "/api/v1/kabel/assistent", { art: "Kabel", kategorie_id: k.id, kennzeichnung: "qr", zeilen: [{ laenge_m: 5, anzahl: 1 }, { laenge_m: 7.5, preis_tag: 375, anzahl: 2 }] });
  assert.deepEqual(z.json.artikel.map((x) => [x.name, x.neu]), [["Kabel 5 m", false], ["Kabel 7,5 m", true]]);
  assert.deepEqual(z.json.geraete.codes, ["KT-0004", "KT-0005", "KT-0006"], "reservierte Codes werden nicht erneut vergeben (R-21)");
  const f = await admin("POST", "/api/v1/kabel/assistent", { art: "", kategorie_id: k.id, zeilen: [] });
  assert.equal(f.status, 400);
  assert.ok(f.json.felder.art && f.json.felder.zeilen);
});

test("R-67 FA-13 Bestellung über 5 Kabel: 5 reservierte, aufeinanderfolgende Codes ohne Geräte; Grenzen; R-72 bestellen", async () => {
  const k = await kat("XLR-Kabel", "XL");
  const a = (await artikel({ name: "XLR 10 m", kategorie_id: k.id })).artikel;
  const r = await admin("POST", "/api/v1/etiketten/bestellungen", { positionen: [{ artikel_id: a.id, menge: 5 }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.bestellung.codes, ["XL-0001", "XL-0002", "XL-0003", "XL-0004", "XL-0005"]);
  assert.equal((await admin("GET", `/api/v1/artikel/${a.id}`)).json.geraete.length, 0);
  const d = (await admin("GET", `/api/v1/etiketten/bestellungen/${r.json.bestellung.id}`)).json;
  assert.deepEqual([d.status, d.gesamt, d.lieferant], ["offen", 5, "Stromstoss"]);
  assert.equal((await admin("POST", "/api/v1/etiketten/bestellungen", { positionen: [{ artikel_id: a.id, menge: 501 }] })).status, 400);
  assert.equal((await admin("POST", "/api/v1/etiketten/bestellungen", { positionen: [{ artikel_id: a.id, menge: 300 }, { artikel_id: a.id, menge: 201 }] })).status, 400, "höchstens 500 je Artikel");
  assert.equal((await admin("POST", "/api/v1/etiketten/bestellungen", { positionen: [{ artikel_id: a.id, menge: 0 }] })).status, 400);
  const vb = (await artikel({ name: "Gaffa", kategorie_id: k.id, verbrauch: true })).artikel;
  const v = await admin("POST", "/api/v1/etiketten/bestellungen", { positionen: [{ artikel_id: vb.id, menge: 2 }] });
  assert.equal(v.status, 400);
  assert.match(v.json.text, /Verbrauch oder Leistung/);
  assert.equal((await lager("POST", "/api/v1/etiketten/bestellungen", { positionen: [{ artikel_id: a.id, menge: 1 }] })).status, 403);
  // R-72 Kennzeichnung „bestellen“ beim Anlegen
  const n = await admin("POST", "/api/v1/artikel", { name: "XLR 20 m", kategorie_id: k.id, anzahl: 2, kennzeichnung: "bestellen" });
  assert.equal(n.status, 200);
  assert.deepEqual(n.json.bestellung.codes, ["XL-0006", "XL-0007"]);
  assert.equal(n.json.geraete, null);
  // R-72 „keine“ und Verbrauch mit Kennzeichnung: weder Geräte noch Bestellung
  const keine = (await admin("POST", "/api/v1/artikel", { name: "XLR 30 m", kategorie_id: k.id, anzahl: 2, kennzeichnung: "keine" })).json;
  assert.deepEqual([keine.geraete, keine.bestellung], [null, null]);
  const vk = (await admin("POST", "/api/v1/artikel", { name: "Kabelbinder", kategorie_id: k.id, verbrauch: true, anzahl: 5, kennzeichnung: "bestellen" })).json;
  assert.deepEqual([vk.geraete, vk.bestellung], [null, null]);
  const zweite = (await admin("GET", "/api/v1/etiketten/bestellungen")).json.zeilen.map((b) => b.nummer);
  assert.equal(new Set(zweite).size, zweite.length, "Bestellnummern eindeutig");
});

test("R-68 Liste für den Lieferanten: PDF und CSV (auch ohne Bindestrich)", async () => {
  const k = await kat("Netzkabel", "NK");
  const a = (await artikel({ name: "Kaltgeräte 2 m", kategorie_id: k.id })).artikel;
  const b = (await admin("POST", "/api/v1/etiketten/bestellungen", { positionen: [{ artikel_id: a.id, menge: 2 }] })).json.bestellung;
  const h = { Authorization: "Bearer " + admin.token };
  const p = await fetch(`${s.url}/api/v1/etiketten/bestellungen/${b.id}/liste.pdf`, { headers: h });
  assert.equal(p.headers.get("content-type"), "application/pdf");
  assert.equal(Buffer.from(await p.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
  const c = await (await fetch(`${s.url}/api/v1/etiketten/bestellungen/${b.id}/liste.csv`, { headers: h })).text();
  assert.match(c, /NK-0001;Kaltgeräte 2 m;2 m;/);
  const o = await (await fetch(`${s.url}/api/v1/etiketten/bestellungen/${b.id}/liste.csv?ohne_bindestrich=1`, { headers: h })).text();
  assert.match(o, /\nNK0001;/);
  assert.ok(!/NK-0001/.test(o));
});

test("R-69 R-70 T-02 T-03 Lieferung buchen erzeugt genau die gescannten Geräte; nicht gelieferter Code meldet Bestellnummer; 4.4 Löschen", async () => {
  const k = await kat("Mikrofonkabel", "MK");
  const a = (await artikel({ name: "Mikro 5 m", kategorie_id: k.id })).artikel;
  const b = (await admin("POST", "/api/v1/etiketten/bestellungen", { positionen: [{ artikel_id: a.id, menge: 3 }] })).json.bestellung;
  // T-03: Code einer noch nicht gelieferten Bestellung scannen
  const t3 = await lager("GET", "/api/v1/geraete/code/mk3");
  assert.equal(t3.status, 404);
  assert.equal(t3.json.level, "error");
  assert.match(t3.json.text, new RegExp(`Bestellung ${b.nummer}`));
  // Teil-Lieferung: Groß/klein und Bindestrich egal, fremder Code gemeldet
  const t = await admin("POST", `/api/v1/etiketten/bestellungen/${b.id}/liefern`, { codes: ["mk0001", "XX-0001"] });
  assert.deepEqual([t.json.gebucht, t.json.unbekannt, t.json.status], [["MK-0001"], ["XX-0001"], "teilweise"]);
  assert.equal((await admin("DELETE", `/api/v1/etiketten/bestellungen/${b.id}`)).status, 409, "nach erster Lieferung nicht löschbar");
  // T-02: Rest liefern
  const r = await admin("POST", `/api/v1/etiketten/bestellungen/${b.id}/liefern`, { codes: ["MK-0002", "mk-0003", "MK-0001"] });
  assert.deepEqual([r.json.gebucht, r.json.schon_geliefert, r.json.status], [["MK-0002", "MK-0003"], ["MK-0001"], "geliefert"]);
  const g = (await admin("GET", `/api/v1/artikel/${a.id}`)).json.geraete.map((x) => x.code);
  assert.deepEqual(g, ["MK-0001", "MK-0002", "MK-0003"]);
  assert.equal((await lager("GET", "/api/v1/geraete/code/mk3")).status, 200);
  const d = (await admin("GET", `/api/v1/etiketten/bestellungen/${b.id}`)).json;
  assert.ok(d.codes.every((c) => c.geraet_id && c.geliefert_am));
  // offene Bestellung löschen; Codes werden nicht neu vergeben
  const b2 = (await admin("POST", "/api/v1/etiketten/bestellungen", { positionen: [{ artikel_id: a.id, menge: 1 }] })).json.bestellung;
  assert.equal((await admin("DELETE", `/api/v1/etiketten/bestellungen/${b2.id}`)).status, 200);
  const n = await admin("POST", `/api/v1/artikel/${a.id}/geraete`, { anzahl: 1 });
  assert.deepEqual(n.json.codes, ["MK-0005"]);
});

test("FA-10 Druckdaten: QR für alle, Barcode und Farbfeld für Kabel; FA-11 Vorlagen kopieren, Standard, Vorschau", async () => {
  const k = await kat("Kabel Druck", "KD");
  const s1 = await kat("Scheinwerfer", "SW");
  const kab = await artikel({ name: "Druckkabel 3 m", kategorie_id: k.id, anzahl: 1, kennzeichnung: "qr" });
  const sw = await artikel({ name: "PAR 64", kategorie_id: s1.id, anzahl: 1, kennzeichnung: "qr" });
  const r = (await lager("POST", "/api/v1/etiketten/druck", { codes: [kab.geraete.codes[0], "sw1", "SW-9999"] })).json;
  assert.deepEqual(r.fehlend, ["SW-9999"]);
  const ek = r.etiketten.find((e) => e.code === "KD-0001"), es = r.etiketten.find((e) => e.code === "SW-0001");
  assert.ok((ek.svg.match(/<rect x=/g) || []).length > 20, "Kabel: Barcode");
  assert.match(ek.svg, />3 m</);
  assert.match(es.svg, /<path d="M/, "QR");
  assert.deepEqual([es.breite_mm, es.hoehe_mm], [62, 29]);
  assert.ok(sw.geraete);
  // Vorlagen
  const v = (await lager("GET", "/api/v1/etiketten/vorlagen")).json.zeilen;
  assert.deepEqual(v.filter((x) => x.standard).map((x) => x.art).sort(), ["allgemein", "kabel"]);
  const std = v.find((x) => x.standard && x.art === "allgemein");
  assert.equal((await admin("DELETE", `/api/v1/etiketten/vorlagen/${std.id}`)).status, 409);
  const kopie = (await admin("POST", `/api/v1/etiketten/vorlagen/${std.id}/kopieren`, {})).json.vorlage;
  assert.equal(kopie.name, `Kopie von ${std.name}`);
  assert.equal((await admin("POST", `/api/v1/etiketten/vorlagen/${std.id}/kopieren`, {})).json.vorlage.name, `Kopie 2 von ${std.name}`);
  const neu = { ...kopie, name: "Klein 40x20", breite_mm: 40, hoehe_mm: 20, elemente: [{ typ: "qr", x: 1, y: 1, b: 18, h: 18, dreh: 0 }, { typ: "code", x: 20, y: 4, b: 19, h: 6, dreh: 90, groesse: 4 }] };
  assert.equal((await admin("PUT", `/api/v1/etiketten/vorlagen/${kopie.id}`, neu)).status, 200);
  assert.equal((await admin("PUT", `/api/v1/etiketten/vorlagen/${kopie.id}`, neu)).status, 409, "veraltete Version");
  assert.equal((await admin("PUT", `/api/v1/etiketten/vorlagen/${kopie.id}`, { ...neu, version: undefined, elemente: [{ typ: "foo", x: 0, y: 0, b: 1, h: 1 }] })).status, 400);
  assert.equal((await admin("POST", `/api/v1/etiketten/vorlagen/${kopie.id}/standard`, {})).status, 200);
  const v2 = (await lager("GET", "/api/v1/etiketten/vorlagen")).json.zeilen;
  assert.deepEqual(v2.filter((x) => x.standard && x.art === "allgemein").map((x) => x.id), [kopie.id]);
  const d2 = (await lager("POST", "/api/v1/etiketten/druck", { codes: ["SW-0001"] })).json.etiketten[0];
  assert.deepEqual([d2.vorlage_id, d2.breite_mm], [kopie.id, 40]);
  assert.match(d2.svg, /rotate\(90/);
  const vs = (await lager("POST", "/api/v1/etiketten/vorschau", { vorlage: neu })).json.svg;
  assert.match(vs, /width="40mm"/);
  assert.equal((await lager("POST", "/api/v1/etiketten/vorlagen", neu)).status, 403);
});
