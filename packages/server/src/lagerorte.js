// FA-08 Lagerorte/Regalplätze: Liste pflegen, Artikel und Geräte zuordnen, Anzeige beim Packen (Packliste).
import { fehler, nichtGefunden, idParam } from "./hilfen.js";
import { sichereFassung } from "./fassung.js";

const M = { bereich: "material" };

function pruefe(b) {
  const name = String(b?.name ?? "").trim();
  const f = {};
  if (!name) f.name = "Gib dem Lagerort einen Namen, z. B. „Regal A3“.";
  else if (name.length > 60) f.name = "Der Name ist zu lang (höchstens 60 Zeichen).";
  if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
  return { name, bereich: String(b?.bereich ?? "").trim().slice(0, 60), notiz: String(b?.notiz ?? "").trim(), aktiv: b?.aktiv !== false };
}

const doppelt = (e, name) => {
  if (e.code === "23505") return fehler(409, `Den Lagerort „${name}“ gibt es schon. Wähle einen anderen Namen.`, { felder: { name: "Name schon vergeben" } });
  return e;
};

/**
 * Lagerorte je Artikel für die Packliste: Platz des Artikels und abweichende Plätze freier Geräte.
 * @returns {Promise<Map<number, {lagerort: string|null, weitere: string[]}>>}
 */
export async function lagerorteFuer(db, artikelIds) {
  if (!artikelIds.length) return new Map();
  const { rows } = await db.query(`SELECT a.id, lo.name AS lagerort,
      coalesce((SELECT array_agg(DISTINCT gl.name ORDER BY gl.name) FROM geraet g JOIN lagerort gl ON gl.id = g.lagerort_id
        WHERE g.artikel_id = a.id AND g.status = 'lager' AND g.lagerort_id IS DISTINCT FROM a.lagerort_id), '{}') AS weitere
    FROM artikel a LEFT JOIN lagerort lo ON lo.id = a.lagerort_id WHERE a.id = ANY($1)`, [artikelIds]);
  return new Map(rows.map((r) => [r.id, { lagerort: r.lagerort, weitere: r.weitere }]));
}

export function lagerorteModul(router) {
  router.get("/api/v1/lagerorte", { ...M, stufe: "r" }, async (ctx) => {
    const { rows } = await ctx.pool.query(`SELECT l.*, (SELECT count(*)::int FROM artikel a WHERE a.lagerort_id = l.id) AS artikel,
        (SELECT count(*)::int FROM geraet g WHERE g.lagerort_id = l.id) AS geraete
      FROM lagerort l ORDER BY l.bereich, l.name`);
    return { zeilen: rows };
  });
  router.get("/api/v1/lagerorte/:id", { ...M, stufe: "r" }, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Lagerort");
    const { rows: [l] } = await ctx.pool.query("SELECT * FROM lagerort WHERE id = $1", [id]);
    if (!l) throw nichtGefunden("Dieser Lagerort");
    const { rows: artikel } = await ctx.pool.query("SELECT id, name FROM artikel WHERE lagerort_id = $1 ORDER BY name", [id]);
    const { rows: geraete } = await ctx.pool.query(`SELECT g.id, g.code, g.status, a.name AS artikel FROM geraet g JOIN artikel a ON a.id = g.artikel_id
      WHERE g.lagerort_id = $1 ORDER BY g.code`, [id]);
    return { ...l, artikel, geraete };
  });
  router.post("/api/v1/lagerorte", M, async (ctx) => {
    const w = pruefe(ctx.body);
    try {
      const { rows: [l] } = await ctx.pool.query("INSERT INTO lagerort (name, bereich, notiz, aktiv) VALUES ($1, $2, $3, $4) RETURNING id", [w.name, w.bereich, w.notiz, w.aktiv]);
      ctx.hub?.sende({ typ: "lagerort.geaendert", id: l.id, bereich: "material" });
      return { ok: true, level: "success", id: l.id, text: `Lagerort „${w.name}“ angelegt.` };
    } catch (e) { throw doppelt(e, w.name); }
  });
  router.put("/api/v1/lagerorte/:id", M, async (ctx) => {
    await sichereFassung(ctx, ctx.pool, "lagerort", Number(ctx.params.id), { was: "Der Lagerort" });
    const id = idParam(ctx.params.id, "Dieser Lagerort");
    const w = pruefe(ctx.body);
    try {
      const { rowCount } = await ctx.pool.query("UPDATE lagerort SET name = $1, bereich = $2, notiz = $3, aktiv = $4 WHERE id = $5", [w.name, w.bereich, w.notiz, w.aktiv, id]);
      if (!rowCount) throw nichtGefunden("Dieser Lagerort");
    } catch (e) { throw doppelt(e, w.name); }
    ctx.hub?.sende({ typ: "lagerort.geaendert", id, bereich: "material" });
    return { ok: true, level: "success", text: `Lagerort „${w.name}“ gespeichert.` };
  });
  router.delete("/api/v1/lagerorte/:id", M, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Lagerort");
    try {
      const { rowCount } = await ctx.pool.query("DELETE FROM lagerort WHERE id = $1", [id]);
      if (!rowCount) throw nichtGefunden("Dieser Lagerort");
    } catch (e) {
      if (e.code === "23503") throw fehler(409, "An diesem Lagerort stehen noch Artikel oder Geräte. Ordne sie zuerst um oder setze den Lagerort auf inaktiv.");
      throw e;
    }
    ctx.hub?.sende({ typ: "lagerort.geaendert", id, bereich: "material" });
    return { ok: true, level: "success", text: "Lagerort gelöscht." };
  });
}
