// Etiketten, Kabel, Etiketten-Bestellungen (Spec 3.12, 3.13, 4.4, 5.4, 5.12, 5.13, 6.2).
import QRCode from "qrcode";
import PDFDocument from "pdfkit";
import { transaktion } from "@lager/db";
import { laengeAusName, naechsteFreieFarbe, farbeHex, KABELFARBEN, laengeText, kabelName, etikettSvg, pruefeVorlage,
  naechsteBestellnummer, bestellStatus, lieferSchluessel, csvCode, pruefeBestellung, code128Module, csv, normalisiereCode } from "@lager/domain";
import { fehler, nichtGefunden, idParam, dbFehler } from "./hilfen.js";
import { sichereFassung } from "./fassung.js";
import { vergibCodes, legeGeraeteAn } from "./geraetecodes.js";

const M = { bereich: "material" }, G = { bereich: "geraete" };
const runde2 = (n) => Math.round(Number(n) * 100) / 100;

/* ── Kabel (R-29, R-29a) ── */

/** R-29a: Farbe einer Länge; beim ersten Auftreten nächste freie Farbe, danach für immer dieselbe. '' = alle vergeben. */
export async function farbeFuerLaenge(c, laenge) {
  if (laenge == null) return "";
  const l = runde2(laenge);
  const { rows: [da] } = await c.query("SELECT farbcode FROM kabel_laenge WHERE laenge_m = $1", [l]);
  if (da) return da.farbcode;
  await c.query("LOCK TABLE kabel_laenge IN SHARE ROW EXCLUSIVE MODE");
  const { rows } = await c.query("SELECT laenge_m, farbcode FROM kabel_laenge");
  const vorhanden = rows.find((r) => r.laenge_m === l);
  if (vorhanden) return vorhanden.farbcode;
  const farbe = naechsteFreieFarbe(rows.map((r) => r.farbcode)) || "";
  await c.query("INSERT INTO kabel_laenge (laenge_m, farbcode) VALUES ($1, $2)", [l, farbe]);
  return farbe;
}

/**
 * Kabel-Felder eines Artikels vor dem Speichern: Länge aus Name (nur neu, nur Kategorie mit „kabel“) und Farbe.
 * @param {boolean} neu Länge aus dem Namen nur beim Anlegen erkennen (sonst bewusst geleerte Länge respektieren).
 */
export async function kabelFelder(c, w, neu) {
  if (w.verbrauch || w.ist_leistung) return { ...w, laenge_m: null, farbcode: "" };
  let laenge = w.laenge_m == null || w.laenge_m === "" ? null : runde2(w.laenge_m);
  if (laenge == null && neu && Number.isInteger(w.kategorie_id)) {
    const { rows: [k] } = await c.query("SELECT name FROM kategorie WHERE id = $1", [w.kategorie_id]);
    laenge = laengeAusName(w.name, k?.name);
  }
  return { ...w, laenge_m: laenge, farbcode: laenge == null ? "" : await farbeFuerLaenge(c, laenge) };
}

/* ── Etiketten-Bestellung (R-67) ── */

/**
 * R-67: Reserviert fortlaufende Codes je Position und legt EtikettCode-Zeilen an. Es entstehen keine Geräte.
 * @param {{artikel_id: number, menge: number}[]} positionen
 */
