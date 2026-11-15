// Angebote (3.11, 4.2, FA-41–FA-44), Verfügbarkeit (R-24–R-27), Packliste (R-51–R-54). Geld in Cent.
import { createHash } from "node:crypto";
import { benachrichtige, benutzerMitRecht } from "./benachrichtigungen.js";
import { lagerorteFuer } from "./lagerorte.js";
import fsp from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import { transaktion } from "@lager/db";
import {
  naechsteProjektnummer, ANGEBOT_STATUS, POSITION_ARTEN, angebotWechselErlaubt, angebotBearbeitbar, projektStatusNachAngebot,
  positionSumme, angebotSumme, pruefePosition, verfuegbarkeit, bestandVon, ueberbuchungHinweis, reservierungsZeitraum,
  packliste, sollInhalt, euro, datumAnzeige, PROJEKT_STATUS,
} from "@lager/domain";
import { fehler, nichtGefunden, seite, idParam, dbFehler } from "./hilfen.js";
import { sichereFassung } from "./fassung.js";
import { ladeEinstellungen } from "./verwaltung.js";
import { datenOrdner, sichererPfad } from "./projekte.js";

const A = { bereich: "angebote" };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KOPF = ["datum", "gueltig_bis", "betreff", "einleitung", "schlusstext", "tage", "rabatt_prozent", "folgetag_prozent"];

/** Effektive Position für die Rechnung: Folgetag-Satz fällt auf den des Angebots zurück. */
const effektiv = (p, a) => ({ ...p, folgetag_prozent: p.folgetag_prozent ?? a.folgetag_prozent });
const summen = (a, pos) => angebotSumme(pos.map((p) => effektiv(p, a)), a);

async function neueNummer(c) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext('angebot-nummer'))");
  const { rows: [{ jahr }] } = await c.query("SELECT extract(year FROM now() AT TIME ZONE 'Europe/Berlin')::int AS jahr");
  const { rows } = await c.query("SELECT nummer FROM angebot WHERE nummer LIKE $1", [`A-${jahr}-%`]);
  return naechsteProjektnummer("A", jahr, rows.map((r) => r.nummer));
}

