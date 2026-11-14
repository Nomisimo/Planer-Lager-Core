// Stammdaten: Kategorien (3.6), Artikel (3.7, FA-01/02/04/05, R-71/72), Geräte (3.8, FA-03, R-16–R-22), Bewegungen (3.9).
import { transaktion } from "@lager/db";
import { praefixVorschlag, praefixGueltig, naechsterGeraetecode, normalisiereCode, pruefeArtikel, artikeltyp,
  bestandNiedrig, uebergangErlaubt, aktionText, loeschSperre, STATUS, pruefstatus } from "@lager/domain";
import { fehler, nichtGefunden, seite, idParam, wer, bucheBewegung, dbFehler } from "./hilfen.js";

/** Prüfstatus in SQL (5.10), Stichtag Berlin. Erwartet Aliase a (artikel) und g (geraet). */
export const PRUEF_SQL = `CASE WHEN NOT a.pruefpflichtig THEN 'keine' WHEN g.letzte_pruefung IS NULL THEN 'offen'
  WHEN (g.letzte_pruefung + make_interval(months => a.pruef_intervall_monate))::date < (now() AT TIME ZONE 'Europe/Berlin')::date THEN 'ueberfaellig'
  WHEN (g.letzte_pruefung + make_interval(months => a.pruef_intervall_monate))::date <= (now() AT TIME ZONE 'Europe/Berlin')::date + 30 THEN 'bald'
  ELSE 'ok' END`;
const NAECHSTE_SQL = `CASE WHEN a.pruefpflichtig AND g.letzte_pruefung IS NOT NULL THEN (g.letzte_pruefung + make_interval(months => a.pruef_intervall_monate))::date END`;

const ARTIKEL_FELDER = ["name", "kategorie_id", "hersteller", "beschreibung", "aktiv", "preis_tag", "folgetag_prozent", "verkaeuflich",
  "verkaufspreis", "mengenschritt", "ist_case", "inhalt_artikel_id", "verpackungseinheit", "ist_leistung", "zeitmodell", "preis_erweitert",
  "verbrauch", "bestand", "mindestbestand", "einheit", "pruefpflichtig", "pruef_intervall_monate", "plansymbol", "laenge_m", "farbcode"];

/**
 * R-21: vergibt n neue Gerätecodes für eine Kategorie (in laufender Transaktion, Kategorie gesperrt).
 * Berücksichtigt vorhandene Geräte und reservierte Codes aus Etiketten-Bestellungen (falls Tabelle vorhanden).
 */
export async function vergibCodes(c, kategorieId, anzahl) {
  const { rows: [k] } = await c.query("SELECT id, praefix, letzte_nummer FROM kategorie WHERE id = $1 FOR UPDATE", [kategorieId]);
  if (!k) throw nichtGefunden("Diese Kategorie");
  // etikett_code (reservierte Codes aus Bestellungen) gibt es erst ab Phase 3 – ohne Fehler in der Transaktion prüfen.
  const { rows: [t] } = await c.query("SELECT to_regclass('etikett_code') IS NOT NULL AS da");
  const { rows: [m] } = await c.query(`SELECT coalesce(max(substring(code from '-([0-9]+)$')::int), 0) AS n FROM (
      SELECT code FROM geraet WHERE code LIKE $1 || '-%' ${t.da ? "UNION ALL SELECT code FROM etikett_code WHERE code LIKE $1 || '-%'" : ""}) x`, [k.praefix]);
  let letzte = Math.max(k.letzte_nummer, m.n);
  const codes = [];
  for (let i = 0; i < anzahl; i++) { const n = naechsterGeraetecode(k.praefix, letzte, []); codes.push(n.code); letzte = n.nummer; }
  await c.query("UPDATE kategorie SET letzte_nummer = $1 WHERE id = $2", [letzte, k.id]);
  return codes;
}

