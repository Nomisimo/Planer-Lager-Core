// FA-06 Inventur, FA-07 Reparatur und Wartung (Materialplaner).
import { transaktion } from "@lager/db";
import { normalisiereCode, inventurAbgleich, IM_LAGER_STATUS, INVENTUR_STATUS, REPARATUR_STATUS, REPARATUR_OFFEN, GERAET_ZU_REPARATUR,
  reparaturWechselFehler, wartungStatus, STATUS } from "@lager/domain";
import { datumAnzeige, zeitpunktAnzeige } from "@lager/domain/zeit.js";
import { fehler, nichtGefunden, idParam, bucheBewegung, wer } from "./hilfen.js";
import { sichereFassung } from "./fassung.js";
import { ladeEinstellungen } from "./verwaltung.js";
import { listenPdf, sendePdf } from "./pdf-liste.js";
import { speichereBild, sendeBild } from "./bilder.js";

const G = { bereich: "geraete" };
const PACKEN = { bereich: "packen" };

/* ── FA-06 Inventur ── */

const sollSql = `SELECT g.id, g.code, g.status, a.name AS artikel FROM geraet g JOIN artikel a ON a.id = g.artikel_id
  WHERE g.status = ANY($1) AND ($2::int IS NULL OR a.kategorie_id = $2) ORDER BY g.code`;

async function ladeInventur(db, id) {
  const { rows: [inv] } = await db.query(`SELECT i.*, k.name AS kategorie FROM inventur i LEFT JOIN kategorie k ON k.id = i.kategorie_id WHERE i.id = $1`, [id]);
  if (!inv) throw nichtGefunden("Diese Inventur");
  const { rows: scans } = await db.query(`SELECT s.code, s.geraet_id, s.zeit, s.von, g.status, a.name AS artikel, k.name AS kategorie
    FROM inventur_scan s LEFT JOIN geraet g ON g.id = s.geraet_id LEFT JOIN artikel a ON a.id = g.artikel_id LEFT JOIN kategorie k ON k.id = a.kategorie_id
    WHERE s.inventur_id = $1 ORDER BY s.zeit DESC, s.id DESC`, [id]);
  const soll = inv.soll || (await db.query(sollSql, [IM_LAGER_STATUS, inv.kategorie_id])).rows;
  const r = inv.ergebnis || inventurAbgleich(soll, scans);
  return { inventur: { ...inv, soll: undefined, ergebnis: undefined, status_text: INVENTUR_STATUS[inv.status] }, soll_anzahl: soll.length, gescannt: scans.length, scans, ...r };
}

async function inventurPdf(ctx, d) {
  const e = await ladeEinstellungen(ctx.pool);
  const i = d.inventur;
  const st = (s) => STATUS[s] || s || "";
  return listenPdf({
    titel: `Inventurprotokoll ${i.kategorie || "Gesamtbestand"}`, firma: e.firma, fuss: `Inventur ${i.id}`,
    kopf: [["Bereich", i.kategorie || "Gesamter Bestand"], ["Gestartet", `${zeitpunktAnzeige(i.gestartet)} von ${i.gestartet_von}`],
      ["Abgeschlossen", i.abgeschlossen ? `${zeitpunktAnzeige(i.abgeschlossen)} von ${i.abgeschlossen_von}` : "noch offen"],
      ["Ergebnis", `${d.soll_anzahl} Soll · ${d.ok.length} gezählt · ${d.fehlt.length} fehlen · ${d.zuViel.length} zu viel · ${d.unbekannt.length} unbekannt`]],
    abschnitte: [
      { titel: `Fehlt (${d.fehlt.length})`, hinweis: i.status === "abgeschlossen" ? "Als vermisst gebucht." : "Wird beim Abschluss als vermisst gebucht.", leer: "Keine fehlenden Geräte.",
        spalten: [{ t: "Code", w: 30 }, { t: "Artikel", w: 90 }, { t: "Status vorher", w: 50 }], zeilen: d.fehlt.map((g) => [g.code, g.artikel, st(g.status)]) },
      { titel: `Zu viel (${d.zuViel.length})`, hinweis: "Gescannt, aber nicht im Soll dieses Bereichs. Vermisste Geräte wurden als gefunden gebucht.", leer: "Keine.",
        spalten: [{ t: "Code", w: 30 }, { t: "Artikel", w: 70 }, { t: "Kategorie", w: 35 }, { t: "Status", w: 35 }], zeilen: d.zuViel.map((s) => [s.code, s.artikel, s.kategorie, st(s.status)]) },
      { titel: `Unbekannt (${d.unbekannt.length})`, leer: "Keine.", spalten: [{ t: "Code", w: 60 }, { t: "Zeit", w: 60 }, { t: "Von", w: 50 }],
        zeilen: d.unbekannt.map((s) => [s.code, zeitpunktAnzeige(s.zeit), s.von]) },
      { titel: `Gezählt (${d.ok.length})`, leer: "Keine.", spalten: [{ t: "Code", w: 30 }, { t: "Artikel", w: 90 }, { t: "Status", w: 50 }],
        zeilen: d.ok.map((g) => [g.code, g.artikel, st(g.status)]) },
    ],
    unterschriften: ["Gezählt", "Geprüft"],
  });
}

