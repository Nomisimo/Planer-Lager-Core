// Planungszeit (Spec 3.5, 5.11 R-62–R-66, FA-46): Timer mit Herzschlag, Nachbuchen, Auswertung, CSV,
// Vormerken im Rechnungsentwurf des Projekts (Schnittstelle Kap. 11, nie automatisch fertiggestellt).
import { transaktion } from "@lager/db";
import { herzschlag, timerMinuten, satzBasis, zeitBetrag, pruefeZeiteintrag, dauerText } from "@lager/domain/planung.js";
import { euro } from "@lager/domain/geld.js";
import { csv } from "@lager/domain/csv.js";
import { fehler, nichtGefunden, idParam } from "./hilfen.js";
import { ladeEinstellungen } from "./verwaltung.js";

const R = { bereich: "zeiten", stufe: "r" };
const W = { bereich: "zeiten" };

/** R-66: Basis (Cent/Std.) und Prozent aus den Einstellungen. */
async function satz(c) {
  const e = await ladeEinstellungen(c);
  const { rows: [a] } = e.zeit_artikel ? await c.query("SELECT id, name, preis_tag, zeitmodell FROM artikel WHERE id = $1", [e.zeit_artikel]) : { rows: [] };
  return { basis: satzBasis(a || null, e), prozent: e.zeit_prozent_planung, posten: a?.name || null };
}

const datumText = (d) => (typeof d === "string" ? d.slice(0, 10).split("-").reverse().join(".") : new Date(d).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }));

/** Kap. 11: Zeiteintrag als Position im offenen Rechnungsentwurf des Projekts vormerken (anlegen, falls keiner offen ist). */
async function vormerken(c, z) {
  if (z.abgerechnet) return;
  let { rows: [r] } = await c.query("SELECT id FROM rechnung WHERE projekt_id = $1 AND status = 'entwurf'", [z.projekt_id]);
  if (!r) ({ rows: [r] } = await c.query("INSERT INTO rechnung (projekt_id) VALUES ($1) RETURNING id", [z.projekt_id]));
  const einzel = zeitBetrag(60, z.satz_basis, z.prozent);
  const text = `Planung ${datumText(z.datum)}${z.wer ? ` (${z.wer})` : ""}${z.beschreibung ? `: ${z.beschreibung}` : ""}`;
  await c.query(`INSERT INTO rechnung_position (rechnung_id, art, text, menge, einzelpreis, betrag, zeiteintrag_id) VALUES ($1, 'planungszeit', $2, $3, $4, $5, $6)
    ON CONFLICT (zeiteintrag_id) DO UPDATE SET text = EXCLUDED.text, menge = EXCLUDED.menge, einzelpreis = EXCLUDED.einzelpreis, betrag = EXCLUDED.betrag`,
  [r.id, text, Math.round((z.minuten / 60) * 100) / 100, einzel, z.betrag, z.id]);
  await c.query("UPDATE zeiteintrag SET rechnung_id = $1 WHERE id = $2", [r.id, z.id]);
}

/** Laufenden Timer beenden (Ende = Zeitpunkt). Unter 1 Minute wird verworfen. Liefert den Eintrag oder null. */
async function beende(c, t, ende) {
  const minuten = timerMinuten(t.laeuft_seit, ende);
  if (new Date(ende).getTime() - new Date(t.laeuft_seit).getTime() < 60_000) { await c.query("DELETE FROM zeiteintrag WHERE id = $1", [t.id]); return null; }
  const { rows: [z] } = await c.query(`UPDATE zeiteintrag SET laeuft_seit = NULL, zuletzt_aktiv = $1, minuten = $2,
      datum = ($3::timestamptz AT TIME ZONE 'Europe/Berlin')::date, betrag = $4 WHERE id = $5 RETURNING *, datum::text AS datum`,
  [ende, minuten, t.laeuft_seit, zeitBetrag(minuten, t.satz_basis, t.prozent), t.id]);
  await vormerken(c, z);
  return z;
}

