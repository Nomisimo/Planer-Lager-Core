// Kunden (3.1, FA-26, FA-27): Stamm, Dublettenprüfung, Kontaktformular-PDF + Import, Adresssuche (NFA-03).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { KUNDE_FELDER, pruefeKunde, dubletten, loeschbarkeit, anonymisiert, FRIST_TEXT } from "@lager/domain";
import { transaktion } from "@lager/db";
import { fehler, nichtGefunden, seite, idParam, dbFehler } from "./hilfen.js";
import { HttpFehler } from "./router.js";
import { protokolliere, clientIp } from "./sicherheit.js";

const K = { bereich: "kunden" };
const FORM_FELDER = [
  ["firma", "Firma"], ["name", "Ansprechpartner (Vor- und Nachname) *"], ["strasse", "Straße und Hausnummer"], ["plz", "PLZ"], ["ort", "Ort"],
  ["telefon", "Telefon"], ["email", "E-Mail"], ["ust_id", "USt-IdNr."], ["notizen", "Anmerkungen"],
];
const sauber = (b) => Object.fromEntries(KUNDE_FELDER.map((f) => [f, String(b?.[f] ?? "").trim().slice(0, f === "notizen" ? 5000 : 300)]));
const tabelleDa = async (db, t) => (await db.query("SELECT to_regclass($1) IS NOT NULL AS da", [t])).rows[0].da;

/** FA-27: ausfüllbares Kontaktformular. */
export async function kontaktformularPdf(firmaName = "") {
  const pdf = await PDFDocument.create();
  const seite = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica), fett = await pdf.embedFont(StandardFonts.HelveticaBold);
  seite.drawText("Kontaktdaten", { x: 50, y: 780, size: 22, font: fett });
  if (firmaName) seite.drawText(`für ${firmaName}`, { x: 50, y: 758, size: 11, font, color: rgb(0.35, 0.35, 0.35) });
  seite.drawText("Bitte am Bildschirm ausfüllen, speichern und per E-Mail zurückschicken. * = Pflichtfeld", { x: 50, y: 738, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
  const form = pdf.getForm();
  let y = 700;
  for (const [name, titel] of FORM_FELDER) {
    seite.drawText(titel, { x: 50, y: y + 22, size: 9, font });
    const f = form.createTextField(`kunde.${name}`);
    const hoehe = name === "notizen" ? 80 : 20;
    if (name === "notizen") f.enableMultiline();
    f.addToPage(seite, { x: 50, y: y - hoehe + 20, width: 495, height: hoehe, font });
    y -= hoehe + 26;
  }
  return Buffer.from(await pdf.save());
}

/** FA-27: Werte aus ausgefülltem Formular lesen. */
export async function leseKontaktformular(bytes) {
  let pdf;
  try { pdf = await PDFDocument.load(bytes, { ignoreEncryption: true }); }
  catch { throw fehler(400, "Die Datei ist kein lesbares PDF. Prüfe, ob du das ausgefüllte Kontaktformular gewählt hast."); }
  const werte = {};
  let gefunden = 0;
  for (const f of pdf.getForm().getFields()) {
    const m = /^kunde\.(\w+)$/.exec(f.getName());
    if (m && KUNDE_FELDER.includes(m[1]) && typeof f.getText === "function") { werte[m[1]] = (f.getText() || "").trim(); gefunden++; }
  }
  if (!gefunden) throw fehler(400, "In dieser PDF wurden keine Formularfelder gefunden. Nutze das Kontaktformular aus dem Programm.");
  return sauber(werte);
}

/** Adresssuche: serverseitig (Schlüssel nie an den Client), Geoapify, sonst Photon. In Tests über config.adressSuche ersetzt. */
async function adressSuche(q, config) {
  if (config?.adressSuche) return config.adressSuche(q);
  const key = process.env.GEOAPIFY_KEY;
  const url = key
    ? `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(q)}&lang=de&limit=6&format=json&apiKey=${key}`
    : `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=de&limit=6`;
  const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { "User-Agent": "Planer-Lager" } });
  if (!r.ok) throw new Error("Adressdienst " + r.status);
  const j = await r.json();
  if (key) return (j.results || []).map((x) => ({ strasse: [x.street, x.housenumber].filter(Boolean).join(" "), plz: x.postcode || "", ort: x.city || "", text: x.formatted }));
  return (j.features || []).map(({ properties: p }) => ({ strasse: [p.street || p.name, p.housenumber].filter(Boolean).join(" "), plz: p.postcode || "", ort: p.city || "",
    text: [p.street || p.name, p.housenumber, p.postcode, p.city].filter(Boolean).join(" ") }));
}

