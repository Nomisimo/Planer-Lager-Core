// Gemeinsame Server-Hilfen: Fehler im R-05-Format, Pflichtprüfung, Paginierung, Bewegung buchen.
import { HttpFehler } from "./router.js";

/** Fehler mit {ok:false, level, text} (UI-2/UI-5). */
export const fehler = (status, text, extra) => new HttpFehler(status, text, { ok: false, level: "error", text, ...extra });
export const nichtGefunden = (was) => fehler(404, `${was} gibt es nicht (mehr). Lade die Liste neu.`);

/** Paginierung (NFA-05): limit 1..500, Standard 200. */
export function seite(query, standard = 200) {
  const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || standard));
  const offset = Math.max(0, parseInt(query.offset, 10) || 0);
  return { limit, offset };
}

/** Id-Parameter prüfen. */
export function idParam(v, was = "Eintrag") {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw nichtGefunden(was);
  return n;
}

/** Wer bucht? Benutzer + (am Arbeitsplatz) Mitarbeiter (R-11f). */
export const wer = (ctx) => ({ benutzer: ctx.nutzer?.benutzername || "", mitarbeiter: ctx.mitarbeiter?.name || "" });

/** R-18: Bewegung anfügen. */
export async function bucheBewegung(c, { geraetId, projektId = null, aktion, benutzer = "", mitarbeiter = "" }) {
  await c.query("INSERT INTO bewegung (geraet_id, projekt_id, aktion, benutzer, mitarbeiter) VALUES ($1, $2, $3, $4, $5)",
    [geraetId, projektId, aktion, benutzer, mitarbeiter]);
}

/** Datenbank-Fehlercodes in UI-5-Texte übersetzen. */
export function dbFehler(e, texte = {}) {
  if (e instanceof HttpFehler) return e;
  if (e.code === "23505") return fehler(409, texte.doppelt || "Diesen Eintrag gibt es schon. Wähle einen anderen Namen.");
  if (e.code === "23503") return fehler(409, texte.verknuepft || "Der Eintrag wird noch verwendet und kann nicht gelöscht werden. Entferne zuerst die Verknüpfungen.");
  if (e.code === "23502") return fehler(400, texte.pflicht || "Ein Pflichtfeld fehlt. Prüfe die markierten Eingaben.");
  if (e.code === "23514") return fehler(400, texte.ungueltig || "Ein Wert ist ungültig. Prüfe die Eingaben.");
  return e;
}

/**
 * R-49 Vermisst melden: Status Vermisst, Case leer, Projekt bleibt (Nachweis), Bewegung „Als vermisst gemeldet, Projekt X, zuletzt in Y“.
 * Doppelte Meldung (oder Endzustand) ändert nichts → null. Sonst der Gerätecode. `where` ist "g.id = $1" oder "g.code = $1".
 */
export async function meldeVermisst(c, ctx, where, wert) {
  const { rows: [g] } = await c.query(`SELECT g.id, g.code, g.status, g.projekt_id, (SELECT p.nummer FROM projekt p WHERE p.id = g.projekt_id) AS nummer,
    (SELECT t.code FROM geraet t WHERE t.id = g.case_id) AS tasche FROM geraet g WHERE ${where} FOR UPDATE OF g`, [wert]);
  if (!g || g.status === "vermisst" || ["ausgemustert", "verkauft"].includes(g.status)) return g ? { ...g, unveraendert: true } : null;
  await c.query("UPDATE geraet SET status = 'vermisst', case_id = NULL, version = version + 1 WHERE id = $1", [g.id]);
  await bucheBewegung(c, { geraetId: g.id, projektId: g.projekt_id,
    aktion: `Als vermisst gemeldet${g.nummer ? `, Projekt ${g.nummer}` : ""}${g.tasche ? `, zuletzt in ${g.tasche}` : ""}`, ...wer(ctx) });
  ctx.hub?.sende({ typ: "geraet.geaendert", id: g.id, bereich: "geraete" });
  return g;
}
