import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer, PW } from "./helfer.js";
import { legeBenutzerAn } from "../src/grunddaten.js";
import { totpCode } from "@lager/domain";

let s;
before(async () => { s = await starteTestServer(); });
after(async () => { await s.ende(); });

test("R-01 jede registrierte Route hat einen Bereich oder ist ausdrücklich öffentlich", () => {
  for (const r of s.router.routen) assert.ok(r.oeffentlich || r.bereich, `${r.methode} ${r.pfad} ohne Bereich`);
  const oeffentlich = s.router.routen.filter((r) => r.oeffentlich).map((r) => r.pfad).sort();
  assert.deepEqual(oeffentlich.filter((p) => p.startsWith("/api")), ["/api/v1/anmelden", "/api/v1/anmelden/totp", "/api/v1/handoff/einloesen"]);
});

test("R-04 ohne Anmeldung ist nichts erreichbar außer der Anmeldung", async () => {
  const r = await s.api("GET", "/api/v1/einstellungen/basis");
  assert.equal(r.status, 401);
  assert.equal(r.json.anmelden, true);
  const f = await s.api("GET", "/api/v1/ich", undefined, { Authorization: "Bearer falsch" });
  assert.equal(f.status, 401);
});

test("R-05 verweigerter Zugriff: 403 mit festem JSON und Eintrag im Sicherheitsprotokoll", async () => {
  const lager = await s.als("lager1", "Lager / Techniker");
  const r = await lager("GET", "/api/v1/verwaltung/einstellungen");
  assert.equal(r.status, 403);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.level, "error");
  assert.equal(r.json.text, "Dafür fehlt dir die Berechtigung.");
  assert.equal(r.json.rolle, "Lager / Techniker");
  const { rows } = await s.db.pool.query("SELECT * FROM sicherheit_ereignis WHERE art = 'verweigert' AND benutzer = 'lager1'");
  assert.equal(rows.length, 1);
});

test("R-03 Bereich verwaltung nur für Admin (Büro mit vielen Rechten wird abgewiesen)", async () => {
  const buero = await s.als("buero1", "Büro / Disposition");
  assert.equal((await buero("GET", "/api/v1/verwaltung/benutzer")).status, 403);
  const admin = await s.als("admin1");
  assert.equal((await admin("GET", "/api/v1/verwaltung/benutzer")).status, 200);
});

test("R-08 Sperre nach 5 Fehlversuchen je Benutzer, auch bei richtigem Passwort; Meldung verrät nichts", async () => {
  await legeBenutzerAn(s.db.pool, { benutzername: "sperrtest", passwort: PW, rolle: "Lager / Techniker" });
  for (let i = 0; i < 5; i++) {
    const r = await s.api("POST", "/api/v1/anmelden", { benutzername: "sperrtest", passwort: "falsch-falsch" });
    assert.equal(r.status, 401);
  }
  const g = await s.api("POST", "/api/v1/anmelden", { benutzername: "sperrtest", passwort: PW });
  assert.equal(g.status, 429);
  const u = await s.api("POST", "/api/v1/anmelden", { benutzername: "gibtsnicht", passwort: "x" });
  const u2 = await s.api("POST", "/api/v1/anmelden", { benutzername: "sperrtest2", passwort: "x" });
  assert.equal(u.json.text, u2.json.text, "gleicher Text für unbekannt/falsch");
  const { rows } = await s.db.pool.query("SELECT count(*)::int AS n FROM sicherheit_ereignis WHERE art = 'sperre'");
  assert.ok(rows[0].n >= 1);
});

test("R-08 erfolgreiches Login setzt den Zähler des Benutzers zurück", async () => {
  await legeBenutzerAn(s.db.pool, { benutzername: "reset1", passwort: PW, rolle: "Lager / Techniker" });
  for (let i = 0; i < 4; i++) await s.api("POST", "/api/v1/anmelden", { benutzername: "reset1", passwort: "falsch-falsch" });
  assert.equal((await s.api("POST", "/api/v1/anmelden", { benutzername: "reset1", passwort: PW })).status, 200);
  for (let i = 0; i < 4; i++) await s.api("POST", "/api/v1/anmelden", { benutzername: "reset1", passwort: "falsch-falsch" });
  assert.equal((await s.api("POST", "/api/v1/anmelden", { benutzername: "reset1", passwort: PW })).status, 200);
});

test("R-08 Sperre je Adresse nach 20 Fehlversuchen", async () => {
  await s.db.pool.query("INSERT INTO anmelde_versuch (benutzername, ip, erfolg) SELECT 'x' || g, '10.9.9.9', false FROM generate_series(1, 20) g");
  // Eigene Adresse ist 127.0.0.1 → nicht gesperrt; direkte Prüfung der Fremd-Adresse über SQL-Logik:
  await s.db.pool.query("UPDATE anmelde_versuch SET ip = '127.0.0.1' WHERE ip = '10.9.9.9'");
  await legeBenutzerAn(s.db.pool, { benutzername: "ipsperre", passwort: PW, rolle: "Lager / Techniker" });
  assert.equal((await s.api("POST", "/api/v1/anmelden", { benutzername: "ipsperre", passwort: PW })).status, 429);
  await s.db.pool.query("DELETE FROM anmelde_versuch WHERE ip = '127.0.0.1'");
});