export async function bestelleEtiketten(c, ctx, positionen, { lieferant, notiz } = {}) {
  const summe = new Map();
  for (const p of Array.isArray(positionen) ? positionen : []) {
    const id = Number(p?.artikel_id), n = Number(p?.menge);
    summe.set(id, (summe.get(id) || 0) + n);
  }
  const pos = [...summe].map(([artikel_id, menge]) => ({ artikel_id, menge }));
  const { rows } = await c.query(`SELECT a.id, a.name, a.verbrauch, a.ist_leistung, a.kategorie_id, k.praefix
    FROM artikel a JOIN kategorie k ON k.id = a.kategorie_id WHERE a.id = ANY($1::int[])`, [pos.map((p) => p.artikel_id).filter(Number.isInteger)]);
  const f = pruefeBestellung(pos, new Map(rows.map((r) => [r.id, r])));
  if (f) throw fehler(400, f);
  await c.query("SELECT pg_advisory_xact_lock(hashtext('etikett_bestellung'))");
  const { rows: [{ jahr, lief }] } = await c.query(`SELECT extract(year FROM now() AT TIME ZONE 'Europe/Berlin')::int AS jahr,
    coalesce(nullif(werte->>'etiketten_lieferant', ''), 'Stromstoss') AS lief FROM einstellungen WHERE id = 1`);
  const { rows: alt } = await c.query("SELECT nummer FROM etikett_bestellung WHERE nummer LIKE $1", [`EB-${jahr}-%`]);
  const nummer = naechsteBestellnummer(jahr, alt.map((r) => r.nummer));
  const { rows: [b] } = await c.query(`INSERT INTO etikett_bestellung (nummer, lieferant, notiz, erstellt_von) VALUES ($1, $2, $3, $4) RETURNING id, nummer`,
    [nummer, String(lieferant || "").trim() || lief, String(notiz || "").slice(0, 2000), ctx.nutzer?.benutzername || ""]);
  const codes = [];
  for (const p of pos) {
    const a = rows.find((r) => r.id === p.artikel_id);
    for (const code of await vergibCodes(c, a.kategorie_id, p.menge)) {
      await c.query("INSERT INTO etikett_code (bestellung_id, artikel_id, code) VALUES ($1, $2, $3)", [b.id, a.id, code]);
      codes.push(code);
    }
  }
  ctx.hub?.sende({ typ: "etiketten.geaendert", id: b.id, bereich: "material" });
  return { id: b.id, nummer: b.nummer, codes };
}

/** R-70: Ist der Code bestellt, aber noch nicht geliefert? */
export async function offeneBestellung(db, code) {
  const { rows: [r] } = await db.query(`SELECT b.id, b.nummer FROM etikett_code c JOIN etikett_bestellung b ON b.id = c.bestellung_id
    WHERE c.code = $1 AND c.geliefert_am IS NULL`, [code]);
  return r || null;
}

/* ── Etikett-Daten ── */

/** QR-Matrix (boolean[][]) für einen Code. */
export function qrMatrix(text) {
  const q = QRCode.create(String(text), { errorCorrectionLevel: "M" });
  const n = q.modules.size, d = q.modules.data;
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => !!d[y * n + x]));
}

const ETIKETT_SQL = `SELECT g.id, g.code, a.name, a.laenge_m, a.farbcode, k.name AS kategorie
  FROM geraet g JOIN artikel a ON a.id = g.artikel_id JOIN kategorie k ON k.id = a.kategorie_id`;

const vorlageZeile = (v) => v && ({ ...v, elemente: v.elemente || [] });

async function firmaName(db) {
  const { rows: [e] } = await db.query("SELECT werte->'firma'->>'name' AS firma, werte->>'etiketten_hinweis' AS hinweis FROM einstellungen WHERE id = 1");
  return { firma: e?.firma || "", hinweis: e?.hinweis || "" };
}

/* ── PDF-Liste für den Lieferanten (R-68) ── */

const MM = 72 / 25.4;
function bestellPdf(b, codes, hinweis) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 15 * MM, info: { Title: `Etiketten-Bestellung ${b.nummer}` } });
    const teile = [];
    doc.on("data", (d) => teile.push(d)).on("end", () => resolve(Buffer.concat(teile))).on("error", reject);
    doc.font("Helvetica-Bold").fontSize(14).text(`Etiketten-Bestellung ${b.nummer}`);
    doc.font("Helvetica").fontSize(9).text(`Lieferant: ${b.lieferant} · ${codes.length} Etiketten`);
    if (hinweis) doc.moveDown(0.3).fontSize(9).text(`Druckvorgabe: ${hinweis}`);
    doc.moveDown(0.8);
    const spalten = 3, zellB = 58 * MM, zellH = 26 * MM, links = 15 * MM;
    let y = doc.y;
    codes.forEach((c, i) => {
      const sp = i % spalten;
      if (sp === 0 && i > 0) y += zellH;
      if (y + zellH > doc.page.height - 15 * MM) { doc.addPage(); y = 15 * MM; }
      const x = links + sp * (zellB + 4 * MM);
      // Code 128 mit Ruhezone, Text darunter
      const module = code128Module(c.code);
      const gesamt = module.reduce((a, v) => a + v, 0) + 20, m = (zellB - 14 * MM) / gesamt;
      let px = x + 10 * m;
      module.forEach((w, j) => { if (j % 2 === 0) doc.rect(px, y, w * m, 12 * MM).fill("#000"); px += w * m; });
      doc.fillColor("#000").font("Helvetica-Bold").fontSize(9).text(c.code, x, y + 13 * MM, { width: zellB - 14 * MM, align: "center" });
      doc.font("Helvetica").fontSize(7).text(c.artikel, x, y + 17.5 * MM, { width: zellB - 14 * MM, height: 8, ellipsis: true });
      if (c.laenge_m != null) {
        const hex = farbeHex(c.farbcode) || "#ffffff";
        doc.rect(x + zellB - 12 * MM, y, 11 * MM, 12 * MM).fillAndStroke(hex, "#000");
        doc.fillColor("#000").font("Helvetica-Bold").fontSize(8).text(laengeText(c.laenge_m), x + zellB - 12 * MM, y + 13 * MM, { width: 11 * MM, align: "center" });
      }
    });
    doc.end();
  });
}