/** Projekttage (Ende − Beginn + 1), sonst 1. */
function projektTage(p) {
  if (!p.beginn) return 1;
  const ms = Date.parse(`${p.ende || p.beginn}T00:00:00Z`) - Date.parse(`${p.beginn}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

/**
 * R-26/R-27: Verfügbarkeit je Artikel im Zeitraum, ohne das gerade bearbeitete Angebot.
 * @returns {Promise<Map<number,{bestand:number|null,reserviert:number,verfuegbar:number|null}>>}
 */
export async function verfuegbarkeitFuer(db, artikelIds, zeitraum, ausserAngebot = null) {
  const ids = [...new Set(artikelIds.filter(Boolean).map(Number))];
  const karte = new Map();
  if (!ids.length) return karte;
  const [art, res] = await Promise.all([
    db.query(`SELECT a.id, a.ist_leistung, a.verbrauch, a.bestand,
        (SELECT count(*)::int FROM geraet g WHERE g.artikel_id = a.id AND g.status IN ('lager','zugeordnet','gepackt')) AS einsatzfaehig
      FROM artikel a WHERE a.id = ANY($1)`, [ids]),
    db.query("SELECT artikel_id, menge::float8 AS menge, von, bis, angebot_id FROM reservierung WHERE artikel_id = ANY($1)", [ids]),
  ]);
  for (const a of art.rows) {
    const r = res.rows.filter((x) => x.artikel_id === a.id);
    karte.set(a.id, verfuegbarkeit(bestandVon(a, a.einsatzfaehig), r, zeitraum, ausserAngebot));
  }
  return karte;
}

const POS_SQL = `SELECT ap.*, ap.menge::float8 AS menge, ap.stunden::float8 AS stunden, ar.name AS artikel_name, ar.ist_leistung, ar.verbrauch,
    ar.zeitmodell, ar.preis_erweitert, ar.mengenschritt AS artikel_mengenschritt
  FROM angebot_position ap LEFT JOIN artikel ar ON ar.id = ap.artikel_id WHERE ap.angebot_id = $1 ORDER BY ap.pos, ap.id`;

async function ladeAngebot(db, id) {
  const { rows: [a] } = await db.query(`SELECT a.*, a.rabatt_prozent::float8 AS rabatt_prozent, a.ust_satz::float8 AS ust_satz,
      p.nummer AS projekt_nummer, p.name AS projekt_name, p.status AS projekt_status, p.beginn, p.ende, p.ort, p.ordner,
      k.id AS kunde_id, k.name AS kunde, k.firma AS kunde_firma, k.strasse AS kunde_strasse, k.plz AS kunde_plz, k.ort AS kunde_ort
    FROM angebot a JOIN projekt p ON p.id = a.projekt_id JOIN kunde k ON k.id = p.kunde_id WHERE a.id = $1`, [id]);
  if (!a) throw nichtGefunden("Dieses Angebot");
  const [pos, fass] = await Promise.all([
    db.query(POS_SQL, [id]),
    db.query("SELECT id, fassung, status, summe_netto, erstellt, erstellt_von, (pdf_datei <> '') AS hat_pdf FROM angebot_fassung WHERE angebot_id = $1 ORDER BY fassung DESC", [id]),
  ]);
  const zeitraum = reservierungsZeitraum(a);
  const verf = await verfuegbarkeitFuer(db, pos.rows.filter((p) => p.art === "miete").map((p) => p.artikel_id), zeitraum, a.id);
  const positionen = pos.rows.map((p) => {
    const v = p.art === "miete" ? verf.get(p.artikel_id) || null : null;
    return { ...p, summe: positionSumme(effektiv(p, a)), verfuegbarkeit: v, hinweis: ueberbuchungHinweis(p.menge, v) };
  });
  return { ...a, status_text: ANGEBOT_STATUS[a.status], positionen, fassungen: fass.rows, summen: summen(a, positionen), zeitraum };
}

/** Kopf-Werte aus dem Body prüfen. */
function kopfWerte(body, alt) {
  const w = {};
  const f = {};
  for (const k of KOPF) if (body && k in body) w[k] = body[k];
  if ("datum" in w && !ISO.test(String(w.datum || ""))) f.datum = "Datum bitte als TT.MM.JJJJ angeben.";
  if ("gueltig_bis" in w) {
    w.gueltig_bis = w.gueltig_bis || null;
    if (w.gueltig_bis && !ISO.test(w.gueltig_bis)) f.gueltig_bis = "Gültig bis bitte als TT.MM.JJJJ angeben.";
  }
  for (const k of ["betreff", "einleitung", "schlusstext"]) if (k in w) w[k] = String(w[k] ?? "").trim();
  if ("tage" in w && (!Number.isInteger(Number(w.tage)) || w.tage < 1 || w.tage > 3650)) f.tage = "Miettage müssen eine ganze Zahl ab 1 sein.";
  if ("rabatt_prozent" in w) {
    const r = Number(w.rabatt_prozent);
    if (!Number.isFinite(r) || r < 0 || r > 100 || Math.round(r * 100) !== r * 100) f.rabatt_prozent = "Rabatt bitte von 0 bis 100 % angeben (höchstens 2 Nachkommastellen).";
  }
  if ("folgetag_prozent" in w && (!Number.isInteger(Number(w.folgetag_prozent)) || w.folgetag_prozent < 0 || w.folgetag_prozent > 100))
    f.folgetag_prozent = "Folgetag-Prozent muss eine ganze Zahl von 0 bis 100 sein.";
  const neu = { ...alt, ...w };
  if (neu.gueltig_bis && neu.datum && neu.gueltig_bis < neu.datum) f.gueltig_bis = "Gültig bis darf nicht vor dem Angebotsdatum liegen.";
  if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
  return neu;
}

/** Positionen prüfen und mit Artikel-Stammdaten ergänzen (Mengenschritt, Bezeichnung, Einheit). */
async function pruefePositionen(c, liste) {
  if (!Array.isArray(liste)) return null;
  const ids = liste.map((p) => Number(p.artikel_id)).filter(Boolean);
  const { rows } = ids.length ? await c.query("SELECT id, name, einheit, mengenschritt, aktiv, ist_leistung, verbrauch, verkaeuflich FROM artikel WHERE id = ANY($1)", [ids]) : { rows: [] };
  const art = new Map(rows.map((r) => [r.id, r]));
  const fehlerListe = [];
  const pos = liste.map((roh, i) => {
    const p = {
      art: String(roh.art || ""), artikel_id: roh.artikel_id ? Number(roh.artikel_id) : null, bezeichnung: String(roh.bezeichnung ?? "").trim(),
      menge: Number(roh.menge), tage: Number(roh.tage ?? 1), einzelpreis: Number(roh.einzelpreis ?? 0),
      folgetag_prozent: roh.folgetag_prozent === "" || roh.folgetag_prozent == null ? null : Number(roh.folgetag_prozent),
      einheit: String(roh.einheit ?? "").trim(), beschreibung: String(roh.beschreibung ?? "").trim(),
      stunden: roh.stunden === "" || roh.stunden == null ? null : Number(roh.stunden), mengenschritt: 1,
    };
    const a = p.artikel_id ? art.get(p.artikel_id) : null;
    if (p.artikel_id && !a) { fehlerListe.push(`Position ${i + 1}: Den Artikel gibt es nicht mehr. Wähle einen anderen.`); return p; }
    if (a) {
      if (!p.bezeichnung) p.bezeichnung = a.name;
      if (!p.einheit) p.einheit = a.einheit;
      if (p.art === "miete") p.mengenschritt = a.mengenschritt || 1;
    }
    if (!p.einheit) p.einheit = "Stück";
    const f = pruefePosition(p);
    if (f) fehlerListe.push(`Position ${i + 1}${p.bezeichnung ? ` (${p.bezeichnung})` : ""}: ${f}`);
    if (p.stunden != null && (!Number.isFinite(p.stunden) || p.stunden < 0 || p.stunden > 999)) fehlerListe.push(`Position ${i + 1}: Stunden bitte von 0 bis 999 angeben.`);
    return p;
  });
  if (fehlerListe.length) throw fehler(400, fehlerListe.join(" "), { positionen: fehlerListe });
  return pos;
}

async function schreibePositionen(c, angebotId, pos) {
  await c.query("DELETE FROM angebot_position WHERE angebot_id = $1", [angebotId]);
  for (const [i, p] of pos.entries()) {
    await c.query(`INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, bezeichnung, menge, tage, einzelpreis, folgetag_prozent, einheit, beschreibung, mengenschritt, stunden)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [angebotId, i + 1, p.art, p.artikel_id, p.bezeichnung, p.menge, p.tage, p.einzelpreis, p.folgetag_prozent, p.einheit, p.beschreibung, p.mengenschritt, p.stunden]);
  }
}

