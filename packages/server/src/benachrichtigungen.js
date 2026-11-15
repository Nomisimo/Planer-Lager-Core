// FA-40 Wiederkehrende Aufgaben und Benachrichtigungen (E-5: In-App + E-Mail per SMTP aus der Umgebung).
// Hintergrundlauf (stündlich): Regeln → Aufgaben, Fristen, Prüfungen, Wartung; Überbuchung meldet das Angebot beim Speichern.
import { darf, istAdminRechte, faelligeRegel, pruefeRegel, rhythmusText, heuteIso } from "@lager/domain";
import { fehler, nichtGefunden, idParam } from "./hilfen.js";
import { sichereFassung } from "./fassung.js";
import { sendeMail } from "./mail.js";

const P = { bereich: "projekte" };

/** Aktive Benutzer mit Recht `bereich` (Stufe w), Admins immer. */
export async function benutzerMitRecht(db, bereich, stufe = "w") {
  const { rows } = await db.query("SELECT b.id, r.rechte FROM benutzer b JOIN rolle r ON r.id = b.rolle_id WHERE b.aktiv");
  return rows.filter((b) => istAdminRechte(b.rechte) || darf(b.rechte, bereich, stufe)).map((b) => b.id);
}

/**
 * Legt Benachrichtigungen an (doppelte per Schlüssel werden übersprungen).
 * @returns {Promise<number>} Anzahl neuer Einträge
 */
export async function benachrichtige(db, benutzerIds, { art, schluessel, titel, text = "", app = "p", pfad = "" }, { mail = false, hub = null } = {}) {
  const ids = [...new Set(benutzerIds.filter(Boolean))];
  if (!ids.length) return 0;
  const { rows } = await db.query(`INSERT INTO benachrichtigung (benutzer_id, art, schluessel, titel, text, app, pfad, mail_status)
    SELECT b.id, $2, $3, $4, $5, $6, $7, CASE WHEN $8 AND b.mail_benachrichtigung AND b.email <> '' THEN 'offen' ELSE '' END
    FROM benutzer b WHERE b.id = ANY($1) AND b.aktiv
    ON CONFLICT (benutzer_id, schluessel) DO NOTHING RETURNING benutzer_id`, [ids, art, schluessel, titel, text, app, pfad, !!mail]);
  if (rows.length) { const an = new Set(rows.map((r) => r.benutzer_id)); hub?.sende({ typ: "benachrichtigung.neu", bereich: "start" }, (ws) => an.has(ws.nutzer?.id)); }
  return rows.length;
}

/** Sendet offene E-Mails (höchstens 50 je Lauf). Fehler bleiben sichtbar (mail_status = fehler). */
export async function sendeOffeneMails(pool, config) {
  if (!config.smtp) return { gesendet: 0, fehler: 0 };
  const { rows } = await pool.query(`SELECT n.id, n.titel, n.text, n.app, n.pfad, b.email FROM benachrichtigung n JOIN benutzer b ON b.id = n.benutzer_id
    WHERE n.mail_status = 'offen' ORDER BY n.id LIMIT 50`);
  let gesendet = 0, fehlerZahl = 0;
  for (const n of rows) {
    const link = config.publicUrl && n.pfad ? `\n\n${n.app === "m" ? "Materialplaner" : "Productionplaner"}: ${n.app === "m" ? "materialplaner" : "productionplaner"}://${n.pfad.replace(/^\//, "")}` : "";
    try {
      await sendeMail(config.smtp, { an: n.email, betreff: `[Planer-Lager] ${n.titel}`, text: `${n.titel}\n\n${n.text}${link}\n\nDiese Nachricht kommt automatisch. Abbestellen: im Glocken-Menü „E-Mails“ ausschalten.` });
      await pool.query("UPDATE benachrichtigung SET mail_status = 'gesendet' WHERE id = $1", [n.id]); gesendet++;
    } catch (e) {
      await pool.query("UPDATE benachrichtigung SET mail_status = 'fehler' WHERE id = $1", [n.id]); fehlerZahl++;
      console.error(`E-Mail an Benutzer nicht gesendet: ${e.message}`);
    }
  }
  return { gesendet, fehler: fehlerZahl };
}

