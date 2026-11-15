// Demo-Daten („Beispiel“, ZUSATZ.md Phase 17): `npm run seed -- --seed demo` füllt eine leere Datenbank mit einem
// kleinen, realistischen Betrieb. Alles läuft über die echte API (gleiche Regeln wie in der Oberfläche).
// Jede dabei entstandene Zeile wird in `beispiel` vermerkt; ein Admin kann die Beispieldaten in Verwaltung › System
// wieder löschen. Verweisen eigene Daten darauf, bricht das Löschen mit einer Erklärung ab.
import { erstelleLagerServer } from "./server.js";
import { legeBenutzerAn } from "./grunddaten.js";

export const BEISPIEL_PASSWORT = "Beispiel-Passwort-1";
/** Tabellen, deren Einträge zu Beispieldaten mitgelöscht werden dürfen, auch wenn sie später entstanden (Verlauf). */
const NICHT_VERMERKEN = new Set(["sicherheit_ereignis", "bewegung", "projekt_durchgang"]); // nur anfügen, bleibt als Nachweis
const VERLAUF = new Set(["bewegung", "projekt_durchgang", "aenderung", "planungszeit", "planungszeit_eintrag", "offline_scan", "sitzung", "benachrichtigung", "handoff"]);
const NUR_ANFUEGEN = ["bewegung", "projekt_durchgang"];

