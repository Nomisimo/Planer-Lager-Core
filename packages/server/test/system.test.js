import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { standardUrl } from "@lager/db";
import { starteTestServer } from "./helfer.js";
import { schreibeZip, leseZip } from "../src/zip.js";
import { autoSicherung, listeSicherungen, raeumeAuf, sicherungsOrdner } from "../src/sicherung.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");
let s, admin, buero, neustarts = 0;
const q = (sql, w) => s.db.pool.query(sql, w);
before(async () => {
  s = await starteTestServer({ config: { neustartErlaubt: true, beiNeustart: () => { neustarts++; } } });
  admin = await s.als("admin8", "Administrator");
  buero = await s.als("buero", "Büro / Disposition");
});
after(async () => { await s.ende(); });

test("FA-49 ZIP-Helfer: schreiben, lesen, Prüfsumme erkennt Beschädigung", () => {
  const z = schreibeZip([{ name: "a.txt", daten: "Hallo Köln" }, { name: "b/c.bin", daten: Buffer.from([0, 1, 2, 255]) }]);
  const l = leseZip(z);
  assert.deepEqual(l.map((e) => e.name), ["a.txt", "b/c.bin"]);
  assert.equal(l[0].daten.toString("utf8"), "Hallo Köln");
  const kaputt = Buffer.from(z); kaputt[40] ^= 0xff;
  assert.throws(() => leseZip(kaputt));
});

