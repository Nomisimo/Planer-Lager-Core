// Datensicherung (FA-49, NFA-04): Datenbank (alle Tabellen als JSON) + Dateien im Datenordner in einer ZIP-Datei,
// Prüfung jeder Sicherung, Aufbewahrung, Zweitort, automatisch beim Start, Wiederherstellung mit Vorab-Sicherung.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { transaktion } from "@lager/db";
import { schreibeZip, leseZip } from "./zip.js";
import { ladeEinstellungen } from "./verwaltung.js";

export const SICHERUNG_ORDNER = "sicherungen";
export const AUTO_STUNDEN = 20;
export const VORAB = "vor-wiederherstellung";
/** Sitzungen gehören nicht zur Sicherung (nach einer Wiederherstellung melden sich alle neu an). */
const OHNE = new Set(["sitzung"]);
const NAME_RE = /^lager-\d{4}-\d{2}-\d{2}_\d{6}(-[a-z0-9-]+)?\.zip(\.enc)?$/;

export const datenOrdner = (config) => path.resolve(config?.dataDir || "./data");
export const sicherungsOrdner = (config) => path.join(datenOrdner(config), SICHERUNG_ORDNER);

/** Prüft einen Dateinamen aus einer Anfrage (kein Pfad, nur echte Sicherungsnamen). */
export const gueltigerName = (n) => typeof n === "string" && NAME_RE.test(n);

/*
 * NFA-04 Verschlüsselung (Cloud): AES-256-GCM, Schlüssel per scrypt aus BACKUP_SCHLUESSEL.
 * Format: "LAGERENC1" | salt (16) | iv (12) | tag (16) | Daten. Ohne Schlüssel bleibt die ZIP unverschlüsselt (lokaler Betrieb).
 */
const KOPF = Buffer.from("LAGERENC1");
export function verschluessele(daten, passwort) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", crypto.scryptSync(passwort, salt, 32), iv);
  const enc = Buffer.concat([c.update(daten), c.final()]);
  return Buffer.concat([KOPF, salt, iv, c.getAuthTag(), enc]);
}
export function entschluessele(buf, passwort) {
  if (!buf.subarray(0, KOPF.length).equals(KOPF)) return buf; // unverschlüsselte Sicherung
  if (!passwort) throw new Error("Die Sicherung ist verschlüsselt. Setze BACKUP_SCHLUESSEL auf den Schlüssel, mit dem sie erstellt wurde.");
  let o = KOPF.length;
  const salt = buf.subarray(o, o += 16), iv = buf.subarray(o, o += 12), tag = buf.subarray(o, o += 16);
  const d = crypto.createDecipheriv("aes-256-gcm", crypto.scryptSync(passwort, salt, 32), iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(buf.subarray(o)), d.final()]); }
  catch { throw new Error("Entschlüsseln fehlgeschlagen: falscher Schlüssel oder beschädigte Datei."); }
}
/** Liest eine Sicherung (entschlüsselt bei Bedarf) als ZIP-Puffer. */
export const leseSicherungsdatei = (datei, config) => entschluessele(fs.readFileSync(datei), config?.backupSchluessel);

function zeitstempel(d = new Date()) {
  const t = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(d);
  return t.replace(" ", "_").replace(/:/g, "");
}

/** Tabellen in Einfüge-Reihenfolge (Fremdschlüssel zuerst). */
async function tabellen(c) {
  const { rows: t } = await c.query("SELECT tablename AS n FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename");
  const { rows: fk } = await c.query(`SELECT cl.relname AS von, ref.relname AS nach FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid JOIN pg_class ref ON ref.oid = co.confrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace WHERE co.contype = 'f' AND ns.nspname = current_schema() AND cl.relname <> ref.relname`);
  const namen = t.map((r) => r.n).filter((n) => !OHNE.has(n));
  const braucht = new Map(namen.map((n) => [n, new Set()]));
  for (const f of fk) if (braucht.has(f.von) && braucht.has(f.nach)) braucht.get(f.von).add(f.nach);
  const fertig = [], gesehen = new Set();
  const besuche = (n, kette = new Set()) => {
    if (gesehen.has(n)) return;
    if (kette.has(n)) throw new Error(`Zyklische Fremdschlüssel bei Tabelle ${n}.`);
    kette.add(n);
    for (const m of braucht.get(n)) besuche(m, kette);
    kette.delete(n); gesehen.add(n); fertig.push(n);
  };
  for (const n of namen) besuche(n);
  return fertig;
}

const id = (n) => `"${n.replace(/"/g, '""')}"`;

