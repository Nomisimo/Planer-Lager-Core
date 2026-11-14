import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { starteTestServer } from "./helfer.js";

let s, buero, lager, admin, kunde, jahr, kat, spot, gaffa, techniker, tasche, akku;
before(async () => {
  s = await starteTestServer();
  admin = await s.als("admin2", "Administrator");
  buero = await s.als("buero", "Büro / Disposition");
  lager = await s.als("lager", "Lager / Techniker");
  kunde = (await buero("POST", "/api/v1/kunden", { name: "Anna Müller", firma: "Stadtwerke", strasse: "Hauptstr. 1", plz: "50667", ort: "Köln" })).json.kunde;
  jahr = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(new Date());
  kat = (await admin("POST", "/api/v1/kategorien", { name: "Licht", praefix: "LI" })).json;
  const art = async (w, anzahl = 0) => (await admin("POST", "/api/v1/artikel", { kategorie_id: kat.id, anzahl, kennzeichnung: anzahl ? "qr" : "keine", ...w })).json;
  spot = (await art({ name: "Spot", preis_tag: 1000, mengenschritt: 4 }, 8)).artikel;
  akku = (await art({ name: "Akku", preis_tag: 500 }, 6)).artikel;
  gaffa = (await art({ name: "Gaffa", art: "verbrauch", verbrauch: true, bestand: 20, einheit: "Rolle", verkaeuflich: true, verkaufspreis: 900 })).artikel;
  techniker = (await art({ name: "Techniker", art: "leistung", ist_leistung: true, zeitmodell: "tag", preis_tag: 40000, preis_erweitert: 50000 })).artikel;
  tasche = (await art({ name: "Spot-Tasche", art: "case", ist_case: true, inhalt_artikel_id: spot.id }, 1)).artikel;
});
after(async () => { await s.ende(); });

const projekt = async (w) => (await buero("POST", "/api/v1/projekte", { name: "Stadtfest", kunde_id: kunde.id, ...w })).json.projekt;
const angebot = async (p) => (await buero("POST", "/api/v1/angebote", { projekt_id: p.id })).json.angebot;
const pos = (w) => ({ art: "miete", menge: 1, tage: 1, einzelpreis: 1000, ...w });

test("3.11 R-20 Angebot A-JJJJ-NNN mit Standards aus den Einstellungen; 4.2 Entwurf; Rechte", async () => {
  const p = await projekt({ beginn: "2027-06-01", ende: "2027-06-04" });
  const a1 = await angebot(p);
  const a2 = await angebot(p);
  assert.match(a1.nummer, new RegExp(`^A-${jahr}-\\d{3}$`));
  assert.equal(Number(a2.nummer.slice(-3)), Number(a1.nummer.slice(-3)) + 1);
  const d = (await buero("GET", `/api/v1/angebote/${a1.id}`)).json;
  assert.deepEqual([d.status, d.tage, d.folgetag_prozent, d.kleinunternehmer, d.ust_satz, d.fassung], ["entwurf", 4, 50, false, 19, 0]);
  assert.match(d.einleitung, /Vielen Dank/);
  const tage = (Date.parse(d.gueltig_bis) - Date.parse(d.datum)) / 86400000;
  assert.equal(tage, 14, "FA-41 Gültigkeit Standard 14 Tage");
  assert.equal((await lager("POST", "/api/v1/angebote", { projekt_id: p.id })).status, 403);
  assert.equal((await buero("POST", "/api/v1/angebote", {})).status, 400);
  assert.equal((await buero("DELETE", `/api/v1/angebote/${a2.id}`)).status, 200);
});