test("T-22 FA-49 NFA-04 Sicherung erstellen, prüfen, per Befehl restore wiederherstellen: Daten identisch, Vorab-Sicherung existiert", async () => {
  const k = (await buero("POST", "/api/v1/kunden", { name: "Anna Müller", firma: "Stadtwerke Köln" })).json.kunde;
  const p = (await buero("POST", "/api/v1/projekte", { name: "Stadtfest", kunde_id: k.id, beginn: "2027-05-01" })).json.projekt;
  fs.mkdirSync(path.join(s.dataDir, "projekte", String(p.id)), { recursive: true });
  fs.writeFileSync(path.join(s.dataDir, "projekte", String(p.id), "plan.txt"), "Bühnenplan");
  const vorher = async () => ({
    kunden: (await q("SELECT id, name, firma FROM kunde ORDER BY id")).rows,
    projekte: (await q("SELECT id, nummer, name, kunde_id, beginn::text FROM projekt ORDER BY id")).rows,
  });
  const stand = await vorher();
  assert.equal((await buero("POST", "/api/v1/verwaltung/sicherungen")).status, 403, "nur Admin");
  const r = (await admin("POST", "/api/v1/verwaltung/sicherungen")).json;
  assert.equal(r.ok, true, r.text);
  assert.match(r.pruefung.text, /In Ordnung: \d+ Tabellen, \d+ Datensätze, 1 Dateien/);
  assert.match(r.name, /^lager-\d{4}-\d{2}-\d{2}_\d{6}\.zip$/);
  // Download
  const dl = await fetch(`${s.url}/api/v1/verwaltung/sicherungen/${r.name}`, { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(dl.headers.get("content-type"), "application/zip");
  assert.equal(leseZip(Buffer.from(await dl.arrayBuffer())).some((e) => e.name === `dateien/projekte/${p.id}/plan.txt`), true);
  assert.equal((await admin("GET", "/api/v1/verwaltung/sicherungen/..%2F..%2Fetc%2Fpasswd")).status, 400);
  // Daten ändern, Datei löschen, danach per Befehl wiederherstellen
  await buero("PUT", `/api/v1/kunden/${k.id}`, { name: "Geändert", firma: "" });
  await q("INSERT INTO kunde (name) VALUES ('Neu nach Sicherung')");
  fs.rmSync(path.join(s.dataDir, "projekte"), { recursive: true });
  const env = { ...process.env, DATABASE_URL_DEV: standardUrl(), DATA_DIR: s.dataDir, LAGER_DB_SCHEMA: s.db.schema, LAGER_ABSICHERN: "0" };
  const { stdout } = await promisify(execFile)(process.execPath, [CLI, "restore", r.name], { env });
  assert.match(stdout, /Wiederhergestellt\. Vorab-Sicherung: lager-.*-vor-wiederherstellung\.zip/);
  assert.deepEqual(await vorher(), stand, "Daten identisch");
  assert.equal(fs.readFileSync(path.join(s.dataDir, "projekte", String(p.id), "plan.txt"), "utf8"), "Bühnenplan");
  assert.equal(listeSicherungen(s.config).filter((x) => x.vorab).length, 1, "Vorab-Sicherung existiert");
  // Sequenzen weitergesetzt: neuer Kunde bekommt eine neue Nummer
  const k2 = (await q("INSERT INTO kunde (name) VALUES ('Danach') RETURNING id")).rows[0];
  assert.ok(k2.id > k.id);
  // Sitzungen beendet → neu anmelden
  assert.equal((await admin("GET", "/api/v1/ich")).status, 401);
  admin = await s.als("admin8", "Administrator");
  buero = await s.als("buero", "Büro / Disposition");
});

test("FA-49 Prüfung erkennt beschädigte Sicherung; Wiederherstellung über die Oberfläche nur mit Bestätigung (SOLL P2)", async () => {
  const r = (await admin("POST", "/api/v1/verwaltung/sicherungen")).json;
  const d = path.join(sicherungsOrdner(s.config), r.name);
  const ok = (await admin("POST", `/api/v1/verwaltung/sicherungen/${r.name}/pruefen`)).json;
  assert.equal(ok.ok, true);
  const nein = await admin("POST", `/api/v1/verwaltung/sicherungen/${r.name}/wiederherstellen`, { bestaetigung: "ja" });
  assert.equal(nein.status, 400);
  assert.match(nein.json.text, /WIEDERHERSTELLEN/);
  const w = (await admin("POST", `/api/v1/verwaltung/sicherungen/${r.name}/wiederherstellen`, { bestaetigung: "WIEDERHERSTELLEN" })).json;
  assert.equal(w.ok, true, w.text);
  assert.match(w.vorab, /vor-wiederherstellung/);
  admin = await s.als("admin8", "Administrator");
  buero = await s.als("buero", "Büro / Disposition");
  const b = fs.readFileSync(d); b[b.length - 60] ^= 0xff; b[100] ^= 0xff; fs.writeFileSync(d, b);
  const schlecht = (await admin("POST", `/api/v1/verwaltung/sicherungen/${r.name}/pruefen`)).json;
  assert.equal(schlecht.ok, false);
  assert.equal((await admin("POST", `/api/v1/verwaltung/sicherungen/${r.name}/wiederherstellen`, { bestaetigung: "WIEDERHERSTELLEN" })).status, 409);
  fs.rmSync(d);
});

test("FA-49 Aufbewahrung (Vorab-Sicherungen bleiben), Zweitkopie, automatisch beim Start nur wenn letzte > 20 h", async () => {
  const zweit = fs.mkdtempSync(path.join(os.tmpdir(), "lager-zweit-"));
  await admin("PUT", "/api/v1/verwaltung/einstellungen", { backup_zweitordner: zweit, backup_behalten: 2 });
  for (let i = 0; i < 3; i++) await admin("POST", "/api/v1/verwaltung/sicherungen");
  const l = listeSicherungen(s.config);
  assert.equal(l.filter((x) => !x.vorab).length, 2, "nur die letzten 2");
  assert.equal(l.filter((x) => x.vorab).length >= 2, true, "Vorab-Sicherungen bleiben");
  assert.ok(fs.readdirSync(zweit).length >= 2, "Zweitkopie");
  assert.equal(raeumeAuf(s.config, 2).length, 0);
  assert.equal(await autoSicherung(s.db.pool, s.config), null, "frische Sicherung → keine neue");
  assert.ok(await autoSicherung(s.db.pool, s.config, Date.now() + 21 * 3600_000), "älter als 20 h → neue Sicherung");
  await admin("PUT", "/api/v1/verwaltung/einstellungen", { backup_zweitordner: "", backup_behalten: 14 });
  fs.rmSync(zweit, { recursive: true, force: true });
});

test("FA-50 Sicherheits-Check und Dateirechte absichern; FA-51 Ping, Wartung, Neustart", async () => {
  fs.writeFileSync(path.join(s.dataDir, "offen.txt"), "x", { mode: 0o644 });
  fs.chmodSync(path.join(s.dataDir, "offen.txt"), 0o644);
  let c = (await admin("GET", "/api/v1/verwaltung/sicherheit/check")).json;
  assert.equal(c.find((z) => z.id === "dateirechte").level, "warning");
  assert.ok(["https", "2fa", "sicherung", "zweitort", "logins"].every((id) => c.some((z) => z.id === id)));
  assert.match((await admin("POST", "/api/v1/verwaltung/sicherheit/absichern")).json.text, /abgesichert/);
  assert.equal(fs.statSync(path.join(s.dataDir, "offen.txt")).mode & 0o777, 0o600);
  c = (await admin("GET", "/api/v1/verwaltung/sicherheit/check")).json;
  assert.equal(c.find((z) => z.id === "dateirechte").level, "ok");
  // Ping ohne Anmeldung
  const ping = await s.api("GET", "/api/v1/ping");
  assert.equal(ping.status, 200);
  // Wartung: Nicht-Admins bekommen 503 mit Text, Admin arbeitet weiter, bleibt über Neustart (DB)
  await admin("PUT", "/api/v1/verwaltung/system/wartung", { aktiv: true, text: "Update bis 14 Uhr." });
  const w = await buero("GET", "/api/v1/kunden");
  assert.equal(w.status, 503);
  assert.equal(w.json.text, "Update bis 14 Uhr.");
  assert.equal((await buero("GET", "/api/v1/ich")).status, 200, "Konto-Info geht weiter");
  assert.equal((await admin("GET", "/api/v1/kunden")).status, 200);
  assert.equal((await q("SELECT wert FROM system_zustand WHERE schluessel = 'wartung'")).rows[0].wert.aktiv, true);
  await admin("PUT", "/api/v1/verwaltung/system/wartung", { aktiv: false });
  assert.equal((await buero("GET", "/api/v1/kunden")).status, 200);
  assert.equal((await buero("POST", "/api/v1/verwaltung/system/neustart")).status, 403);
  const n = (await admin("POST", "/api/v1/verwaltung/system/neustart")).json;
  assert.match(n.text, /startet neu/);
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(neustarts, 1);
});

test("NFA-04 verschlüsselte Sicherung (AES-256-GCM): Inhalt unlesbar ohne Schlüssel, Prüfung + Wiederherstellung mit Schlüssel", async () => {
  s.config.backupSchluessel = "Geheimer-Sicherungsschluessel-1";
  try {
    const r = (await admin("POST", "/api/v1/verwaltung/sicherungen")).json;
    assert.equal(r.ok, true, r.text);
    assert.match(r.name, /\.zip\.enc$/);
    const d = path.join(sicherungsOrdner(s.config), r.name);
    const roh = fs.readFileSync(d);
    assert.equal(roh.subarray(0, 9).toString(), "LAGERENC1");
    assert.throws(() => leseZip(roh), "ohne Entschlüsseln keine ZIP");
    assert.ok(!roh.includes(Buffer.from("benutzername")), "kein Klartext");
    assert.equal((await admin("POST", `/api/v1/verwaltung/sicherungen/${r.name}/pruefen`)).json.ok, true);
    const env = { ...process.env, DATABASE_URL_DEV: standardUrl(), DATA_DIR: s.dataDir, LAGER_DB_SCHEMA: s.db.schema, LAGER_ABSICHERN: "0" };
    const falsch = await promisify(execFile)(process.execPath, [CLI, "pruefen", r.name], { env: { ...env, BACKUP_SCHLUESSEL: "falsch" } }).catch((e) => e);
    assert.match(falsch.stdout, /falscher Schlüssel/);
    const ohne = await promisify(execFile)(process.execPath, [CLI, "pruefen", r.name], { env }).catch((e) => e);
    assert.match(ohne.stdout, /verschlüsselt/);
    const { stdout } = await promisify(execFile)(process.execPath, [CLI, "restore", r.name], { env: { ...env, BACKUP_SCHLUESSEL: "Geheimer-Sicherungsschluessel-1" } });
    assert.match(stdout, /Wiederhergestellt/);
    admin = await s.als("admin8", "Administrator");
  } finally { s.config.backupSchluessel = ""; }
});