/* ── PDF (FA-41 Firmenkopf, FA-43 Archiv) ── */
const MM = 72 / 25.4;
function pdfPuffer(baue, titel) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 20 * MM, info: { Title: titel }, bufferPages: true });
    const teile = [];
    doc.on("data", (d) => teile.push(d)).on("end", () => resolve(Buffer.concat(teile))).on("error", reject);
    baue(doc);
    doc.end();
  });
}
const mengeText = (m) => String(Math.round(Number(m) * 100) / 100).replace(".", ",");

/** Firmenlogo (FA-41): <Datenordner>/firma/logo.png|jpg, wird in der Verwaltung hinterlegt (D-60). */
export async function ladeLogo(ctx) {
  for (const n of ["logo.png", "logo.jpg", "logo.jpeg"]) {
    try { return await fsp.readFile(path.join(datenOrdner(ctx), "firma", n)); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  return null;
}

export function angebotPdf(a, firma, { entwurf = false, logo = null } = {}) {
  return pdfPuffer((doc) => {
    const L = 20 * MM, B = doc.page.width - 40 * MM;
    const f = firma || {};
    if (logo) {
      try { doc.image(logo, L + B - 45 * MM, 15 * MM, { fit: [45 * MM, 18 * MM], align: "right" }); } catch { /* ungültiges Bild: ohne Logo weiter */ }
    }
    doc.font("Helvetica-Bold").fontSize(14).text(f.name || "Angebot", L, 20 * MM, { width: B - 50 * MM });
    doc.font("Helvetica").fontSize(8).fillColor("#555")
      .text([f.strasse, [f.plz, f.ort].filter(Boolean).join(" "), f.telefon, f.email, f.web].filter(Boolean).join(" · "));
    doc.fillColor("#000").moveDown(2);
    const yAdr = doc.y;
    doc.fontSize(10).text([a.kunde_firma, a.kunde, a.kunde_strasse, [a.kunde_plz, a.kunde_ort].filter(Boolean).join(" ")].filter(Boolean).join("\n"), L, yAdr, { width: B / 2 });
    doc.fontSize(9).text([`Angebot ${a.nummer}${a.fassung ? ` · Fassung ${a.fassung}` : ""}`, `Datum: ${datumAnzeige(a.datum)}`,
      a.gueltig_bis ? `Gültig bis: ${datumAnzeige(a.gueltig_bis)}` : "", `Projekt: ${a.projekt_nummer} ${a.projekt_name}`,
      a.beginn ? `Zeitraum: ${datumAnzeige(a.beginn)}${a.ende && a.ende !== a.beginn ? ` – ${datumAnzeige(a.ende)}` : ""}` : "",
      a.ort ? `Ort: ${a.ort}` : ""].filter(Boolean).join("\n"), L + B / 2, yAdr, { width: B / 2, align: "right" });
    doc.moveDown(3);
    doc.x = L;
    if (entwurf) doc.fillColor("#b3483f").font("Helvetica-Bold").fontSize(10).text("ENTWURF – noch nicht versendet").fillColor("#000");
    doc.font("Helvetica-Bold").fontSize(12).text(a.betreff || `Angebot ${a.nummer}`, L);
    if (a.einleitung) doc.moveDown(0.5).font("Helvetica").fontSize(9.5).text(a.einleitung, { width: B });
    doc.moveDown(1);
    // Tabelle
    const sp = [{ t: "Pos", w: 10 }, { t: "Bezeichnung", w: 70 }, { t: "Menge", w: 18, r: true }, { t: "Tage", w: 12, r: true },
      { t: "Einzelpreis", w: 25, r: true }, { t: "Summe", w: 25, r: true }];
    const kopf = () => {
      let x = L; const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(8.5);
      for (const s of sp) { doc.text(s.t, x, y, { width: s.w * MM, align: s.r ? "right" : "left" }); x += s.w * MM; }
      doc.moveTo(L, doc.y + 2).lineTo(L + B, doc.y + 2).strokeColor("#999").stroke();
      doc.y += 5;
    };
    kopf();
    for (const [i, p] of a.positionen.entries()) {
      const besch = [p.art === "miete" && p.tage > 1 ? `Miete, Folgetage ${p.folgetag_prozent ?? a.folgetag_prozent} %` : POSITION_ARTEN[p.art],
        p.stunden != null ? `${mengeText(p.stunden)} h/Tag` : "", p.beschreibung].filter(Boolean).join(" · ");
      const h = Math.max(doc.font("Helvetica").fontSize(9).heightOfString(p.bezeichnung, { width: 70 * MM }) + doc.fontSize(7.5).heightOfString(besch, { width: 70 * MM }), 12) + 4;
      if (doc.y + h > doc.page.height - 30 * MM) { doc.addPage(); doc.y = 20 * MM; kopf(); }
      const y = doc.y; let x = L;
      const werte = [String(i + 1), null, `${mengeText(p.menge)} ${p.einheit}`, p.art === "verkauf" ? "–" : String(p.tage), euro(p.einzelpreis), euro(p.summe)];
      sp.forEach((s, j) => {
        if (j === 1) {
          doc.font("Helvetica").fontSize(9).text(p.bezeichnung, x, y, { width: s.w * MM });
          doc.fontSize(7.5).fillColor("#555").text(besch, x, doc.y, { width: s.w * MM }).fillColor("#000");
        } else doc.font("Helvetica").fontSize(9).text(werte[j], x, y, { width: s.w * MM, align: s.r ? "right" : "left" });
        x += s.w * MM;
      });
      doc.y = y + h;
    }
    doc.moveTo(L, doc.y).lineTo(L + B, doc.y).strokeColor("#999").stroke();
    doc.moveDown(0.5);
    const s = a.summen;
    const zeile = (t, w, fett) => {
      const y = doc.y;
      doc.font(fett ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).text(t, L + B - 85 * MM, y, { width: 55 * MM, align: "right" });
      doc.text(euro(w), L + B - 30 * MM, y, { width: 30 * MM, align: "right" });
    };
    zeile("Zwischensumme", s.zwischensumme);
    if (s.rabatt) zeile(`Rabatt ${String(a.rabatt_prozent).replace(".", ",")} %`, -s.rabatt);
    zeile("Summe netto", s.netto, true);
    if (!a.kleinunternehmer) zeile(`Umsatzsteuer ${String(a.ust_satz).replace(".", ",")} %`, s.ust);
    zeile(a.kleinunternehmer ? "Gesamtbetrag" : "Summe brutto", s.brutto, true);
    doc.x = L;
    if (a.kleinunternehmer) doc.moveDown(0.8).font("Helvetica").fontSize(8.5).text("Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.", L, doc.y, { width: B });
    if (a.schlusstext) doc.moveDown(1).font("Helvetica").fontSize(9.5).text(a.schlusstext, L, doc.y, { width: B });
    // Fußzeile auf jeder Seite
    const fuss = [f.name, f.ust_id ? `USt-ID ${f.ust_id}` : "", f.bank, f.iban ? `IBAN ${f.iban}` : "", f.bic ? `BIC ${f.bic}` : ""].filter(Boolean).join(" · ");
    const seiten = doc.bufferedPageRange();
    for (let i = 0; i < seiten.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(7).fillColor("#777").text(`${fuss}${fuss ? " · " : ""}Seite ${i + 1} von ${seiten.count}`, L, doc.page.height - 15 * MM, { width: B, align: "center", lineBreak: false });
    }
  }, `Angebot ${a.nummer}`);
}

/* ── Packliste (R-51–R-54, FA-44) ── */
export async function ladePackliste(db, angebotId) {
  const { rows: [a] } = await db.query(`SELECT a.id, a.nummer, a.status, a.projekt_id, p.nummer AS projekt_nummer, p.name AS projekt_name, p.beginn, p.ende
    FROM angebot a JOIN projekt p ON p.id = a.projekt_id WHERE a.id = $1`, [angebotId]);
  if (!a) throw nichtGefunden("Dieses Angebot");
  const { rows: pos } = await db.query("SELECT art, artikel_id, menge::float8 AS menge FROM angebot_position WHERE angebot_id = $1", [angebotId]);
  const ids = [...new Set(pos.map((p) => p.artikel_id).filter(Boolean))];
  const { rows: art } = ids.length ? await db.query(`SELECT a.*, k.name AS kategorie, i.name AS inhalt_name, i.mengenschritt AS inhalt_mengenschritt
      FROM artikel a JOIN kategorie k ON k.id = a.kategorie_id LEFT JOIN artikel i ON i.id = a.inhalt_artikel_id WHERE a.id = ANY($1)`, [ids]) : { rows: [] };
  const karte = new Map(art.map((r) => [r.id, { ...r, inhalt: r.inhalt_name ? { name: r.inhalt_name } : null,
    soll_inhalt: sollInhalt(r, r.inhalt_artikel_id ? { mengenschritt: r.inhalt_mengenschritt } : null) }]));
  const { rows: z } = await db.query(`SELECT artikel_id, count(*) FILTER (WHERE status IN ('zugeordnet','gepackt'))::int AS ist,
      count(*) FILTER (WHERE status = 'gepackt')::int AS gepackt FROM geraet WHERE projekt_id = $1 GROUP BY artikel_id`, [a.projekt_id]);
  const zeilen = packliste(pos, karte, new Map(z.map((r) => [r.artikel_id, r])));
  // R-53: freie, vollständige Taschen als Vorschlag (nichts wird gebucht)
  for (const zl of zeilen) {
    if (!zl.set) continue;
    const { rows: t } = await db.query(`SELECT t.code, (SELECT count(*)::int FROM geraet i WHERE i.case_id = t.id AND i.status = 'lager') AS teile
      FROM geraet t JOIN artikel ta ON ta.id = t.artikel_id
      WHERE ta.ist_case AND ta.inhalt_artikel_id = $1 AND t.status = 'lager' AND t.projekt_id IS NULL
        AND (SELECT count(*) FROM geraet i WHERE i.case_id = t.id AND i.status = 'lager') >= $2
      ORDER BY t.code LIMIT $3`, [zl.artikel_id, zl.set.groesse, zl.set.anzahl]);
    zl.set.vorschlag = t;
  }
  // FA-08: Lagerort je Zeile (Anzeige beim Packen)
  const orte = await lagerorteFuer(db, zeilen.map((zl) => zl.artikel_id).filter(Boolean));
  for (const zl of zeilen) { const o = orte.get(zl.artikel_id); zl.lagerort = o?.lagerort || null; zl.lagerorte_weitere = o?.weitere || []; }
  return { angebot: a, zeilen };
}

function packlistePdf(pl) {
  return pdfPuffer((doc) => {
    const L = 20 * MM, B = doc.page.width - 40 * MM;
    const a = pl.angebot;
    doc.font("Helvetica-Bold").fontSize(14).text(`Packliste ${a.projekt_nummer} ${a.projekt_name}`, L);
    doc.font("Helvetica").fontSize(9).text(`Aus Angebot ${a.nummer}${a.beginn ? ` · ${datumAnzeige(a.beginn)}${a.ende && a.ende !== a.beginn ? ` – ${datumAnzeige(a.ende)}` : ""}` : ""}`);
    doc.moveDown(1);
    const sp = [{ t: "", w: 8 }, { t: "Artikel", w: 82 }, { t: "Soll", w: 20, r: true }, { t: "Ist", w: 20, r: true }, { t: "Gepackt", w: 20, r: true }, { t: "Fertig", w: 20, r: true }];
    const kopf = () => {
      let x = L; const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(8.5);
      for (const s of sp) { doc.text(s.t, x, y, { width: s.w * MM, align: s.r ? "right" : "left" }); x += s.w * MM; }
      doc.moveTo(L, doc.y + 2).lineTo(L + B, doc.y + 2).strokeColor("#999").stroke();
      doc.y += 5;
    };
    let kat = null;
    kopf();
    for (const z of pl.zeilen) {
      const extra = [z.set?.text, z.set?.vorschlag?.length ? `Vorschlag: ${z.set.vorschlag.map((t) => t.code).join(", ")}` : "", z.inhalt?.text, z.verbrauch ? "Verbrauch – von Hand kontrollieren" : ""].filter(Boolean).join(" · ");
      const h = (extra ? 22 : 13) + (z.kategorie !== kat ? 14 : 0);
      if (doc.y + h > doc.page.height - 20 * MM) { doc.addPage(); doc.y = 20 * MM; kopf(); }
      if (z.kategorie !== kat) { kat = z.kategorie; doc.font("Helvetica-Bold").fontSize(9).fillColor("#333").text(kat, L, doc.y + 3).fillColor("#000"); doc.y += 2; }
      const y = doc.y; let x = L;
      doc.rect(L + 1, y + 1, 7, 7).strokeColor("#000").stroke();
      const w = [null, z.artikel + (z.lagerort ? ` · ${z.lagerort}` : ""), `${mengeText(z.soll)} ${z.einheit}`, z.ist ?? "–", z.gepackt ?? "–", z.fertig == null ? "–" : z.fertig ? "ja" : "nein"];
      sp.forEach((s, j) => { if (j) doc.font("Helvetica").fontSize(9).text(String(w[j]), x, y, { width: s.w * MM, align: s.r ? "right" : "left" }); x += s.w * MM; });
      if (extra) doc.fontSize(7.5).fillColor("#555").text(extra, L + 8 * MM, y + 11, { width: 160 * MM }).fillColor("#000");
      doc.y = y + (extra ? 22 : 13);
    }
    if (!pl.zeilen.length) doc.font("Helvetica").fontSize(9).text("Keine packbaren Positionen im Angebot.", L);
  }, `Packliste ${pl.angebot.projekt_nummer}`);
}

const sendePdf = (ctx, puffer, name, inline = true) => {
  ctx.res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  ctx.res.end(puffer);
};

/** Neues Angebot zum Projekt; optional mit Positionen (FA-39 Vorlage). */
export async function legeAngebotAn(ctx, c, projektId, { betreff = "", positionen = null } = {}) {
  const { rows: [p] } = Number.isInteger(projektId) && projektId > 0 ? await c.query("SELECT id, nummer, name, beginn, ende, status FROM projekt WHERE id = $1", [projektId]) : { rows: [] };
  if (!p) throw fehler(400, "Wähle ein Projekt für das Angebot.", { felder: { projekt_id: "Projekt wählen" } });
  if (["abgeschlossen", "storniert"].includes(p.status)) throw fehler(409, `${p.nummer} ist „${PROJEKT_STATUS[p.status]}“. Setze das Projekt zuerst zurück, um ein Angebot zu schreiben.`);
  const e = await ladeEinstellungen(c);
  const nummer = await neueNummer(c);
  const { rows: [{ heute, bis }] } = await c.query("SELECT (now() AT TIME ZONE 'Europe/Berlin')::date AS heute, ((now() AT TIME ZONE 'Europe/Berlin')::date + $1::int) AS bis", [e.angebot_gueltig_tage]);
  const { rows: [a] } = await c.query(`INSERT INTO angebot (nummer, projekt_id, datum, gueltig_bis, betreff, einleitung, schlusstext, tage, folgetag_prozent, kleinunternehmer, ust_satz, erstellt_von)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, nummer, version`,
  [nummer, p.id, heute, bis, String(betreff || `${p.name}`).trim(), e.angebot_text_einleitung, e.angebot_text_schluss, projektTage(p),
    e.folgetag_prozent, e.kleinunternehmer, e.ust_satz, ctx.nutzer?.benutzername || ""]);
  const pos = await pruefePositionen(c, positionen);
  if (pos?.length) {
    await schreibePositionen(c, a.id, pos);
    const { rows: [k] } = await c.query("SELECT *, rabatt_prozent::float8 AS rabatt_prozent, ust_satz::float8 AS ust_satz FROM angebot WHERE id = $1", [a.id]);
    const { rows: alle } = await c.query("SELECT art, menge::float8 AS menge, tage, einzelpreis, folgetag_prozent FROM angebot_position WHERE angebot_id = $1", [a.id]);
    await c.query("UPDATE angebot SET summe_netto = $1 WHERE id = $2", [summen(k, alle).netto, a.id]);
  }
  ctx.hub?.sende({ typ: "angebot.geaendert", id: a.id, projekt_id: p.id, bereich: "angebote" });
  return a;
}

export function angeboteModul(router) {
  router.get("/api/v1/angebote", { ...A, stufe: "r" }, async (ctx) => {
    const { q, status, projekt_id: projektId } = ctx.query;
    const { limit, offset } = seite(ctx.query);
    const st = String(status || "").split(",").filter((s) => ANGEBOT_STATUS[s]);
    const { rows } = await ctx.pool.query(`SELECT a.id, a.nummer, a.status, a.datum, a.gueltig_bis, a.betreff, a.fassung, a.summe_netto, a.projekt_id,
        p.nummer AS projekt_nummer, p.name AS projekt_name, k.name AS kunde, k.firma AS kunde_firma, count(*) OVER()::int AS gesamt
      FROM angebot a JOIN projekt p ON p.id = a.projekt_id JOIN kunde k ON k.id = p.kunde_id
      WHERE ($1::text IS NULL OR a.nummer ILIKE '%' || $1 || '%' OR a.betreff ILIKE '%' || $1 || '%' OR p.name ILIKE '%' || $1 || '%' OR p.nummer ILIKE '%' || $1 || '%' OR k.name ILIKE '%' || $1 || '%' OR k.firma ILIKE '%' || $1 || '%')
        AND (cardinality($2::text[]) = 0 OR a.status = ANY($2)) AND ($3::int IS NULL OR a.projekt_id = $3)
      ORDER BY a.id DESC LIMIT $4 OFFSET $5`, [q || null, st, projektId ? Number(projektId) : null, limit, offset]);
    return { gesamt: rows[0]?.gesamt || 0, zeilen: rows.map((r) => ({ ...r, gesamt: undefined })) };
  });
  router.get("/api/v1/angebote/:id", { ...A, stufe: "r" }, async (ctx) => ladeAngebot(ctx.pool, idParam(ctx.params.id, "Dieses Angebot")));

  router.post("/api/v1/angebote", A, async (ctx) => transaktion(ctx.pool, async (c) => {
    const a = await legeAngebotAn(ctx, c, Number(ctx.body?.projekt_id), { betreff: ctx.body?.betreff });
    return { ok: true, level: "success", text: `Angebot ${a.nummer} angelegt.`, angebot: a };
  }));

  router.put("/api/v1/angebote/:id", A, async (ctx) => transaktion(ctx.pool, async (c) => {
    await sichereFassung(ctx, c, "angebot", Number(ctx.params.id), { was: "Das Angebot" });
    const id = idParam(ctx.params.id, "Dieses Angebot");
    const { rows: [alt] } = await c.query("SELECT *, rabatt_prozent::float8 AS rabatt_prozent, ust_satz::float8 AS ust_satz FROM angebot WHERE id = $1 FOR UPDATE", [id]);
    if (!alt) throw nichtGefunden("Dieses Angebot");
    if (!angebotBearbeitbar(alt.status))
      throw fehler(409, `${alt.nummer} ist „${ANGEBOT_STATUS[alt.status]}“ und kann nicht mehr geändert werden. Setze es auf „Versendet“ zurück oder lege ein neues Angebot an.`);
    const k = kopfWerte(ctx.body, alt);
    const pos = await pruefePositionen(c, ctx.body?.positionen);
    if (pos) await schreibePositionen(c, id, pos);
    const { rows: alle } = await c.query("SELECT art, menge::float8 AS menge, tage, einzelpreis, folgetag_prozent FROM angebot_position WHERE angebot_id = $1", [id]);
    const s = summen(k, alle);
    try {
      const { rows: [a] } = await c.query(`UPDATE angebot SET datum = $1, gueltig_bis = $2, betreff = $3, einleitung = $4, schlusstext = $5, tage = $6, rabatt_prozent = $7,
          folgetag_prozent = $8, summe_netto = $9, version = version + 1, geaendert = now() WHERE id = $10 RETURNING id, version`,
      [k.datum, k.gueltig_bis, k.betreff, k.einleitung, k.schlusstext, Number(k.tage), Number(k.rabatt_prozent), Number(k.folgetag_prozent), s.netto, id]);
      const neu = await ladeAngebot(c, id);
      const hinweise = neu.positionen.filter((p) => p.hinweis).map((p) => `${p.bezeichnung}: ${p.hinweis}`);
      ctx.hub?.sende({ typ: "angebot.geaendert", id, version: a.version, projekt_id: alt.projekt_id, bereich: "angebote" });
      if (hinweise.length) { // FA-40: Überbuchung an alle mit Recht „Angebote ändern“ (außer dem, der gerade speichert)
        const an = (await benutzerMitRecht(c, "angebote")).filter((b) => b !== ctx.nutzer.id);
        await benachrichtige(c, an, { art: "ueberbuchung", schluessel: `ueberbuchung-${id}-${createHash("sha1").update(hinweise.join("|")).digest("hex").slice(0, 12)}`,
          titel: `Überbuchung in ${alt.nummer}`, text: hinweise.join("\n"), pfad: `/angebote/${id}` }, { mail: !!ctx.config?.smtp, hub: ctx.hub });
      }
      return { ok: true, level: hinweise.length ? "warning" : "success", text: hinweise.length ? `Gespeichert. ${hinweise.length} Position(en) überbucht.` : "Gespeichert.", hinweise, angebot: neu };
    } catch (e) { throw dbFehler(e); }
  }));

  // FA-43 Statuswechsel. Versenden erzeugt eine neue Fassung mit PDF; jede Fassung bleibt im Archiv (4.2).
  router.post("/api/v1/angebote/:id/status", A, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Angebot");
    const nach = String(ctx.body?.status || "");
    const ergebnis = await transaktion(ctx.pool, async (c) => {
      const { rows: [alt] } = await c.query("SELECT id, nummer, status, fassung, pdf_datei, summe_netto, projekt_id FROM angebot WHERE id = $1 FOR UPDATE", [id]);
      if (!alt) throw nichtGefunden("Dieses Angebot");
      if (!ANGEBOT_STATUS[nach]) throw fehler(400, "Wähle einen Status aus der Liste.");
      if (!angebotWechselErlaubt(alt.status, nach)) throw fehler(400, `${alt.nummer} ist „${ANGEBOT_STATUS[alt.status]}“ und kann nicht direkt auf „${ANGEBOT_STATUS[nach]}“ wechseln. Versende es zuerst.`);
      let pdfRel = alt.pdf_datei;
      let fassung = alt.fassung;
      if (nach === "versendet") {
        const { rows: [{ n }] } = await c.query("SELECT count(*)::int AS n FROM angebot_position WHERE angebot_id = $1", [id]);
        if (!n) throw fehler(400, "Das Angebot hat noch keine Positionen. Füge mindestens eine Position hinzu.");
        fassung = alt.fassung + 1;
        await c.query("UPDATE angebot SET fassung = $1 WHERE id = $2", [fassung, id]);
        const a = await ladeAngebot(c, id);
        const e = await ladeEinstellungen(c);
        const pdf = await angebotPdf(a, e.firma, { logo: await ladeLogo(ctx) });
        const basis = datenOrdner(ctx);
        const ordner = a.ordner ? path.join(a.ordner, "Angebote") : path.join("angebote");
        pdfRel = path.join(ordner, `${a.nummer} Fassung ${fassung}.pdf`);
        const voll = sichererPfad(basis, pdfRel);
        await fsp.mkdir(path.dirname(voll), { recursive: true });
        await fsp.writeFile(voll, pdf);
        // 4.2 Archiv: jede versendete Fassung mit PDF und Stand der Positionen festhalten
        await c.query(`INSERT INTO angebot_fassung (angebot_id, fassung, status, pdf_datei, summe_netto, daten, erstellt_von) VALUES ($1, $2, 'versendet', $3, $4, $5, $6)`,
          [id, fassung, pdfRel, a.summen.netto, JSON.stringify({ positionen: a.positionen.map(({ verfuegbarkeit: _v, hinweis: _h, ...p }) => p), summen: a.summen }), ctx.nutzer?.benutzername || ""]);
      }
      await c.query("UPDATE angebot SET status = $1, pdf_datei = $2, version = version + 1, geaendert = now() WHERE id = $3", [nach, pdfRel, id]);
      // D-55: Projektstatus folgt dem Angebot (nur vorwärts)
      const { rows: [p] } = await c.query("SELECT id, nummer, status FROM projekt WHERE id = $1 FOR UPDATE", [alt.projekt_id]);
      const pNeu = projektStatusNachAngebot(p.status, nach);
      if (pNeu) await c.query("UPDATE projekt SET status = $1, version = version + 1, geaendert = now() WHERE id = $2", [pNeu, p.id]);
      return { alt, fassung, pNeu, p };
    });
    ctx.hub?.sende({ typ: "angebot.geaendert", id, projekt_id: ergebnis.alt.projekt_id, bereich: "angebote" });
    ctx.hub?.sende({ typ: "projekt.geaendert", id: ergebnis.alt.projekt_id, bereich: "projekte" });
    const teile = [`${ergebnis.alt.nummer}: ${ANGEBOT_STATUS[nach]}`];
    if (nach === "versendet") teile.push(`Fassung ${ergebnis.fassung} als PDF abgelegt`);
    if (ergebnis.pNeu) teile.push(`Projekt ${ergebnis.p.nummer} jetzt „${PROJEKT_STATUS[ergebnis.pNeu]}“`);
    return { ok: true, level: "success", text: `${teile.join(". ")}.`, status: nach, fassung: ergebnis.fassung };
  });

  router.delete("/api/v1/angebote/:id", A, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Angebot");
    const { rows: [a] } = await ctx.pool.query("SELECT nummer, status, projekt_id FROM angebot WHERE id = $1", [id]);
    if (!a) throw nichtGefunden("Dieses Angebot");
    if (a.status !== "entwurf") throw fehler(409, `${a.nummer} wurde schon versendet und bleibt erhalten. Setze es stattdessen auf „Abgelehnt“.`);
    await ctx.pool.query("DELETE FROM angebot WHERE id = $1", [id]);
    ctx.hub?.sende({ typ: "angebot.geaendert", id, projekt_id: a.projekt_id, bereich: "angebote" });
    return { ok: true, level: "success", text: `${a.nummer} gelöscht.` };
  });

  // PDF: versendete Fassung aus dem Archiv, sonst (oder mit ?vorschau=1) frisch erzeugt mit Entwurf-Vermerk.
  router.get("/api/v1/angebote/:id/pdf", { ...A, stufe: "r" }, async (ctx) => {
    const a = await ladeAngebot(ctx.pool, idParam(ctx.params.id, "Dieses Angebot"));
    const name = `${a.nummer}${a.fassung ? `-F${a.fassung}` : ""}.pdf`;
    if (a.pdf_datei && ctx.query.vorschau !== "1") {
      try { return sendePdf(ctx, await fsp.readFile(sichererPfad(datenOrdner(ctx), a.pdf_datei)), name, ctx.query.download !== "1"); }
      catch (e) { if (e.code !== "ENOENT") throw e; }
    }
    const e = await ladeEinstellungen(ctx.pool);
    sendePdf(ctx, await angebotPdf(a, e.firma, { entwurf: a.status === "entwurf", logo: await ladeLogo(ctx) }), name, ctx.query.download !== "1");
  });
  router.get("/api/v1/angebote/:id/fassungen/:fassung/pdf", { ...A, stufe: "r" }, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Angebot");
    const { rows: [f] } = await ctx.pool.query(`SELECT f.pdf_datei, f.fassung, a.nummer FROM angebot_fassung f JOIN angebot a ON a.id = f.angebot_id
      WHERE f.angebot_id = $1 AND f.fassung = $2`, [id, Number(ctx.params.fassung)]);
    if (!f?.pdf_datei) throw nichtGefunden("Diese Fassung");
    try { sendePdf(ctx, await fsp.readFile(sichererPfad(datenOrdner(ctx), f.pdf_datei)), `${f.nummer}-F${f.fassung}.pdf`, ctx.query.download !== "1"); }
    catch (e) { if (e.code === "ENOENT") throw fehler(404, "Die PDF-Datei dieser Fassung fehlt im Projektordner. Stelle sie aus der Sicherung wieder her."); throw e; }
  });

  // R-27 Verfügbarkeit für den Editor (vor dem Speichern): Zeitraum aus dem Projekt, eigenes Angebot ausgenommen.
  router.post("/api/v1/verfuegbarkeit", { ...A, stufe: "r" }, async (ctx) => {
    const b = ctx.body || {};
    let zeitraum = { von: b.von || null, bis: b.bis || b.von || null };
    if (b.projekt_id) {
      const { rows: [p] } = await ctx.pool.query("SELECT beginn, ende FROM projekt WHERE id = $1", [Number(b.projekt_id)]);
      if (!p) throw nichtGefunden("Dieses Projekt");
      zeitraum = reservierungsZeitraum(p);
    }
    const ids = Array.isArray(b.artikel_ids) ? b.artikel_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500) : [];
    const karte = await verfuegbarkeitFuer(ctx.pool, ids, zeitraum, b.ausser_angebot ? Number(b.ausser_angebot) : null);
    return { zeitraum, artikel: Object.fromEntries(karte) };
  });

  // FA-05/FA-42 Reservierungsübersicht je Artikel (vorgemerkt/fest), nur aktuelle und künftige.
  router.get("/api/v1/artikel/:id/reservierungen", { bereich: "material", stufe: "r" }, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Artikel");
    // Optional Zeitraum ?von=JJJJ-MM-TT&bis=JJJJ-MM-TT: überlappende Reservierungen (ohne Termin zählen immer)
    const iso = (v, name) => { if (v == null || v === "") return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) throw fehler(400, `„${name}“ ist kein gültiges Datum. Nutze TT.MM.JJJJ.`); return String(v); };
    const von = iso(ctx.query.von, "Von"), bis = iso(ctx.query.bis, "Bis");
    if (von && bis && bis < von) throw fehler(400, "„Bis“ liegt vor „Von“. Tausche die Daten.");
    const { rows } = await ctx.pool.query(`SELECT r.*, r.menge::float8 AS menge FROM reservierung r
      WHERE r.artikel_id = $1 AND (r.bis IS NULL OR r.bis >= COALESCE($2::date, (now() AT TIME ZONE 'Europe/Berlin')::date))
        AND ($3::date IS NULL OR r.von IS NULL OR r.von <= $3::date) ORDER BY r.von NULLS FIRST, r.projekt_nummer`, [id, von, bis]);
    return rows.map((r) => ({ ...r, von_text: r.von ? datumAnzeige(r.von) : "ohne Termin", bis_text: r.bis ? datumAnzeige(r.bis) : "ohne Termin" }));
  });

  // FA-44 Packliste aus dem Angebot (Bildschirm + PDF)
  router.get("/api/v1/angebote/:id/packliste", { bereich: "packen", stufe: "r" }, async (ctx) => ladePackliste(ctx.pool, idParam(ctx.params.id, "Dieses Angebot")));
  router.get("/api/v1/angebote/:id/packliste.pdf", { bereich: "packen", stufe: "r" }, async (ctx) => {
    const pl = await ladePackliste(ctx.pool, idParam(ctx.params.id, "Dieses Angebot"));
    sendePdf(ctx, await packlistePdf(pl), `Packliste ${pl.angebot.projekt_nummer}.pdf`, ctx.query.download !== "1");
  });
}