test("FA-41 R-28 R-28b Positionen speichern: Summen, Folgetag vom Angebot, Mengenschritt-Prüfung, Rabatt, USt, Kleinunternehmer", async () => {
  const p = await projekt({ beginn: "2027-07-01", ende: "2027-07-04" });
  const a = await angebot(p);
  const r = await buero("PUT", `/api/v1/angebote/${a.id}`, { rabatt_prozent: 10, positionen: [
    pos({ artikel_id: akku.id, menge: 2, tage: 4, folgetag_prozent: 50, einzelpreis: 500 }),       // 2 × 2,5 × 5 € = 25,00 €
    pos({ artikel_id: spot.id, menge: 4, tage: 4 }),                              // Folgetag 50 % vom Angebot: 4 × 2,5 × 10 € = 100,00 €
    pos({ art: "verkauf", artikel_id: gaffa.id, menge: 3, einzelpreis: 900 }),     // 27,00 €
    pos({ art: "frei", artikel_id: techniker.id, menge: 1, tage: 2, einzelpreis: 50000, stunden: 9 }), // 2 Tage × 500 € = 1000,00 €
    pos({ art: "frei", bezeichnung: "Anfahrt", menge: 1, einzelpreis: 4999 }),    // 49,99 €
  ] });
  assert.equal(r.status, 200, r.text);
  const d = r.json.angebot;
  assert.deepEqual(d.positionen.map((x) => x.summe), [2500, 10000, 2700, 100000, 4999]);
  assert.deepEqual(d.summen, { zwischensumme: 120199, rabatt: 12020, netto: 108179, ust: 20554, brutto: 128733 });
  assert.equal(d.positionen[1].mengenschritt, 4, "Mengenschritt aus dem Artikel");
  assert.equal(d.positionen[3].bezeichnung, "Techniker");
  assert.equal(d.positionen[2].einheit, "Rolle");
  assert.equal((await buero("GET", `/api/v1/kunden/${kunde.id}`)).json.angebote.find((x) => x.id === a.id).summe, 108179, "Kunde zeigt Netto");
  // Mengenschritt verletzt → 400 mit Text
  const f = await buero("PUT", `/api/v1/angebote/${a.id}`, { positionen: [pos({ artikel_id: spot.id, menge: 5 })] });
  assert.equal(f.status, 400);
  assert.match(f.json.text, /Position 1 \(Spot\).*4er-Set.*Nimm 8 statt 5/);
  assert.equal((await buero("PUT", `/api/v1/angebote/${a.id}`, { rabatt_prozent: 101 })).status, 400);
  assert.equal((await buero("PUT", `/api/v1/angebote/${a.id}`, { version: 1 })).status, 409, "veraltete Version");
  // Kleinunternehmer wird beim Anlegen aus den Einstellungen kopiert
  assert.equal((await admin("PUT", "/api/v1/verwaltung/einstellungen", { kleinunternehmer: true })).status, 200);
  const k = await angebot(p);
  const kd = (await buero("PUT", `/api/v1/angebote/${k.id}`, { positionen: [pos({ art: "frei", bezeichnung: "X", einzelpreis: 10000 })] })).json.angebot;
  assert.deepEqual([kd.kleinunternehmer, kd.summen.ust, kd.summen.brutto], [true, 0, 10000]);
  assert.equal((await buero("GET", `/api/v1/angebote/${a.id}`)).json.kleinunternehmer, false, "Kopie, nicht live");
  await admin("PUT", "/api/v1/verwaltung/einstellungen", { kleinunternehmer: false });
});