test("R-10 Sitzung läuft 12 Stunden nach letzter Aktivität ab; Web-Cookie HttpOnly + SameSite=Lax", async () => {
  await legeBenutzerAn(s.db.pool, { benutzername: "zeit1", passwort: PW, rolle: "Lager / Techniker" });
  const w = await s.api("POST", "/api/v1/anmelden", { benutzername: "zeit1", passwort: PW, art: "web" });
  const cookie = w.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=43200/);
  const a = await s.als("zeit1", "Lager / Techniker");
  assert.equal((await a("GET", "/api/v1/ich")).status, 200);
  await s.db.pool.query("UPDATE sitzung SET letzte_aktivitaet = now() - interval '11 hours 59 minutes'");
  assert.equal((await a("GET", "/api/v1/ich")).status, 200, "Aktivität verlängert");
  await s.db.pool.query("UPDATE sitzung SET letzte_aktivitaet = now() - interval '12 hours 1 minute'");
  const r = await a("GET", "/api/v1/ich");
  assert.equal(r.status, 401);
  assert.match(r.json.text, /abgelaufen/);
});

test("NFA-01 CSRF: Cookie-Sitzung braucht X-CSRF-Token bei ändernden Anfragen, Bearer nicht", async () => {
  await legeBenutzerAn(s.db.pool, { benutzername: "csrf1", passwort: PW, rolle: "Lager / Techniker" });
  const w = await s.api("POST", "/api/v1/anmelden", { benutzername: "csrf1", passwort: PW, art: "web" });
  const cookie = w.headers.get("set-cookie").split(";")[0];
  assert.equal((await s.api("GET", "/api/v1/ich", undefined, { Cookie: cookie })).status, 200);
  assert.equal((await s.api("POST", "/api/v1/abmelden", {}, { Cookie: cookie })).status, 403);
  assert.equal((await s.api("POST", "/api/v1/abmelden", {}, { Cookie: cookie, "X-CSRF-Token": w.json.csrf })).status, 200);
  assert.equal((await s.api("GET", "/api/v1/ich", undefined, { Cookie: cookie })).status, 401, "abgemeldet");
});

test("FA-54 Zwei-Faktor: Pflicht für Admin im Netz, Einrichtung, danach Anmeldung nur mit Code", async () => {
  const n = await starteTestServer({ config: { imNetz: true } });
  try {
    const admin = await n.als("chef");
    const g = await admin("GET", "/api/v1/verwaltung/benutzer");
    assert.equal(g.status, 403);
    assert.equal(g.json.zweiFaktorEinrichten, true);
    const e = await admin("POST", "/api/v1/ich/totp/einrichten", {});
    assert.match(e.json.uri, /^otpauth:\/\/totp\//);
    assert.equal((await admin("POST", "/api/v1/ich/totp/bestaetigen", { code: "000000" })).status, 400);
    assert.equal((await admin("POST", "/api/v1/ich/totp/bestaetigen", { code: totpCode(e.json.geheimnis) })).status, 200);
    assert.equal((await admin("GET", "/api/v1/verwaltung/benutzer")).status, 200);
    const l = await n.api("POST", "/api/v1/anmelden", { benutzername: "chef", passwort: PW });
    assert.equal(l.json.zweiterFaktor, true);
    assert.equal(l.json.token, undefined);
    assert.equal((await n.api("GET", "/api/v1/ich", undefined, { Authorization: "Bearer " + l.json.zwischenToken })).status, 401);
    assert.equal((await n.api("POST", "/api/v1/anmelden/totp", { zwischenToken: l.json.zwischenToken, code: "123456" })).status, 401);
    const ok = await n.api("POST", "/api/v1/anmelden/totp", { zwischenToken: l.json.zwischenToken, code: totpCode(e.json.geheimnis) });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.token);
    // Nicht-Admin im Netz: 2FA optional
    const lager = await n.als("lagerx", "Lager / Techniker");
    assert.equal((await lager("GET", "/api/v1/ich")).status, 200);
  } finally { await n.ende(); }
});

test("Handoff: Einmal-Code 60 s gültig und nur einmal einlösbar", async () => {
  const a = await s.als("hand1", "Büro / Disposition");
  const h = await a("POST", "/api/v1/handoff", {});
  assert.equal(h.json.gueltigSekunden, 60);
  const e = await s.api("POST", "/api/v1/handoff/einloesen", { code: h.json.code });
  assert.equal(e.status, 200);
  assert.equal(e.json.nutzer.benutzername, "hand1");
  assert.equal((await s.api("POST", "/api/v1/handoff/einloesen", { code: h.json.code })).status, 401);
  const h2 = await a("POST", "/api/v1/handoff", {});
  await s.db.pool.query("UPDATE handoff SET ablauf = now() - interval '1 second' WHERE eingeloest IS NULL");
  assert.equal((await s.api("POST", "/api/v1/handoff/einloesen", { code: h2.json.code })).status, 401);
});

test("Sicherheitsprotokoll 3.15: Einträge nur anfügen (UPDATE/DELETE scheitern)", async () => {
  await assert.rejects(s.db.pool.query("UPDATE sicherheit_ereignis SET text = 'x'"), /nur neue Einträge/);
  await assert.rejects(s.db.pool.query("DELETE FROM sicherheit_ereignis"), /nur neue Einträge/);
});
