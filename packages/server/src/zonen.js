// Ladezonen (Spec 3.10, 5.8 R-55–R-59, FA-23, FA-24): Verwaltung, Zuweisen/Freigeben, automatische Verteilung, Anzeige.
import QRCode from "qrcode";
import { transaktion } from "@lager/db";
import { prioritaet, verteilung, zuweisenPruefen, pruefeZone, zonenSortiert, zoneFrei } from "@lager/domain/zonen.js";
import { fehler, nichtGefunden, idParam, dbFehler } from "./hilfen.js";
import { sichereFassung } from "./fassung.js";
import { ladeEinstellungen } from "./verwaltung.js";

const R = { bereich: "zonen", stufe: "r" };
const W = { bereich: "zonen", auchFuer: ["anzeige", "packen"] };
const V = { bereich: "verwaltung" };
const OFFEN = "p.status NOT IN ('abgeschlossen','storniert')";

/** Zonen mit belegt/frei (belegt = zugewiesene aktive Projekte, 3.10). `c` sperrt die Zonen, wenn sperren=true. */
export async function ladeZonen(c, { sperren = false } = {}) {
  if (sperren) await c.query("SELECT id FROM ladezone ORDER BY id FOR UPDATE");
  const { rows } = await c.query(`SELECT z.*, z.flaeche_m2::float AS flaeche_m2,
      (SELECT count(*)::int FROM projekt p WHERE p.ladezone_id = z.id AND ${OFFEN}) AS belegt FROM ladezone z`);
  return zonenSortiert(rows).map((z) => ({ ...z, frei: zoneFrei(z) }));
}

async function packbareProjekte(c) {
  const { rows } = await c.query(`SELECT p.id, p.nummer, p.name, p.status, p.beginn, p.ende, p.erstellt, p.gepackt_am, p.ladezone_id, p.zone_seit,
      k.name AS kunde, k.firma AS kunde_firma FROM projekt p JOIN kunde k ON k.id = p.kunde_id
    WHERE p.art = 'projekt' AND p.status IN ('bestaetigt','laeuft') AND p.gepackt_am IS NULL`);
  return rows;
}

/** R-56 Zuweisen in einer Transaktion. */
async function weiseZu(c, projektId, zoneId) {
  const zonen = await ladeZonen(c, { sperren: true });
  const z = zonen.find((x) => x.id === zoneId);
  if (!z) throw nichtGefunden("Diese Ladezone");
  const { rows: [p] } = await c.query("SELECT id, nummer, status, ladezone_id FROM projekt WHERE id = $1 FOR UPDATE", [projektId]);
  if (!p) throw nichtGefunden("Dieses Projekt");
  const r = zuweisenPruefen(p, z);
  if (r?.nichts) return { p, z, alt: p.ladezone_id, nichts: true };
  if (r) throw fehler(409, r.text);
  await c.query("UPDATE projekt SET ladezone_id = $1, zone_seit = now(), version = version + 1 WHERE id = $2", [zoneId, projektId]);
  return { p, z, alt: p.ladezone_id };
}

/** R-58 Verteilung ausführen. Liefert die Zuweisungen. */
export async function verteile(pool, hub) {
  const zuweisungen = await transaktion(pool, async (c) => {
    const zonen = await ladeZonen(c, { sperren: true });
    const plan = verteilung(await packbareProjekte(c), zonen);
    for (const v of plan) await c.query("UPDATE projekt SET ladezone_id = $1, zone_seit = now(), version = version + 1 WHERE id = $2 AND ladezone_id IS NULL", [v.zoneId, v.projektId]);
    return plan;
  });
  if (zuweisungen.length) hub?.sende({ typ: "zone.geaendert", bereich: "zonen", auchFuer: ["anzeige", "packen"] });
  return zuweisungen;
}

