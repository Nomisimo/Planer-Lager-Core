// Phase S: Testmodus des Servers (Oracle-Testserver). Nur mit LAGER_MODUS=test gibt es Test-Token, Test-Routen, Band und noindex.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer, PW } from "./helfer.js";
import { configAusEnv } from "../src/config.js";
import { pruefeTestKonfig } from "../src/testmodus.js";
import { einmalZugang } from "../src/grunddaten.js";
import { totpCode } from "@lager/domain";

const TOKEN = "a".repeat(40) + "0123456789abcdef0123456789";
let normal, testS;
before(async () => {
  normal = await starteTestServer({ config: { testModus: false, testToken: TOKEN } });
  testS = await starteTestServer({ config: { testModus: true, testToken: TOKEN, imNetz: true, adminBenutzer: "admin", adminPasswort: PW } });
});
after(async () => { await normal?.ende(); await testS?.ende(); });
const mitToken = { Authorization: `Bearer ${TOKEN}` };

test("REMOTE-09 Normalbetrieb: Test-Token gibt 401, Test-Routen 404, kein Band, kein robots.txt", async () => {
  assert.equal((await normal.api("GET", "/api/v1/ich", undefined, mitToken)).status, 401);
  assert.equal((await normal.api("POST", "/api/v1/test/zuruecksetzen", {}, mitToken)).status, 404);
  assert.equal((await normal.api("POST", "/api/v1/test/benutzer", {}, mitToken)).status, 404);
  assert.equal((await normal.api("GET", "/robots.txt")).status, 404);
  const h = await normal.api("GET", "/health");
  assert.equal(h.json.testsystem, undefined);
  assert.equal(h.headers.get("x-robots-tag"), null);
  assert.equal(configAusEnv({ LAGER_TEST_TOKEN: TOKEN }).testToken, "", "Token ohne LAGER_MODUS=test wird nicht übernommen");
});

test("REMOTE-09 Server startet im Testmodus nicht ohne Token oder mit zu kurzem Token", () => {
  assert.throws(() => pruefeTestKonfig(configAusEnv({ LAGER_MODUS: "test" })), /LAGER_TEST_TOKEN/);
  assert.throws(() => pruefeTestKonfig(configAusEnv({ LAGER_MODUS: "test", LAGER_TEST_TOKEN: "kurz".repeat(7) })), /32 Zeichen/);
  assert.doesNotThrow(() => pruefeTestKonfig(configAusEnv({ LAGER_MODUS: "test", LAGER_TEST_TOKEN: TOKEN })));
  assert.doesNotThrow(() => pruefeTestKonfig(configAusEnv({})));
});

test("REMOTE-09 Test-Token ergibt Admin claude-test ohne 2FA-Zwang, jede Nutzung im Sicherheitsprotokoll", async () => {
  const r = await testS.api("GET", "/api/v1/ich", undefined, mitToken);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.nutzer.benutzername, "claude-test");
  assert.equal(r.json.nutzer.admin, true);
  assert.equal(r.json.testsystem, true);
  assert.equal(r.json.zweiFaktorEinrichten, false);
  assert.equal((await testS.api("GET", "/api/v1/verwaltung/benutzer", undefined, mitToken)).status, 200);
  const { rows } = await testS.db.pool.query("SELECT count(*)::int AS n FROM sicherheit_ereignis WHERE art = 'test' AND benutzer = 'claude-test'");
  assert.ok(rows[0].n >= 2, `nur ${rows[0].n} Protokolleinträge`);
  // Falscher Token bleibt ungültig
  assert.equal((await testS.api("GET", "/api/v1/ich", undefined, { Authorization: `Bearer ${TOKEN.slice(1)}x` })).status, 401);
});

