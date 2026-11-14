// FA-20 Teilrückgaben und Nachpacken: jeder Verlade- und Rückgabe-Durchgang wird mit Zeit, Person und Geräteliste festgehalten.
// FA-21 Lieferschein (beim Verladen) und Rückgabeprotokoll (zurückgegeben, fehlt, defekt) als PDF.
import { transaktion } from "@lager/db";
import { STATUS } from "@lager/domain";
import { datumAnzeige, zeitpunktAnzeige } from "@lager/domain/zeit.js";
import { fehler, nichtGefunden, idParam } from "./hilfen.js";
import { ladeEinstellungen } from "./verwaltung.js";
import { listenPdf, sendePdf } from "./pdf-liste.js";

const P = { bereich: "packen" };
const personVon = (ctx) => ctx.mitarbeiter?.name || ctx.nutzer?.name || ctx.nutzer?.benutzername || "";

async function naechsteNr(c, projektId, art) {
  const { rows: [r] } = await c.query("SELECT coalesce(max(nr), 0) + 1 AS nr FROM projekt_durchgang WHERE projekt_id = $1 AND art = $2", [projektId, art]);
  return r.nr;
}

/** Beim Verladen (in derselben Transaktion): alle gepackten Geräte festhalten, neue seit dem letzten Verladen markieren. */
export async function erfasseVerladen(c, ctx, projektId) {
  const { rows: geraete } = await c.query(`SELECT g.id, g.code, g.seriennummer, a.name AS artikel, t.code AS tasche FROM geraet g
    JOIN artikel a ON a.id = g.artikel_id LEFT JOIN geraet t ON t.id = g.case_id
    WHERE g.projekt_id = $1 AND g.status = 'gepackt' ORDER BY a.name, g.code`, [projektId]);
  const { rows: [vorher] } = await c.query("SELECT geraete FROM projekt_durchgang WHERE projekt_id = $1 AND art = 'verladen' ORDER BY nr DESC LIMIT 1", [projektId]);
  const alt = new Set((vorher?.geraete || []).map((g) => g.id));
  const liste = geraete.map((g) => ({ ...g, neu: !!vorher && !alt.has(g.id) }));
  const nr = await naechsteNr(c, projektId, "verladen");
  const { rows: [d] } = await c.query("INSERT INTO projekt_durchgang (projekt_id, art, nr, von, geraete) VALUES ($1, 'verladen', $2, $3, $4) RETURNING id, nr",
    [projektId, nr, personVon(ctx), JSON.stringify(liste)]);
  return { ...d, anzahl: liste.length, neu: liste.filter((g) => g.neu).length };
}

/** Rückgabe-Durchgang: was seit dem letzten Rückgabe-Abschluss zurückkam, was fehlt, was defekt ist. */
async function erfasseRueckgabe(c, ctx, projektId) {
  const { rows: [letzte] } = await c.query("SELECT zeit FROM projekt_durchgang WHERE projekt_id = $1 AND art = 'rueckgabe' ORDER BY nr DESC LIMIT 1", [projektId]);
  const { rows: zurueck } = await c.query(`SELECT DISTINCT ON (g.id) g.id, g.code, g.seriennummer, g.status, a.name AS artikel, b.zeit,
      (SELECT substr(m.aktion, 22) FROM bewegung m WHERE m.geraet_id = g.id AND m.aktion LIKE 'Mangel bei Rückgabe:%' AND m.zeit >= b.zeit ORDER BY m.zeit DESC LIMIT 1) AS mangel_text
    FROM bewegung b JOIN geraet g ON g.id = b.geraet_id JOIN artikel a ON a.id = g.artikel_id
    WHERE b.projekt_id = $1 AND b.aktion IN ('Zurück im Lager', 'Wieder aufgetaucht') AND b.zeit > coalesce($2, '-infinity'::timestamptz)
      AND g.projekt_id IS DISTINCT FROM $1
    ORDER BY g.id, b.zeit DESC`, [projektId, letzte?.zeit || null]);
  const { rows: fehlt } = await c.query(`SELECT g.id, g.code, g.seriennummer, g.status, a.name AS artikel FROM geraet g JOIN artikel a ON a.id = g.artikel_id
    WHERE g.projekt_id = $1 AND g.status IN ('zugeordnet', 'gepackt', 'vermisst') ORDER BY a.name, g.code`, [projektId]);
  if (!zurueck.length && !fehlt.length) throw fehler(409, "Seit dem letzten Abschluss wurde nichts zurückgegeben und nichts fehlt. Scanne zuerst die Rückgaben.");
  // Der Funktionstest (R-11g) folgt der Rückgabe, das Projekt ist dann schon gelöst: Mangel ab dem Rückgabezeitpunkt zählen
  for (const g of zurueck) g.mangel = g.mangel_text != null;
  const defekt = zurueck.filter((g) => g.mangel || g.status === "defekt");
  zurueck.sort((a, b) => a.artikel.localeCompare(b.artikel) || a.code.localeCompare(b.code));
  const nr = await naechsteNr(c, projektId, "rueckgabe");
  const { rows: [d] } = await c.query(`INSERT INTO projekt_durchgang (projekt_id, art, nr, von, geraete, fehlt, defekt) VALUES ($1, 'rueckgabe', $2, $3, $4, $5, $6) RETURNING id, nr`,
    [projektId, nr, personVon(ctx), JSON.stringify(zurueck), JSON.stringify(fehlt), JSON.stringify(defekt)]);
  return { ...d, zurueck: zurueck.length, fehlt: fehlt.length, defekt: defekt.length };
}