export function inventurModul(router) {
  router.get("/api/v1/inventuren", { ...G, stufe: "r" }, async (ctx) => (await ctx.pool.query(`SELECT i.id, i.kategorie_id, k.name AS kategorie, i.status, i.gestartet, i.gestartet_von, i.abgeschlossen, i.abgeschlossen_von,
      (SELECT count(*)::int FROM inventur_scan s WHERE s.inventur_id = i.id) AS gescannt,
      CASE WHEN i.ergebnis IS NOT NULL THEN jsonb_array_length(i.ergebnis->'fehlt') END AS fehlt
    FROM inventur i LEFT JOIN kategorie k ON k.id = i.kategorie_id ORDER BY i.status = 'offen' DESC, i.id DESC LIMIT 200`)).rows.map((r) => ({ ...r, status_text: INVENTUR_STATUS[r.status] })));

  router.post("/api/v1/inventuren", G, async (ctx) => {
    const kat = ctx.body?.kategorie_id ? Number(ctx.body.kategorie_id) : null;
    if (kat) { const { rows } = await ctx.pool.query("SELECT 1 FROM kategorie WHERE id = $1", [kat]); if (!rows.length) throw nichtGefunden("Diese Kategorie"); }
    try {
      const { rows: [i] } = await ctx.pool.query("INSERT INTO inventur (kategorie_id, gestartet_von) VALUES ($1, $2) RETURNING id", [kat, ctx.nutzer.name || ctx.nutzer.benutzername]);
      ctx.hub?.sende({ typ: "inventur.geaendert", id: i.id, bereich: "geraete" });
      return { ok: true, level: "success", id: i.id, text: "Inventur gestartet. Scanne jetzt alle Geräte im Bereich." };
    } catch (e) {
      if (e.code === "23505") throw fehler(409, "Für diesen Bereich läuft schon eine Inventur. Öffne sie in der Liste und mach dort weiter.");
      throw e;
    }
  });

  router.get("/api/v1/inventuren/:id", { ...G, stufe: "r" }, async (ctx) => ladeInventur(ctx.pool, idParam(ctx.params.id, "Diese Inventur")));

  router.post("/api/v1/inventuren/:id/scan", G, async (ctx) => {
    const id = idParam(ctx.params.id, "Diese Inventur");
    const roh = String(ctx.body?.code || "").trim();
    if (!roh) throw fehler(400, "Kein Code. Scanne das Etikett erneut.");
    const { rows: [inv] } = await ctx.pool.query("SELECT status, kategorie_id FROM inventur WHERE id = $1", [id]);
    if (!inv) throw nichtGefunden("Diese Inventur");
    if (inv.status !== "offen") throw fehler(409, "Diese Inventur ist schon beendet. Starte eine neue Inventur.");
    const code = normalisiereCode(roh);
    const { rows: [g] } = await ctx.pool.query(`SELECT g.id, g.code, g.status, a.name AS artikel, a.kategorie_id, k.name AS kategorie FROM geraet g
      JOIN artikel a ON a.id = g.artikel_id JOIN kategorie k ON k.id = a.kategorie_id
      WHERE g.code = $1 OR (g.alte_pruef_id <> '' AND lower(g.alte_pruef_id) = lower($2)) LIMIT 1`, [code, roh]);
    const gespeichert = g?.code || code || roh.toUpperCase();
    const { rowCount } = await ctx.pool.query("INSERT INTO inventur_scan (inventur_id, code, geraet_id, von) VALUES ($1, $2, $3, $4) ON CONFLICT (inventur_id, code) DO NOTHING",
      [id, gespeichert, g?.id || null, ctx.nutzer.name || ctx.nutzer.benutzername]);
    ctx.hub?.sende({ typ: "inventur.geaendert", id, bereich: "geraete" });
    if (!rowCount) return { level: "info", code: gespeichert, text: `${gespeichert} ist schon gezählt.` };
    if (!g) return { level: "error", code: gespeichert, text: `${gespeichert}: Diesen Code kennt das System nicht. Leg das Teil zur Seite und kläre es nach der Inventur.` };
    const imSoll = IM_LAGER_STATUS.includes(g.status) && (!inv.kategorie_id || inv.kategorie_id === g.kategorie_id);
    if (!imSoll) {
      const grund = inv.kategorie_id && inv.kategorie_id !== g.kategorie_id ? `gehört zur Kategorie ${g.kategorie}` : `ist als „${STATUS[g.status]}“ gebucht`;
      return { level: "warn", code: g.code, text: `${g.code} ${g.artikel} ${grund}, zählt als „zu viel“.` };
    }
    return { level: "ok", code: g.code, text: `${g.code} ${g.artikel} – gezählt` };
  });

  router.post("/api/v1/inventuren/:id/abschliessen", G, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Diese Inventur");
    const { rows: [inv] } = await c.query("SELECT * FROM inventur WHERE id = $1 FOR UPDATE", [id]);
    if (!inv) throw nichtGefunden("Diese Inventur");
    if (inv.status !== "offen") throw fehler(409, "Diese Inventur ist schon beendet.");
    // Soll unter Sperre einfrieren, damit parallel gebuchte Geräte das Ergebnis nicht verfälschen
    const { rows: soll } = await c.query(`${sollSql.replace("ORDER BY g.code", "ORDER BY g.code FOR UPDATE OF g")}`, [IM_LAGER_STATUS, inv.kategorie_id]);
    const { rows: scans } = await c.query(`SELECT s.code, s.geraet_id, s.zeit, s.von, g.status, a.name AS artikel, k.name AS kategorie
      FROM inventur_scan s LEFT JOIN geraet g ON g.id = s.geraet_id LEFT JOIN artikel a ON a.id = g.artikel_id LEFT JOIN kategorie k ON k.id = a.kategorie_id WHERE s.inventur_id = $1 ORDER BY s.id`, [id]);
    const r = inventurAbgleich(soll, scans);
    const w = wer(ctx);
    for (const g of r.fehlt) {
      await c.query("UPDATE geraet SET status = 'vermisst', version = version + 1 WHERE id = $1", [g.id]);
      await bucheBewegung(c, { geraetId: g.id, aktion: `Inventur ${id}: nicht gefunden, als vermisst gemeldet (vorher ${STATUS[g.status]})`, ...w });
    }
    for (const s of r.zuViel) {
      if (s.status === "vermisst") {
        await c.query("UPDATE geraet SET status = 'lager', projekt_id = NULL, version = version + 1 WHERE id = $1", [s.geraet_id]);
        await bucheBewegung(c, { geraetId: s.geraet_id, aktion: `Inventur ${id}: wieder gefunden, zurück im Lager`, ...w });
      } else await bucheBewegung(c, { geraetId: s.geraet_id, aktion: `Inventur ${id}: gezählt, gehört nicht zum Bereich (${STATUS[s.status] || s.status})`, ...w });
    }
    if (r.ok.length) await c.query(`INSERT INTO bewegung (geraet_id, aktion, benutzer, mitarbeiter) SELECT unnest($1::int[]), $2, $3, $4`,
      [r.ok.map((g) => g.id), `Inventur ${id}: gezählt`, w.benutzer, w.mitarbeiter]);
    await c.query("UPDATE inventur SET status = 'abgeschlossen', abgeschlossen = now(), abgeschlossen_von = $1, soll = $2, ergebnis = $3 WHERE id = $4",
      [ctx.nutzer.name || ctx.nutzer.benutzername, JSON.stringify(soll), JSON.stringify(r), id]);
    ctx.hub?.sende({ typ: "inventur.geaendert", id, bereich: "geraete" });
    ctx.hub?.sende({ typ: "geraet.geaendert", bereich: "geraete" });
    return { ok: true, level: r.fehlt.length ? "warning" : "success",
      text: `Inventur abgeschlossen: ${r.ok.length} gezählt, ${r.fehlt.length} als vermisst gemeldet, ${r.zuViel.length} zu viel, ${r.unbekannt.length} unbekannt.` };
  }));

  router.post("/api/v1/inventuren/:id/abbrechen", G, async (ctx) => {
    const id = idParam(ctx.params.id, "Diese Inventur");
    const { rows: [i] } = await ctx.pool.query("UPDATE inventur SET status = 'abgebrochen', abgeschlossen = now(), abgeschlossen_von = $1 WHERE id = $2 AND status = 'offen' RETURNING id",
      [ctx.nutzer.name || ctx.nutzer.benutzername, id]);
    if (!i) throw fehler(409, "Diese Inventur ist schon beendet.");
    ctx.hub?.sende({ typ: "inventur.geaendert", id, bereich: "geraete" });
    return { ok: true, level: "success", text: "Inventur abgebrochen. Es wurde nichts gebucht." };
  });

  router.get("/api/v1/inventuren/:id/protokoll.pdf", { ...G, stufe: "r" }, async (ctx) => {
    const d = await ladeInventur(ctx.pool, idParam(ctx.params.id, "Diese Inventur"));
    sendePdf(ctx, await inventurPdf(ctx, d), `Inventur ${d.inventur.id} ${d.inventur.kategorie || "Gesamtbestand"}.pdf`, ctx.query.download !== "1");
  });

  /* ── FA-07 Reparatur ── */

  const REP_SQL = `SELECT r.*, g.code, g.status AS geraet_status, a.name AS artikel, b.name AS verantwortlich FROM reparatur r
    JOIN geraet g ON g.id = r.geraet_id JOIN artikel a ON a.id = g.artikel_id LEFT JOIN benutzer b ON b.id = r.verantwortlich_id`;
  const mitText = (r) => ({ ...r, status_text: REPARATUR_STATUS[r.status], offen: REPARATUR_OFFEN.includes(r.status) });
  const ladeRep = async (db, id, sperre = false) => {
    const { rows: [r] } = await db.query(`${REP_SQL} WHERE r.id = $1${sperre ? " FOR UPDATE OF r" : ""}`, [id]);
    if (!r) throw nichtGefunden("Diese Reparatur");
    return mitText(r);
  };
  const kosten = (v, f) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    if (!Number.isInteger(v) || v < 0) f.kosten = "Kosten als Betrag ab 0 € eingeben oder leer lassen.";
    return v;
  };

  router.get("/api/v1/reparaturen", { ...G, stufe: "r" }, async (ctx) => {
    const { status = "offen", geraet } = ctx.query;
    const { rows } = await ctx.pool.query(`${REP_SQL} WHERE ($1 = 'alle' OR ($1 = 'offen' AND r.status = ANY($2)) OR r.status = $1) AND ($3::int IS NULL OR r.geraet_id = $3)
      ORDER BY r.status = ANY($2) DESC, r.gemeldet DESC LIMIT 500`, [String(status), REPARATUR_OFFEN, geraet ? Number(geraet) : null]);
    return rows.map(mitText);
  });
  router.get("/api/v1/reparaturen/:id", { ...G, stufe: "r" }, async (ctx) => ladeRep(ctx.pool, idParam(ctx.params.id, "Diese Reparatur")));

  // Defekt melden darf, wer packen/zurücknehmen darf (Lager/Techniker)
  router.post("/api/v1/reparaturen", PACKEN, async (ctx) => transaktion(ctx.pool, async (c) => {
    const b = ctx.body || {};
    const f = {};
    const beschreibung = String(b.beschreibung || "").trim();
    if (!beschreibung) f.beschreibung = "Beschreibe den Defekt kurz (was geht nicht?).";
    const k = kosten(b.kosten, f);
    const code = b.code ? normalisiereCode(String(b.code)) : null;
    const { rows: [g] } = await c.query(`SELECT id, code, status, projekt_id FROM geraet WHERE ${b.geraet_id ? "id = $1" : "code = $1"} FOR UPDATE`, [b.geraet_id ? Number(b.geraet_id) : code]);
    if (!g) f.geraet = "Dieses Gerät gibt es nicht. Prüfe den Code.";
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    if (["ausgemustert", "verkauft"].includes(g.status)) throw fehler(409, `${g.code} ist „${STATUS[g.status]}“ und kann nicht repariert werden.`);
    let rep;
    try {
      ({ rows: [rep] } = await c.query(`INSERT INTO reparatur (geraet_id, beschreibung, verantwortlich_id, kosten, gemeldet_von) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [g.id, beschreibung, b.verantwortlich_id ? Number(b.verantwortlich_id) : null, k ?? null, ctx.nutzer.name || ctx.nutzer.benutzername]));
    } catch (e) { if (e.code === "23505") throw fehler(409, `Für ${g.code} gibt es schon eine offene Reparatur. Ergänze sie statt einer neuen Meldung.`); throw e; }
    if (g.status !== "defekt") await c.query("UPDATE geraet SET status = 'defekt', version = version + 1 WHERE id = $1", [g.id]);
    await bucheBewegung(c, { geraetId: g.id, projektId: g.projekt_id, aktion: `Defekt gemeldet: ${beschreibung.slice(0, 120)}`, ...wer(ctx) });
    ctx.hub?.sende({ typ: "reparatur.geaendert", id: rep.id, bereich: "geraete" });
    ctx.hub?.sende({ typ: "geraet.geaendert", id: g.id, projekt: g.projekt_id, bereich: "geraete" });
    return { ok: true, level: "success", id: rep.id, text: `Defekt für ${g.code} gemeldet. Das Gerät ist gesperrt, bis es repariert und geprüft ist.` };
  }));

  router.put("/api/v1/reparaturen/:id", G, async (ctx) => {
    await sichereFassung(ctx, ctx.pool, "reparatur", Number(ctx.params.id), { was: "Die Reparatur" });
    const id = idParam(ctx.params.id, "Diese Reparatur");
    const b = ctx.body || {};
    const f = {};
    const k = kosten(b.kosten, f);
    if (b.beschreibung !== undefined && !String(b.beschreibung).trim()) f.beschreibung = "Beschreibung darf nicht leer sein.";
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    const { rows: [r] } = await ctx.pool.query(`UPDATE reparatur SET beschreibung = coalesce($1, beschreibung), notiz = coalesce($2, notiz),
        verantwortlich_id = CASE WHEN $3 THEN $4 ELSE verantwortlich_id END, kosten = CASE WHEN $5 THEN $6 ELSE kosten END, geaendert = now(), version = version + 1
      WHERE id = $7 RETURNING id`, [b.beschreibung === undefined ? null : String(b.beschreibung).trim(), b.notiz === undefined ? null : String(b.notiz),
      b.verantwortlich_id !== undefined, b.verantwortlich_id ? Number(b.verantwortlich_id) : null, k !== undefined, k ?? null, id]);
    if (!r) throw nichtGefunden("Diese Reparatur");
    ctx.hub?.sende({ typ: "reparatur.geaendert", id, bereich: "geraete" });
    return { ok: true, level: "success", text: "Reparatur gespeichert." };
  });

  router.post("/api/v1/reparaturen/:id/status", G, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Diese Reparatur");
    const r = await ladeRep(c, id, true);
    const nach = String(ctx.body?.status || "");
    const pruefungOk = ctx.body?.pruefung_ok === true;
    const fehlerText = reparaturWechselFehler(r.status, nach, { pruefungOk });
    if (fehlerText) throw fehler(409, fehlerText);
    const f = {};
    const k = kosten(ctx.body?.kosten, f);
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    await c.query(`UPDATE reparatur SET status = $1, pruefung_ok = CASE WHEN $1 = 'repariert' THEN true ELSE pruefung_ok END, kosten = CASE WHEN $2 THEN $3 ELSE kosten END,
        notiz = CASE WHEN $4 <> '' THEN btrim(notiz || E'\\n' || $4) ELSE notiz END, geaendert = now(), erledigt = CASE WHEN $1 IN ('repariert', 'ausgemustert') THEN now() END, version = version + 1
      WHERE id = $5`, [nach, k !== undefined, k ?? null, String(ctx.body?.notiz || "").trim(), id]);
    const gStatus = GERAET_ZU_REPARATUR[nach];
    // Rückgabe in den Bestand: geprüft (setzt bei prüfpflichtigen Artikeln die letzte Prüfung), Projekt gelöst
    await c.query(`UPDATE geraet g SET status = $1, version = g.version + 1,
        projekt_id = CASE WHEN $1 IN ('lager', 'ausgemustert') THEN NULL ELSE g.projekt_id END,
        letzte_pruefung = CASE WHEN $1 = 'lager' AND a.pruefpflichtig THEN (now() AT TIME ZONE 'Europe/Berlin')::date ELSE g.letzte_pruefung END
      FROM artikel a WHERE a.id = g.artikel_id AND g.id = $2`, [gStatus, r.geraet_id]);
    await bucheBewegung(c, { geraetId: r.geraet_id, aktion: `Reparatur: ${REPARATUR_STATUS[nach]}${nach === "repariert" ? ", Prüfung bestanden, zurück im Lager" : ""}`, ...wer(ctx) });
    ctx.hub?.sende({ typ: "reparatur.geaendert", id, bereich: "geraete" });
    ctx.hub?.sende({ typ: "geraet.geaendert", id: r.geraet_id, bereich: "geraete" });
    return { ok: true, level: "success", text: `${r.code}: ${REPARATUR_STATUS[nach]}.${nach === "repariert" ? " Das Gerät ist wieder im Lager." : ""}` };
  }));

  router.post("/api/v1/reparaturen/:id/foto", { ...PACKEN, stream: true }, async (ctx) => {
    const id = idParam(ctx.params.id, "Diese Reparatur");
    const { rows: [r] } = await ctx.pool.query("SELECT id FROM reparatur WHERE id = $1", [id]);
    if (!r) { ctx.req.resume(); throw nichtGefunden("Diese Reparatur"); }
    const name = await speichereBild(ctx, `reparatur/${id}`);
    await ctx.pool.query("UPDATE reparatur SET foto = $1, geaendert = now() WHERE id = $2", [name, id]);
    ctx.hub?.sende({ typ: "reparatur.geaendert", id, bereich: "geraete" });
    return { ok: true, level: "success", foto: name, text: "Foto gespeichert." };
  });
  router.get("/api/v1/reparaturen/:id/foto", { ...G, stufe: "r" }, async (ctx) => {
    const r = await ladeRep(ctx.pool, idParam(ctx.params.id, "Diese Reparatur"));
    await sendeBild(ctx, `reparatur/${r.id}`, r.foto);
  });

  /* ── FA-07 Wartung (nicht prüfpflichtig) ── */

  router.get("/api/v1/wartung", { ...G, stufe: "r" }, async (ctx) => {
    const { rows } = await ctx.pool.query(`SELECT g.id, g.code, g.status, g.letzte_wartung, a.id AS artikel_id, a.name AS artikel, a.wartung_text, a.wartung_intervall_monate
      FROM geraet g JOIN artikel a ON a.id = g.artikel_id
      WHERE a.wartung_intervall_monate IS NOT NULL AND g.status NOT IN ('ausgemustert', 'verkauft')
        AND (g.letzte_wartung IS NULL OR (g.letzte_wartung + make_interval(months => a.wartung_intervall_monate))::date <= (now() AT TIME ZONE 'Europe/Berlin')::date + 30)
      ORDER BY g.letzte_wartung NULLS FIRST, g.code LIMIT 500`);
    return rows.map((g) => ({ ...g, wartung: wartungStatus(g, g.letzte_wartung) }));
  });
  router.post("/api/v1/geraete/:id/gewartet", G, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Dieses Gerät");
    const { rows: [g] } = await c.query(`UPDATE geraet g SET letzte_wartung = (now() AT TIME ZONE 'Europe/Berlin')::date, version = g.version + 1 FROM artikel a
      WHERE a.id = g.artikel_id AND g.id = $1 RETURNING g.id, g.code, g.projekt_id, g.letzte_wartung, a.wartung_text`, [id]);
    if (!g) throw nichtGefunden("Dieses Gerät");
    await bucheBewegung(c, { geraetId: id, projektId: g.projekt_id, aktion: `Wartung erledigt${g.wartung_text ? `: ${g.wartung_text}` : ""}`, ...wer(ctx) });
    ctx.hub?.sende({ typ: "geraet.geaendert", id, bereich: "geraete" });
    return { ok: true, level: "success", text: `${g.code}: Wartung am ${datumAnzeige(g.letzte_wartung)} eingetragen.`, letzte_wartung: g.letzte_wartung };
  }));
}
