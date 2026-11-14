// FA-09 Schadensdokumentation bei Rückgabe: Beschreibung + Fotos, verknüpft mit Projekt und Kunde (Haftung).
// Optional wird das Gerät gleich als defekt gemeldet (Reparatur, FA-07).
import { darf } from "@lager/domain/rechte.js";
import { normalisiereCode } from "@lager/domain";
import { transaktion } from "@lager/db";
import { fehler, nichtGefunden, idParam, wer, bucheBewegung } from "./hilfen.js";
import { speichereBild, sendeBild } from "./bilder.js";

const P = { bereich: "packen" };
const MAX_FOTOS = 10;
const ordner = (id) => `schaden/${id}`;

const LISTE = `SELECT s.id, s.zeit, s.von, s.beschreibung, cardinality(s.fotos) AS fotos, s.reparatur_id, s.projekt_id, s.kunde_id,
    g.code, a.name AS artikel, p.nummer AS projekt_nummer, p.name AS projekt
  FROM schaden s JOIN geraet g ON g.id = s.geraet_id JOIN artikel a ON a.id = g.artikel_id JOIN projekt p ON p.id = s.projekt_id`;

/** FA-09: Schaden anlegen; projektId null = aus dem Gerät ableiten. */
async function dokumentiere(ctx, projektId) {
  const b = ctx.body || {};
  const beschreibung = String(b.beschreibung || "").trim();
  const code = b.code ? normalisiereCode(String(b.code)) : "";
  const f = {};
  if (!code) f.code = "Scanne oder tippe den Gerätecode.";
  if (!beschreibung) f.beschreibung = "Beschreibe den Schaden (was, wo, wie sichtbar).";
  if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
  const r = await transaktion(ctx.pool, async (c) => {
    const { rows: [g] } = await c.query("SELECT id, code, status, projekt_id FROM geraet WHERE code = $1 FOR UPDATE", [code]);
    if (!g) throw fehler(400, "Dieses Gerät gibt es nicht. Prüfe den Code.", { felder: { code: "Unbekannter Code" } });
    const pid = projektId ?? g.projekt_id ?? (await c.query("SELECT projekt_id FROM bewegung WHERE geraet_id = $1 AND projekt_id IS NOT NULL ORDER BY zeit DESC, id DESC LIMIT 1", [g.id])).rows[0]?.projekt_id;
    if (!pid) throw fehler(409, `${g.code} war noch bei keinem Projekt. Ein Schaden bei Rückgabe gehört zu einem Projekt.`, { felder: { code: "Kein Projekt" } });
    const { rows: [p] } = await c.query("SELECT id, nummer, kunde_id FROM projekt WHERE id = $1", [pid]);
    if (!p) throw nichtGefunden("Dieses Projekt");
    const { rows: [war] } = await c.query("SELECT 1 FROM bewegung WHERE geraet_id = $1 AND projekt_id = $2 LIMIT 1", [g.id, p.id]);
    if (g.projekt_id !== p.id && !war) throw fehler(409, `${g.code} war nicht bei ${p.nummer}. Prüfe Gerät und Projekt.`, { felder: { code: "Nicht bei diesem Projekt" } });
    const von = (wer(ctx).mitarbeiter || ctx.nutzer.name || ctx.nutzer.benutzername);
    let reparaturId = null;
    if (b.defekt) {
      const { rows: [offen] } = await c.query("SELECT id FROM reparatur WHERE geraet_id = $1 AND status IN ('gemeldet', 'in_reparatur')", [g.id]);
      reparaturId = offen?.id ?? (await c.query("INSERT INTO reparatur (geraet_id, beschreibung, gemeldet_von) VALUES ($1, $2, $3) RETURNING id",
        [g.id, `Schaden bei Rückgabe ${p.nummer}: ${beschreibung}`, von])).rows[0].id;
      if (!["defekt", "reparatur", "ausgemustert", "verkauft"].includes(g.status)) await c.query("UPDATE geraet SET status = 'defekt', version = version + 1 WHERE id = $1", [g.id]);
    }
    const { rows: [s] } = await c.query(`INSERT INTO schaden (geraet_id, projekt_id, kunde_id, beschreibung, reparatur_id, von) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [g.id, p.id, p.kunde_id, beschreibung, reparaturId, von]);
    await bucheBewegung(c, { geraetId: g.id, projektId: p.id, aktion: `Schaden dokumentiert: ${beschreibung.slice(0, 120)}`, ...wer(ctx) });
    return { id: s.id, code: g.code, nummer: p.nummer, reparaturId, geraetId: g.id, projektId: p.id };
  });
  ctx.hub?.sende({ typ: "schaden.geaendert", id: r.id, projekt: r.projektId, bereich: "packen" });
  if (r.reparaturId) ctx.hub?.sende({ typ: "geraet.geaendert", id: r.geraetId, bereich: "geraete" });
  return { ok: true, level: r.reparaturId ? "warning" : "success", id: r.id,
    text: `Schaden an ${r.code} für ${r.nummer} dokumentiert.${r.reparaturId ? " Das Gerät ist als defekt gemeldet." : ""} Füge jetzt Fotos hinzu.` };
}

export function schaedenModul(router) {
  router.get("/api/v1/projekte/:id/schaeden", { ...P, stufe: "r" }, async (ctx) => {
    const { rows } = await ctx.pool.query(`${LISTE} WHERE s.projekt_id = $1 ORDER BY s.zeit DESC`, [idParam(ctx.params.id, "Dieses Projekt")]);
    return { zeilen: rows };
  });
  router.get("/api/v1/kunden/:id/schaeden", { bereich: "kunden", stufe: "r" }, async (ctx) => {
    const { rows } = await ctx.pool.query(`${LISTE} WHERE s.kunde_id = $1 ORDER BY s.zeit DESC`, [idParam(ctx.params.id, "Dieser Kunde")]);
    return { zeilen: rows };
  });
  // Ohne Projekt (Rückgabe-Arbeitsplatz): Projekt = aktuelles oder zuletzt gebuchtes Projekt des Geräts
  router.post("/api/v1/schaeden", P, async (ctx) => dokumentiere(ctx, null));
  router.post("/api/v1/projekte/:id/schaeden", P, async (ctx) => dokumentiere(ctx, idParam(ctx.params.id, "Dieses Projekt")));
  router.post("/api/v1/schaeden/:id/foto", { ...P, stream: true }, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Schaden");
    const { rows: [s] } = await ctx.pool.query("SELECT id, cardinality(fotos) AS n FROM schaden WHERE id = $1", [id]);
    if (!s) { ctx.req.resume(); throw nichtGefunden("Dieser Schaden"); }
    if (s.n >= MAX_FOTOS) { ctx.req.resume(); throw fehler(409, `Höchstens ${MAX_FOTOS} Fotos je Schaden. Dokumentiere weitere Schäden einzeln.`); }
    const name = await speichereBild(ctx, ordner(id));
    const { rows: [n] } = await ctx.pool.query("UPDATE schaden SET fotos = array_append(fotos, $1) WHERE id = $2 RETURNING cardinality(fotos) AS n", [name, id]);
    ctx.hub?.sende({ typ: "schaden.geaendert", id, bereich: "packen" });
    return { ok: true, level: "success", fotos: n.n, text: `Foto ${n.n} gespeichert.` };
  });
  // Fotos sehen: wer Packen oder Kunden lesen darf (Haftungsfrage im Büro)
  router.get("/api/v1/schaeden/:id/foto/:n", { bereich: "start" }, async (ctx) => {
    const n = ctx.nutzer;
    if (!n.admin && !darf(n.rechte, "packen", "r") && !darf(n.rechte, "kunden", "r")) throw fehler(403, "Dafür fehlt dir das Recht. Frag einen Admin.");
    const id = idParam(ctx.params.id, "Dieser Schaden");
    const { rows: [s] } = await ctx.pool.query("SELECT fotos FROM schaden WHERE id = $1", [id]);
    if (!s) throw nichtGefunden("Dieser Schaden");
    await sendeBild(ctx, ordner(id), s.fotos[Number(ctx.params.n) - 1]);
  });
}