test("T-04 FA-43 FA-05 4.2 Versenden: neue Fassung, PDF im Projektordner Angebote/, Projekt „Angebot gesendet“, Material vorgemerkt; erneut versenden archiviert", async () => {
  const p = await projekt({ beginn: "2027-08-10", ende: "2027-08-12" });
  const a = await angebot(p);
  assert.equal((await buero("POST", `/api/v1/angebote/${a.id}/status`, { status: "versendet" })).status, 400, "ohne Positionen");
  await buero("PUT", `/api/v1/angebote/${a.id}`, { positionen: [pos({ artikel_id: akku.id, menge: 2 }), pos({ artikel_id: spot.id, menge: 4 })] });
  assert.equal((await buero("POST", `/api/v1/angebote/${a.id}/status`, { status: "angenommen" })).status, 400, "Entwurf nicht direkt annehmen");
  const v = await buero("POST", `/api/v1/angebote/${a.id}/status`, { status: "versendet" });
  assert.equal(v.status, 200, v.text);
  assert.match(v.json.text, /Fassung 1 als PDF abgelegt.*angebot gesendet|Fassung 1 als PDF abgelegt.*Angebot gesendet/);
  const pd = (await buero("GET", `/api/v1/projekte/${p.id}`)).json;
  assert.equal(pd.status, "angebot_gesendet");
  assert.equal(pd.kennzahlen.angebotswert_netto, 6000, "FA-29 Angebotswert netto");
  assert.equal(pd.angebote.length, 1);
  const datei = path.join(s.dataDir, pd.ordner, "Angebote", `${a.nummer} Fassung 1.pdf`);
  assert.ok(fs.readFileSync(datei).subarray(0, 4).toString() === "%PDF");
  // vorgemerkt (R-24 b)
  const res = (await admin("GET", `/api/v1/artikel/${akku.id}/reservierungen`)).json;
  assert.deepEqual(res.map((x) => [x.projekt_nummer, x.menge, x.fest, x.von_text]), [[p.nummer, 2, false, "10.08.2027"]]);
  // FA-05 Zeitraum: überlappend ja, davor/danach nein, ungültig → 400
  const zr = async (q) => (await admin("GET", `/api/v1/artikel/${akku.id}/reservierungen?${q}`));
  assert.equal((await zr("von=2027-08-01&bis=2027-08-10")).json.length, 1);
  assert.equal((await zr("von=2027-08-01&bis=2027-08-09")).json.length, 0, "endet vor Beginn");
  assert.equal((await zr("von=2028-01-01")).json.length, 0, "beginnt nach Ende");
  assert.equal((await zr("von=kaputt")).status, 400);
  assert.equal((await zr("von=2027-09-01&bis=2027-08-01")).status, 400);
  const liste = (await admin("GET", "/api/v1/artikel?q=Akku")).json.zeilen;
  assert.equal(liste[0].reserviert, 2, "Materialliste zeigt Reservierung");
  // erneut versenden → Fassung 2, Fassung 1 archiviert mit PDF
  await buero("PUT", `/api/v1/angebote/${a.id}`, { positionen: [pos({ artikel_id: akku.id, menge: 3 })] });
  await buero("POST", `/api/v1/angebote/${a.id}/status`, { status: "versendet" });
  const d = (await buero("GET", `/api/v1/angebote/${a.id}`)).json;
  assert.equal(d.fassung, 2);
  assert.deepEqual(d.fassungen.map((f) => [f.fassung, f.status, f.hat_pdf, f.summe_netto]), [[2, "versendet", true, 3000], [1, "versendet", true, 6000]]);
  const alt = await buero("GET", `/api/v1/angebote/${a.id}/fassungen/1/pdf`);
  assert.equal(alt.status, 200);
  assert.equal(alt.headers.get("content-type"), "application/pdf");
  const akt = await buero("GET", `/api/v1/angebote/${a.id}/pdf`);
  assert.equal(akt.status, 200);
  assert.match(akt.headers.get("content-disposition"), /F2\.pdf/);
  assert.equal((await buero("DELETE", `/api/v1/angebote/${a.id}`)).status, 409, "versendet nicht löschbar");
  // annehmen → fest, Projekt bestätigt; danach gesperrt
  const an = await buero("POST", `/api/v1/angebote/${a.id}/status`, { status: "angenommen" });
  assert.match(an.json.text, /Bestätigt/);
  assert.equal((await buero("GET", `/api/v1/projekte/${p.id}`)).json.status, "bestaetigt");
  assert.equal((await admin("GET", `/api/v1/artikel/${akku.id}/reservierungen`)).json.find((x) => x.angebot_id === a.id).fest, true);
  assert.equal((await buero("PUT", `/api/v1/angebote/${a.id}`, { betreff: "neu" })).status, 409, "angenommen nicht mehr änderbar");
  // Projekt abgeschlossen → keine feste Reservierung mehr (R-24 a)
  await buero("POST", `/api/v1/projekte/${p.id}/status`, { status: "abgeschlossen" });
  assert.equal((await admin("GET", `/api/v1/artikel/${akku.id}/reservierungen`)).json.filter((x) => x.angebot_id === a.id).length, 0);
});