/** Alle Dateien unter dem Datenordner (ohne Sicherungen), relativ. */
function dateienListe(basis, rel = "") {
  const ordner = path.join(basis, rel);
  if (!fs.existsSync(ordner)) return [];
  const out = [];
  for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!rel && e.name === SICHERUNG_ORDNER) continue;
    if (e.isDirectory()) out.push(...dateienListe(basis, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** Sicherungen im Ordner, neueste zuerst. */
export function listeSicherungen(config) {
  const o = sicherungsOrdner(config);
  if (!fs.existsSync(o)) return [];
  return fs.readdirSync(o).filter(gueltigerName).sort().reverse().map((name) => {
    const st = fs.statSync(path.join(o, name));
    return { name, groesse: st.size, erstellt: st.mtime.toISOString(), vorab: name.includes(VORAB) };
  });
}

/**
 * FA-49 Prüfung: ZIP lesbar (Prüfsummen), Inhaltsverzeichnis vorhanden, Datenbank-Teil lesbar und vollständig.
 * @returns {{ok: boolean, text: string, tabellen?: number, zeilen?: number, dateien?: number}}
 */
export function pruefeSicherung(datei, config) {
  try {
    const eintraege = leseZip(leseSicherungsdatei(datei, config));
    const finde = (n) => eintraege.find((e) => e.name === n);
    const m = JSON.parse(finde("manifest.json")?.daten.toString("utf8") || "null");
    if (!m) return { ok: false, text: "Inhaltsverzeichnis (manifest.json) fehlt." };
    const db = JSON.parse(finde("datenbank.json")?.daten.toString("utf8") || "null");
    if (!db?.tabellen) return { ok: false, text: "Datenbank-Teil fehlt oder ist unlesbar." };
    for (const [t, n] of Object.entries(m.zeilen)) if ((db.tabellen[t] || []).length !== n) return { ok: false, text: `Tabelle ${t}: ${db.tabellen[t]?.length ?? 0} statt ${n} Zeilen.` };
    const dateien = eintraege.filter((e) => e.name.startsWith("dateien/")).length;
    if (dateien !== m.dateien) return { ok: false, text: `${dateien} statt ${m.dateien} Dateien.` };
    const zeilen = Object.values(m.zeilen).reduce((a, b) => a + b, 0);
    return { ok: true, text: `In Ordnung: ${Object.keys(m.zeilen).length} Tabellen, ${zeilen} Datensätze, ${dateien} Dateien.`, tabellen: Object.keys(m.zeilen).length, zeilen, dateien };
  } catch (e) {
    return { ok: false, text: `Sicherung unlesbar: ${e.message}` };
  }
}

/** Aufbewahrung: nur die letzten `behalten` normalen Sicherungen; Vorab-Sicherungen bleiben immer. */
export function raeumeAuf(config, behalten) {
  const normal = listeSicherungen(config).filter((s) => !s.vorab);
  const weg = normal.slice(Math.max(1, behalten));
  for (const s of weg) fs.rmSync(path.join(sicherungsOrdner(config), s.name), { force: true });
  return weg.map((s) => s.name);
}

/**
 * Erstellt, prüft und kopiert eine Sicherung. art: "" (normal) | "auto" | VORAB.
 * @returns {Promise<{name, datei, groesse, pruefung, zweitkopie: {ok, text}|null, geloescht: string[]}>}
 */
export async function erstelleSicherung(pool, config, { art = "" } = {}) {
  const basis = datenOrdner(config);
  const db = await transaktion(pool, async (c) => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const out = {};
    out.__stand = (await c.query("SELECT coalesce(max(nr), 0)::int AS n FROM schema_migration")).rows[0].n;
    for (const t of await tabellen(c)) out[t] = (await c.query(`SELECT coalesce(json_agg(x), '[]'::json) AS d FROM ${id(t)} x`)).rows[0].d;
    return out;
  });
  const stand = db.__stand; delete db.__stand;
  const dateien = dateienListe(basis);
  const manifest = { format: 1, stand, erstellt: new Date().toISOString(), art: art || "manuell", zeilen: Object.fromEntries(Object.entries(db).map(([t, r]) => [t, r.length])), dateien: dateien.length };
  const zip = schreibeZip([
    { name: "manifest.json", daten: JSON.stringify(manifest, null, 1) },
    { name: "datenbank.json", daten: JSON.stringify({ format: 1, tabellen: db }) },
    ...dateien.map((d) => ({ name: `dateien/${d}`, daten: fs.readFileSync(path.join(basis, d)) })),
  ]);
  const ordner = sicherungsOrdner(config);
  fs.mkdirSync(ordner, { recursive: true, mode: 0o700 });
  const stamm = `lager-${zeitstempel()}${art && art !== "auto" ? `-${art}` : ""}`;
  const endung = config.backupSchluessel ? ".zip.enc" : ".zip";
  let name = `${stamm}${endung}`;
  for (let i = 2; fs.existsSync(path.join(ordner, name)); i++) name = `${stamm}-${i}${endung}`;
  const datei = path.join(ordner, name);
  const inhalt = config.backupSchluessel ? verschluessele(zip, config.backupSchluessel) : zip;
  fs.writeFileSync(datei, inhalt, { mode: 0o600 });
  const pruefung = pruefeSicherung(datei, config);
  const e = await ladeEinstellungen(pool);
  let zweitkopie = null;
  if (e.backup_zweitordner) {
    try {
      fs.mkdirSync(e.backup_zweitordner, { recursive: true });
      fs.copyFileSync(datei, path.join(e.backup_zweitordner, name));
      zweitkopie = { ok: true, text: `Zweitkopie in ${e.backup_zweitordner}.` };
    } catch (err) {
      zweitkopie = { ok: false, text: `Zweitkopie fehlgeschlagen (${err.code || err.message}). Prüfe den Zweitordner in den Einstellungen.` };
    }
  }
  const geloescht = raeumeAuf(config, e.backup_behalten);
  return { name, datei, groesse: inhalt.length, verschluesselt: !!config.backupSchluessel, pruefung, zweitkopie, geloescht };
}

/** FA-49: beim Start sichern, wenn die letzte Sicherung älter als 20 Stunden ist (oder keine da). */
export async function autoSicherung(pool, config, jetzt = Date.now()) {
  const letzte = listeSicherungen(config).find((s) => !s.vorab);
  if (letzte && jetzt - new Date(letzte.erstellt).getTime() < AUTO_STUNDEN * 3600_000) return null;
  return erstelleSicherung(pool, config, { art: "auto" });
}

/**
 * Wiederherstellung (FA-49, T-22): erst Vorab-Sicherung, dann Datenbank und Dateien ersetzen.
 * @returns {Promise<{vorab: string, pruefung: object}>}
 */
export async function stelleWiederHer(pool, config, datei) {
  const p = pruefeSicherung(datei, config);
  if (!p.ok) throw Object.assign(new Error(`Diese Sicherung ist nicht in Ordnung: ${p.text}`), { status: 409 });
  const eintraege = leseZip(leseSicherungsdatei(datei, config));
  const { tabellen: daten } = JSON.parse(eintraege.find((e) => e.name === "datenbank.json").daten.toString("utf8"));
  const m = JSON.parse(eintraege.find((e) => e.name === "manifest.json").daten.toString("utf8"));
  const { rows: [st] } = await pool.query("SELECT coalesce(max(nr), 0)::int AS n FROM schema_migration");
  if (m.stand !== st.n) throw Object.assign(new Error(`Die Sicherung hat Datenbank-Stand ${m.stand}, der Server ${st.n}. Stelle sie mit der passenden Programmversion wieder her.`), { status: 409 });
  const vorab = await erstelleSicherung(pool, config, { art: VORAB });
  await transaktion(pool, async (c) => {
    const reihe = await tabellen(c);
    await c.query(`TRUNCATE ${reihe.map(id).join(", ")}, sitzung RESTART IDENTITY CASCADE`);
    for (const t of reihe) {
      const zeilen = daten[t] || [];
      if (zeilen.length) await c.query(`INSERT INTO ${id(t)} SELECT * FROM json_populate_recordset(NULL::${id(t)}, $1::json)`, [JSON.stringify(zeilen)]);
      const { rows: spalten } = await c.query(`SELECT a.attname AS s, pg_get_serial_sequence($1, a.attname) AS seq FROM pg_attribute a
        WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`, [id(t)]);
      for (const sp of spalten.filter((x) => x.seq)) await c.query(`SELECT setval($1, coalesce((SELECT max(${id(sp.s)}) FROM ${id(t)}), 0) + 1, false)`, [sp.seq]);
    }
  });
  // Dateien ersetzen (Sicherungen bleiben)
  const basis = datenOrdner(config);
  for (const d of dateienListe(basis)) fs.rmSync(path.join(basis, d), { force: true });
  for (const e of eintraege.filter((x) => x.name.startsWith("dateien/"))) {
    const rel = e.name.slice(8);
    const ziel = path.resolve(basis, rel);
    if (!ziel.startsWith(basis + path.sep)) continue; // kein Pfad aus dem Datenordner heraus
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, e.daten, { mode: 0o600 });
  }
  return { vorab: vorab.name, pruefung: p };
}
