import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer, PW } from "./helfer.js";

let s, admin;
before(async () => { s = await starteTestServer(); admin = await s.als("admin"); });
after(async () => { await s.ende(); });

test("FA-48 Einstellungen: genau ein Datensatz, Standardwerte, Speichern mit Prüfung", async () => {
  const e = await admin("GET", "/api/v1/verwaltung/einstellungen");
  assert.equal(e.json.angebot_gueltig_tage, 14);
  const f = await admin("PUT", "/api/v1/verwaltung/einstellungen", { angebot_gueltig_tage: 0 });
  assert.equal(f.status, 400);
  assert.ok(f.json.felder.angebot_gueltig_tage);
  const ok = await admin("PUT", "/api/v1/verwaltung/einstellungen", { angebot_gueltig_tage: 21, firma: { name: "Verleih GmbH" } });
  assert.equal(ok.status, 200);
  await admin("PUT", "/api/v1/verwaltung/einstellungen", { firma: { ort: "Köln" } });
  const b = await admin("GET", "/api/v1/einstellungen/basis");
  assert.equal(b.json.firma.name, "Verleih GmbH", "Teiländerung behält andere Firmenfelder");
  await assert.rejects(s.db.pool.query("INSERT INTO einstellungen (id) VALUES (2)"));
});

