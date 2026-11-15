// FA-39 Projektvorlagen: Standardaufgaben (Termin relativ zum Projektbeginn) und Standardpositionen je Art von Veranstaltung.
// Anwenden legt die Aufgaben an und – mit Recht „Angebote ändern“ – ein Angebot mit den Positionen (Preise aus dem Artikel).
import { darf, istAdminRechte } from "@lager/domain";
import { transaktion } from "@lager/db";
import { fehler, nichtGefunden, idParam } from "./hilfen.js";
import { sichereFassung } from "./fassung.js";
import { legeAngebotAn } from "./angebote.js";

const P = { bereich: "projekte" };
const minusTage = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const tageZwischen = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

function pruefeVorlage(b) {
  const f = {};
  const name = String(b?.name ?? "").trim();
  if (!name) f.name = "Gib der Vorlage einen Namen, z. B. „Hochzeit klein“.";
  const aufgaben = Array.isArray(b?.aufgaben) ? b.aufgaben : [];
  const positionen = Array.isArray(b?.positionen) ? b.positionen : [];
  const auf = aufgaben.map((a) => ({ text: String(a?.text ?? "").trim(), tage_vorher: a?.tage_vorher === "" || a?.tage_vorher == null ? null : Number(a.tage_vorher),
    zugewiesen_id: a?.zugewiesen_id ? Number(a.zugewiesen_id) : null })).filter((a) => a.text);
  if (auf.some((a) => a.tage_vorher != null && (!Number.isInteger(a.tage_vorher) || a.tage_vorher < -365 || a.tage_vorher > 365)))
    f.aufgaben = "Tage vor Beginn als ganze Zahl von -365 bis 365 (negativ = nach Beginn).";
  const pos = positionen.map((p) => ({ artikel_id: Number(p?.artikel_id), menge: Number(p?.menge) })).filter((p) => p.artikel_id);
  if (pos.some((p) => !Number.isInteger(p.artikel_id) || !(p.menge > 0))) f.positionen = "Jede Position braucht einen Artikel und eine Menge über 0.";
  if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
  return { name, veranstaltung: String(b?.veranstaltung ?? "").trim(), beschreibung: String(b?.beschreibung ?? "").trim(), aufgaben: auf, positionen: pos, aktiv: b?.aktiv !== false };
}

const doppelt = (e, name) => (e.code === "23505" ? fehler(409, `Eine Vorlage „${name}“ gibt es schon. Wähle einen anderen Namen.`, { felder: { name: "Name schon vergeben" } }) : e);

/** Vorlage auf ein Projekt anwenden (in der Transaktion c). */
export async function wendeVorlageAn(ctx, c, projektId, vorlageId, { angebot = true } = {}) {
  const { rows: [v] } = await c.query("SELECT * FROM projekt_vorlage WHERE id = $1", [vorlageId]);
  if (!v) throw nichtGefunden("Diese Vorlage");
  const { rows: [p] } = await c.query("SELECT id, nummer, beginn::text AS beginn FROM projekt WHERE id = $1", [projektId]);
  if (!p) throw nichtGefunden("Dieses Projekt");
  for (const a of v.aufgaben) {
    const faellig = a.tage_vorher != null && p.beginn ? minusTage(p.beginn, a.tage_vorher) : null;
    await c.query("INSERT INTO aufgabe (projekt_id, text, faellig, zugewiesen_id, von) VALUES ($1, $2, $3, (SELECT id FROM benutzer WHERE id = $4 AND aktiv), $5)",
      [p.id, a.text, faellig, a.zugewiesen_id, `Vorlage ${v.name}`]);
  }
  let neuesAngebot = null, ohneRecht = false;
  if (angebot && v.positionen.length) {
    const n = ctx.nutzer;
    if (n.admin || istAdminRechte(n.rechte) || darf(n.rechte, "angebote", "w")) {
      const { rows: art } = await c.query("SELECT id, preis_tag, folgetag_prozent, ist_leistung, verbrauch, verkaeuflich, verkaufspreis, aktiv FROM artikel WHERE id = ANY($1)", [v.positionen.map((x) => x.artikel_id)]);
      const karte = new Map(art.map((a) => [a.id, a]));
      const positionen = v.positionen.filter((x) => karte.get(x.artikel_id)?.aktiv).map((x) => {
        const a = karte.get(x.artikel_id);
        const verkauf = a.verbrauch && a.verkaeuflich;
        return { art: verkauf ? "verkauf" : "miete", artikel_id: a.id, menge: x.menge,
          einzelpreis: verkauf ? a.verkaufspreis ?? 0 : a.preis_tag ?? 0, folgetag_prozent: a.folgetag_prozent };
      });
      if (positionen.length) neuesAngebot = await legeAngebotAn(ctx, c, p.id, { betreff: v.veranstaltung || v.name, positionen });
    } else ohneRecht = true;
  }
  ctx.hub?.sende({ typ: "aufgabe.geaendert", projekt: p.id, bereich: "projekte" });
  const teile = [`Vorlage „${v.name}“ angewendet: ${v.aufgaben.length} Aufgabe(n)`];
  if (neuesAngebot) teile.push(`Angebot ${neuesAngebot.nummer} mit ${v.positionen.length} Position(en)`);
  return { text: `${teile.join(", ")}.${ohneRecht ? " Für das Angebot fehlt dir das Recht „Angebote ändern“." : ""}${!p.beginn && v.aufgaben.some((a) => a.tage_vorher != null) ? " Ohne Projektbeginn haben die Aufgaben noch keinen Termin." : ""}`,
    angebot: neuesAngebot, ohneRecht };
}