test("REMOTE-09 Benutzer-Cookie geht vor dem Test-Token (Proxy hängt ihn an jede Anfrage)", async () => {
  const bea = await testS.als("bea-test", "Büro / Disposition");
  const web = await testS.api("POST", "/api/v1/anmelden", { benutzername: "bea-test", passwort: PW, art: "web" });
  const cookie = String(web.headers.get("set-cookie")).split(";")[0];
  const r = await testS.api("GET", "/api/v1/ich", undefined, { ...mitToken, Cookie: cookie });
  assert.equal(r.json.nutzer.benutzername, "bea-test");
  // abgelaufenes/ungültiges Cookie → Test-Token
  const r2 = await testS.api("GET", "/api/v1/ich", undefined, { ...mitToken, Cookie: "lager_sitzung=ungueltig" });
  assert.equal(r2.json.nutzer.benutzername, "claude-test");
  assert.ok(bea.token);
});

test("REMOTE-09 Testsystem: X-Robots-Tag, robots.txt Disallow, Band-Merker in /health, /api/v1/sitzung und Portal", async () => {
  const h = await testS.api("GET", "/health");
  assert.equal(h.json.testsystem, true);
  assert.equal(h.headers.get("x-robots-tag"), "noindex, nofollow");
  const rb = await testS.api("GET", "/robots.txt");
  assert.equal(rb.status, 200);
  assert.match(rb.text, /Disallow: \//);
  assert.equal((await testS.api("GET", "/api/v1/sitzung")).json.testsystem, true);
  const portal = await testS.api("GET", "/");
  assert.match(portal.text, /TESTSYSTEM – nur Beispieldaten/);
  assert.doesNotMatch((await normal.api("GET", "/")).text, /TESTSYSTEM/);
  // Schutz-Header wie im Echtbetrieb
  assert.equal(h.headers.get("x-frame-options"), "DENY");
});

test("REMOTE-09 /api/v1/test/benutzer legt je Rolle einen Testbenutzer an, Passwörter nur in der Antwort", async () => {
  const r = await testS.api("POST", "/api/v1/test/benutzer", {}, mitToken);
  assert.equal(r.status, 200, r.text);
  const rollen = r.json.benutzer.map((b) => b.rolle);
  assert.ok(rollen.includes("Administrator") && rollen.includes("Lager / Techniker"));
  const admin = r.json.benutzer.find((b) => b.rolle === "Administrator");
  assert.ok(admin.totpGeheimnis, "Admin bekommt 2FA-Geheimnis");
  const tech = r.json.benutzer.find((b) => b.rolle === "Lager / Techniker");
  const login = await testS.api("POST", "/api/v1/anmelden", { benutzername: tech.benutzername, passwort: tech.passwort });
  assert.equal(login.status, 200, login.text);
  const a1 = await testS.api("POST", "/api/v1/anmelden", { benutzername: admin.benutzername, passwort: admin.passwort });
  assert.equal(a1.json.zweiterFaktor, true);
  const a2 = await testS.api("POST", "/api/v1/anmelden/totp", { zwischenToken: a1.json.zwischenToken, code: totpCode(admin.totpGeheimnis) });
  assert.equal(a2.status, 200, a2.text);
  const { rows } = await testS.db.pool.query("SELECT passwort_hash FROM benutzer WHERE benutzername = $1", [tech.benutzername]);
  assert.notEqual(rows[0].passwort_hash, tech.passwort);
  // erneut = neue Passwörter
  const r2 = await testS.api("POST", "/api/v1/test/benutzer", {}, mitToken);
  assert.notEqual(r2.json.benutzer.find((b) => b.rolle === "Lager / Techniker").passwort, tech.passwort);
  // Nicht-Admins dürfen das nicht
  const lager = await testS.als("lager-test", "Lager / Techniker");
  assert.equal((await lager("POST", "/api/v1/test/benutzer", {})).status, 403);
});

test("REMOTE-07 /api/v1/test/zuruecksetzen: nur Demo-Daten, eigene Benutzer bleiben mit Passwort", async () => {
  await testS.db.pool.query("INSERT INTO kunde (name) VALUES ('Echter Kunde (darf weg)')");
  const r = await testS.api("POST", "/api/v1/test/zuruecksetzen", {}, mitToken);
  assert.equal(r.status, 200, r.text);
  const q = async (sql, p) => (await testS.db.pool.query(sql, p)).rows;
  assert.equal((await q("SELECT count(*)::int AS n FROM kunde WHERE name = 'Echter Kunde (darf weg)'"))[0].n, 0);
  assert.equal((await q("SELECT count(*)::int AS n FROM projekt WHERE name = 'Stadtfest Neustadt'"))[0].n, 1);
  const nb = (await q("SELECT count(*)::int AS n FROM projekt WHERE id NOT IN (SELECT datensatz_id FROM beispiel WHERE tabelle = 'projekt')"))[0].n;
  assert.equal(nb, 0, "nur Beispiel-Projekte");
  assert.ok(r.json.benutzerBehalten.includes("bea-test"));
  assert.equal((await testS.api("POST", "/api/v1/anmelden", { benutzername: "bea-test", passwort: PW })).status, 200);
  assert.equal((await q("SELECT count(*)::int AS n FROM benutzer WHERE benutzername LIKE 'test-%'"))[0].n, 0);
  // Test-Token funktioniert danach weiter (Sitzung wird neu angelegt)
  assert.equal((await testS.api("GET", "/api/v1/ich", undefined, mitToken)).json.nutzer.benutzername, "claude-test");
});

test("REMOTE-10 Einmal-Passwort: erst eigenes Passwort, dann 2FA; vorher ist alles andere gesperrt", async () => {
  const sam = await testS.als("sam-test", "Administrator");
  await testS.db.pool.query("UPDATE benutzer SET passwort_wechsel = true WHERE benutzername = 'sam-test'");
  const ich = await sam("GET", "/api/v1/ich");
  assert.equal(ich.json.passwortWechseln, true);
  const gesperrt = await sam("GET", "/api/v1/kunden");
  assert.equal(gesperrt.status, 403);
  assert.equal(gesperrt.json.passwortWechseln, true);
  assert.equal((await sam("POST", "/api/v1/ich/totp/einrichten", {})).status, 403, "2FA erst nach dem Passwort");
  assert.equal((await sam("POST", "/api/v1/ich/passwort", { neu: "kurz" })).status, 400);
  assert.equal((await sam("POST", "/api/v1/ich/passwort", { neu: PW })).status, 400, "gleiches Passwort");
  const ok = await sam("POST", "/api/v1/ich/passwort", { neu: "Ganz-neues-Passwort-7" });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.zweiFaktorEinrichten, true);
  const danach = await sam("GET", "/api/v1/kunden");
  assert.equal(danach.status, 403);
  assert.equal(danach.json.zweiFaktorEinrichten, true, "jetzt 2FA-Pflicht");
  assert.equal((await testS.api("POST", "/api/v1/anmelden", { benutzername: "sam-test", passwort: PW })).status, 401, "altes Passwort gilt nicht mehr");
  // Ohne Einmal-Passwort braucht der Wechsel das bisherige Passwort
  const bea = await testS.als("bea-test");
  assert.equal((await bea("POST", "/api/v1/ich/passwort", { neu: "Noch-ein-Passwort-8" })).status, 400);
  assert.equal((await bea("POST", "/api/v1/ich/passwort", { alt: PW, neu: "Noch-ein-Passwort-8" })).status, 200);
});

test("REMOTE-10 einmal-zugang: Admin mit Einmal-Passwort, erneut = neues Passwort, 2FA neu", async () => {
  const pw1 = await einmalZugang(testS.db.pool, { benutzername: "sam" });
  const l1 = await testS.api("POST", "/api/v1/anmelden", { benutzername: "sam", passwort: pw1 });
  assert.equal(l1.status, 200, l1.text);
  assert.equal(l1.json.passwortWechseln, true);
  assert.equal(l1.json.nutzer.admin, true);
  const pw2 = await einmalZugang(testS.db.pool, { benutzername: "sam" });
  assert.notEqual(pw1, pw2);
  assert.equal((await testS.api("POST", "/api/v1/anmelden", { benutzername: "sam", passwort: pw1 })).status, 401);
  assert.equal((await testS.api("GET", "/api/v1/ich", undefined, { Authorization: `Bearer ${l1.json.token}` })).status, 401, "alte Sitzung beendet");
  const { rows: [b] } = await testS.db.pool.query("SELECT totp_aktiv, passwort_wechsel FROM benutzer WHERE benutzername = 'sam'");
  assert.deepEqual(b, { totp_aktiv: false, passwort_wechsel: true });
});