/** Legt n Geräte eines Artikels an (Codes nach R-21). */
export async function legeGeraeteAn(c, artikelId, anzahl, w = {}) {
  const { rows: [a] } = await c.query("SELECT id, kategorie_id, verbrauch, ist_leistung FROM artikel WHERE id = $1", [artikelId]);
  if (!a) throw nichtGefunden("Dieser Artikel");
  if (a.verbrauch || a.ist_leistung) throw fehler(400, "Verbrauchsmaterial und Leistungen haben keine Einzelgeräte. Ändere stattdessen den Bestand.");
  if (!Number.isInteger(anzahl) || anzahl < 1 || anzahl > 500) throw fehler(400, "Anzahl muss zwischen 1 und 500 liegen.", { felder: { anzahl: "1 bis 500" } });
  const codes = w.codes || await vergibCodes(c, a.kategorie_id, anzahl);
  const ids = [];
  for (const code of codes) {
    const { rows } = await c.query("INSERT INTO geraet (code, artikel_id) VALUES ($1, $2) RETURNING id", [code, artikelId]);
    ids.push(rows[0].id);
  }
  return { codes, ids };
}

const nurFelder = (body, felder) => Object.fromEntries(felder.filter((f) => body && f in body).map((f) => [f, body[f] === "" ? null : body[f]]));