export function kundenModul(router) {
  router.get("/api/v1/kunden", { ...K, stufe: "r" }, async (ctx) => {
    const { limit, offset } = seite(ctx.query);
    const q = ctx.query.q || null;
    const { rows } = await ctx.pool.query(`SELECT k.*, count(*) OVER()::int AS gesamt FROM kunde k
      WHERE $1::text IS NULL OR k.name ILIKE '%' || $1 || '%' OR k.firma ILIKE '%' || $1 || '%' OR k.ort ILIKE '%' || $1 || '%' OR k.email ILIKE '%' || $1 || '%'
      ORDER BY lower(coalesce(nullif(k.firma, ''), k.name)) LIMIT $2 OFFSET $3`, [q, limit, offset]);
    return { gesamt: rows[0]?.gesamt || 0, zeilen: rows.map(({ gesamt: _g, ...r }) => r) };
  });
  router.get("/api/v1/kunden/formular.pdf", { ...K, stufe: "r" }, async (ctx) => {
    const { rows: [e] } = await ctx.pool.query("SELECT werte->'firma'->>'name' AS firma FROM einstellungen WHERE id = 1");
    const pdf = await kontaktformularPdf(e?.firma || "");
    await protokolliere(ctx.pool, "download", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: "Kontaktformular (PDF)" });
    ctx.res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="Kontaktformular.pdf"', "Cache-Control": "no-store" });
    ctx.res.end(pdf);
  });
  // FA-27: Import → nur Vorschau + Dubletten, Anlegen erfolgt danach bewusst (POST /kunden).
  router.post("/api/v1/kunden/import", K, async (ctx) => {
    if (!Buffer.isBuffer(ctx.body) || !ctx.body.length) throw fehler(400, "Wähle das ausgefüllte Kontaktformular (PDF) aus.");
    const werte = await leseKontaktformular(ctx.body);
    const { rows } = await ctx.pool.query("SELECT id, name, firma, email, telefon, plz, ort FROM kunde");
    return { werte, felder: pruefeKunde(werte), dubletten: dubletten(werte, rows).slice(0, 10) };
  });
  router.get("/api/v1/adresse", { ...K, stufe: "r" }, async (ctx) => {
    const q = String(ctx.query.q || "").trim().slice(0, 200);
    if (q.length < 3) return [];
    try { return await adressSuche(q, ctx.config); }
    catch { throw fehler(502, "Die Adresssuche antwortet gerade nicht. Gib die Adresse von Hand ein."); }
  });
  router.get("/api/v1/kunden/:id", { ...K, stufe: "r" }, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Kunde");
    const { rows: [k] } = await ctx.pool.query("SELECT * FROM kunde WHERE id = $1", [id]);
    if (!k) throw nichtGefunden("Diesen Kunden");
    await protokolliere(ctx.pool, "zugriff", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Kunde ${id} angesehen` }); // NFA-03 Protokoll über Zugriffe
    const projekte = await tabelleDa(ctx.pool, "projekt")
      ? (await ctx.pool.query("SELECT id, nummer, name, status, beginn, ende FROM projekt WHERE kunde_id = $1 ORDER BY nummer DESC", [id])).rows : [];
    const angebote = await tabelleDa(ctx.pool, "angebot")
      ? (await ctx.pool.query("SELECT a.id, a.nummer, a.status, a.summe_netto AS summe, p.nummer AS projekt_nummer FROM angebot a JOIN projekt p ON p.id = a.projekt_id WHERE p.kunde_id = $1 ORDER BY a.id DESC", [id])).rows : [];
    return { ...k, projekte, angebote };
  });
  router.post("/api/v1/kunden", K, async (ctx) => {
    const w = sauber(ctx.body);
    const f = pruefeKunde(w);
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    // FA-26 SOLL: Dublettenwarnung auch beim manuellen Anlegen; mit trotzdem=true bewusst anlegen.
    if (!ctx.body?.trotzdem) {
      const { rows } = await ctx.pool.query("SELECT id, name, firma, email, telefon, plz, ort FROM kunde");
      const d = dubletten(w, rows);
      if (d.length) throw new HttpFehler(409, "Es gibt schon ähnliche Kunden. Prüfe die Liste und lege nur an, wenn es wirklich ein neuer Kunde ist.",
        { ok: false, level: "warning", text: "Es gibt schon ähnliche Kunden. Prüfe die Liste und lege nur an, wenn es wirklich ein neuer Kunde ist.", dubletten: d.slice(0, 10) });
    }
    const { rows: [k] } = await ctx.pool.query(`INSERT INTO kunde (${KUNDE_FELDER.join(", ")}) VALUES (${KUNDE_FELDER.map((_, i) => "$" + (i + 1)).join(", ")}) RETURNING *`, KUNDE_FELDER.map((x) => w[x]));
    ctx.hub?.sende({ typ: "kunde.geaendert", id: k.id, bereich: "kunden" });
    return { ok: true, level: "success", text: `Kunde „${k.firma || k.name}“ angelegt.`, kunde: k };
  });
  router.put("/api/v1/kunden/:id", K, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Kunde");
    const w = sauber(ctx.body);
    const f = pruefeKunde(w);
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    const { rows: [k] } = await ctx.pool.query(`UPDATE kunde SET ${KUNDE_FELDER.map((x, i) => `${x} = $${i + 1}`).join(", ")}, version = version + 1
      WHERE id = $${KUNDE_FELDER.length + 1} AND ($${KUNDE_FELDER.length + 2}::int IS NULL OR version = $${KUNDE_FELDER.length + 2}) RETURNING *`,
    [...KUNDE_FELDER.map((x) => w[x]), id, ctx.body?.version ?? null]);
    if (!k) {
      const da = (await ctx.pool.query("SELECT 1 FROM kunde WHERE id = $1", [id])).rows.length;
      if (!da) throw nichtGefunden("Diesen Kunden");
      throw fehler(409, "Jemand anderes hat diesen Kunden inzwischen geändert. Lade die Seite neu und trage deine Änderung erneut ein.");
    }
    ctx.hub?.sende({ typ: "kunde.geaendert", id, version: k.version, bereich: "kunden" });
    return { ok: true, level: "success", text: "Gespeichert.", kunde: k };
  });
  // NFA-03 Löschkonzept: Fristen prüfen, Datenauskunft, Anonymisieren (nur Admin)
  const HEUTE_SQL = "(now() AT TIME ZONE 'Europe/Berlin')::date::text";
  const dokumente = async (db, id) => (await db.query(`
      SELECT 'projekt' AS art, p.nummer, coalesce(p.ende, p.beginn, p.erstellt::date)::text AS datum FROM projekt p WHERE p.kunde_id = $1
      UNION ALL SELECT 'angebot', a.nummer, a.datum::text FROM angebot a JOIN projekt p ON p.id = a.projekt_id WHERE p.kunde_id = $1 AND a.status <> 'entwurf'
      UNION ALL SELECT 'rechnung', 'Rechnung ' || r.id, r.erstellt::date::text FROM rechnung r JOIN projekt p ON p.id = r.projekt_id WHERE p.kunde_id = $1 AND r.status <> 'entwurf'`, [id])).rows;
  const datenschutz = async (db, id) => {
    const { rows: [k] } = await db.query(`SELECT id, anonymisiert, ${HEUTE_SQL} AS heute, (SELECT count(*)::int FROM projekt WHERE kunde_id = kunde.id) AS projekte FROM kunde WHERE id = $1`, [id]);
    if (!k) throw nichtGefunden("Diesen Kunden");
    const l = loeschbarkeit(await dokumente(db, id), k.heute);
    return { anonymisiert: k.anonymisiert, loeschen: k.projekte === 0, anonymisieren: l.erlaubt && !k.anonymisiert && k.projekte > 0, ab: l.ab,
      sperrt: l.sperrt.map((d) => ({ ...d, text: FRIST_TEXT[d.art] })),
      text: k.anonymisiert ? "Personenbezogene Daten sind gelöscht." : k.projekte === 0 ? "Keine Projekte: Der Kunde kann ganz gelöscht werden."
        : l.erlaubt ? "Alle Aufbewahrungsfristen sind abgelaufen: Die Kundendaten können anonymisiert werden."
          : `Aufbewahrungspflicht bis ${l.ab.split("-").reverse().join(".")}: ${l.sperrt.length} Unterlage(n). Erst danach anonymisieren.` };
  };
  router.get("/api/v1/kunden/:id/datenschutz", { ...K, stufe: "r" }, async (ctx) => datenschutz(ctx.pool, idParam(ctx.params.id, "Dieser Kunde")));
  // DSGVO Art. 15: alle gespeicherten Daten zum Kunden als JSON
  router.get("/api/v1/kunden/:id/auskunft", K, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Kunde");
    const { rows: [k] } = await ctx.pool.query("SELECT * FROM kunde WHERE id = $1", [id]);
    if (!k) throw nichtGefunden("Diesen Kunden");
    const projekte = (await ctx.pool.query("SELECT id, nummer, name, ort, status, beginn::text, ende::text, notizen FROM projekt WHERE kunde_id = $1 ORDER BY id", [id])).rows;
    const angebote = (await ctx.pool.query("SELECT a.nummer, a.datum::text, a.status, a.betreff, a.summe_netto FROM angebot a JOIN projekt p ON p.id = a.projekt_id WHERE p.kunde_id = $1 ORDER BY a.id", [id])).rows;
    await protokolliere(ctx.pool, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Datenauskunft Kunde ${id}` });
    const body = JSON.stringify({ erstellt: new Date().toISOString(), kunde: k, projekte, angebote }, null, 2);
    ctx.res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="Datenauskunft-Kunde-${id}.json"`, "Cache-Control": "no-store" });
    ctx.res.end(body);
  });
  router.post("/api/v1/kunden/:id/anonymisieren", { bereich: "verwaltung" }, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Dieser Kunde");
    await c.query("SELECT 1 FROM kunde WHERE id = $1 FOR UPDATE", [id]);
    const d = await datenschutz(c, id);
    if (d.anonymisiert) throw fehler(409, "Dieser Kunde ist schon anonymisiert.");
    if (!d.anonymisieren) throw fehler(409, d.text);
    if (ctx.body?.bestaetigung !== "ANONYMISIEREN") throw fehler(400, "Tippe zur Bestätigung ANONYMISIEREN ein.", { felder: { bestaetigung: "Bestätigung fehlt" } });
    const a = anonymisiert(id);
    const sp = Object.keys(a);
    await c.query(`UPDATE kunde SET ${sp.map((k, i) => `${k} = $${i + 1}`).join(", ")}, anonymisiert = now(), version = version + 1 WHERE id = $${sp.length + 1}`, [...sp.map((k) => a[k]), id]);
    await protokolliere(c, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Kunde ${id} anonymisiert (NFA-03)` });
    ctx.hub?.sende({ typ: "kunde.geaendert", id, bereich: "kunden" });
    return { ok: true, level: "success", text: "Personenbezogene Daten gelöscht. Projekte und Belege bleiben mit der Kundennummer erhalten." };
  }));
  // Übersicht für Admins: Kunden, deren Fristen abgelaufen sind (Kandidaten zum Anonymisieren)
  router.get("/api/v1/verwaltung/loeschfristen", { bereich: "verwaltung" }, async (ctx) => {
    const { rows } = await ctx.pool.query("SELECT id, name, firma FROM kunde WHERE anonymisiert IS NULL AND EXISTS (SELECT 1 FROM projekt WHERE kunde_id = kunde.id) ORDER BY id");
    const out = [];
    for (const k of rows) { const d = await datenschutz(ctx.pool, k.id); if (d.anonymisieren) out.push({ ...k, text: d.text }); }
    return out;
  });
  router.delete("/api/v1/kunden/:id", K, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Kunde");
    try {
      const { rowCount } = await ctx.pool.query("DELETE FROM kunde WHERE id = $1", [id]);
      if (!rowCount) throw nichtGefunden("Diesen Kunden");
    } catch (e) { throw dbFehler(e, { verknuepft: "Dieser Kunde hat Projekte oder Rechnungen und kann nicht gelöscht werden." }); }
    ctx.hub?.sende({ typ: "kunde.geaendert", id, bereich: "kunden" });
    return { ok: true, level: "success", text: "Kunde gelöscht." };
  });
}
