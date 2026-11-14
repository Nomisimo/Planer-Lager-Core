// FA-55 Änderungsprotokoll: der Datenbank-Trigger (Migration 019) schreibt mit, hier kommen „wer“ und die Abfragen dazu.
import { darf } from "@lager/domain/rechte.js";
import { fehler, idParam } from "./hilfen.js";

const SCHREIBEN = /^\s*(insert|update|delete|with)\b/i;
const SETZE = "SELECT set_config('lager.wer', $1, false)";

/** Tabelle → Bereich, dessen Leserecht den Verlauf eines Datensatzes zeigt. */
export const PROTOKOLL_TABELLEN = Object.freeze({ artikel: "material", kunde: "kunden", projekt: "projekte", rolle: "verwaltung", benutzer: "verwaltung" });

/** Anzeigename für das Protokoll: Benutzer, am Arbeitsplatz mit Mitarbeiter. */
export function werText(ctx) {
  const b = ctx.nutzer?.name || ctx.nutzer?.benutzername || "";
  const m = ctx.mitarbeiter?.name;
  return m && m !== b ? `${m} (${b})` : b;
}

const sqlText = (sql) => (typeof sql === "string" ? sql : sql?.text || "");

/**
 * Pool-Hülle je Anfrage: vor dem ersten schreibenden Befehl setzt sie lager.wer auf der Verbindung
 * und beim Zurückgeben wieder zurück. Lesende Anfragen kosten nichts extra.
 * @param {import("pg").Pool} pool
 * @param {() => string} wer
 */
export function mitWer(pool, wer) {
  const huelle = (c) => {
    let gesetzt = false;
    return new Proxy(c, {
      get(t, k) {
        if (k === "query") return async (sql, ...rest) => {
          if (!gesetzt && SCHREIBEN.test(sqlText(sql))) { gesetzt = true; await t.query(SETZE, [wer() || ""]); }
          return t.query(sql, ...rest);
        };
        if (k === "release") return (e) => {
          // Der Client arbeitet Befehle der Reihe nach ab: das Zurücksetzen läuft vor jedem Befehl des nächsten Nutzers.
          if (gesetzt && !e) t.query(SETZE, [""]).catch(() => {});
          gesetzt = false;
          return t.release(e);
        };
        const v = Reflect.get(t, k);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  };
  return new Proxy(pool, {
    get(t, k) {
      if (k === "connect") return async () => huelle(await t.connect());
      if (k === "query") return async (sql, ...rest) => {
        if (!SCHREIBEN.test(sqlText(sql))) return t.query(sql, ...rest);
        const c = huelle(await t.connect());
        try { return await c.query(sql, ...rest); } finally { c.release(); }
      };
      const v = Reflect.get(t, k);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

async function liste(db, { tabelle, id, q, von, bis, limit = 200 }) {
  const w = [], p = [];
  const add = (sql, ...v) => { let s = sql; for (const x of v) { p.push(x); s = s.replace("?", `$${p.length}`); } w.push(s); };
  if (tabelle) add("tabelle = ?", tabelle);
  if (id) add("datensatz_id = ?", id);
  if (q) add("(bezeichnung ILIKE ? OR von ILIKE ?)", `%${q}%`, `%${q}%`);
  if (von) add("zeit >= ?::date", von);
  if (bis) add("zeit < ?::date + 1", bis);
  p.push(Math.min(Number(limit) || 200, 1000));
  const { rows } = await db.query(`SELECT id, zeit, tabelle, datensatz_id, bezeichnung, aktion, von, felder FROM aenderung
    ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY zeit DESC, id DESC LIMIT $${p.length}`, p);
  return rows;
}

export function aenderungenModul(router) {
  router.get("/api/v1/verwaltung/aenderungen", { bereich: "verwaltung" }, async (ctx) => {
    const { tabelle = "", q = "", von = "", bis = "", limit } = ctx.query;
    if (tabelle && !PROTOKOLL_TABELLEN[tabelle]) throw fehler(400, "Diesen Bereich gibt es im Änderungsprotokoll nicht. Wähle Artikel, Kunden, Projekte, Rollen oder Benutzer.");
    for (const d of [von, bis]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw fehler(400, "Datum bitte als JJJJ-MM-TT angeben.");
    return { zeilen: await liste(ctx.pool, { tabelle, q: q.trim(), von, bis, limit }) };
  });
  // Verlauf eines Datensatzes: wer den Bereich lesen darf, sieht dessen Änderungen.
  router.get("/api/v1/aenderungen/:tabelle/:id", { bereich: "start" }, async (ctx) => {
    const bereich = PROTOKOLL_TABELLEN[ctx.params.tabelle];
    if (!bereich) throw fehler(404, "Für diesen Bereich gibt es kein Änderungsprotokoll.");
    if (!ctx.nutzer.admin && !darf(ctx.nutzer.rechte, bereich, "r")) throw fehler(403, "Dafür fehlt dir das Recht. Frag einen Admin.");
    return { zeilen: await liste(ctx.pool, { tabelle: ctx.params.tabelle, id: idParam(ctx.params.id, "Dieser Eintrag") }) };
  });
}