test("T-05 R-27 FA-42 Zweites Projekt im selben Zeitraum fordert mehr als vorhanden: Hinweis, Speichern bleibt möglich", async () => {
  const p1 = await projekt({ name: "Konzert", beginn: "2027-09-05", ende: "2027-09-06" });
  const a1 = await angebot(p1);
  await buero("PUT", `/api/v1/angebote/${a1.id}`, { positionen: [pos({ artikel_id: akku.id, menge: 4 })] });
  await buero("POST", `/api/v1/angebote/${a1.id}/status`, { status: "versendet" });
  const p2 = await projekt({ name: "Party", beginn: "2027-09-06", ende: "2027-09-07" });
  const a2 = await angebot(p2);
  const vorab = (await buero("POST", "/api/v1/verfuegbarkeit", { projekt_id: p2.id, artikel_ids: [akku.id, techniker.id], ausser_angebot: a2.id })).json;
  assert.deepEqual(vorab.artikel[akku.id], { bestand: 6, reserviert: 4, verfuegbar: 2 });
  assert.equal(vorab.artikel[techniker.id].verfuegbar, null, "Leistung unbegrenzt");
  const r = await buero("PUT", `/api/v1/angebote/${a2.id}`, { positionen: [pos({ artikel_id: akku.id, menge: 5 })] });
  assert.equal(r.status, 200, "Speichern bleibt möglich");
  assert.equal(r.json.level, "warning");
  assert.match(r.json.angebot.positionen[0].hinweis, /Überbucht: 3 fehlen/);
  // eigenes Angebot zählt nicht gegen sich selbst
  await buero("POST", `/api/v1/angebote/${a2.id}/status`, { status: "versendet" });
  const d1 = (await buero("GET", `/api/v1/angebote/${a1.id}`)).json;
  assert.match(d1.positionen[0].hinweis, /Überbucht: 3 fehlen/, "beide sehen die Überbuchung");
  // anderer Zeitraum → keine Überschneidung
  const p3 = await projekt({ name: "Später", beginn: "2027-09-08", ende: "2027-09-08" });
  assert.equal((await buero("POST", "/api/v1/verfuegbarkeit", { projekt_id: p3.id, artikel_ids: [akku.id] })).json.artikel[akku.id].verfuegbar, 6);
  // abgelehnt reserviert nichts
  await buero("POST", `/api/v1/angebote/${a2.id}/status`, { status: "abgelehnt" });
  assert.equal((await buero("GET", `/api/v1/angebote/${a1.id}`)).json.positionen[0].hinweis, null);
  // gueltig_bis abgelaufen → vorgemerkt endet
  await s.db.pool.query("UPDATE angebot SET gueltig_bis = '2020-01-01', datum = '2020-01-01' WHERE id = $1", [a1.id]);
  assert.equal((await buero("POST", "/api/v1/verfuegbarkeit", { projekt_id: p2.id, artikel_ids: [akku.id] })).json.artikel[akku.id].reserviert, 0);
});