test("R-06 Rollen: eigene Rolle anlegen, Rechte setzen, eingebaute Rollen nicht löschbar", async () => {
  const r = await admin("POST", "/api/v1/verwaltung/rollen", { name: "Aushilfe", rechte: { packen: "w", material: "r", verwaltung: "x" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.rechte.packen, "w");
  assert.equal(r.json.rechte.verwaltung, "", "ungültige Stufe wird verworfen");
  const liste = (await admin("GET", "/api/v1/verwaltung/rollen")).json;
  const eingebaut = liste.find((x) => x.name === "Lagerleitung");
  const d = await admin("DELETE", `/api/v1/verwaltung/rollen/${eingebaut.id}`);
  assert.equal(d.status, 409);
  assert.match(d.json.text, /eingebaute Rolle/);
  assert.equal((await admin("DELETE", `/api/v1/verwaltung/rollen/${r.json.id}`)).status, 200);
});

test("R-07 letzter Administrator: Herabstufen, Deaktivieren, Löschen wird verhindert", async () => {
  const rollen = (await admin("GET", "/api/v1/verwaltung/rollen")).json;
  const adminRolle = rollen.find((x) => x.name === "Administrator");
  const lagerRolle = rollen.find((x) => x.name === "Lager / Techniker");
  const ich = (await admin("GET", "/api/v1/ich")).json.nutzer;
  assert.equal((await admin("PUT", `/api/v1/verwaltung/benutzer/${ich.id}`, { rolle_id: lagerRolle.id })).status, 409);
  assert.equal((await admin("PUT", `/api/v1/verwaltung/benutzer/${ich.id}`, { aktiv: false })).status, 409);
  assert.equal((await admin("DELETE", `/api/v1/verwaltung/benutzer/${ich.id}`)).status, 409);
  assert.equal((await admin("PUT", `/api/v1/verwaltung/rollen/${adminRolle.id}`, { rechte: { verwaltung: "" } })).status, 409);
  const n = await admin("POST", "/api/v1/verwaltung/benutzer", { benutzername: "admin2", passwort: PW, rolle_id: adminRolle.id });
  assert.equal(n.status, 200);
  assert.equal((await admin("PUT", `/api/v1/verwaltung/benutzer/${n.json.id}`, { rolle_id: lagerRolle.id })).status, 200);
});

test("R-09 Benutzer anlegen prüft Passwortregeln; Passwort nur als Hash gespeichert", async () => {
  const rollen = (await admin("GET", "/api/v1/verwaltung/rollen")).json;
  const r = await admin("POST", "/api/v1/verwaltung/benutzer", { benutzername: "neu1", passwort: "1234567890", rolle_id: rollen[0].id });
  assert.equal(r.status, 400);
  assert.match(r.json.felder.passwort, /Ziffern/);
  const ok = await admin("POST", "/api/v1/verwaltung/benutzer", { benutzername: "neu1", passwort: PW, rolle_id: rollen[0].id });
  assert.equal(ok.status, 200);
  const { rows } = await s.db.pool.query("SELECT passwort_hash FROM benutzer WHERE benutzername = 'neu1'");
  assert.match(rows[0].passwort_hash, /^scrypt\$/);
  assert.ok(!rows[0].passwort_hash.includes(PW));
});

test("FA-47 Benutzer: Passwort setzen (Regeln, alte Sitzungen enden), deaktivieren beendet Sitzung und sperrt Anmeldung, Rolle wechseln", async () => {
  const neu = await admin("POST", "/api/v1/verwaltung/benutzer", { benutzername: "fa47", name: "Fa Siebenundvierzig", passwort: PW, rolle_id: (await admin("GET", "/api/v1/verwaltung/rollen")).json.find((r) => r.name === "Büro / Disposition").id });
  const id = neu.json.id;
  const anmelden = (pw) => s.api("POST", "/api/v1/anmelden", { benutzername: "fa47", passwort: pw });
  const t1 = (await anmelden(PW)).json.token;
  const ich = (t) => s.api("GET", "/api/v1/ich", undefined, { Authorization: `Bearer ${t}` });
  assert.equal((await ich(t1)).status, 200);
  assert.equal((await admin("PUT", `/api/v1/verwaltung/benutzer/${id}`, { passwort: "kurz" })).status, 400, "Passwortregeln");
  assert.equal((await admin("PUT", `/api/v1/verwaltung/benutzer/${id}`, { passwort: "Neues-Passwort-2026" })).status, 200);
  assert.equal((await ich(t1)).status, 401, "alte Sitzung beendet");
  assert.equal((await anmelden(PW)).status, 401, "altes Passwort gilt nicht mehr");
  const t2 = (await anmelden("Neues-Passwort-2026")).json.token;
  const lager = (await admin("GET", "/api/v1/verwaltung/rollen")).json.find((r) => r.name === "Lager / Techniker").id;
  await admin("PUT", `/api/v1/verwaltung/benutzer/${id}`, { rolle_id: lager });
  assert.equal((await ich(t2)).json.nutzer.rolle, "Lager / Techniker", "Rolle gilt sofort");
  assert.equal((await admin("PUT", `/api/v1/verwaltung/benutzer/${id}`, { aktiv: false })).status, 200);
  assert.equal((await ich(t2)).status, 401, "Deaktivieren beendet die Sitzung");
  assert.equal((await anmelden("Neues-Passwort-2026")).status, 401, "deaktiviert: keine Anmeldung");
});

test("FA-48 Einstellungsgruppen: Etiketten, Zeiterfassung, Angebote, Sicherung (Zweitordner als Serverpfad, D-82) geprüft und gespeichert", async () => {
  const f = await admin("PUT", "/api/v1/verwaltung/einstellungen", { etikett_format: "62 mal 29", zeit_prozent_planung: 120, backup_behalten: 0, ust_satz: 19.555, tag_stunden_standard: 12, tag_stunden_erweitert: 10 });
  assert.equal(f.status, 400);
  assert.deepEqual(Object.keys(f.json.felder).sort(), ["backup_behalten", "etikett_format", "tag_stunden_erweitert", "ust_satz", "zeit_prozent_planung"]);
  const ok = await admin("PUT", "/api/v1/verwaltung/einstellungen", { etikett_format: "50x25", etiketten_lieferant: "Brady", zeit_prozent_planung: 40, zeit_basis_stundensatz: 7500,
    angebot_text_einleitung: "Hallo", kleinunternehmer: true, backup_behalten: 7, backup_zweitordner: "/mnt/nas/lager", zonen_auto: false });
  assert.equal(ok.status, 200, ok.text);
  const e = (await admin("GET", "/api/v1/verwaltung/einstellungen")).json;
  assert.deepEqual([e.etikett_format, e.zeit_prozent_planung, e.backup_behalten, e.backup_zweitordner, e.kleinunternehmer, e.zonen_auto], ["50x25", 40, 7, "/mnt/nas/lager", true, false]);
  assert.equal((await admin("PUT", "/api/v1/verwaltung/einstellungen", { unbekannt: 1 })).status, 400);
});