export function etikettenModul(router) {
  /* ── Vorlagen (3.13, FA-11) ── */
  router.get("/api/v1/etiketten/vorlagen", { ...G, stufe: "r" }, async (ctx) => {
    const { rows } = await ctx.pool.query("SELECT * FROM etikett_vorlage ORDER BY art, NOT standard, lower(name)");
    return { zeilen: rows.map(vorlageZeile) };
  });
  router.get("/api/v1/etiketten/vorlagen/:id", { ...G, stufe: "r" }, async (ctx) => {
    const { rows: [v] } = await ctx.pool.query("SELECT * FROM etikett_vorlage WHERE id = $1", [idParam(ctx.params.id, "Diese Vorlage")]);
    if (!v) throw nichtGefunden("Diese Vorlage");
    return vorlageZeile(v);
  });
  const vorlageWerte = (b) => {
    const v = { name: String(b?.name || "").trim(), art: b?.art === "kabel" ? "kabel" : "allgemein", breite_mm: Number(b?.breite_mm), hoehe_mm: Number(b?.hoehe_mm),
      farbe: /^#[0-9a-f]{6}$/i.test(b?.farbe || "") ? b.farbe : "#ffffff", elemente: b?.elemente };
    const f = pruefeVorlage(v);
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    return v;
  };
  const doppelt = { doppelt: "Eine Vorlage mit diesem Namen gibt es schon. Wähle einen anderen Namen." };
  router.post("/api/v1/etiketten/vorlagen", M, async (ctx) => {
    const v = vorlageWerte(ctx.body);
    try {
      const { rows: [n] } = await ctx.pool.query(`INSERT INTO etikett_vorlage (name, art, breite_mm, hoehe_mm, farbe, elemente)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [v.name, v.art, v.breite_mm, v.hoehe_mm, v.farbe, JSON.stringify(v.elemente)]);
      ctx.hub?.sende({ typ: "vorlage.geaendert", id: n.id, bereich: "material" });
      return { ok: true, level: "success", text: `Vorlage „${n.name}“ angelegt.`, vorlage: vorlageZeile(n) };
    } catch (e) { throw dbFehler(e, doppelt); }
  });
  router.put("/api/v1/etiketten/vorlagen/:id", M, async (ctx) => {
    await sichereFassung(ctx, ctx.pool, "etikett_vorlage", Number(ctx.params.id), { was: "Die Vorlage" });
    const id = idParam(ctx.params.id, "Diese Vorlage");
    const v = vorlageWerte(ctx.body);
    try {
      const { rows: [n] } = await ctx.pool.query(`UPDATE etikett_vorlage SET name = $1, art = $2, breite_mm = $3, hoehe_mm = $4, farbe = $5, elemente = $6,
          version = version + 1, geaendert = now() WHERE id = $7 AND ($8::int IS NULL OR version = $8) RETURNING *`,
      [v.name, v.art, v.breite_mm, v.hoehe_mm, v.farbe, JSON.stringify(v.elemente), id, ctx.body?.version ?? null]);
      if (!n) {
        const { rows: [da] } = await ctx.pool.query("SELECT 1 FROM etikett_vorlage WHERE id = $1", [id]);
        if (!da) throw nichtGefunden("Diese Vorlage");
        throw fehler(409, "Jemand anderes hat diese Vorlage inzwischen geändert. Lade sie neu und trage deine Änderung erneut ein.");
      }
      ctx.hub?.sende({ typ: "vorlage.geaendert", id, bereich: "material" });
      return { ok: true, level: "success", text: "Vorlage gespeichert.", vorlage: vorlageZeile(n) };
    } catch (e) { throw dbFehler(e, doppelt); }
  });
  router.post("/api/v1/etiketten/vorlagen/:id/kopieren", M, async (ctx) => {
    const id = idParam(ctx.params.id, "Diese Vorlage");
    const { rows: [v] } = await ctx.pool.query("SELECT * FROM etikett_vorlage WHERE id = $1", [id]);
    if (!v) throw nichtGefunden("Diese Vorlage");
    const { rows: namen } = await ctx.pool.query("SELECT name FROM etikett_vorlage");
    const belegt = new Set(namen.map((r) => r.name));
    let name = `Kopie von ${v.name}`;
    for (let i = 2; belegt.has(name); i++) name = `Kopie ${i} von ${v.name}`;
    const { rows: [n] } = await ctx.pool.query(`INSERT INTO etikett_vorlage (name, art, breite_mm, hoehe_mm, farbe, elemente)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [name, v.art, v.breite_mm, v.hoehe_mm, v.farbe, JSON.stringify(v.elemente)]);
    ctx.hub?.sende({ typ: "vorlage.geaendert", id: n.id, bereich: "material" });
    return { ok: true, level: "success", text: `Kopie „${name}“ angelegt.`, vorlage: vorlageZeile(n) };
  });
  router.post("/api/v1/etiketten/vorlagen/:id/standard", M, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Diese Vorlage");
    const { rows: [v] } = await c.query("SELECT id, name, art FROM etikett_vorlage WHERE id = $1 FOR UPDATE", [id]);
    if (!v) throw nichtGefunden("Diese Vorlage");
    await c.query("UPDATE etikett_vorlage SET standard = false WHERE art = $1 AND standard", [v.art]);
    await c.query("UPDATE etikett_vorlage SET standard = true WHERE id = $1", [id]);
    ctx.hub?.sende({ typ: "vorlage.geaendert", id, bereich: "material" });
    return { ok: true, level: "success", text: `„${v.name}“ ist jetzt die Standardvorlage${v.art === "kabel" ? " für Kabel" : ""}.` };
  }));
  router.delete("/api/v1/etiketten/vorlagen/:id", M, async (ctx) => {
    const id = idParam(ctx.params.id, "Diese Vorlage");
    const { rows: [v] } = await ctx.pool.query("SELECT standard FROM etikett_vorlage WHERE id = $1", [id]);
    if (!v) throw nichtGefunden("Diese Vorlage");
    if (v.standard) throw fehler(409, "Die Standardvorlage kann nicht gelöscht werden. Mache zuerst eine andere Vorlage zum Standard.");
    await ctx.pool.query("DELETE FROM etikett_vorlage WHERE id = $1", [id]);
    ctx.hub?.sende({ typ: "vorlage.geaendert", id, bereich: "material" });
    return { ok: true, level: "success", text: "Vorlage gelöscht." };
  });

  /* ── Druckdaten (FA-10): fertige SVGs je Gerät ── */
  router.post("/api/v1/etiketten/druck", { ...G, stufe: "r" }, async (ctx) => {
    const ids = (Array.isArray(ctx.body?.ids) ? ctx.body.ids : []).map(Number).filter(Number.isInteger);
    const codes = (Array.isArray(ctx.body?.codes) ? ctx.body.codes : []).map(normalisiereCode).filter(Boolean);
    if (!ids.length && !codes.length) throw fehler(400, "Wähle mindestens ein Gerät für den Etikettendruck.");
    if (ids.length + codes.length > 1000) throw fehler(400, "Höchstens 1000 Etiketten auf einmal. Teile den Druck auf.");
    const { rows } = await ctx.pool.query(`${ETIKETT_SQL} WHERE g.id = ANY($1::int[]) OR g.code = ANY($2::text[]) ORDER BY g.code`, [ids, codes]);
    const { rows: vorlagen } = await ctx.pool.query("SELECT * FROM etikett_vorlage");
    const gewaehlt = ctx.body?.vorlage_id ? vorlagen.find((v) => v.id === Number(ctx.body.vorlage_id)) : null;
    if (ctx.body?.vorlage_id && !gewaehlt) throw nichtGefunden("Diese Vorlage");
    const std = (art) => vorlagen.find((v) => v.standard && v.art === art) || vorlagen.find((v) => v.standard) || vorlagen[0];
    const { firma } = await firmaName(ctx.pool);
    const gefunden = new Set(rows.map((r) => r.code));
    const etiketten = rows.map((r) => {
      const v = gewaehlt || std(r.laenge_m != null ? "kabel" : "allgemein");
      const d = { code: r.code, name: r.name, kategorie: r.kategorie, firma, laenge_m: r.laenge_m, farbe_hex: farbeHex(r.farbcode) || "#ffffff", text: "", qr: qrMatrix(r.code) };
      return { id: r.id, code: r.code, vorlage_id: v.id, breite_mm: v.breite_mm, hoehe_mm: v.hoehe_mm, svg: etikettSvg(vorlageZeile(v), d) };
    });
    return { etiketten, fehlend: codes.filter((c) => !gefunden.has(c)) };
  });
  // FA-11 Vorschau mit Beispieldaten und echtem QR
  router.post("/api/v1/etiketten/vorschau", { ...G, stufe: "r" }, async (ctx) => {
    const v = vorlageWerte({ name: "Vorschau", ...ctx.body?.vorlage });
    const { firma } = await firmaName(ctx.pool);
    const d = { code: "LT-0001", name: "Schuko-Kabel 5 m", kategorie: "Stromkabel", firma: firma || "Deine Firma", laenge_m: 5, farbe_hex: "#1e66d0", text: "", qr: qrMatrix("LT-0001"), ...ctx.body?.daten };
    return { svg: etikettSvg(v, d) };
  });

  /* ── Kabel (FA-12, R-73) ── */
  router.get("/api/v1/kabel/farben", { ...M, stufe: "r" }, async (ctx) => {
    const { rows } = await ctx.pool.query(`SELECT l.laenge_m, l.farbcode, count(a.id)::int AS artikel FROM kabel_laenge l
      LEFT JOIN artikel a ON a.laenge_m = l.laenge_m GROUP BY l.laenge_m ORDER BY l.laenge_m`);
    const ohne = rows.filter((r) => !r.farbcode).length;
    return {
      zeilen: rows.map((r) => ({ ...r, hex: farbeHex(r.farbcode), text: laengeText(r.laenge_m) })),
      farben: KABELFARBEN,
      hinweis: ohne ? `Alle 12 Farben sind vergeben. ${ohne} Länge(n) haben keine Farbe und zeigen nur die Länge.` : "",
    };
  });
  router.post("/api/v1/kabel/neu-erkennen", M, async (ctx) => transaktion(ctx.pool, async (c) => {
    const { rows } = await c.query(`SELECT a.id, a.name, a.laenge_m, a.farbcode, k.name AS kategorie FROM artikel a JOIN kategorie k ON k.id = a.kategorie_id
      WHERE NOT a.verbrauch AND NOT a.ist_leistung ORDER BY a.id FOR UPDATE OF a`);
    let geaendert = 0;
    for (const a of rows) {
      const erkannt = laengeAusName(a.name, a.kategorie);
      const laenge = erkannt ?? a.laenge_m;
      const farbe = laenge == null ? "" : await farbeFuerLaenge(c, laenge);
      if (laenge !== a.laenge_m || farbe !== a.farbcode) {
        await c.query("UPDATE artikel SET laenge_m = $1, farbcode = $2, version = version + 1, geaendert = now() WHERE id = $3", [laenge, farbe, a.id]);
        geaendert++;
      }
    }
    if (geaendert) ctx.hub?.sende({ typ: "artikel.geaendert", bereich: "material" });
    return { ok: true, level: "success", text: geaendert ? `${geaendert} Artikel aktualisiert.` : "Alle Längen und Farben sind schon aktuell.", geaendert };
  }));
  // R-73 Kabel-Assistent
  router.post("/api/v1/kabel/assistent", M, async (ctx) => transaktion(ctx.pool, async (c) => {
    const art = String(ctx.body?.art || "").trim();
    const kategorieId = Number(ctx.body?.kategorie_id);
    const kennzeichnung = ctx.body?.kennzeichnung || "keine";
    const f = {};
    if (!art) f.art = "Gib die Kabelart an, z. B. „Schuko-Kabel“.";
    if (!Number.isInteger(kategorieId)) f.kategorie_id = "Wähle eine Kategorie.";
    if (!["qr", "bestellen", "keine"].includes(kennzeichnung)) f.kennzeichnung = "Wähle QR, Bestellen oder Keine.";
    const zeilen = (Array.isArray(ctx.body?.zeilen) ? ctx.body.zeilen : []).map((z) => ({
      laenge_m: runde2(z?.laenge_m), preis_tag: z?.preis_tag == null || z.preis_tag === "" ? null : Number(z.preis_tag),
      anzahl: z?.anzahl == null || z.anzahl === "" ? 0 : Number(z.anzahl) }));
    if (!zeilen.length) f.zeilen = "Kreuze mindestens eine Länge an.";
    for (const z of zeilen) {
      if (!(z.laenge_m > 0) || z.laenge_m >= 1e6) { f.zeilen = "Jede Länge muss größer als 0 m sein."; break; }
      if (z.preis_tag != null && (!Number.isInteger(z.preis_tag) || z.preis_tag < 0)) { f.zeilen = `Preis für ${laengeText(z.laenge_m)} muss ein Betrag ab 0 sein.`; break; }
      if (!Number.isInteger(z.anzahl) || z.anzahl < 0 || z.anzahl > 500) { f.zeilen = `Stückzahl für ${laengeText(z.laenge_m)} muss zwischen 0 und 500 liegen.`; break; }
    }
    if (new Set(zeilen.map((z) => z.laenge_m)).size !== zeilen.length) f.zeilen = "Jede Länge nur einmal ankreuzen.";
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    const { rows: [k] } = await c.query("SELECT id FROM kategorie WHERE id = $1", [kategorieId]);
    if (!k) throw nichtGefunden("Diese Kategorie");
    const artikel = [];
    for (const z of zeilen) {
      const name = kabelName(art, z.laenge_m);
      const { rows: [da] } = await c.query("SELECT id, name FROM artikel WHERE kategorie_id = $1 AND lower(name) = lower($2)", [kategorieId, name]);
      if (da) { artikel.push({ id: da.id, name: da.name, neu: false, anzahl: z.anzahl }); continue; }
      const farbe = await farbeFuerLaenge(c, z.laenge_m);
      const { rows: [n] } = await c.query(`INSERT INTO artikel (name, kategorie_id, laenge_m, farbcode, preis_tag) VALUES ($1, $2, $3, $4, $5) RETURNING id, name`,
        [name, kategorieId, z.laenge_m, farbe, z.preis_tag]);
      artikel.push({ id: n.id, name: n.name, neu: true, anzahl: z.anzahl });
    }
    let geraete = null, bestellung = null;
    const mitAnzahl = artikel.filter((a) => a.anzahl > 0);
    if (mitAnzahl.length && kennzeichnung === "qr") {
      geraete = { codes: [], ids: [] };
      for (const a of mitAnzahl) { const r = await legeGeraeteAn(c, a.id, a.anzahl); geraete.codes.push(...r.codes); geraete.ids.push(...r.ids); }
    } else if (mitAnzahl.length && kennzeichnung === "bestellen") {
      bestellung = await bestelleEtiketten(c, ctx, mitAnzahl.map((a) => ({ artikel_id: a.id, menge: a.anzahl })));
    }
    ctx.hub?.sende({ typ: "artikel.geaendert", bereich: "material" });
    const neu = artikel.filter((a) => a.neu).length;
    return { ok: true, level: "success", artikel, geraete, bestellung,
      text: `${neu} Kabel-Artikel angelegt${artikel.length > neu ? `, ${artikel.length - neu} gab es schon` : ""}.${bestellung ? ` Bestellung ${bestellung.nummer} mit ${bestellung.codes.length} Codes.` : ""}${geraete ? ` ${geraete.codes.length} Geräte angelegt.` : ""}` };
  }));

  /* ── Bestellungen (R-67–R-70, FA-13, 4.4) ── */
  const LISTE_SQL = `SELECT b.*, count(c.id)::int AS gesamt, count(c.geliefert_am)::int AS geliefert
    FROM etikett_bestellung b LEFT JOIN etikett_code c ON c.bestellung_id = b.id`;
  const mitStatus = (b) => ({ ...b, status: bestellStatus(b.gesamt, b.geliefert) });
  router.get("/api/v1/etiketten/bestellungen", { ...M, stufe: "r" }, async (ctx) => {
    const { rows } = await ctx.pool.query(`${LISTE_SQL} GROUP BY b.id ORDER BY b.erstellt DESC, b.id DESC LIMIT 500`);
    const zeilen = rows.map(mitStatus).filter((b) => !ctx.query.status || b.status === ctx.query.status);
    return { gesamt: zeilen.length, zeilen };
  });
  const ladeBestellung = async (db, id) => {
    const { rows: [b] } = await db.query(`${LISTE_SQL} WHERE b.id = $1 GROUP BY b.id`, [id]);
    if (!b) throw nichtGefunden("Diese Bestellung");
    const { rows: codes } = await db.query(`SELECT c.id, c.code, c.artikel_id, a.name AS artikel, a.laenge_m, a.farbcode, c.geraet_id, c.geliefert_am
      FROM etikett_code c JOIN artikel a ON a.id = c.artikel_id WHERE c.bestellung_id = $1 ORDER BY c.code`, [id]);
    return { ...mitStatus(b), codes: codes.map((c) => ({ ...c, hex: farbeHex(c.farbcode) })) };
  };
  router.get("/api/v1/etiketten/bestellungen/:id", { ...M, stufe: "r" }, async (ctx) => ladeBestellung(ctx.pool, idParam(ctx.params.id, "Diese Bestellung")));
  router.post("/api/v1/etiketten/bestellungen", M, async (ctx) => transaktion(ctx.pool, async (c) => {
    const b = await bestelleEtiketten(c, ctx, ctx.body?.positionen, { lieferant: ctx.body?.lieferant, notiz: ctx.body?.notiz });
    return { ok: true, level: "success", text: `Bestellung ${b.nummer} mit ${b.codes.length} Codes angelegt.`, bestellung: b };
  }));
  router.put("/api/v1/etiketten/bestellungen/:id", M, async (ctx) => {
    await sichereFassung(ctx, ctx.pool, "etikett_bestellung", Number(ctx.params.id), { was: "Die Bestellung" });
    const id = idParam(ctx.params.id, "Diese Bestellung");
    const am = ctx.body?.bestellt_am || null;
    if (am && !/^\d{4}-\d{2}-\d{2}$/.test(am)) throw fehler(400, "Das Bestelldatum ist ungültig. Wähle ein Datum im Kalender.", { felder: { bestellt_am: "Datum ungültig" } });
    const { rowCount } = await ctx.pool.query(`UPDATE etikett_bestellung SET lieferant = coalesce($1, lieferant), notiz = coalesce($2, notiz), bestellt_am = $3 WHERE id = $4`,
      [ctx.body?.lieferant == null ? null : String(ctx.body.lieferant).trim(), ctx.body?.notiz == null ? null : String(ctx.body.notiz).slice(0, 2000), am, id]);
    if (!rowCount) throw nichtGefunden("Diese Bestellung");
    ctx.hub?.sende({ typ: "etiketten.geaendert", id, bereich: "material" });
    return { ok: true, level: "success", text: "Bestellung gespeichert." };
  });
  // 4.4: Löschen nur, solange noch kein Gerät aus der Bestellung gebucht wurde. Codes bleiben verbraucht (R-21).
  router.delete("/api/v1/etiketten/bestellungen/:id", M, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Diese Bestellung");
    const { rows: [b] } = await c.query("SELECT nummer FROM etikett_bestellung WHERE id = $1 FOR UPDATE", [id]);
    if (!b) throw nichtGefunden("Diese Bestellung");
    const { rows: [g] } = await c.query("SELECT count(*)::int AS n FROM etikett_code WHERE bestellung_id = $1 AND geliefert_am IS NOT NULL", [id]);
    if (g.n) throw fehler(409, `Aus ${b.nummer} sind schon ${g.n} Geräte geliefert und gebucht. Die Bestellung kann nicht mehr gelöscht werden.`);
    await c.query("DELETE FROM etikett_bestellung WHERE id = $1", [id]);
    ctx.hub?.sende({ typ: "etiketten.geaendert", id, bereich: "material" });
    return { ok: true, level: "success", text: `Bestellung ${b.nummer} gelöscht. Die Codes werden nicht neu vergeben.` };
  }));
  // R-68 PDF und CSV für den Lieferanten
  router.get("/api/v1/etiketten/bestellungen/:id/liste.pdf", { ...M, stufe: "r" }, async (ctx) => {
    const b = await ladeBestellung(ctx.pool, idParam(ctx.params.id, "Diese Bestellung"));
    const { hinweis } = await firmaName(ctx.pool);
    const pdf = await bestellPdf(b, b.codes, hinweis);
    ctx.res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${b.nummer}.pdf"`, "Cache-Control": "no-store" });
    ctx.res.end(pdf);
  });
  router.get("/api/v1/etiketten/bestellungen/:id/liste.csv", { ...M, stufe: "r" }, async (ctx) => {
    const b = await ladeBestellung(ctx.pool, idParam(ctx.params.id, "Diese Bestellung"));
    const ohne = ctx.query.ohne_bindestrich === "1";
    const text = csv([["Code", "Artikel", "Länge", "Farbe"], ...b.codes.map((c) => [csvCode(c.code, ohne), c.artikel, laengeText(c.laenge_m), c.farbcode])]);
    ctx.res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${b.nummer}${ohne ? "-ohne-bindestrich" : ""}.csv"`, "Cache-Control": "no-store" });
    ctx.res.end(text);
  });
  // R-69 Lieferung buchen: gescannte oder abgehakte Codes → Geräte
  router.post("/api/v1/etiketten/bestellungen/:id/liefern", M, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Diese Bestellung");
    const { rows: [b] } = await c.query("SELECT id, nummer FROM etikett_bestellung WHERE id = $1 FOR UPDATE", [id]);
    if (!b) throw nichtGefunden("Diese Bestellung");
    const eingaben = (Array.isArray(ctx.body?.codes) ? ctx.body.codes : []).map(String).filter((s) => s.trim());
    if (!eingaben.length) throw fehler(400, "Scanne oder hake mindestens einen gelieferten Code ab.");
    const { rows: offen } = await c.query("SELECT id, code, artikel_id, geliefert_am FROM etikett_code WHERE bestellung_id = $1 FOR UPDATE", [id]);
    const nachSchluessel = new Map(offen.map((r) => [lieferSchluessel(r.code), r]));
    const gebucht = [], schon = [], unbekannt = [];
    for (const e of eingaben) {
      const r = nachSchluessel.get(lieferSchluessel(e));
      if (!r) { unbekannt.push(e.trim()); continue; }
      if (r.geliefert_am) { if (!schon.includes(r.code) && !gebucht.includes(r.code)) schon.push(r.code); continue; }
      const { ids: [gid] } = await legeGeraeteAn(c, r.artikel_id, 1, { codes: [r.code] });
      await c.query("UPDATE etikett_code SET geraet_id = $1, geliefert_am = now() WHERE id = $2", [gid, r.id]);
      r.geliefert_am = new Date();
      gebucht.push(r.code);
    }
    const st = bestellStatus(offen.length, offen.filter((r) => r.geliefert_am).length);
    if (gebucht.length) {
      ctx.hub?.sende({ typ: "etiketten.geaendert", id, bereich: "material" });
      ctx.hub?.sende({ typ: "artikel.geaendert", bereich: "material" });
    }
    const teile = [`${gebucht.length} Gerät(e) gebucht.`];
    if (schon.length) teile.push(`${schon.length} schon geliefert.`);
    if (unbekannt.length) teile.push(`Nicht in ${b.nummer}: ${unbekannt.slice(0, 5).join(", ")}${unbekannt.length > 5 ? " …" : ""}. Prüfe die Etiketten.`);
    return { ok: true, level: unbekannt.length ? "warning" : "success", text: teile.join(" "), gebucht, schon_geliefert: schon, unbekannt, status: st };
  }));
}