export function vorlagenModul(router) {
  router.get("/api/v1/projektvorlagen", { ...P, stufe: "r" }, async (ctx) => {
    const { rows } = await ctx.pool.query("SELECT * FROM projekt_vorlage ORDER BY aktiv DESC, veranstaltung, name");
    return { zeilen: rows };
  });
  router.get("/api/v1/projektvorlagen/:id", { ...P, stufe: "r" }, async (ctx) => {
    const { rows: [v] } = await ctx.pool.query("SELECT * FROM projekt_vorlage WHERE id = $1", [idParam(ctx.params.id, "Diese Vorlage")]);
    if (!v) throw nichtGefunden("Diese Vorlage");
    const ids = v.positionen.map((p) => p.artikel_id);
    const { rows: art } = ids.length ? await ctx.pool.query("SELECT id, name, einheit FROM artikel WHERE id = ANY($1)", [ids]) : { rows: [] };
    const karte = new Map(art.map((a) => [a.id, a]));
    return { ...v, positionen: v.positionen.map((p) => ({ ...p, artikel: karte.get(p.artikel_id)?.name || "(gelöscht)", einheit: karte.get(p.artikel_id)?.einheit || "" })) };
  });
  // Neu, optional aus einem bestehenden Projekt (Aufgaben mit Abstand zum Beginn, Positionen des neuesten Angebots)
  router.post("/api/v1/projektvorlagen", P, async (ctx) => {
    const b = { ...(ctx.body || {}) };
    if (b.aus_projekt_id) {
      const pid = idParam(b.aus_projekt_id, "Dieses Projekt");
      const { rows: [p] } = await ctx.pool.query("SELECT beginn::text AS beginn FROM projekt WHERE id = $1", [pid]);
      if (!p) throw nichtGefunden("Dieses Projekt");
      const { rows: auf } = await ctx.pool.query("SELECT text, faellig::text AS faellig, zugewiesen_id FROM aufgabe WHERE projekt_id = $1 ORDER BY faellig NULLS LAST, id", [pid]);
      b.aufgaben = auf.map((a) => ({ text: a.text, tage_vorher: a.faellig && p.beginn ? tageZwischen(a.faellig, p.beginn) : null, zugewiesen_id: a.zugewiesen_id }));
      const { rows: pos } = await ctx.pool.query(`SELECT ap.artikel_id, ap.menge::float8 AS menge FROM angebot_position ap
        WHERE ap.angebot_id = (SELECT id FROM angebot WHERE projekt_id = $1 ORDER BY id DESC LIMIT 1) AND ap.artikel_id IS NOT NULL ORDER BY ap.pos`, [pid]);
      b.positionen = pos;
    }
    const w = pruefeVorlage(b);
    try {
      const { rows: [v] } = await ctx.pool.query(`INSERT INTO projekt_vorlage (name, veranstaltung, beschreibung, aufgaben, positionen, aktiv, erstellt_von)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [w.name, w.veranstaltung, w.beschreibung, JSON.stringify(w.aufgaben), JSON.stringify(w.positionen), w.aktiv, ctx.nutzer.benutzername]);
      return { ok: true, level: "success", id: v.id, text: `Vorlage „${w.name}“ gespeichert: ${w.aufgaben.length} Aufgabe(n), ${w.positionen.length} Position(en).` };
    } catch (e) { throw doppelt(e, w.name); }
  });
  router.put("/api/v1/projektvorlagen/:id", P, async (ctx) => {
    await sichereFassung(ctx, ctx.pool, "projekt_vorlage", Number(ctx.params.id), { was: "Die Projektvorlage" });
    const id = idParam(ctx.params.id, "Diese Vorlage");
    const w = pruefeVorlage(ctx.body);
    try {
      const { rowCount } = await ctx.pool.query("UPDATE projekt_vorlage SET name = $1, veranstaltung = $2, beschreibung = $3, aufgaben = $4, positionen = $5, aktiv = $6 WHERE id = $7",
        [w.name, w.veranstaltung, w.beschreibung, JSON.stringify(w.aufgaben), JSON.stringify(w.positionen), w.aktiv, id]);
      if (!rowCount) throw nichtGefunden("Diese Vorlage");
    } catch (e) { throw doppelt(e, w.name); }
    return { ok: true, level: "success", text: `Vorlage „${w.name}“ gespeichert.` };
  });
  router.delete("/api/v1/projektvorlagen/:id", P, async (ctx) => {
    const { rowCount } = await ctx.pool.query("DELETE FROM projekt_vorlage WHERE id = $1", [idParam(ctx.params.id, "Diese Vorlage")]);
    if (!rowCount) throw nichtGefunden("Diese Vorlage");
    return { ok: true, level: "success", text: "Vorlage gelöscht. Projekte, die sie genutzt haben, bleiben unverändert." };
  });
  router.post("/api/v1/projekte/:id/vorlage", P, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const r = await transaktion(ctx.pool, (c) => wendeVorlageAn(ctx, c, id, idParam(ctx.body?.vorlage_id, "Diese Vorlage"), { angebot: ctx.body?.angebot !== false }));
    return { ok: true, level: r.ohneRecht ? "warning" : "success", text: r.text, angebot: r.angebot };
  });
}