const tag = (plus) => {
  const d = new Date(Date.now() + plus * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(d);
};
const objekt = (j) => (j?.id ? j : Object.values(j || {}).find((v) => v && typeof v === "object" && !Array.isArray(v) && v.id));

/** Tabellen mit Spalte id im aktuellen Schema. */
async function tabellenMitId(c) {
  const { rows } = await c.query(`SELECT table_name AS t FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name = 'id' AND data_type IN ('integer', 'bigint') AND table_name <> 'beispiel' ORDER BY 1`);
  return rows.map((r) => r.t);
}
async function hoechsteIds(c) {
  const m = {};
  for (const t of await tabellenMitId(c)) m[t] = Number((await c.query(`SELECT coalesce(max(id), 0) AS n FROM ${t}`)).rows[0].n);
  return m;
}

/**
 * Lädt die Beispieldaten. Nur in eine Datenbank ohne Projekte und Geräte.
 * @param {{pool: import("pg").Pool, config?: object}} opt
 * @returns {Promise<Record<string, number>>} Anzahl neuer Zeilen je Tabelle
 */
export async function ladeBeispiel({ pool, config = {} }) {
  const { rows: [z] } = await pool.query("SELECT (SELECT count(*) FROM projekt)::int + (SELECT count(*) FROM geraet)::int AS n");
  if (z.n > 0) throw new Error("Es gibt schon Projekte oder Geräte. Beispieldaten nur in eine leere Datenbank laden.");
  const app = await erstelleLagerServer({ pool, config });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const vorher = await hoechsteIds(pool);
  try {
    await legeBenutzerAn(pool, { benutzername: "beispiel-admin", passwort: BEISPIEL_PASSWORT, rolle: "Administrator", name: "Alex Admin (Beispiel)" });
    const anmeldung = await (await fetch(`${url}/api/v1/anmelden`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ benutzername: "beispiel-admin", passwort: BEISPIEL_PASSWORT }) })).json();
    if (!anmeldung.token) throw new Error(`Anmeldung für die Beispieldaten fehlgeschlagen: ${anmeldung.text || ""}`);
    const api = async (methode, pfad, body) => {
      const r = await fetch(url + pfad, { method: methode, headers: { "Content-Type": "application/json", Authorization: `Bearer ${anmeldung.token}` }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (r.status >= 300) throw new Error(`${methode} ${pfad}: ${r.status} ${j.text || ""}`);
      return j;
    };
    const neu = async (pfad, body) => objekt(await api("POST", pfad, body));

    // Benutzer je Rolle (Passwort für alle: BEISPIEL_PASSWORT)
    for (const [b, rolle, name] of [["lena", "Lagerleitung", "Lena Lager"], ["tom", "Lager / Techniker", "Tom Technik"],
      ["paula", "Büro / Disposition", "Paula Projekt"], ["platz1", "Lager-Arbeitsplatz", "Arbeitsplatz Halle"]])
      await legeBenutzerAn(pool, { benutzername: b, passwort: BEISPIEL_PASSWORT, rolle, name });

    // Lager: Orte, Zonen, Kategorien, Material mit Geräten
    const regal = await neu("/api/v1/lagerorte", { name: "Regal A1", bereich: "Halle" });
    const kabellager = await neu("/api/v1/lagerorte", { name: "Kabellager", bereich: "Halle" });
    for (const bezeichnung of ["Rampe 1", "Rampe 2", "Halle Mitte"]) await neu("/api/v1/verwaltung/zonen", { bezeichnung });
    const kat = {};
    for (const [name, praefix] of [["Licht", "LI"], ["Ton", "TO"], ["Kabel", "KA"], ["Rigging", "RI"], ["Strom", "ST"], ["Personal", "PE"], ["Verbrauch", "VB"]])
      kat[praefix] = await neu("/api/v1/kategorien", { name, praefix });
    const artikel = async (w) => objekt(await api("POST", "/api/v1/artikel", { kennzeichnung: w.anzahl ? "qr" : "keine", anzahl: 0, ...w }));
    const spot = await artikel({ name: "Akku-Spot", kategorie_id: kat.LI.id, preis_tag: 1500, hersteller: "Lumen", anzahl: 12, lagerort_id: regal.id });
    const par = await artikel({ name: "PAR-Set", kategorie_id: kat.LI.id, preis_tag: 800, mengenschritt: 4, anzahl: 8, lagerort_id: regal.id });
    const mikro = await artikel({ name: "Funkmikrofon", kategorie_id: kat.TO.id, preis_tag: 2500, anzahl: 6 });
    const box = await artikel({ name: "Aktivlautsprecher 12\"", kategorie_id: kat.TO.id, preis_tag: 4500, anzahl: 4, gewicht_kg: 18 });
    const xlr = await artikel({ name: "XLR-Kabel 10 m", kategorie_id: kat.KA.id, preis_tag: 300, anzahl: 20, laenge_m: 10, lagerort_id: kabellager.id });
    const traverse = await artikel({ name: "Traverse 2 m", kategorie_id: kat.RI.id, preis_tag: 2000, anzahl: 6, gewicht_kg: 9 });
    const verteiler = await artikel({ name: "Stromverteiler 32 A", kategorie_id: kat.ST.id, preis_tag: 3500, anzahl: 2 });
    const techniker = await artikel({ name: "Veranstaltungstechniker", kategorie_id: kat.PE.id, ist_leistung: true, preis_tag: 45000, einheit: "Tag" });
    await artikel({ name: "Gaffa-Tape schwarz", kategorie_id: kat.VB.id, verbrauch: true, verkaeuflich: true, verkaufspreis: 1290, bestand: 40, mindestbestand: 10, einheit: "Rolle" });
    // Geräte geprüft, damit Packen ohne Prüfhinweis geht
    await pool.query("UPDATE geraet SET letzte_pruefung = (now() AT TIME ZONE 'Europe/Berlin')::date WHERE id > $1", [vorher.geraet || 0]);

    // Kunden und Projekte
    const kunde = async (w) => neu("/api/v1/kunden", { ...w, notizen: "Beispiel", trotzdem: true });
    const stadt = await kunde({ name: "Jana Becker", firma: "Stadtmarketing Neustadt", email: "events@neustadt.example", telefon: "030 123456", strasse: "Marktplatz 1", plz: "10115", ort: "Berlin" });
    const mueller = await kunde({ name: "Peter Müller", firma: "Müller Maschinenbau GmbH", email: "p.mueller@mueller.example", telefon: "0221 9876", ort: "Köln" });
    const schneider = await kunde({ name: "Familie Schneider", email: "schneider@example.org", telefon: "0171 555123", ort: "Potsdam" });
    const projekt = async (w) => neu("/api/v1/projekte", { notizen: "Beispiel", ...w });
    const fest = await projekt({ name: "Stadtfest Neustadt", kunde_id: stadt.id, beginn: tag(7), ende: tag(9), ort: "Marktplatz Neustadt" });
    const ton = await projekt({ art: "job", name: "Bühne Ton", uebergeordnet_id: fest.id, gewerk: "Ton" });
    const jubi = await projekt({ name: "Firmenjubiläum Müller", kunde_id: mueller.id, beginn: tag(14), ende: tag(14), ort: "Werkshalle Köln" });
    const hochzeit = await projekt({ name: "Hochzeit Schneider", kunde_id: schneider.id, beginn: tag(30), ende: tag(31), ort: "Gut Schwanenwerder" });

    const angebot = async (p, positionen, status = []) => {
      const a = await neu("/api/v1/angebote", { projekt_id: p.id });
      await api("PUT", `/api/v1/angebote/${a.id}`, { version: a.version, betreff: `Veranstaltungstechnik ${p.name}`, positionen: positionen.map((x) => ({ tage: 1, ...x })) });
      for (const s of status) await api("POST", `/api/v1/angebote/${a.id}/status`, { status: s });
      return a;
    };
    const miete = (a, menge) => ({ art: "miete", artikel_id: a.id, bezeichnung: a.name, menge, einzelpreis: a.preis_tag });
    await angebot(fest, [miete(spot, 8), miete(par, 4), miete(traverse, 4), miete(verteiler, 1),
      { art: "frei", artikel_id: techniker.id, bezeichnung: techniker.name, menge: 2, einzelpreis: 45000, stunden: 8 }], ["versendet", "angenommen"]);
    await angebot(ton, [miete(mikro, 4), miete(box, 2), miete(xlr, 10)], ["versendet", "angenommen"]);
    await angebot(jubi, [miete(spot, 6), miete(box, 2), miete(mikro, 2)], ["versendet"]);
    await angebot(hochzeit, [miete(spot, 4), miete(box, 2)]);

    // Aufgaben, Personal, Fahrzeug
    const ich = (await api("GET", "/api/v1/ich")).nutzer;
    await api("POST", `/api/v1/projekte/${fest.id}/aufgaben`, { text: "Genehmigung Ordnungsamt prüfen", faellig: tag(3), zugewiesen_id: ich?.id });
    await api("POST", `/api/v1/projekte/${jubi.id}/aufgaben`, { text: "Hallenplan beim Kunden anfragen", faellig: tag(5) });
    await api("POST", `/api/v1/projekte/${hochzeit.id}/aufgaben`, { text: "Angebot nachfassen", faellig: tag(10) });
    await neu("/api/v1/personal", { name: "Mia Meister", art: "mitarbeiter", qualifikationen: "Ton, Licht", telefon: "0170 1111" });
    await neu("/api/v1/personal", { name: "Jonas Frei", art: "freelancer", qualifikationen: "Rigging", tagessatz: 30000 });
    await neu("/api/v1/fahrzeuge", { name: "Sprinter 1", kennzeichen: "B-LG 101", zuladung_kg: 1200 });
    await neu("/api/v1/verwaltung/mitarbeiter", { name: "Kai Kommissionierer", pin: "1234" });
  } finally {
    app.server.closeAllConnections?.();
    await new Promise((r) => app.server.close(r));
    app.kontext?.hub?.wss?.close?.();
  }
  // Alles Neue vermerken (auch Positionen, Codes, Protokoll), damit es sich später vollständig löschen lässt
  const anzahl = {};
  for (const [t, max] of Object.entries(await hoechsteIds(pool))) {
    if (NICHT_VERMERKEN.has(t)) continue;
    const { rowCount } = await pool.query(`INSERT INTO beispiel (tabelle, datensatz_id) SELECT $1, id FROM ${t} WHERE id > $2 ON CONFLICT DO NOTHING`, [t, vorher[t] ?? 0]);
    if (rowCount && max > (vorher[t] ?? 0)) anzahl[t] = rowCount;
  }
  return anzahl;
}

