// Projekte/Jobs (3.2, 4.1, R-12–R-14, R-20, FA-29–FA-31, FA-34), Aufgaben (3.4, FA-32), Dateien (3.3, FA-33).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { transaktion } from "@lager/db";
import { naechsteProjektnummer, normalisiereProjektcode, pruefeProjekt, PROJEKT_STATUS, statusWechselErlaubt, gibtZoneFrei, statusNachVerladen,
  ordnerName, UNTERORDNER, kopieName, GEWERKE, DATEI_KATEGORIEN, pruefeDatei, inlineErlaubt, inhaltsTyp, sichererDateiname, MAX_DATEI, heuteIso } from "@lager/domain";
import { fehler, nichtGefunden, seite, idParam, dbFehler } from "./hilfen.js";
import { protokolliere, clientIp } from "./sicherheit.js";

const P = { bereich: "projekte" };
const FELDER = ["art", "uebergeordnet_id", "gewerk", "name", "kunde_id", "status", "beginn", "ende", "ort", "notizen"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const datenOrdner = (ctx) => path.resolve(ctx.config?.dataDir || "./data");
/** Pfad innerhalb des Datenordners; alles andere wird abgewiesen (FA-33 „nur aus dem Projektbereich“). */
function sichererPfad(basis, rel) {
  const voll = path.resolve(basis, rel);
  if (voll !== basis && !voll.startsWith(basis + path.sep)) throw fehler(400, "Ungültiger Pfad. Lade die Seite neu.");
  return voll;
}

/** Werte aus dem Body; leere Texte → "", leere Daten/IDs → null. */
function werte(body) {
  const w = {};
  for (const f of FELDER) if (body && f in body) {
    const v = body[f];
    if (["uebergeordnet_id", "kunde_id"].includes(f)) w[f] = v === "" || v == null ? null : Number(v);
    else if (["beginn", "ende"].includes(f)) w[f] = v || null;
    else w[f] = v == null ? "" : String(v).trim();
  }
  return w;
}

async function neueNummer(c, art) {
  const praefix = art === "job" ? "J" : "P";
  await c.query("SELECT pg_advisory_xact_lock(hashtext('projekt-nummer-' || $1))", [praefix]);
  const { rows: [{ jahr }] } = await c.query("SELECT extract(year FROM now() AT TIME ZONE 'Europe/Berlin')::int AS jahr");
  const { rows } = await c.query("SELECT nummer FROM projekt WHERE nummer LIKE $1", [`${praefix}-${jahr}-%`]);
  return naechsteProjektnummer(praefix, jahr, rows.map((r) => r.nummer));
}

/** Projektordner mit Unterordnern (3.2). Jobs eines Projekts liegen unter <Projektordner>/Jobs/. */
async function legeOrdnerAn(ctx, c, p) {
  let rel;
  if (p.uebergeordnet_id) {
    const { rows: [e] } = await c.query("SELECT ordner FROM projekt WHERE id = $1", [p.uebergeordnet_id]);
    rel = path.join(e.ordner, "Jobs", ordnerName(p.nummer, p.name));
  } else rel = path.join("projekte", ordnerName(p.nummer, p.name));
  const voll = sichererPfad(datenOrdner(ctx), rel);
  for (const u of UNTERORDNER) await fsp.mkdir(path.join(voll, u), { recursive: true });
  await c.query("UPDATE projekt SET ordner = $1 WHERE id = $2", [rel, p.id]);
  return rel;
}

/** Legt Projekt/Job an (in Transaktion). Jobs übernehmen Kunde, Termin, Ort vom Projekt (FA-30). */
export async function legeProjektAn(ctx, c, roh) {
  const w = { art: "projekt", status: "anfrage", ort: "", notizen: "", gewerk: "", ...roh };
  if (w.uebergeordnet_id) {
    const { rows: [e] } = await c.query("SELECT id, art, kunde_id, beginn, ende, ort FROM projekt WHERE id = $1", [w.uebergeordnet_id]);
    if (!e) throw fehler(400, "Das übergeordnete Projekt gibt es nicht (mehr). Wähle ein anderes.", { felder: { uebergeordnet_id: "Projekt fehlt" } });
    if (e.art !== "projekt") throw fehler(400, "Ein Job kann keine Unter-Jobs haben. Wähle ein Projekt als Oberprojekt.", { felder: { uebergeordnet_id: "Nur Projekte" } });
    w.art = "job";
    w.kunde_id = e.kunde_id;
    if (!w.beginn) w.beginn = e.beginn;
    if (!w.ende) w.ende = e.ende;
    if (!w.ort) w.ort = e.ort;
  }
  if (w.art !== "job") w.gewerk = "";
  const f = pruefeProjekt(w);
  if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
  const nummer = await neueNummer(c, w.art);
  let p;
  try {
    ({ rows: [p] } = await c.query(`INSERT INTO projekt (nummer, art, uebergeordnet_id, gewerk, name, kunde_id, status, beginn, ende, ort, notizen, erstellt_von)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [nummer, w.art, w.uebergeordnet_id || null, w.gewerk, w.name, w.kunde_id, w.status, w.beginn, w.ende, w.ort, w.notizen, ctx.nutzer?.benutzername || ""]));
  } catch (e) { throw dbFehler(e, { verknuepft: "Den gewählten Kunden gibt es nicht (mehr). Wähle einen anderen." }); }
  p.ordner = await legeOrdnerAn(ctx, c, p);
  return p;
}

/** R-14: Beim Verladen (Packen abgeschlossen) wechselt bestätigt automatisch auf läuft. */
export async function nachVerladen(c, projektId) {
  const { rows: [p] } = await c.query("SELECT status FROM projekt WHERE id = $1 FOR UPDATE", [projektId]);
  if (!p) return null;
  const neu = statusNachVerladen(p.status);
  if (neu !== p.status) await c.query("UPDATE projekt SET status = $1, version = version + 1, geaendert = now() WHERE id = $2", [neu, projektId]);
  return neu;
}

const LISTE_SQL = `SELECT p.id, p.nummer, p.art, p.name, p.status, p.beginn, p.ende, p.ort, p.gewerk, p.uebergeordnet_id, p.kunde_id,
  k.name AS kunde, k.firma AS kunde_firma, e.nummer AS eltern_nummer, e.name AS eltern_name
  FROM projekt p JOIN kunde k ON k.id = p.kunde_id LEFT JOIN projekt e ON e.id = p.uebergeordnet_id`;

async function detail(db, p) {
  const [jobs, aufgaben, dateien, geraete, eltern] = await Promise.all([
    db.query(`${LISTE_SQL} WHERE p.uebergeordnet_id = $1 ORDER BY p.nummer`, [p.id]),
    db.query(`SELECT a.*, b.name AS zugewiesen_name, b.benutzername AS zugewiesen_benutzer FROM aufgabe a LEFT JOIN benutzer b ON b.id = a.zugewiesen_id
      WHERE a.projekt_id = $1 ORDER BY a.erledigt, a.faellig NULLS LAST, a.id`, [p.id]),
    db.query("SELECT id, name, kategorie, beschreibung, groesse, hochgeladen, von FROM projekt_datei WHERE projekt_id = $1 ORDER BY hochgeladen DESC, id DESC", [p.id]),
    db.query("SELECT count(*)::int AS gesamt, count(*) FILTER (WHERE status = 'gepackt')::int AS gepackt FROM geraet WHERE projekt_id = $1", [p.id]),
    p.uebergeordnet_id ? db.query("SELECT id, nummer, name FROM projekt WHERE id = $1", [p.uebergeordnet_id]) : { rows: [] },
  ]);
  const heute = heuteIso();
  const offen = aufgaben.rows.filter((a) => !a.erledigt);
  return {
    ...p, status_text: PROJEKT_STATUS[p.status], eltern: eltern.rows[0] || null,
    // FA-29 Kopfkennzahlen. Angebotswert kommt mit den Angeboten (Phase 5).
    kennzahlen: { beginn: p.beginn, ende: p.ende, angebotswert_netto: 0, geraete: geraete.rows[0].gesamt, gepackt: geraete.rows[0].gepackt,
      aufgaben_offen: offen.length, aufgaben_ueberfaellig: offen.filter((a) => a.faellig && a.faellig < heute).length },
    jobs: jobs.rows, aufgaben: aufgaben.rows, dateien: dateien.rows, angebote: [], zeiten: [],
  };
}
const ladeProjekt = async (db, where, wert) => (await db.query(`SELECT p.*, k.name AS kunde, k.firma AS kunde_firma FROM projekt p JOIN kunde k ON k.id = p.kunde_id WHERE ${where}`, [wert])).rows[0];

export function projekteModul(router) {
  router.get("/api/v1/projekte/gewerke", { ...P, stufe: "r" }, async () => ({ gewerke: GEWERKE, status: PROJEKT_STATUS }));
  /* ── Liste (FA-29) ── */
  router.get("/api/v1/projekte", { ...P, stufe: "r" }, async (ctx) => {
    const { q, status, art, kunde, von, bis, eltern } = ctx.query;
    const { limit, offset } = seite(ctx.query);
    const st = status ? String(status).split(",").filter((s) => PROJEKT_STATUS[s]) : null;
    if ((von && !ISO.test(von)) || (bis && !ISO.test(bis))) throw fehler(400, "Zeitraum ungültig. Wähle die Daten im Kalender.");
    const { rows } = await ctx.pool.query(`${LISTE_SQL.replace("SELECT ", "SELECT count(*) OVER()::int AS gesamt, ")}
      WHERE ($1::text IS NULL OR p.name ILIKE '%' || $1 || '%' OR p.nummer ILIKE '%' || $1 || '%' OR k.name ILIKE '%' || $1 || '%' OR k.firma ILIKE '%' || $1 || '%' OR p.ort ILIKE '%' || $1 || '%')
        AND ($2::text[] IS NULL OR p.status = ANY($2)) AND ($3::text IS NULL OR p.art = $3) AND ($4::int IS NULL OR p.kunde_id = $4)
        AND ($5::date IS NULL OR coalesce(p.ende, p.beginn) >= $5) AND ($6::date IS NULL OR p.beginn <= $6) AND ($7::int IS NULL OR p.uebergeordnet_id = $7)
      ORDER BY p.beginn DESC NULLS LAST, p.nummer DESC LIMIT $8 OFFSET $9`,
    [q || null, st?.length ? st : null, ["projekt", "job"].includes(art) ? art : null, kunde ? Number(kunde) : null, von || null, bis || null, eltern ? Number(eltern) : null, limit, offset]);
    return { gesamt: rows[0]?.gesamt || 0, zeilen: rows.map((r) => ({ ...r, gesamt: undefined, status_text: PROJEKT_STATUS[r.status] })) };
  });
  router.get("/api/v1/projekte/nummer/:nummer", { ...P, stufe: "r" }, async (ctx) => {
    const n = normalisiereProjektcode(ctx.params.nummer);
    const p = n && await ladeProjekt(ctx.pool, "p.nummer = $1", n);
    if (!p) throw fehler(404, `Kein Projekt mit der Nummer ${n || ctx.params.nummer} gefunden. Prüfe die Nummer.`);
    return detail(ctx.pool, p);
  });
  router.get("/api/v1/projekte/:id", { ...P, stufe: "r" }, async (ctx) => {
    const p = await ladeProjekt(ctx.pool, "p.id = $1", idParam(ctx.params.id, "Dieses Projekt"));
    if (!p) throw nichtGefunden("Dieses Projekt");
    return detail(ctx.pool, p);
  });

  /* ── Anlegen / Bearbeiten (FA-30, R-12, R-13) ── */
  router.post("/api/v1/projekte", P, async (ctx) => transaktion(ctx.pool, async (c) => {
    const p = await legeProjektAn(ctx, c, werte(ctx.body));
    ctx.hub?.sende({ typ: "projekt.geaendert", id: p.id, bereich: "projekte" });
    return { ok: true, level: "success", text: `${p.art === "job" ? "Job" : "Projekt"} ${p.nummer} angelegt.`, projekt: p };
  }));
  router.put("/api/v1/projekte/:id", P, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const { rows: [alt] } = await c.query("SELECT * FROM projekt WHERE id = $1 FOR UPDATE", [id]);
    if (!alt) throw nichtGefunden("Dieses Projekt");
    if (ctx.body?.version != null && ctx.body.version !== alt.version)
      throw fehler(409, "Jemand anderes hat dieses Projekt inzwischen geändert. Lade die Seite neu und trage deine Änderung erneut ein.");
    const w = { ...alt, ...werte(ctx.body) };
    if (w.art === "projekt") { w.uebergeordnet_id = null; w.gewerk = ""; }
    if (w.uebergeordnet_id === id) throw fehler(400, "Ein Projekt kann nicht sein eigener Job sein.", { felder: { uebergeordnet_id: "Anderes Projekt wählen" } });
    if (w.art === "job" && alt.art === "projekt") {
      const { rows: [j] } = await c.query("SELECT count(*)::int AS n FROM projekt WHERE uebergeordnet_id = $1", [id]);
      if (j.n) throw fehler(409, `Dieses Projekt hat ${j.n} Job(s) und kann nicht zum Job werden. Verschiebe oder lösche zuerst die Jobs.`);
    }
    const f = pruefeProjekt(w);
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    const zoneFrei = gibtZoneFrei(w.status); // R-13
    try {
      const { rows: [p] } = await c.query(`UPDATE projekt SET art = $1, uebergeordnet_id = $2, gewerk = $3, name = $4, kunde_id = $5, status = $6, beginn = $7, ende = $8,
          ort = $9, notizen = $10, ladezone_id = CASE WHEN $11 THEN NULL ELSE ladezone_id END, zone_seit = CASE WHEN $11 THEN NULL ELSE zone_seit END,
          version = version + 1, geaendert = now() WHERE id = $12 RETURNING *`,
      [w.art, w.uebergeordnet_id || null, w.gewerk, w.name, w.kunde_id, w.status, w.beginn, w.ende, w.ort, w.notizen, zoneFrei, id]);
      ctx.hub?.sende({ typ: "projekt.geaendert", id, version: p.version, bereich: "projekte" });
      if (zoneFrei && alt.ladezone_id) ctx.hub?.sende({ typ: "zone.geaendert", id: alt.ladezone_id, bereich: "zonen" });
      return { ok: true, level: "success", text: "Gespeichert.", projekt: p };
    } catch (e) {
      if (e.code === "P0001") throw fehler(400, `${e.message}. Wähle ein Projekt als Oberprojekt.`);
      throw dbFehler(e);
    }
  }));
  router.post("/api/v1/projekte/:id/status", P, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const nach = String(ctx.body?.status || "");
    const { rows: [alt] } = await c.query("SELECT nummer, status, ladezone_id FROM projekt WHERE id = $1 FOR UPDATE", [id]);
    if (!alt) throw nichtGefunden("Dieses Projekt");
    if (!statusWechselErlaubt(alt.status, nach)) throw fehler(400, PROJEKT_STATUS[nach] ? `${alt.nummer} ist schon „${PROJEKT_STATUS[nach]}“.` : "Wähle einen Status aus der Liste.");
    const frei = gibtZoneFrei(nach);
    await c.query(`UPDATE projekt SET status = $1, ladezone_id = CASE WHEN $2 THEN NULL ELSE ladezone_id END, zone_seit = CASE WHEN $2 THEN NULL ELSE zone_seit END,
      version = version + 1, geaendert = now() WHERE id = $3`, [nach, frei, id]);
    ctx.hub?.sende({ typ: "projekt.geaendert", id, bereich: "projekte" });
    if (frei && alt.ladezone_id) ctx.hub?.sende({ typ: "zone.geaendert", id: alt.ladezone_id, bereich: "zonen" });
    return { ok: true, level: "success", text: `${alt.nummer}: ${PROJEKT_STATUS[nach]}${frei && alt.ladezone_id ? ". Ladezone freigegeben" : ""}.`, status: nach };
  }));
  // FA-30 „Jobs anlegen“: mehrere Jobs nach Gewerk auf einmal
  router.post("/api/v1/projekte/:id/jobs", P, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const { rows: [p] } = await c.query("SELECT id, art, name FROM projekt WHERE id = $1 FOR UPDATE", [id]);
    if (!p) throw nichtGefunden("Dieses Projekt");
    if (p.art !== "projekt") throw fehler(400, "Ein Job kann keine Unter-Jobs haben. Lege die Jobs am Projekt an.");
    const gewerke = [...new Set(Array.isArray(ctx.body?.gewerke) ? ctx.body.gewerke : [])];
    if (!gewerke.length) throw fehler(400, "Wähle mindestens ein Gewerk.", { felder: { gewerke: "Mindestens ein Gewerk" } });
    if (gewerke.some((g) => !GEWERKE.includes(g))) throw fehler(400, "Ein Gewerk ist unbekannt. Wähle aus der Liste.", { felder: { gewerke: "Unbekanntes Gewerk" } });
    const jobs = [];
    for (const g of gewerke) jobs.push(await legeProjektAn(ctx, c, { uebergeordnet_id: id, gewerk: g, name: `${p.name} – ${g}` }));
    ctx.hub?.sende({ typ: "projekt.geaendert", id, bereich: "projekte" });
    return { ok: true, level: "success", text: `${jobs.length} Job(s) angelegt: ${jobs.map((j) => j.nummer).join(", ")}.`, jobs };
  }));
  // FA-31 Duplizieren: Stammdaten, Jobs, offene Aufgaben; neue Nummer, Anfrage, „(Kopie)“; ohne Termin/Angebote/Material/Rechnungen
  router.post("/api/v1/projekte/:id/duplizieren", P, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const { rows: [a] } = await c.query("SELECT * FROM projekt WHERE id = $1", [id]);
    if (!a) throw nichtGefunden("Dieses Projekt");
    const kopiere = async (q, extra) => {
      const n = await legeProjektAn(ctx, c, { art: q.art, uebergeordnet_id: q.uebergeordnet_id, gewerk: q.gewerk, name: q.name, kunde_id: q.kunde_id,
        status: "anfrage", beginn: null, ende: null, ort: q.ort, notizen: q.notizen, ...extra });
      await c.query(`INSERT INTO aufgabe (projekt_id, text, zugewiesen_id, von) SELECT $1, text, zugewiesen_id, $3 FROM aufgabe WHERE projekt_id = $2 AND NOT erledigt ORDER BY id`,
        [n.id, q.id, ctx.nutzer?.benutzername || ""]);
      return n;
    };
    const neu = await kopiere(a, { name: kopieName(a.name) });
    if (a.art === "projekt") {
      const { rows: jobs } = await c.query("SELECT * FROM projekt WHERE uebergeordnet_id = $1 ORDER BY nummer", [id]);
      for (const j of jobs) await kopiere(j, { uebergeordnet_id: neu.id });
    }
    ctx.hub?.sende({ typ: "projekt.geaendert", id: neu.id, bereich: "projekte" });
    return { ok: true, level: "success", text: `Kopie ${neu.nummer} angelegt.`, projekt: neu };
  }));
  router.delete("/api/v1/projekte/:id", P, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const { rows: [p] } = await ctx.pool.query("SELECT nummer, ordner FROM projekt WHERE id = $1", [id]);
    if (!p) throw nichtGefunden("Dieses Projekt");
    try { await ctx.pool.query("DELETE FROM projekt WHERE id = $1", [id]); }
    catch (e) { throw dbFehler(e, { verknuepft: `${p.nummer} hat noch Jobs, Material oder Verlauf und kann nicht gelöscht werden. Setze es stattdessen auf „Storniert“.` }); }
    if (p.ordner) await fsp.rm(sichererPfad(datenOrdner(ctx), p.ordner), { recursive: true, force: true });
    ctx.hub?.sende({ typ: "projekt.geaendert", id, bereich: "projekte" });
    return { ok: true, level: "success", text: `${p.nummer} gelöscht.` };
  });

  /* ── Kalender (FA-34) ── */
  router.get("/api/v1/kalender", { ...P, stufe: "r" }, async (ctx) => {
    const { von, bis } = ctx.query;
    if (!ISO.test(von || "") || !ISO.test(bis || "") || bis < von) throw fehler(400, "Zeitraum ungültig. Wähle einen Monat.");
    const { rows } = await ctx.pool.query(`${LISTE_SQL} WHERE p.beginn IS NOT NULL AND p.beginn <= $2 AND coalesce(p.ende, p.beginn) >= $1
      ORDER BY p.beginn, p.nummer LIMIT 1000`, [von, bis]);
    return { zeilen: rows.map((r) => ({ ...r, status_text: PROJEKT_STATUS[r.status] })) };
  });

  /* ── Aufgaben (3.4, FA-32) ── */
  const AUFGABE_SQL = `SELECT a.*, p.nummer, p.name AS projekt, b.name AS zugewiesen_name, b.benutzername AS zugewiesen_benutzer,
      (NOT a.erledigt AND a.faellig < (now() AT TIME ZONE 'Europe/Berlin')::date) AS ueberfaellig
    FROM aufgabe a JOIN projekt p ON p.id = a.projekt_id LEFT JOIN benutzer b ON b.id = a.zugewiesen_id`;
  router.get("/api/v1/aufgaben", { ...P, stufe: "r" }, async (ctx) => {
    const meine = ctx.query.filter !== "alle";
    const erledigte = ctx.query.erledigt === "1";
    const { limit, offset } = seite(ctx.query);
    const { rows } = await ctx.pool.query(`${AUFGABE_SQL} WHERE ($1::int IS NULL OR a.zugewiesen_id = $1) AND ($2 OR NOT a.erledigt)
      ORDER BY a.erledigt, (NOT a.erledigt AND a.faellig < (now() AT TIME ZONE 'Europe/Berlin')::date) DESC, a.faellig NULLS LAST, a.id LIMIT $3 OFFSET $4`,
    [meine ? ctx.nutzer.id : null, erledigte, limit, offset]);
    return { zeilen: rows };
  });
  const aufgabeWerte = (b, teil = false) => {
    const w = {}, f = {};
    if (!teil || "text" in b) { w.text = String(b.text || "").trim(); if (!w.text) f.text = "Text fehlt. Bitte ausfüllen."; }
    if ("faellig" in b) { w.faellig = b.faellig || null; if (w.faellig && !ISO.test(w.faellig)) f.faellig = "Datum ungültig. Wähle ein Datum im Kalender."; }
    if ("zugewiesen_id" in b) w.zugewiesen_id = b.zugewiesen_id === "" || b.zugewiesen_id == null ? null : Number(b.zugewiesen_id);
    if ("erledigt" in b) w.erledigt = b.erledigt === true;
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    return w;
  };
  router.post("/api/v1/projekte/:id/aufgaben", P, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const w = aufgabeWerte(ctx.body || {});
    try {
      const { rows: [a] } = await ctx.pool.query(`INSERT INTO aufgabe (projekt_id, text, faellig, zugewiesen_id, von) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, w.text, w.faellig ?? null, w.zugewiesen_id ?? null, ctx.nutzer.benutzername]);
      ctx.hub?.sende({ typ: "aufgabe.geaendert", id: a.id, projekt: id, bereich: "projekte" });
      return { ok: true, level: "success", text: "Aufgabe angelegt.", aufgabe: a };
    } catch (e) { throw dbFehler(e, { verknuepft: "Projekt oder Benutzer gibt es nicht (mehr). Lade die Seite neu." }); }
  });
  router.put("/api/v1/aufgaben/:id", P, async (ctx) => {
    const id = idParam(ctx.params.id, "Diese Aufgabe");
    const w = aufgabeWerte(ctx.body || {}, true);
    const sets = [], werteListe = [];
    for (const [k, v] of Object.entries(w)) {
      werteListe.push(v); sets.push(`${k} = $${werteListe.length}`);
      if (k === "erledigt") sets.push(`erledigt_am = CASE WHEN $${werteListe.length}::boolean THEN coalesce(erledigt_am, now()) END`);
    }
    if (!sets.length) throw fehler(400, "Nichts zu ändern.");
    werteListe.push(id);
    try {
      const { rows: [a] } = await ctx.pool.query(`UPDATE aufgabe SET ${sets.join(", ")} WHERE id = $${werteListe.length} RETURNING *`, werteListe);
      if (!a) throw nichtGefunden("Diese Aufgabe");
      ctx.hub?.sende({ typ: "aufgabe.geaendert", id, projekt: a.projekt_id, bereich: "projekte" });
      return { ok: true, level: "success", text: a.erledigt && w.erledigt ? "Erledigt." : "Gespeichert.", aufgabe: a };
    } catch (e) { throw dbFehler(e, { verknuepft: "Den gewählten Benutzer gibt es nicht (mehr). Wähle einen anderen." }); }
  });
  router.delete("/api/v1/aufgaben/:id", P, async (ctx) => {
    const id = idParam(ctx.params.id, "Diese Aufgabe");
    const { rows: [a] } = await ctx.pool.query("DELETE FROM aufgabe WHERE id = $1 RETURNING projekt_id", [id]);
    if (!a) throw nichtGefunden("Diese Aufgabe");
    ctx.hub?.sende({ typ: "aufgabe.geaendert", id, projekt: a.projekt_id, bereich: "projekte" });
    return { ok: true, level: "success", text: "Aufgabe gelöscht." };
  });
  // Auswahl „Zuständiger“ (FA-32): aktive Benutzer, ohne Rechte-Details
  router.get("/api/v1/benutzer/auswahl", { ...P, stufe: "r" }, async (ctx) => {
    const { rows } = await ctx.pool.query("SELECT id, benutzername, name FROM benutzer WHERE aktiv ORDER BY lower(coalesce(nullif(name, ''), benutzername))");
    return { zeilen: rows };
  });

  /* ── Dateien (3.3, FA-33) ── */
  router.post("/api/v1/projekte/:id/dateien", { ...P, stream: true }, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const name = sichererDateiname(decodeURIComponent(String(ctx.query.name || "")));
    const kategorie = DATEI_KATEGORIEN[ctx.query.kategorie] ? ctx.query.kategorie : "sonstiges";
    const angegeben = Number(ctx.req.headers["content-length"] || 0);
    const vorab = pruefeDatei(name, angegeben || 1);
    if (vorab) { ctx.req.resume(); throw fehler(vorab.includes("50 MB") ? 413 : 400, vorab); }
    const { rows: [p] } = await ctx.pool.query("SELECT id, ordner FROM projekt WHERE id = $1", [id]);
    if (!p) { ctx.req.resume(); throw nichtGefunden("Dieses Projekt"); }
    const basis = datenOrdner(ctx);
    const ziel = sichererPfad(basis, path.join(p.ordner, "Dokumente", "Dateien"));
    await fsp.mkdir(ziel, { recursive: true });
    let datei = name, n = 2;
    while (fs.existsSync(path.join(ziel, datei))) datei = name.replace(/(\.[^.]+)?$/, (m) => ` (${n++})${m}`);
    const voll = path.join(ziel, datei);
    let groesse = 0;
    try {
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(voll, { flags: "wx" });
        ctx.req.on("data", (t) => {
          groesse += t.length;
          if (groesse > MAX_DATEI) { ctx.req.unpipe(out); out.destroy(); reject(fehler(413, "Die Datei ist größer als 50 MB. Verkleinere sie oder teile sie auf.")); ctx.req.resume(); }
        });
        ctx.req.on("error", reject);
        out.on("error", reject).on("finish", resolve);
        ctx.req.pipe(out);
      });
      const f = pruefeDatei(name, groesse);
      if (f) throw fehler(400, f);
    } catch (e) { await fsp.rm(voll, { force: true }); throw e; }
    const { rows: [d] } = await ctx.pool.query(`INSERT INTO projekt_datei (projekt_id, name, pfad, kategorie, beschreibung, groesse, von)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, kategorie, beschreibung, groesse, hochgeladen, von`,
    [id, datei, path.relative(basis, voll), kategorie, String(ctx.query.beschreibung || "").slice(0, 500), groesse, ctx.nutzer.benutzername]);
    ctx.hub?.sende({ typ: "projekt.geaendert", id, bereich: "projekte" });
    return { ok: true, level: "success", text: `„${datei}“ hochgeladen.`, datei: d };
  });
  const ladeDatei = async (ctx) => {
    const { rows: [d] } = await ctx.pool.query("SELECT d.*, p.ordner FROM projekt_datei d JOIN projekt p ON p.id = d.projekt_id WHERE d.id = $1", [idParam(ctx.params.id, "Diese Datei")]);
    if (!d) throw nichtGefunden("Diese Datei");
    return d;
  };
  router.get("/api/v1/dateien/:id", { ...P, stufe: "r" }, async (ctx) => {
    const d = await ladeDatei(ctx);
    const basis = datenOrdner(ctx);
    const voll = sichererPfad(basis, d.pfad);
    const bereichOrdner = sichererPfad(basis, d.ordner);
    if (!voll.startsWith(bereichOrdner + path.sep)) throw fehler(403, "Diese Datei liegt außerhalb des Projektordners und wird nicht ausgeliefert.");
    let st;
    try { st = await fsp.stat(voll); } catch { throw fehler(404, `Die Datei „${d.name}“ fehlt im Projektordner. Lade sie erneut hoch.`); }
    const inline = inlineErlaubt(d.name) && ctx.query.download !== "1";
    await protokolliere(ctx.pool, "download", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Projektdatei ${d.name}` });
    ctx.res.writeHead(200, {
      "Content-Type": inline ? inhaltsTyp(d.name) : "application/octet-stream", "Content-Length": st.size,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "Cache-Control": "private, no-store",
    });
    await new Promise((resolve, reject) => fs.createReadStream(voll).on("error", reject).on("end", resolve).pipe(ctx.res));
  });
  router.put("/api/v1/dateien/:id", P, async (ctx) => {
    const d = await ladeDatei(ctx);
    const kategorie = ctx.body?.kategorie ?? d.kategorie;
    if (!DATEI_KATEGORIEN[kategorie]) throw fehler(400, "Wähle eine Kategorie aus der Liste.", { felder: { kategorie: "Kategorie wählen" } });
    await ctx.pool.query("UPDATE projekt_datei SET kategorie = $1, beschreibung = $2 WHERE id = $3", [kategorie, String(ctx.body?.beschreibung ?? d.beschreibung).slice(0, 500), d.id]);
    ctx.hub?.sende({ typ: "projekt.geaendert", id: d.projekt_id, bereich: "projekte" });
    return { ok: true, level: "success", text: "Gespeichert." };
  });
  router.delete("/api/v1/dateien/:id", P, async (ctx) => {
    const d = await ladeDatei(ctx);
    await ctx.pool.query("DELETE FROM projekt_datei WHERE id = $1", [d.id]);
    await fsp.rm(sichererPfad(datenOrdner(ctx), d.pfad), { force: true });
    ctx.hub?.sende({ typ: "projekt.geaendert", id: d.projekt_id, bereich: "projekte" });
    return { ok: true, level: "success", text: `„${d.name}“ gelöscht.` };
  });
}