/** Wiederkehrende Regeln: fällige Aufgaben anlegen und nächsten Termin setzen. */
export async function regelnAusfuehren(pool, heute = heuteIso(), hub = null) {
  const { rows } = await pool.query("SELECT * FROM aufgabe_regel WHERE aktiv ORDER BY id");
  let neu = 0;
  for (const r of rows) {
    const { termin, naechste } = faelligeRegel({ ...r, naechste: isoVon(r.naechste) }, heute);
    if (!termin) continue;
    const { rowCount } = await pool.query(`INSERT INTO aufgabe (projekt_id, text, faellig, zugewiesen_id, von, regel_id) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (regel_id, faellig) WHERE regel_id IS NOT NULL DO NOTHING`, [r.projekt_id, r.text, termin, r.zugewiesen_id, "wiederkehrend", r.id]);
    await pool.query("UPDATE aufgabe_regel SET naechste = $1 WHERE id = $2", [naechste, r.id]);
    neu += rowCount;
  }
  if (neu) hub?.sende({ typ: "aufgabe.geaendert", bereich: "projekte" });
  return neu;
}
const isoVon = (d) => (typeof d === "string" ? d.slice(0, 10) : heuteIso(d));

/** Ein Hintergrundlauf: Regeln, Fristen, Prüfungen, Wartung, dann E-Mails. */
export async function hintergrundLauf(pool, config = {}, hub = null, heute = heuteIso()) {
  const mail = !!config.smtp;
  const opt = { mail, hub };
  const aufgaben = await regelnAusfuehren(pool, heute, hub);
  let meldungen = 0;
  // Fristen: morgen fällig oder überfällig, an den Zuständigen
  const { rows: fr } = await pool.query(`SELECT a.id, a.text, a.faellig::text AS faellig, a.zugewiesen_id, a.projekt_id, p.nummer FROM aufgabe a LEFT JOIN projekt p ON p.id = a.projekt_id
    WHERE NOT a.erledigt AND a.zugewiesen_id IS NOT NULL AND a.faellig <= $1::date + 1`, [heute]);
  for (const a of fr) {
    const ueber = a.faellig < heute;
    meldungen += await benachrichtige(pool, [a.zugewiesen_id], { art: "frist", schluessel: `frist-${a.id}-${a.faellig}-${ueber ? "ueber" : "bald"}`,
      titel: ueber ? `Überfällig: ${a.text}` : `Fällig ${a.faellig === heute ? "heute" : "morgen"}: ${a.text}`,
      text: `${a.nummer ? `Projekt ${a.nummer} · ` : ""}fällig am ${a.faellig.split("-").reverse().join(".")}`,
      pfad: a.projekt_id ? `/projekte/${a.projekt_id}?tab=aufgaben` : "/aufgaben" }, opt);
  }
  // Prüfungen: überfällig oder in 14 Tagen fällig – eine Sammelmeldung je Woche an alle mit Recht „Geräte ändern“
  const woche = isoWoche(heute);
  const { rows: [pr] } = await pool.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE (g.letzte_pruefung + make_interval(months => a.pruef_intervall_monate))::date < $1::date OR g.letzte_pruefung IS NULL)::int AS ueber
    FROM geraet g JOIN artikel a ON a.id = g.artikel_id
    WHERE a.pruefpflichtig AND g.status NOT IN ('ausgemustert', 'verkauft')
      AND (g.letzte_pruefung IS NULL OR (g.letzte_pruefung + make_interval(months => a.pruef_intervall_monate))::date <= $1::date + 14)`, [heute]);
  if (pr.n) meldungen += await benachrichtige(pool, await benutzerMitRecht(pool, "geraete"), { art: "pruefung", schluessel: `pruefung-${woche}`, app: "m",
    titel: `${pr.n} Gerät(e) zur Prüfung`, text: `${pr.ueber} überfällig, der Rest in den nächsten 14 Tagen.`, pfad: "/geraete?pruef=faellig" }, opt);
  // Wartung (FA-07): fällig, eine Sammelmeldung je Woche
  const { rows: [wa] } = await pool.query(`SELECT count(*)::int AS n FROM geraet g JOIN artikel a ON a.id = g.artikel_id
    WHERE a.wartung_intervall_monate IS NOT NULL AND g.status NOT IN ('ausgemustert', 'verkauft')
      AND (g.letzte_wartung IS NULL OR (g.letzte_wartung + make_interval(months => a.wartung_intervall_monate))::date <= $1::date)`, [heute]);
  if (wa.n) meldungen += await benachrichtige(pool, await benutzerMitRecht(pool, "geraete"), { art: "wartung", schluessel: `wartung-${woche}`, app: "m",
    titel: `${wa.n} Gerät(e) zur Wartung`, text: "Wartung ist fällig. Liste unter Reparatur & Wartung.", pfad: "/reparatur?tab=wartung" }, opt);
  const mails = await sendeOffeneMails(pool, config);
  return { aufgaben, meldungen, mails };
}

/** ISO-Kalenderwoche „2026-W46“. */
export function isoWoche(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const tag = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - tag + 3);
  const jahr = d.getUTCFullYear();
  const erster = new Date(Date.UTC(jahr, 0, 4));
  const kw = 1 + Math.round(((d - erster) / 86400000 - 3 + ((erster.getUTCDay() + 6) % 7)) / 7);
  return `${jahr}-W${String(kw).padStart(2, "0")}`;
}

/** Startet den stündlichen Lauf (erster Lauf nach 30 s). */
export function starteHintergrund(pool, config, hub) {
  const minuten = Number(config.hintergrundMinuten) || 0;
  if (!minuten) return null;
  const lauf = () => hintergrundLauf(pool, config, hub).catch((e) => console.error(`Hintergrundlauf fehlgeschlagen: ${e.message}`));
  const t1 = setTimeout(lauf, 30_000); t1.unref?.();
  const t2 = setInterval(lauf, minuten * 60_000); t2.unref?.();
  return { stop: () => { clearTimeout(t1); clearInterval(t2); } };
}

function regelWerte(b) {
  const f = pruefeRegel(b);
  if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
  return { text: String(b.text).trim(), rhythmus: b.rhythmus, alle: Number(b.alle ?? 1), naechste: b.naechste, vorlauf_tage: Number(b.vorlauf_tage ?? 0),
    projekt_id: b.projekt_id ? Number(b.projekt_id) : null, zugewiesen_id: b.zugewiesen_id ? Number(b.zugewiesen_id) : null, aktiv: b.aktiv !== false };
}
const fkFehler = (e) => (e.code === "23503" ? fehler(400, "Projekt oder Benutzer gibt es nicht (mehr). Wähle aus der Liste.") : e);

export function benachrichtigungenModul(router) {
  /* ── Wiederkehrende Aufgaben ── */
  router.get("/api/v1/aufgaben-regeln", { ...P, stufe: "r" }, async (ctx) => {
    const { rows } = await ctx.pool.query(`SELECT r.*, r.naechste::text AS naechste, p.nummer, p.name AS projekt, b.name AS zugewiesen_name, b.benutzername AS zugewiesen_benutzer
      FROM aufgabe_regel r LEFT JOIN projekt p ON p.id = r.projekt_id LEFT JOIN benutzer b ON b.id = r.zugewiesen_id ORDER BY r.aktiv DESC, r.naechste, r.id`);
    return { zeilen: rows.map((r) => ({ ...r, rhythmus_text: rhythmusText(r.rhythmus, r.alle) })) };
  });
  router.post("/api/v1/aufgaben-regeln", P, async (ctx) => {
    const w = regelWerte(ctx.body || {});
    try {
      const { rows: [r] } = await ctx.pool.query(`INSERT INTO aufgabe_regel (text, rhythmus, alle, naechste, vorlauf_tage, projekt_id, zugewiesen_id, aktiv, von)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [w.text, w.rhythmus, w.alle, w.naechste, w.vorlauf_tage, w.projekt_id, w.zugewiesen_id, w.aktiv, ctx.nutzer.benutzername]);
      const neu = await regelnAusfuehren(ctx.pool, heuteIso(), ctx.hub);
      return { ok: true, level: "success", id: r.id, text: `Wiederkehrende Aufgabe „${w.text}“ angelegt (${rhythmusText(w.rhythmus, w.alle)}).${neu ? " Die erste Aufgabe steht schon in der Liste." : ""}` };
    } catch (e) { throw fkFehler(e); }
  });
  router.put("/api/v1/aufgaben-regeln/:id", P, async (ctx) => {
    await sichereFassung(ctx, ctx.pool, "aufgabe_regel", Number(ctx.params.id), { was: "Die wiederkehrende Aufgabe" });
    const id = idParam(ctx.params.id, "Diese Regel");
    const w = regelWerte(ctx.body || {});
    try {
      const { rowCount } = await ctx.pool.query(`UPDATE aufgabe_regel SET text = $1, rhythmus = $2, alle = $3, naechste = $4, vorlauf_tage = $5, projekt_id = $6, zugewiesen_id = $7, aktiv = $8 WHERE id = $9`,
        [w.text, w.rhythmus, w.alle, w.naechste, w.vorlauf_tage, w.projekt_id, w.zugewiesen_id, w.aktiv, id]);
      if (!rowCount) throw nichtGefunden("Diese Regel");
    } catch (e) { throw fkFehler(e); }
    await regelnAusfuehren(ctx.pool, heuteIso(), ctx.hub);
    return { ok: true, level: "success", text: "Gespeichert." };
  });
  router.delete("/api/v1/aufgaben-regeln/:id", P, async (ctx) => {
    const { rowCount } = await ctx.pool.query("DELETE FROM aufgabe_regel WHERE id = $1", [idParam(ctx.params.id, "Diese Regel")]);
    if (!rowCount) throw nichtGefunden("Diese Regel");
    return { ok: true, level: "success", text: "Wiederkehrende Aufgabe beendet. Schon angelegte Aufgaben bleiben." };
  });

  /* ── Benachrichtigungen (jeder für sich) ── */
  router.get("/api/v1/benachrichtigungen", { bereich: "start" }, async (ctx) => {
    const { rows } = await ctx.pool.query(`SELECT id, art, titel, text, app, pfad, erstellt, gelesen, mail_status FROM benachrichtigung WHERE benutzer_id = $1
      ORDER BY erstellt DESC, id DESC LIMIT 50`, [ctx.nutzer.id]);
    const { rows: [z] } = await ctx.pool.query("SELECT count(*)::int AS n FROM benachrichtigung WHERE benutzer_id = $1 AND gelesen IS NULL", [ctx.nutzer.id]);
    const { rows: [b] } = await ctx.pool.query("SELECT mail_benachrichtigung, email FROM benutzer WHERE id = $1", [ctx.nutzer.id]);
    return { zeilen: rows, ungelesen: z.n, mail: { an: b?.mail_benachrichtigung ?? false, adresse: b?.email || "", moeglich: !!ctx.config?.smtp } };
  });
  router.post("/api/v1/benachrichtigungen/gelesen", { bereich: "start" }, async (ctx) => {
    const ids = Array.isArray(ctx.body?.ids) ? ctx.body.ids.map(Number).filter(Number.isInteger) : null;
    await ctx.pool.query(`UPDATE benachrichtigung SET gelesen = now() WHERE benutzer_id = $1 AND gelesen IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2))`, [ctx.nutzer.id, ids]);
    return { ok: true, level: "success", text: "Als gelesen markiert." };
  });
  router.put("/api/v1/benachrichtigungen/mail", { bereich: "start", ohneVersion: "eigener Schalter, nur der Nutzer selbst" }, async (ctx) => {
    const an = ctx.body?.an === true;
    await ctx.pool.query("UPDATE benutzer SET mail_benachrichtigung = $1 WHERE id = $2", [an, ctx.nutzer.id]);
    return { ok: true, level: "success", text: an ? "Du bekommst Benachrichtigungen auch per E-Mail." : "Keine E-Mails mehr, nur noch hier in der App." };
  });
  // Admin: Lauf sofort starten (sonst stündlich)
  router.post("/api/v1/verwaltung/benachrichtigungen/lauf", { bereich: "verwaltung" }, async (ctx) => {
    const r = await hintergrundLauf(ctx.pool, ctx.config || {}, ctx.hub);
    return { ok: true, level: r.mails.fehler ? "warning" : "success", ...r,
      text: `${r.aufgaben} Aufgabe(n) angelegt, ${r.meldungen} Benachrichtigung(en), ${r.mails.gesendet} E-Mail(s) gesendet${r.mails.fehler ? `, ${r.mails.fehler} fehlgeschlagen (SMTP prüfen)` : ""}.` };
  });
}