/** Wie viele Beispiel-Zeilen gibt es noch? */
export async function beispielStand(db) {
  const { rows: [r] } = await db.query("SELECT count(*)::int AS n FROM beispiel");
  return r.n;
}

/** Fremdschlüssel, die auf `tabelle` zeigen: [{kind, spalte}] (nur einspaltige). */
async function verweise(c, tabelle) {
  const { rows } = await c.query(`SELECT cl.relname AS kind, a.attname AS spalte FROM pg_constraint k
    JOIN pg_class cl ON cl.oid = k.conrelid JOIN pg_class ziel ON ziel.oid = k.confrelid JOIN pg_namespace n ON n.oid = ziel.relnamespace
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    WHERE k.contype = 'f' AND ziel.relname = $1 AND n.nspname = current_schema() AND array_length(k.conkey, 1) = 1`, [tabelle]);
  return rows;
}

/**
 * Löscht alle Beispieldaten samt späterem Verlauf (Bewegungen, Durchgänge) in einer Transaktion.
 * Verweisen eigene (nicht vermerkte) Daten auf Beispiel-Zeilen, bricht es ab und nennt sie.
 * @param {import("pg").PoolClient} c Verbindung in einer Transaktion
 * @returns {Promise<number>} gelöschte Beispiel-Zeilen
 */