export function stammdatenModul(router) {
  const M = { bereich: "material" }, G = { bereich: "geraete" }, P = { bereich: "packen" };

  /* ── Kategorien ── */
  router.get("/api/v1/kategorien", { ...M, stufe: "r" }, async (ctx) =>
    (await ctx.pool.query("SELECT k.*, (SELECT count(*) FROM artikel a WHERE a.kategorie_id = k.id) AS artikel FROM kategorie k ORDER BY lower(k.name)")).rows);
  router.get("/api/v1/kategorien/praefix-vorschlag", { ...M, stufe: "r" }, async (ctx) => {
    const { rows } = await ctx.pool.query("SELECT praefix FROM kategorie");
    return { praefix: praefixVorschlag(ctx.query.name || "", rows.map((r) => r.praefix)) };
  });
  router.post("/api/v1/kategorien", M, async (ctx) => {
    const name = String(ctx.body?.name || "").trim();
    if (!name) throw fehler(400, "Gib der Kategorie einen Namen.", { felder: { name: "Name fehlt. Bitte ausfüllen." } });
    let praefix = String(ctx.body?.praefix || "").trim().toUpperCase();
    if (!praefix) praefix = praefixVorschlag(name, (await ctx.pool.query("SELECT praefix FROM kategorie")).rows.map((r) => r.praefix));
    if (!praefixGueltig(praefix)) throw fehler(400, "Das Präfix muss aus 1 bis 4 Buchstaben bestehen.", { felder: { praefix: "1 bis 4 Buchstaben (A–Z)" } });
    try {
      const { rows } = await ctx.pool.query("INSERT INTO kategorie (name, praefix) VALUES ($1, $2) RETURNING *", [name, praefix]);
      ctx.hub?.sende({ typ: "kategorie.geaendert", id: rows[0].id, bereich: "material" });
      return rows[0];
    } catch (e) { throw dbFehler(e, { doppelt: `Name oder Präfix „${praefix}“ ist schon vergeben. Wähle einen anderen.` }); }
  });
  router.put("/api/v1/kategorien/:id", M, async (ctx) => {
    const id = idParam(ctx.params.id, "Diese Kategorie");
    const name = String(ctx.body?.name || "").trim();
    const praefix = String(ctx.body?.praefix || "").trim().toUpperCase();
    if (!name) throw fehler(400, "Gib der Kategorie einen Namen.", { felder: { name: "Name fehlt. Bitte ausfüllen." } });
    if (!praefixGueltig(praefix)) throw fehler(400, "Das Präfix muss aus 1 bis 4 Buchstaben bestehen.", { felder: { praefix: "1 bis 4 Buchstaben (A–Z)" } });
    try {
      const { rows } = await ctx.pool.query("UPDATE kategorie SET name = $1, praefix = $2 WHERE id = $3 RETURNING *", [name, praefix, id]);
      if (!rows[0]) throw nichtGefunden("Diese Kategorie");
      return rows[0];
    } catch (e) {
      if (/Präfix ist schon vergeben/.test(e.message)) throw fehler(409, "Das Präfix ist schon für Gerätecodes verwendet worden und bleibt fest. Lege bei Bedarf eine neue Kategorie an.");
      throw dbFehler(e, { doppelt: `Name oder Präfix „${praefix}“ ist schon vergeben. Wähle einen anderen.` });
    }
  });
  router.delete("/api/v1/kategorien/:id", M, async (ctx) => {
    try {
      const { rowCount } = await ctx.pool.query("DELETE FROM kategorie WHERE id = $1", [idParam(ctx.params.id, "Diese Kategorie")]);
      if (!rowCount) throw nichtGefunden("Diese Kategorie");
      return { ok: true };
    } catch (e) { throw dbFehler(e, { verknuepft: "In dieser Kategorie gibt es noch Artikel. Verschiebe oder lösche sie zuerst." }); }
  });

  /* ── Artikel ── */
  router.get("/api/v1/artikel", { ...M, stufe: "r" }, async (ctx) => {
    const { q, kategorie, typ, aktiv } = ctx.query;
    const { limit, offset } = seite(ctx.query);
    const typFilter = { leistung: "a.ist_leistung", case: "a.ist_case AND NOT a.ist_leistung", verbrauch: "a.verbrauch AND NOT a.ist_case AND NOT a.ist_leistung",
      set: "a.mengenschritt > 1 AND NOT a.verbrauch AND NOT a.ist_case AND NOT a.ist_leistung", kabel: "a.laenge_m IS NOT NULL",
      artikel: "a.mengenschritt = 1 AND NOT a.verbrauch AND NOT a.ist_case AND NOT a.ist_leistung" }[typ] || "true";
    const { rows } = await ctx.pool.query(`SELECT a.*, k.name AS kategorie, k.praefix,
        count(g.id) FILTER (WHERE g.status NOT IN ('ausgemustert','verkauft'))::int AS geraete,
        count(g.id) FILTER (WHERE g.status IN ('lager','zugeordnet','gepackt'))::int AS einsatzfaehig,
        count(*) OVER()::int AS gesamt
      FROM artikel a JOIN kategorie k ON k.id = a.kategorie_id LEFT JOIN geraet g ON g.artikel_id = a.id
      WHERE ($1::text IS NULL OR a.name ILIKE '%' || $1 || '%' OR a.hersteller ILIKE '%' || $1 || '%' OR k.name ILIKE '%' || $1 || '%')
        AND ($2::int IS NULL OR a.kategorie_id = $2) AND ($3::boolean IS NULL OR a.aktiv = $3) AND ${typFilter}
      GROUP BY a.id, k.id ORDER BY lower(k.name), lower(a.name) LIMIT $4 OFFSET $5`,
    [q || null, kategorie ? Number(kategorie) : null, aktiv === undefined ? null : aktiv === "1", limit, offset]);
    return { gesamt: rows[0]?.gesamt || 0, zeilen: rows.map((r) => ({ ...r, gesamt: undefined, typ: artikeltyp(r), niedrig: bestandNiedrig(r) })) };
  });
  router.get("/api/v1/artikel/:id", { ...M, stufe: "r" }, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Artikel");
    const { rows: [a] } = await ctx.pool.query(`SELECT a.*, k.name AS kategorie, k.praefix, i.name AS inhalt_artikel, i.mengenschritt AS inhalt_mengenschritt
      FROM artikel a JOIN kategorie k ON k.id = a.kategorie_id LEFT JOIN artikel i ON i.id = a.inhalt_artikel_id WHERE a.id = $1`, [id]);
    if (!a) throw nichtGefunden("Dieser Artikel");
    const { rows: geraete } = await ctx.pool.query(`SELECT g.id, g.code, g.status, g.projekt_id, g.letzte_pruefung, ${PRUEF_SQL} AS pruefstatus
      FROM geraet g JOIN artikel a ON a.id = g.artikel_id WHERE g.artikel_id = $1 ORDER BY g.code`, [id]);
    return { ...a, typ: artikeltyp(a), niedrig: bestandNiedrig(a), geraete };
  });
  router.post("/api/v1/artikel", M, async (ctx) => transaktion(ctx.pool, async (c) => {
    const w = { mengenschritt: 1, pruefpflichtig: true, pruef_intervall_monate: 12, aktiv: true, ...nurFelder(ctx.body, ARTIKEL_FELDER) };
    const f = pruefeArtikel(w);
    const anzahl = ctx.body?.anzahl == null || ctx.body.anzahl === "" ? 0 : Number(ctx.body.anzahl);
    const kennzeichnung = ctx.body?.kennzeichnung || "keine";
    if (!Number.isInteger(anzahl) || anzahl < 0 || anzahl > 500) f.anzahl = "Anzahl muss zwischen 0 und 500 liegen.";
    if (!["qr", "bestellen", "keine"].includes(kennzeichnung)) f.kennzeichnung = "Wähle QR, Bestellen oder Keine.";
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    const spalten = Object.keys(w);
    let a;
    try {
      ({ rows: [a] } = await c.query(`INSERT INTO artikel (${spalten.join(", ")}) VALUES (${spalten.map((_, i) => "$" + (i + 1)).join(", ")}) RETURNING *`, spalten.map((k) => w[k])));
    } catch (e) { throw dbFehler(e); }
    let geraete = null, bestellung = null;
    // R-72: Kennzeichnung bei Anzahl > 0 (nicht Verbrauch/Leistung)
    if (anzahl > 0 && !a.verbrauch && !a.ist_leistung) {
      if (kennzeichnung === "qr") geraete = await legeGeraeteAn(c, a.id, anzahl);
      else if (kennzeichnung === "bestellen") {
        if (!ctx.etikettenBestellen) throw fehler(501, "Etiketten-Bestellungen sind noch nicht verfügbar. Wähle „QR“ oder „Keine“.");
        bestellung = await ctx.etikettenBestellen(c, ctx, [{ artikelId: a.id, anzahl }]);
      }
    }
    ctx.hub?.sende({ typ: "artikel.geaendert", id: a.id, bereich: "material" });
    return { ok: true, level: "success", text: `Artikel „${a.name}“ angelegt.`, artikel: a, geraete, bestellung };
  }));
  router.put("/api/v1/artikel/:id", M, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Dieser Artikel");
    const { rows: [alt] } = await c.query("SELECT * FROM artikel WHERE id = $1 FOR UPDATE", [id]);
    if (!alt) throw nichtGefunden("Dieser Artikel");
    if (ctx.body?.version != null && ctx.body.version !== alt.version)
      throw fehler(409, "Jemand anderes hat diesen Artikel inzwischen geändert. Lade die Seite neu und trage deine Änderung erneut ein.");
    const w = { ...alt, ...nurFelder(ctx.body, ARTIKEL_FELDER) };
    const f = pruefeArtikel(w);
    if (w.inhalt_artikel_id === id) f.inhalt_artikel_id = "Ein Case kann nicht sich selbst enthalten.";
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    const spalten = ARTIKEL_FELDER;
    try {
      const { rows: [a] } = await c.query(`UPDATE artikel SET ${spalten.map((k, i) => `${k} = $${i + 1}`).join(", ")}, version = version + 1, geaendert = now()
        WHERE id = $${spalten.length + 1} RETURNING *`, [...spalten.map((k) => w[k]), id]);
      ctx.hub?.sende({ typ: "artikel.geaendert", id, version: a.version, bereich: "material" });
      return { ok: true, level: "success", text: "Gespeichert.", artikel: a };
    } catch (e) { throw dbFehler(e); }
  }));
  // FA-02: löschen nur, wenn kein Gerät in einem Projekt belegt ist (vermisste/ausgemusterte zählen nicht).
  router.delete("/api/v1/artikel/:id", M, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Dieser Artikel");
    const { rows: [a] } = await c.query("SELECT name FROM artikel WHERE id = $1 FOR UPDATE", [id]);
    if (!a) throw nichtGefunden("Dieser Artikel");
    const { rows: belegt } = await c.query(`SELECT code FROM geraet WHERE artikel_id = $1 AND projekt_id IS NOT NULL
      AND status NOT IN ('vermisst','ausgemustert') ORDER BY code`, [id]);
    if (belegt.length) throw fehler(409, `„${a.name}“ kann nicht gelöscht werden: ${belegt.length} Gerät(e) sind in Projekten belegt (${belegt.slice(0, 5).map((r) => r.code).join(", ")}${belegt.length > 5 ? " …" : ""}). Gib sie zuerst zurück.`);
    const { rows: [h] } = await c.query("SELECT count(*)::int AS n FROM bewegung b JOIN geraet g ON g.id = b.geraet_id WHERE g.artikel_id = $1", [id]);
    if (h.n) throw fehler(409, `„${a.name}“ hat Geräte mit Verlauf und kann nicht gelöscht werden (Nachweis). Setze den Artikel auf „inaktiv“ und mustere die Geräte aus.`);
    try {
      await c.query("DELETE FROM geraet WHERE artikel_id = $1", [id]);
      await c.query("DELETE FROM artikel WHERE id = $1", [id]);
    } catch (e) { throw dbFehler(e, { verknuepft: `„${a.name}“ wird noch verwendet (z. B. in Angeboten oder als Case-Inhalt). Setze ihn stattdessen auf „inaktiv“.` }); }
    ctx.hub?.sende({ typ: "artikel.geaendert", id, bereich: "material" });
    return { ok: true, level: "success", text: `„${a.name}“ wurde gelöscht.` };
  }));
  // FA-04: Bestand von Verbrauchsmaterial ändern (Bereich packen w).
  router.post("/api/v1/artikel/:id/bestand", P, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Dieser Artikel");
    const { rows: [a] } = await c.query("SELECT id, name, verbrauch, bestand FROM artikel WHERE id = $1 FOR UPDATE", [id]);
    if (!a) throw nichtGefunden("Dieser Artikel");
    if (!a.verbrauch) throw fehler(400, "Nur bei Verbrauchsmaterial gibt es einen Bestand. Bei Geräten zählt die Anzahl der Einzelstücke.");
    const { neu, aenderung } = ctx.body || {};
    const wert = Number.isInteger(neu) ? neu : Number.isInteger(aenderung) ? a.bestand + aenderung : NaN;
    if (!Number.isInteger(wert) || wert < 0) throw fehler(400, "Der Bestand kann nicht unter 0 fallen. Prüfe die Menge.", { felder: { bestand: "mindestens 0" } });
    const { rows: [n] } = await c.query("UPDATE artikel SET bestand = $1, version = version + 1, geaendert = now() WHERE id = $2 RETURNING bestand, mindestbestand, verbrauch", [wert, id]);
    ctx.hub?.sende({ typ: "artikel.geaendert", id, bereich: "material" });
    return { ok: true, level: bestandNiedrig(n) ? "warning" : "success", text: bestandNiedrig(n) ? `Bestand ${wert} gespeichert. Achtung: Mindestbestand erreicht, bitte nachbestellen.` : `Bestand ${wert} gespeichert.`, bestand: wert };
  }));

  /* ── Geräte ── */
  router.post("/api/v1/artikel/:id/geraete", G, async (ctx) => transaktion(ctx.pool, async (c) => {
    const r = await legeGeraeteAn(c, idParam(ctx.params.id, "Dieser Artikel"), Number(ctx.body?.anzahl));
    ctx.hub?.sende({ typ: "geraet.geaendert", bereich: "geraete" });
    return { ok: true, level: "success", text: `${r.codes.length} Gerät(e) angelegt: ${r.codes.join(", ")}.`, ...r };
  }));
  router.get("/api/v1/geraete", { ...G, stufe: "r" }, async (ctx) => {
    const { q, status, pruef, projekt, artikel } = ctx.query;
    const { limit, offset } = seite(ctx.query);
    const qn = q ? normalisiereCode(q) : null;
    const { rows } = await ctx.pool.query(`SELECT * FROM (SELECT g.id, g.code, g.status, g.projekt_id, g.case_id, g.seriennummer, g.alte_pruef_id, g.letzte_pruefung,
        a.id AS artikel_id, a.name AS artikel, k.name AS kategorie, ${PRUEF_SQL} AS pruefstatus, ${NAECHSTE_SQL} AS naechste_pruefung
        FROM geraet g JOIN artikel a ON a.id = g.artikel_id JOIN kategorie k ON k.id = a.kategorie_id) x
      WHERE ($1::text IS NULL OR x.code = $2 OR x.code ILIKE '%' || $1 || '%' OR x.artikel ILIKE '%' || $1 || '%' OR x.seriennummer ILIKE '%' || $1 || '%' OR x.alte_pruef_id = $1)
        AND ($3::text IS NULL OR x.status = $3) AND ($4::text IS NULL OR x.pruefstatus = $4)
        AND ($5::text IS NULL OR ($5 = 'ohne' AND x.projekt_id IS NULL) OR ($5 = 'mit' AND x.projekt_id IS NOT NULL) OR x.projekt_id::text = $5)
        AND ($6::int IS NULL OR x.artikel_id = $6)
      ORDER BY x.code LIMIT $7 OFFSET $8`, [q || null, qn, status || null, pruef || null, projekt || null, artikel ? Number(artikel) : null, limit, offset]);
    return { zeilen: rows };
  });
  const ladeGeraet = async (db, where, wert) => {
    const { rows: [g] } = await db.query(`SELECT g.*, a.name AS artikel, a.pruefpflichtig, a.pruef_intervall_monate, a.ist_case, a.verpackungseinheit,
        a.inhalt_artikel_id, k.name AS kategorie, c.code AS case_code, ${PRUEF_SQL} AS pruefstatus, ${NAECHSTE_SQL} AS naechste_pruefung
      FROM geraet g JOIN artikel a ON a.id = g.artikel_id JOIN kategorie k ON k.id = a.kategorie_id LEFT JOIN geraet c ON c.id = g.case_id WHERE ${where}`, [wert]);
    return g;
  };
  const geraetDetail = async (db, g) => {
    const { rows: bewegungen } = await db.query("SELECT id, aktion, benutzer, mitarbeiter, projekt_id, zeit, coalesce(nullif(mitarbeiter, ''), benutzer) AS wer FROM bewegung WHERE geraet_id = $1 ORDER BY zeit DESC, id DESC LIMIT 200", [g.id]);
    const { rows: inhalt } = await db.query("SELECT g.id, g.code, g.status, a.name AS artikel FROM geraet g JOIN artikel a ON a.id = g.artikel_id WHERE g.case_id = $1 ORDER BY g.code", [g.id]);
    return { ...g, status_text: STATUS[g.status], bewegungen, inhalt };
  };
  router.get("/api/v1/geraete/:id", { ...G, stufe: "r" }, async (ctx) => {
    const g = await ladeGeraet(ctx.pool, "g.id = $1", idParam(ctx.params.id, "Dieses Gerät"));
    if (!g) throw nichtGefunden("Dieses Gerät");
    return geraetDetail(ctx.pool, g);
  });
  // Code-Suche (R-22): normalisiert, findet auch alte Prüf-ID.
  router.get("/api/v1/geraete/code/:code", { ...G, stufe: "r" }, async (ctx) => {
    const roh = ctx.params.code;
    const code = normalisiereCode(roh);
    const g = (await ladeGeraet(ctx.pool, "g.code = $1", code)) || (await ladeGeraet(ctx.pool, "g.alte_pruef_id = $1", roh.trim()));
    if (!g) throw fehler(404, `Kein Gerät mit dem Code ${code} gefunden. Prüfe den Code oder scanne erneut.`);
    return geraetDetail(ctx.pool, g);
  });
  router.put("/api/v1/geraete/:id", G, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Gerät");
    const w = nurFelder(ctx.body, ["seriennummer", "alte_pruef_id", "notizen"]);
    const { rows: [g] } = await ctx.pool.query(`UPDATE geraet SET seriennummer = coalesce($1, seriennummer), alte_pruef_id = coalesce($2, alte_pruef_id),
      notizen = coalesce($3, notizen), version = version + 1 WHERE id = $4 RETURNING id, version`, [w.seriennummer ?? null, w.alte_pruef_id ?? null, w.notizen ?? null, id]);
    if (!g) throw nichtGefunden("Dieses Gerät");
    ctx.hub?.sende({ typ: "geraet.geaendert", id, version: g.version, bereich: "geraete" });
    return { ok: true, level: "success", text: "Gespeichert." };
  });

  /** Statuswechsel mit Bewegung (R-18). Gibt neues Gerät zurück. */
  async function wechsleStatus(ctx, id, nach, { zusatz = "", projektLoesen = false } = {}) {
    return transaktion(ctx.pool, async (c) => {
      const { rows: [g] } = await c.query("SELECT id, code, status, projekt_id FROM geraet WHERE id = $1 FOR UPDATE", [id]);
      if (!g) throw nichtGefunden("Dieses Gerät");
      if (!uebergangErlaubt(g.status, nach))
        throw fehler(409, `Das Gerät ${g.code} ist „${STATUS[g.status]}“ und kann nicht auf „${STATUS[nach] || nach}“ wechseln. Prüfe den Status.`);
      const projekt = projektLoesen || nach === "lager" ? null : g.projekt_id;
      await c.query("UPDATE geraet SET status = $1, projekt_id = $2, version = version + 1 WHERE id = $3", [nach, projekt, id]);
      await bucheBewegung(c, { geraetId: id, projektId: g.projekt_id, aktion: aktionText(g.status, nach, zusatz), ...wer(ctx) });
      ctx.hub?.sende({ typ: "geraet.geaendert", id, bereich: "geraete" });
      return { ok: true, level: "success", text: `${g.code}: ${STATUS[nach]}.`, code: g.code, status: nach };
    });
  }
  router.post("/api/v1/geraete/:id/status", G, async (ctx) => {
    const nach = String(ctx.body?.status || "");
    if (!STATUS[nach]) throw fehler(400, "Wähle einen Status aus der Liste.");
    return wechsleStatus(ctx, idParam(ctx.params.id, "Dieses Gerät"), nach, { zusatz: String(ctx.body?.notiz || "").slice(0, 200) });
  });
  // geprueft/vermisst/gefunden: Bereich packen (Spec 7.1)
  router.post("/api/v1/geraete/:id/vermisst", P, async (ctx) => wechsleStatus(ctx, idParam(ctx.params.id, "Dieses Gerät"), "vermisst", { zusatz: "als vermisst gemeldet" }));
  router.post("/api/v1/geraete/:id/gefunden", P, async (ctx) => wechsleStatus(ctx, idParam(ctx.params.id, "Dieses Gerät"), "lager", { zusatz: "gefunden", projektLoesen: true }));
  router.post("/api/v1/geraete/:id/geprueft", P, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Dieses Gerät");
    const { rows: [g] } = await c.query(`UPDATE geraet SET letzte_pruefung = (now() AT TIME ZONE 'Europe/Berlin')::date, version = version + 1
      WHERE id = $1 RETURNING id, code, projekt_id, letzte_pruefung`, [id]);
    if (!g) throw nichtGefunden("Dieses Gerät");
    await bucheBewegung(c, { geraetId: id, projektId: g.projekt_id, aktion: "Heute geprüft", ...wer(ctx) });
    ctx.hub?.sende({ typ: "geraet.geaendert", id, bereich: "geraete" });
    return { ok: true, level: "success", text: `${g.code} als geprüft eingetragen.`, letzte_pruefung: g.letzte_pruefung };
  }));
  // Case-Inhalt ein-/austragen (FA-03)
  router.post("/api/v1/geraete/:id/inhalt", G, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Dieses Case");
    const { rows: [cs] } = await c.query("SELECT g.id, g.code, a.ist_case FROM geraet g JOIN artikel a ON a.id = g.artikel_id WHERE g.id = $1 FOR UPDATE OF g", [id]);
    if (!cs) throw nichtGefunden("Dieses Case");
    if (!cs.ist_case) throw fehler(400, `${cs.code} ist kein Case. Nur Cases und Taschen können Geräte enthalten.`);
    const code = normalisiereCode(ctx.body?.code);
    const { rows: [g] } = await c.query("SELECT id, code, case_id, projekt_id FROM geraet WHERE code = $1 FOR UPDATE", [code]);
    if (!g) throw fehler(404, `Kein Gerät mit dem Code ${code} gefunden. Prüfe den Code oder scanne erneut.`);
    if (g.id === cs.id) throw fehler(400, "Ein Case kann nicht in sich selbst liegen.");
    const raus = ctx.body?.austragen === true;
    if (raus) {
      if (g.case_id !== cs.id) throw fehler(409, `${g.code} liegt nicht in ${cs.code}.`);
      await c.query("UPDATE geraet SET case_id = NULL, version = version + 1 WHERE id = $1", [g.id]);
      await bucheBewegung(c, { geraetId: g.id, projektId: g.projekt_id, aktion: `Aus Case ${cs.code} ausgetragen`, ...wer(ctx) });
    } else {
      await c.query("UPDATE geraet SET case_id = $1, version = version + 1 WHERE id = $2", [cs.id, g.id]);
      await bucheBewegung(c, { geraetId: g.id, projektId: g.projekt_id, aktion: `In Case ${cs.code} eingetragen`, ...wer(ctx) });
    }
    ctx.hub?.sende({ typ: "geraet.geaendert", id: cs.id, bereich: "geraete" });
    return { ok: true, level: "success", text: raus ? `${g.code} aus ${cs.code} ausgetragen.` : `${g.code} liegt jetzt in ${cs.code}.` };
  }));
  // R-19: Löschen
  router.delete("/api/v1/geraete/:id", G, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Dieses Gerät");
    const { rows: [g] } = await c.query("SELECT id, code, status, projekt_id FROM geraet WHERE id = $1 FOR UPDATE", [id]);
    if (!g) throw nichtGefunden("Dieses Gerät");
    const { rows: [h] } = await c.query("SELECT count(*)::int AS n FROM bewegung WHERE geraet_id = $1", [id]);
    const sperre = loeschSperre(g, h.n);
    if (sperre) throw fehler(409, sperre, { empfehlung: "ausmustern" });
    await c.query("UPDATE geraet SET case_id = NULL WHERE case_id = $1", [id]);
    await c.query("DELETE FROM geraet WHERE id = $1", [id]);
    ctx.hub?.sende({ typ: "geraet.geaendert", id, bereich: "geraete" });
    return { ok: true, level: "success", text: `${g.code} gelöscht. Der Code wird nicht neu vergeben.` };
  }));
}

export { pruefstatus };