/** R-58 beim Anmelden: nur mit Einstellung zonen_auto, nicht für Anzeige-Bildschirme. Ein Fehler verhindert die Anmeldung nie. */
export async function verteileBeimAnmelden(ctx, nutzer) {
  try {
    if (!nutzer || (!nutzer.admin && Object.keys(nutzer.rechte || {}).every((b) => b === "anzeige"))) return;
    if (!(await ladeEinstellungen(ctx.pool)).zonen_auto) return;
    await verteile(ctx.pool, ctx.hub);
  } catch (e) {
    ctx.log?.warn?.(`R-58 Verteilung beim Anmelden fehlgeschlagen: ${e.message}`);
  }
}

async function qrSvg(text) { return QRCode.toString(String(text), { type: "svg", errorCorrectionLevel: "M", margin: 1 }); }

export function zonenModul(router) {
  // FA-23 Übersicht: Zonen mit Belegung und Projekten
  router.get("/api/v1/zonen", R, async (ctx) => {
    const zonen = await ladeZonen(ctx.pool);
    const { rows: projekte } = await ctx.pool.query(`SELECT p.id, p.nummer, p.name, p.status, p.beginn, p.ende, p.ladezone_id, p.zone_seit, k.name AS kunde, k.firma AS kunde_firma
      FROM projekt p JOIN kunde k ON k.id = p.kunde_id WHERE p.ladezone_id IS NOT NULL AND ${OFFEN} ORDER BY p.zone_seit`);
    return { zonen: zonen.map((z) => ({ ...z, projekte: projekte.filter((p) => p.ladezone_id === z.id) })) };
  });
  // R-55 „Als Nächstes zu packen“
  router.get("/api/v1/zonen/prioritaet", R, async (ctx) => ({ zeilen: prioritaet(await packbareProjekte(ctx.pool)) }));
  // R-56 Zuweisen
  router.post("/api/v1/zonen/:id/zuweisen", W, async (ctx) => {
    const zoneId = idParam(ctx.params.id, "Diese Ladezone");
    const projektId = idParam(ctx.body?.projekt, "Dieses Projekt");
    const r = await transaktion(ctx.pool, (c) => weiseZu(c, projektId, zoneId));
    if (r.nichts) return { ok: true, level: "info", text: `${r.p.nummer} ist schon in ${r.z.bezeichnung}.` };
    ctx.hub?.sende({ typ: "zone.geaendert", id: zoneId, alt: r.alt, projekt: projektId, bereich: "zonen", auchFuer: ["anzeige", "packen"] });
    return { ok: true, level: "success", text: `${r.p.nummer} ist jetzt in ${r.z.bezeichnung}${r.alt ? " (vorherige Zone frei)" : ""}.` };
  });
  // R-57 Freigeben
  router.post("/api/v1/projekte/:id/zone-freigeben", W, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const { rows: [p] } = await ctx.pool.query(`UPDATE projekt n SET ladezone_id = NULL, zone_seit = NULL, version = n.version + 1 FROM projekt a
      WHERE n.id = a.id AND n.id = $1 RETURNING n.nummer, a.ladezone_id AS alt`, [id]);
    if (!p) throw nichtGefunden("Dieses Projekt");
    if (p.alt) ctx.hub?.sende({ typ: "zone.geaendert", id: p.alt, projekt: id, bereich: "zonen", auchFuer: ["anzeige", "packen"] });
    return { ok: true, level: "success", text: p.alt ? `Ladezone von ${p.nummer} freigegeben.` : `${p.nummer} hatte keine Ladezone.` };
  });
  // R-58 per Knopf
  router.post("/api/v1/zonen/verteilen", W, async (ctx) => {
    const z = await verteile(ctx.pool, ctx.hub);
    return { ok: true, level: z.length ? "success" : "info", zuweisungen: z,
      text: z.length ? `${z.length} Projekt(e) auf freie Ladezonen verteilt.` : "Nichts zu verteilen: keine freie Zone oder kein Projekt ohne Zone." };
  });

  // FA-24 / R-59 Anzeige-Bildschirm: Zonen mit Projekten und QR-Code
  router.get("/api/v1/anzeige/zonen", { bereich: "anzeige", stufe: "r", auchArbeitsplatz: true }, async (ctx) => { // R-11d: auch Lager-Arbeitsplätze
    const zonen = (await ladeZonen(ctx.pool)).filter((z) => z.aktiv);
    const { rows: projekte } = await ctx.pool.query(`SELECT p.id, p.nummer, p.name, p.status, p.beginn, p.ende, p.ladezone_id, k.name AS kunde, k.firma AS kunde_firma
      FROM projekt p JOIN kunde k ON k.id = p.kunde_id WHERE p.ladezone_id IS NOT NULL AND ${OFFEN} ORDER BY p.zone_seit`);
    for (const p of projekte) p.qr_svg = await qrSvg(p.nummer);
    const zid = ctx.query.zone ? Number(ctx.query.zone) : null;
    return { stand: new Date().toISOString(), zonen: zonen.filter((z) => !zid || z.id === zid).map((z) => ({ id: z.id, bezeichnung: z.bezeichnung, plaetze: z.plaetze,
      belegt: z.belegt, frei: z.frei, projekte: projekte.filter((p) => p.ladezone_id === z.id) })) };
  });

  // FA-23 Verwaltung (Admin)
  router.get("/api/v1/verwaltung/zonen", V, async (ctx) => ladeZonen(ctx.pool));
  const speichern = async (ctx, id) => {
    const { werte: w, fehler: f } = pruefeZone(ctx.body || {});
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    try {
      const { rows: [z] } = id
        ? await ctx.pool.query("UPDATE ladezone SET bezeichnung = $1, flaeche_m2 = $2, plaetze = $3, beschreibung = $4, aktiv = $5, reihenfolge = $6 WHERE id = $7 RETURNING id",
          [w.bezeichnung, w.flaeche_m2, w.plaetze, w.beschreibung, w.aktiv, w.reihenfolge, id])
        : await ctx.pool.query("INSERT INTO ladezone (bezeichnung, flaeche_m2, plaetze, beschreibung, aktiv, reihenfolge) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
          [w.bezeichnung, w.flaeche_m2, w.plaetze, w.beschreibung, w.aktiv, w.reihenfolge]);
      if (!z) throw nichtGefunden("Diese Ladezone");
      ctx.hub?.sende({ typ: "zone.geaendert", id: z.id, bereich: "zonen", auchFuer: ["anzeige", "packen"] });
      return { ok: true, level: "success", id: z.id, text: id ? "Ladezone gespeichert." : `Ladezone ${w.bezeichnung} angelegt.` };
    } catch (e) {
      throw dbFehler(e, { doppelt: `Eine Ladezone „${w.bezeichnung}“ gibt es schon. Wähle einen anderen Namen.` });
    }
  };
  router.post("/api/v1/verwaltung/zonen", V, async (ctx) => speichern(ctx, null));
  router.put("/api/v1/verwaltung/zonen/:id", V, async (ctx) => { const id = idParam(ctx.params.id, "Diese Ladezone"); await sichereFassung(ctx, ctx.pool, "ladezone", id, { was: "Die Ladezone" }); return speichern(ctx, id); });
  router.delete("/api/v1/verwaltung/zonen/:id", V, async (ctx) => {
    const id = idParam(ctx.params.id, "Diese Ladezone");
    const { rows: [z] } = await ctx.pool.query("DELETE FROM ladezone WHERE id = $1 RETURNING bezeichnung", [id]);
    if (!z) throw nichtGefunden("Diese Ladezone");
    ctx.hub?.sende({ typ: "zone.geaendert", id, bereich: "zonen", auchFuer: ["anzeige", "packen"] });
    return { ok: true, level: "success", text: `Ladezone ${z.bezeichnung} gelöscht. Ihre Projekte haben jetzt keine Zone.` };
  });
}