async function ladeDurchgang(db, id) {
  const { rows: [d] } = await db.query(`SELECT d.*, p.nummer, p.name AS projekt, p.beginn, p.ende, p.ort, k.name AS kunde, k.firma AS kunde_firma,
      k.strasse AS kunde_strasse, k.plz AS kunde_plz, k.ort AS kunde_ort
    FROM projekt_durchgang d JOIN projekt p ON p.id = d.projekt_id JOIN kunde k ON k.id = p.kunde_id WHERE d.id = $1`, [id]);
  if (!d) throw nichtGefunden("Dieser Durchgang");
  return d;
}

async function belegPdf(ctx, d) {
  const e = await ladeEinstellungen(ctx.pool);
  const kunde = [d.kunde_firma, d.kunde, d.kunde_strasse, [d.kunde_plz, d.kunde_ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const zeitraum = d.beginn ? `${datumAnzeige(d.beginn)}${d.ende && d.ende !== d.beginn ? ` – ${datumAnzeige(d.ende)}` : ""}` : "ohne Termin";
  const kopf = [["Projekt", `${d.nummer} ${d.projekt}`], ["Kunde", kunde], ["Zeitraum", zeitraum], ...(d.ort ? [["Ort", d.ort]] : []),
    ["Datum", zeitpunktAnzeige(d.zeit)], ["Durchgang", `${d.nr}${d.von ? ` · ${d.von}` : ""}`]];
  const geraeteSpalten = [{ t: "Code", w: 28 }, { t: "Artikel", w: 70 }, { t: "Seriennummer", w: 42 }, { t: "", w: 30 }];
  if (d.art === "verladen") {
    return listenPdf({ titel: `Lieferschein ${d.nummer}${d.nr > 1 ? ` (Nachlieferung ${d.nr - 1})` : ""}`, firma: e.firma, kopf, fuss: `Lieferschein ${d.nummer}-${d.nr}`,
      abschnitte: [{ titel: `Übergebene Geräte (${d.geraete.length})`, leer: "Keine gepackten Geräte.", hinweis: d.nr > 1 ? "„neu“ = seit dem letzten Verladen dazugekommen." : "",
        spalten: geraeteSpalten, zeilen: d.geraete.map((g) => [g.code, g.artikel + (g.tasche ? ` (in ${g.tasche})` : ""), g.seriennummer || "–", g.neu ? "neu" : ""]) }],
      unterschriften: ["Übergeben", "Übernommen"] });
  }
  return listenPdf({ titel: `Rückgabeprotokoll ${d.nummer}${d.nr > 1 ? ` (Teil ${d.nr})` : ""}`, firma: e.firma, kopf, fuss: `Rückgabe ${d.nummer}-${d.nr}`,
    abschnitte: [
      { titel: `Zurückgegeben (${d.geraete.length})`, leer: "In diesem Durchgang nichts zurückgegeben.", spalten: geraeteSpalten,
        zeilen: d.geraete.map((g) => [g.code, g.artikel, g.seriennummer || "–", g.mangel || g.status === "defekt" ? "defekt" : "ok"]) },
      { titel: `Fehlt (${d.fehlt.length})`, leer: "Nichts fehlt.", hinweis: "Noch beim Projekt oder als vermisst gemeldet.", spalten: geraeteSpalten,
        zeilen: d.fehlt.map((g) => [g.code, g.artikel, g.seriennummer || "–", STATUS[g.status] || g.status]) },
      { titel: `Defekt (${d.defekt.length})`, leer: "Keine Mängel.", spalten: [{ t: "Code", w: 28 }, { t: "Artikel", w: 60 }, { t: "Mangel", w: 82 }],
        zeilen: d.defekt.map((g) => [g.code, g.artikel, g.mangel_text || "defekt"]) },
    ],
    unterschriften: ["Zurückgegeben", "Angenommen"] });
}

export function durchgaengeModul(router) {
  router.get("/api/v1/projekte/:id/durchgaenge", { ...P, stufe: "r" }, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const { rows } = await ctx.pool.query(`SELECT id, art, nr, zeit, von, jsonb_array_length(geraete) AS anzahl,
        (SELECT count(*)::int FROM jsonb_array_elements(geraete) x WHERE (x->>'neu')::boolean) AS neu,
        jsonb_array_length(fehlt) AS fehlt, jsonb_array_length(defekt) AS defekt
      FROM projekt_durchgang WHERE projekt_id = $1 ORDER BY zeit DESC, id DESC`, [id]);
    return { zeilen: rows };
  });
  router.post("/api/v1/projekte/:id/rueckgabe-abschliessen", P, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const d = await transaktion(ctx.pool, async (c) => {
      const { rows: [p] } = await c.query("SELECT id FROM projekt WHERE id = $1 FOR UPDATE", [id]);
      if (!p) throw nichtGefunden("Dieses Projekt");
      return erfasseRueckgabe(c, ctx, id);
    });
    ctx.hub?.sende({ typ: "packen.geaendert", projekt: id, bereich: "packen" });
    return { ok: true, level: d.fehlt || d.defekt ? "warning" : "success", durchgang: d.id,
      text: `Rückgabe ${d.nr} abgeschlossen: ${d.zurueck} zurück, ${d.fehlt} fehlen, ${d.defekt} defekt. Das Rückgabeprotokoll steht bereit.` };
  });
  router.get("/api/v1/durchgaenge/:id/pdf", { ...P, stufe: "r" }, async (ctx) => {
    const d = await ladeDurchgang(ctx.pool, idParam(ctx.params.id, "Dieser Durchgang"));
    const name = `${d.art === "verladen" ? "Lieferschein" : "Rückgabeprotokoll"} ${d.nummer}-${d.nr}.pdf`;
    sendePdf(ctx, await belegPdf(ctx, d), name, ctx.query.download !== "1");
  });
}