test("R-51 R-52 R-53 R-54 FA-44 Packliste aus dem Angebot: Bildschirm + PDF, Set-Vorschlag mit freier Tasche", async () => {
  const p = await projekt({ name: "Gala", beginn: "2027-10-01" });
  const a = await angebot(p);
  await buero("PUT", `/api/v1/angebote/${a.id}`, { positionen: [
    pos({ artikel_id: spot.id, menge: 4 }), pos({ artikel_id: spot.id, menge: 4 }), pos({ artikel_id: akku.id, menge: 2 }),
    pos({ art: "verkauf", artikel_id: gaffa.id, menge: 2, einzelpreis: 900 }), pos({ art: "frei", artikel_id: techniker.id, menge: 1, einzelpreis: 40000 }),
    pos({ artikel_id: tasche.id, menge: 1 }),
  ] });
  // Tasche mit 4 Spots im Lager füllen; ein Akku dem Projekt zuordnen und packen
  const { rows: spots } = await s.db.pool.query("SELECT id FROM geraet WHERE artikel_id = $1 ORDER BY id LIMIT 4", [spot.id]);
  const { rows: [t] } = await s.db.pool.query("SELECT id, code FROM geraet WHERE artikel_id = $1", [tasche.id]);
  await s.db.pool.query("UPDATE geraet SET case_id = $1 WHERE id = ANY($2)", [t.id, spots.map((x) => x.id)]);
  await s.db.pool.query("UPDATE artikel SET verpackungseinheit = 4 WHERE id = $1", [tasche.id]);
  const { rows: ak } = await s.db.pool.query("SELECT id FROM geraet WHERE artikel_id = $1 ORDER BY id LIMIT 2", [akku.id]);
  await s.db.pool.query("UPDATE geraet SET projekt_id = $1, status = 'gepackt' WHERE id = $2", [p.id, ak[0].id]);
  await s.db.pool.query("UPDATE geraet SET projekt_id = $1, status = 'zugeordnet' WHERE id = $2", [p.id, ak[1].id]);
  const pl = (await lager("GET", `/api/v1/angebote/${a.id}/packliste`)).json;
  assert.deepEqual(pl.zeilen.map((z) => z.artikel), ["Akku", "Gaffa", "Spot", "Spot-Tasche"], "nach Kategorie und Name, ohne Leistung");
  const sp = pl.zeilen.find((z) => z.artikel === "Spot");
  assert.equal(sp.soll, 8);
  assert.equal(sp.set.text, "2 × 4er-Set");
  assert.deepEqual(sp.set.vorschlag.map((x) => x.code), [t.code]);
  const akz = pl.zeilen.find((z) => z.artikel === "Akku");
  assert.deepEqual([akz.ist, akz.gepackt, akz.fertig], [2, 1, false]);
  assert.equal(pl.zeilen.find((z) => z.artikel === "Gaffa").ist, null);
  assert.equal(pl.zeilen.find((z) => z.artikel === "Spot-Tasche").inhalt.text, "Inhalt: Spot × 4");
  const pdf = await lager("GET", `/api/v1/angebote/${a.id}/packliste.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.ok(pdf.text.startsWith("%PDF"));
  const { rows: [g] } = await s.db.pool.query("SELECT status, projekt_id FROM geraet WHERE id = $1", [t.id]);
  assert.deepEqual([g.status, g.projekt_id], ["lager", null], "R-53 nichts gebucht");
});

test("FA-43 PDF-Vorschau im Entwurf; Projekt mit Angebot nicht löschbar", async () => {
  const p = await projekt({ name: "Vorschau" });
  const a = await angebot(p);
  const r = await buero("GET", `/api/v1/angebote/${a.id}/pdf`);
  assert.equal(r.status, 200);
  assert.ok(r.text.startsWith("%PDF"));
  const del = await buero("DELETE", `/api/v1/projekte/${p.id}`);
  assert.equal(del.status, 409);
  assert.match(del.json.text, /Angebote/);
  const l = (await buero("GET", `/api/v1/angebote?projekt_id=${p.id}`)).json;
  assert.equal(l.gesamt, 1);
  assert.equal((await buero("GET", "/api/v1/angebote?status=angenommen")).json.zeilen.every((x) => x.status === "angenommen"), true);
});

test("FA-41 PDF mit Firmenkopf und Logo; Reihenfolge der Positionen bleibt wie eingegeben", async () => {
  fs.mkdirSync(path.join(s.dataDir, "firma"), { recursive: true });
  fs.writeFileSync(path.join(s.dataDir, "firma", "logo.png"), await QRCode.toBuffer("Logo"));
  await admin("PUT", "/api/v1/verwaltung/einstellungen", { firma: { name: "Eventtechnik Muster", ort: "Köln" } });
  const p = await projekt({ name: "Logo" });
  const a = await angebot(p);
  const r = await buero("PUT", `/api/v1/angebote/${a.id}`, { positionen: [
    pos({ art: "frei", bezeichnung: "Zweite" }), pos({ art: "frei", bezeichnung: "Erste" }), pos({ art: "frei", bezeichnung: "Dritte" })] });
  assert.deepEqual(r.json.angebot.positionen.map((x) => [x.pos, x.bezeichnung]), [[1, "Zweite"], [2, "Erste"], [3, "Dritte"]]);
  const neu = await buero("PUT", `/api/v1/angebote/${a.id}`, { positionen: [pos({ art: "frei", bezeichnung: "Erste" }), pos({ art: "frei", bezeichnung: "Zweite" })] });
  assert.deepEqual(neu.json.angebot.positionen.map((x) => x.bezeichnung), ["Erste", "Zweite"]);
  const pdf = await buero("GET", `/api/v1/angebote/${a.id}/pdf`);
  assert.match(pdf.text, /\/Subtype \/Image/, "Logo eingebettet");
  fs.rmSync(path.join(s.dataDir, "firma"), { recursive: true });
  assert.doesNotMatch((await buero("GET", `/api/v1/angebote/${a.id}/pdf`)).text, /\/Subtype \/Image/, "ohne Logo geht es auch");
});