const TIMER_SQL = `SELECT z.*, p.nummer, p.name AS projekt_name FROM zeiteintrag z JOIN projekt p ON p.id = z.projekt_id
  WHERE z.benutzer_id = $1 AND z.laeuft_seit IS NOT NULL`;
const timerAntwort = (t) => (t ? { id: t.id, projekt: { id: t.projekt_id, nummer: t.nummer, name: t.projekt_name }, laeuft_seit: t.laeuft_seit, zuletzt_aktiv: t.zuletzt_aktiv } : null);
const gestopptText = (z, grund) => (z ? `Planungszeit gestoppt: ${dauerText(z.minuten)} vorgemerkt${grund === "leerlauf" ? " (5 Minuten ohne Aktivität)" : ""}.` : "Timer gestoppt (unter einer Minute, nichts gebucht).");

export function zeitModul(router) {
  // Aktueller Timer (stoppt einen verwaisten nach 300 s Leerlauf, R-63)
  router.get("/api/v1/zeit/timer", R, async (ctx) => transaktion(ctx.pool, async (c) => {
    const { rows: [t] } = await c.query(`${TIMER_SQL} FOR UPDATE OF z`, [ctx.nutzer.id]);
    if (t) { const h = herzschlag(t, { neutral: true }); if (h.aktion === "stopp") { const z = await beende(c, t, h.ende); return { timer: null, text: gestopptText(z, h.grund) }; } }
    return { timer: timerAntwort(t) };
  }));

  // R-63 bewusst starten, R-64 höchstens einer je Benutzer
  router.post("/api/v1/zeit/start", W, async (ctx) => {
    const projektId = idParam(ctx.body?.projekt, "Dieses Projekt");
    const r = await transaktion(ctx.pool, async (c) => {
      await c.query("SELECT id FROM benutzer WHERE id = $1 FOR UPDATE", [ctx.nutzer.id]); // R-64: gleichzeitige Starts nacheinander
      const { rows: [p] } = await c.query("SELECT id, nummer, name, status FROM projekt WHERE id = $1", [projektId]);
      if (!p) throw nichtGefunden("Dieses Projekt");
      if (["abgeschlossen", "storniert"].includes(p.status)) throw fehler(409, `${p.nummer} ist abgeschlossen oder storniert. Trage Planungszeit dort über „Nachbuchen“ ein.`);
      const { rows: [alt] } = await c.query(`${TIMER_SQL} FOR UPDATE OF z`, [ctx.nutzer.id]);
      let vorher = null;
      if (alt) {
        if (alt.projekt_id === projektId) return { t: alt, schon: true };
        const h = herzschlag(alt, { neutral: true });
        vorher = await beende(c, alt, h.aktion === "stopp" ? h.ende : new Date());
      }
      const s = await satz(c);
      const { rows: [t] } = await c.query(`INSERT INTO zeiteintrag (projekt_id, benutzer_id, wer, laeuft_seit, zuletzt_aktiv, quelle, satz_basis, prozent)
        VALUES ($1, $2, $3, now(), now(), 'timer', $4, $5) RETURNING *`, [projektId, ctx.nutzer.id, ctx.nutzer.name || ctx.nutzer.benutzername, s.basis, s.prozent]);
      return { t: { ...t, nummer: p.nummer, projekt_name: p.name }, vorher };
    });
    ctx.hub?.sende({ typ: "zeit.geaendert", projekt: projektId, bereich: "zeiten" });
    return { ok: true, level: "success", timer: timerAntwort(r.t),
      text: r.schon ? "Der Timer läuft schon für dieses Projekt." : `Planungszeit läuft für ${r.t.nummer}.${r.vorher ? ` Vorheriger Timer gestoppt (${dauerText(r.vorher.minuten)}).` : ""}` };
  });

  // R-63 Herzschlag: { projekt?, neutral?, aktiv }
  router.post("/api/v1/zeit/ping", R, async (ctx) => {
    const r = await transaktion(ctx.pool, async (c) => {
      const { rows: [t] } = await c.query(`${TIMER_SQL} FOR UPDATE OF z`, [ctx.nutzer.id]);
      if (!t) return { timer: null };
      const b = ctx.body || {};
      const kontext = b.neutral ? { neutral: true } : b.projekt ? { projekt: Number(b.projekt) } : { planung: false };
      const h = herzschlag(t, kontext, Date.now(), b.aktiv !== false);
      if (h.aktion === "stopp") { const z = await beende(c, t, h.ende); return { timer: null, gestoppt: true, grund: h.grund, text: gestopptText(z, h.grund), projekt: t.projekt_id }; }
      if (h.aktiv) await c.query("UPDATE zeiteintrag SET zuletzt_aktiv = now() WHERE id = $1", [t.id]);
      return { timer: timerAntwort(t) };
    });
    if (r.gestoppt) ctx.hub?.sende({ typ: "zeit.geaendert", projekt: r.projekt, bereich: "zeiten" });
    return r;
  });

  router.post("/api/v1/zeit/stopp", R, async (ctx) => {
    const r = await transaktion(ctx.pool, async (c) => {
      const { rows: [t] } = await c.query(`${TIMER_SQL} FOR UPDATE OF z`, [ctx.nutzer.id]);
      if (!t) return { kein: true };
      const h = herzschlag(t, { neutral: true });
      return { z: await beende(c, t, h.aktion === "stopp" ? h.ende : new Date()), grund: h.grund, projekt: t.projekt_id };
    });
    if (r.kein) return { ok: true, level: "info", timer: null, text: "Es läuft kein Timer." };
    ctx.hub?.sende({ typ: "zeit.geaendert", projekt: r.projekt, bereich: "zeiten" });
    return { ok: true, level: "success", timer: null, text: gestopptText(r.z, r.grund) };
  });

  // R-65 Nachbuchen
  router.post("/api/v1/zeit/eintraege", W, async (ctx) => {
    const { werte: w, fehler: f } = pruefeZeiteintrag(ctx.body || {});
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    const z = await transaktion(ctx.pool, async (c) => {
      const { rows: [p] } = await c.query("SELECT id FROM projekt WHERE id = $1", [w.projekt_id]);
      if (!p) throw fehler(400, "Dieses Projekt gibt es nicht (mehr). Wähle ein anderes.", { felder: { projekt_id: "Projekt wählen" } });
      const s = await satz(c);
      const { rows: [n] } = await c.query(`INSERT INTO zeiteintrag (projekt_id, benutzer_id, wer, datum, minuten, beschreibung, quelle, satz_basis, prozent, betrag)
        VALUES ($1, $2, $3, $4, $5, $6, 'manuell', $7, $8, $9) RETURNING *, datum::text AS datum`,
      [w.projekt_id, ctx.nutzer.id, ctx.nutzer.name || ctx.nutzer.benutzername, w.datum, w.minuten, w.beschreibung, s.basis, s.prozent, zeitBetrag(w.minuten, s.basis, s.prozent)]);
      await vormerken(c, n);
      return n;
    });
    ctx.hub?.sende({ typ: "zeit.geaendert", projekt: z.projekt_id, bereich: "zeiten" });
    return { ok: true, level: "success", id: z.id, text: `${dauerText(z.minuten)} nachgebucht und im Rechnungsentwurf vorgemerkt.` };
  });

  router.delete("/api/v1/zeit/eintraege/:id", W, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Eintrag");
    const { rows: [z] } = await ctx.pool.query("SELECT id, abgerechnet, laeuft_seit, projekt_id, rechnung_id FROM zeiteintrag WHERE id = $1", [id]);
    if (!z) throw nichtGefunden("Dieser Eintrag");
    if (z.abgerechnet) throw fehler(409, "Dieser Eintrag ist schon abgerechnet und kann nicht mehr gelöscht werden.");
    if (z.laeuft_seit) throw fehler(409, "Der Timer läuft noch. Stoppe ihn zuerst.");
    if (z.rechnung_id) {
      const { rows: [r] } = await ctx.pool.query("SELECT status FROM rechnung WHERE id = $1", [z.rechnung_id]);
      if (r && r.status !== "entwurf") throw fehler(409, "Die Rechnung mit diesem Eintrag ist nicht mehr im Entwurf. Lösche ihn in der Buchhaltung.");
    }
    await ctx.pool.query("DELETE FROM zeiteintrag WHERE id = $1", [id]); // Position im Entwurf fällt mit weg (CASCADE)
    ctx.hub?.sende({ typ: "zeit.geaendert", projekt: z.projekt_id, bereich: "zeiten" });
    return { ok: true, level: "success", text: "Eintrag gelöscht, auch aus dem Rechnungsentwurf." };
  });

  // FA-46 Auswertung je Projekt
  const auswahl = (q) => {
    const w = ["z.laeuft_seit IS NULL"], v = [];
    if (q.projekt) { v.push(Number(q.projekt)); w.push(`z.projekt_id = $${v.length}`); }
    if (q.von) { v.push(q.von); w.push(`z.datum >= $${v.length}`); }
    if (q.bis) { v.push(q.bis); w.push(`z.datum <= $${v.length}`); }
    if (q.benutzer) { v.push(Number(q.benutzer)); w.push(`z.benutzer_id = $${v.length}`); }
    return { w: w.join(" AND "), v };
  };
  const ladeEintraege = async (db, q) => {
    for (const k of ["von", "bis"]) if (q[k] && !/^\d{4}-\d{2}-\d{2}$/.test(q[k])) throw fehler(400, "Datum bitte als JJJJ-MM-TT angeben.");
    const a = auswahl(q);
    const { rows } = await db.query(`SELECT z.id, z.projekt_id, p.nummer, p.name AS projekt_name, z.wer, z.datum::text AS datum, z.minuten, z.beschreibung, z.quelle,
        z.satz_basis, z.prozent, z.betrag, z.abgerechnet, z.rechnung_id FROM zeiteintrag z JOIN projekt p ON p.id = z.projekt_id WHERE ${a.w}
      ORDER BY z.datum DESC, z.id DESC LIMIT 2000`, a.v);
    return rows;
  };
  router.get("/api/v1/zeit/eintraege", R, async (ctx) => {
    const zeilen = await ladeEintraege(ctx.pool, ctx.query);
    const projekte = new Map();
    for (const z of zeilen) {
      const p = projekte.get(z.projekt_id) || { projekt_id: z.projekt_id, nummer: z.nummer, name: z.projekt_name, minuten: 0, betrag: 0 };
      p.minuten += z.minuten; p.betrag += z.betrag; projekte.set(z.projekt_id, p);
    }
    const s = await satz(ctx.pool);
    return { zeilen, projekte: [...projekte.values()].sort((a, b) => b.minuten - a.minuten),
      summe: { minuten: zeilen.reduce((x, z) => x + z.minuten, 0), betrag: zeilen.reduce((x, z) => x + z.betrag, 0) }, satz: s };
  });
  router.get("/api/v1/zeit/eintraege.csv", R, async (ctx) => {
    const zeilen = await ladeEintraege(ctx.pool, ctx.query);
    const kopf = ["Datum", "Projekt", "Projektname", "Wer", "Minuten", "Stunden", "Beschreibung", "Quelle", "Stundensatz", "Prozent", "Betrag"];
    const text = csv([kopf, ...zeilen.map((z) => [datumText(z.datum), z.nummer, z.projekt_name, z.wer, z.minuten,
      String(Math.round((z.minuten / 60) * 100) / 100).replace(".", ","), z.beschreibung, z.quelle === "timer" ? "Timer" : "nachgebucht",
      euro(z.satz_basis, { symbol: false }), z.prozent, euro(z.betrag, { symbol: false })])]);
    ctx.res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="planungszeit.csv"', "Cache-Control": "no-store" });
    ctx.res.end(text);
  });
}