export async function loescheBeispiel(c) {
  const { rows } = await c.query("SELECT tabelle, array_agg(datensatz_id) AS ids FROM beispiel GROUP BY tabelle");
  const offen = new Map(rows.map((r) => [r.tabelle, new Set(r.ids.map(Number))]));
  // Eigene Daten, die auf Beispiel-Zeilen verweisen?
  const fremd = [];
  for (const [t, ids] of offen) for (const v of await verweise(c, t)) {
    if (VERLAUF.has(v.kind)) continue;
    const mitId = (await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'id' AND data_type IN ('integer', 'bigint')", [v.kind])).rowCount > 0;
    const { rows: [f] } = await c.query(`SELECT count(*)::int AS n FROM ${v.kind} x WHERE x.${v.spalte} = ANY($1::int[])
      ${mitId ? "AND NOT EXISTS (SELECT 1 FROM beispiel b WHERE b.tabelle = $2 AND b.datensatz_id = x.id)" : "AND $2::text IS NOT NULL"}`, [[...ids], v.kind]);
    if (f.n) fremd.push(`${f.n} × ${v.kind}`);
  }
  if (fremd.length) {
    const e = new Error(`Eigene Daten verweisen noch auf Beispieldaten (${[...new Set(fremd)].join(", ")}). Lösche oder ändere sie zuerst, dann klappt es.`);
    e.status = 409;
    throw e;
  }
  for (const t of NUR_ANFUEGEN) await c.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
  // Verlauf zu Beispiel-Zeilen zuerst
  for (const [t, ids] of offen) for (const v of await verweise(c, t)) if (VERLAUF.has(v.kind) && !offen.has(v.kind)) await c.query(`DELETE FROM ${v.kind} WHERE ${v.spalte} = ANY($1)`, [[...ids]]);
  // Dann die Beispiel-Zeilen, Kinder vor Eltern: wiederholen, bis nichts mehr hängt
  let geloescht = 0;
  for (let runde = 0; runde < 30 && [...offen.values()].some((s) => s.size); runde++) {
    for (const [t, ids] of offen) {
      if (!ids.size) continue;
      await c.query("SAVEPOINT bsp");
      try {
        const { rowCount } = await c.query(`DELETE FROM ${t} WHERE id = ANY($1)`, [[...ids]]);
        geloescht += rowCount; ids.clear();
        await c.query("RELEASE SAVEPOINT bsp");
      } catch (e) {
        await c.query("ROLLBACK TO SAVEPOINT bsp");
        if (e.code !== "23503") throw e;
        if (t === "projekt") { // Jobs vor ihrem Projekt (Selbstverweis mit RESTRICT)
          await c.query("SAVEPOINT job");
          try {
            const { rows: jobs } = await c.query("DELETE FROM projekt WHERE id = ANY($1) AND uebergeordnet_id IS NOT NULL RETURNING id", [[...ids]]);
            for (const j of jobs) ids.delete(j.id);
            geloescht += jobs.length;
            await c.query("RELEASE SAVEPOINT job");
          } catch { await c.query("ROLLBACK TO SAVEPOINT job"); }
        }
      }
    }
  }
  for (const t of NUR_ANFUEGEN) await c.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
  const rest = [...offen].filter(([, s]) => s.size).map(([t]) => t);
  if (rest.length) throw new Error(`Beispieldaten ließen sich nicht ganz löschen (${rest.join(", ")}). Melde das bitte mit diesem Text.`);
  await c.query("DELETE FROM beispiel");
  return geloescht;
}
