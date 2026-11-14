// Plan-Symbole für yEd (FA-53): Liste, SVG je Artikel, Symbolbibliothek.graphml (bei jeder Artikeländerung neu), alle SVG als ZIP.
import fs from "node:fs";
import path from "node:path";
import { symbolSvg, symbolbibliothekGraphml, svgDateiname, piktogrammVon, PIKTOGRAMME } from "@lager/domain/plansymbole.js";
import { schreibeZip } from "./zip.js";
import { nichtGefunden, idParam } from "./hilfen.js";
import { datenOrdner } from "./sicherung.js";

const R = { bereich: "material", stufe: "r" };
export const BIBLIOTHEK = "Symbolbibliothek.graphml";
const ordner = (config) => path.join(datenOrdner(config), "plansymbole");

async function ladeArtikel(db) {
  const { rows } = await db.query(`SELECT a.id, a.name, a.plansymbol, a.ist_case, a.laenge_m, a.aktiv, k.name AS kategorie
    FROM artikel a JOIN kategorie k ON k.id = a.kategorie_id WHERE a.aktiv AND NOT a.ist_leistung AND NOT a.verbrauch ORDER BY k.name, a.name`);
  return rows;
}

/** Schreibt die Symbolbibliothek in den Datenordner (in der Sicherung enthalten). */
export async function schreibeBibliothek(pool, config) {
  const xml = symbolbibliothekGraphml(await ladeArtikel(pool));
  fs.mkdirSync(ordner(config), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(ordner(config), BIBLIOTHEK), xml, { mode: 0o600 });
  return xml;
}

/** Bei jeder Artikel-/Kategorieänderung: Bibliothek neu (kurz gebündelt). */
export function beobachteArtikel(hub, pool, config) {
  let t = null;
  hub.beobachte((ev) => {
    if (!/^(artikel|kategorie)\./.test(ev.typ)) return;
    clearTimeout(t);
    t = setTimeout(() => { schreibeBibliothek(pool, config).catch((e) => console.error(`Symbolbibliothek: ${e.message}`)); }, 200);
    t.unref?.();
  });
}

export function plansymboleModul(router) {
  router.get("/api/v1/plansymbole", R, async (ctx) => {
    const zeilen = (await ladeArtikel(ctx.pool)).map((a) => ({ id: a.id, name: a.name, kategorie: a.kategorie, plansymbol: a.plansymbol, piktogramm: piktogrammVon(a),
      automatisch: !a.plansymbol, titel: PIKTOGRAMME[piktogrammVon(a)].titel, svg: symbolSvg(a), datei: svgDateiname(a) }));
    const d = path.join(ordner(ctx.config), BIBLIOTHEK);
    return { zeilen, bibliothek: fs.existsSync(d) ? fs.statSync(d).mtime.toISOString() : null };
  });
  router.get(`/api/v1/plansymbole/${BIBLIOTHEK}`, R, async (ctx) => {
    const d = path.join(ordner(ctx.config), BIBLIOTHEK);
    const xml = fs.existsSync(d) ? fs.readFileSync(d, "utf8") : await schreibeBibliothek(ctx.pool, ctx.config);
    ctx.res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${BIBLIOTHEK}"`, "Cache-Control": "no-store" });
    ctx.res.end(xml);
  });
  router.get("/api/v1/plansymbole/svg.zip", R, async (ctx) => {
    const zip = schreibeZip((await ladeArtikel(ctx.pool)).map((a) => ({ name: svgDateiname(a), daten: symbolSvg(a) })));
    ctx.res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="Plan-Symbole.zip"', "Cache-Control": "no-store" });
    ctx.res.end(zip);
  });
  router.get("/api/v1/plansymbole/:id.svg", R, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Artikel");
    const a = (await ladeArtikel(ctx.pool)).find((x) => x.id === id);
    if (!a) throw nichtGefunden("Dieser Artikel");
    // SVG nur als Download (nie inline, vgl. T-24)
    ctx.res.writeHead(200, { "Content-Type": "image/svg+xml", "Content-Disposition": `attachment; filename="${svgDateiname(a)}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
    ctx.res.end(symbolSvg(a));
  });
}
