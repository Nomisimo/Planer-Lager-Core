// Testsystem (Phase S, Oracle-Testserver). Alles hier gibt es nur mit LAGER_MODUS=test:
// - Test-Token (Authorization: Bearer <LAGER_TEST_TOKEN>) → Admin-Sitzung des System-Nutzers „claude-test“, jede Nutzung im Sicherheitsprotokoll
// - POST /api/v1/test/zuruecksetzen (Demo-Daten neu), POST /api/v1/test/benutzer (Testbenutzer je Rolle)
// - X-Robots-Tag und /robots.txt, Band „TESTSYSTEM – nur Beispieldaten“ in den Oberflächen
// Ohne Testmodus: Test-Token ist ein ungültiger Token (401), Test-Routen gibt es nicht (404).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { EINGEBAUTE_ROLLEN, ROLLE_ADMIN, neuesTotpGeheimnis } from "@lager/domain";
import { hashePasswort } from "./passwort-hash.js";
import { sichereGrunddaten } from "./grunddaten.js";
import { protokolliere, clientIp } from "./sicherheit.js";

export const TEST_NUTZER = "claude-test";
export const TEST_BAND = "TESTSYSTEM – nur Beispieldaten";
const sha = (s) => createHash("sha256").update(s).digest("hex");

/** Startprüfung: Testmodus ohne ausreichend langen Token startet nicht. */
export function pruefeTestKonfig(config = {}) {
  if (config.testModus && String(config.testToken || "").length < 32)
    throw new Error("LAGER_MODUS=test braucht LAGER_TEST_TOKEN mit mindestens 32 Zeichen. Trage ihn in die .env ein und starte neu.");
}

/** Ist das der Test-Token? Vergleich in konstanter Zeit. */
export function istTestToken(config, token) {
  if (!config?.testModus || !config.testToken || !token) return false;
  const a = Buffer.from(sha(String(token))), b = Buffer.from(sha(config.testToken));
  return timingSafeEqual(a, b);
}

/** Admin-Sitzung für claude-test zum Test-Token sicherstellen (legt Nutzer und Sitzung bei Bedarf neu an). */
export async function sichereTestSitzung(pool, config) {
  let { rows: [b] } = await pool.query("SELECT id FROM benutzer WHERE benutzername = $1", [TEST_NUTZER]);
  if (!b) {
    ({ rows: [b] } = await pool.query(`INSERT INTO benutzer (benutzername, name, passwort_hash, rolle_id)
      VALUES ($1, 'Claude (Testzugang)', $2, (SELECT id FROM rolle WHERE name = $3))
      ON CONFLICT ((lower(benutzername))) DO UPDATE SET aktiv = true RETURNING id`, [TEST_NUTZER, await hashePasswort(randomBytes(24).toString("hex")), ROLLE_ADMIN]));
  }
  await pool.query(`INSERT INTO sitzung (token_hash, benutzer_id, art, ip, geraet) VALUES ($1, $2, 'app', '', 'Test-Token')
    ON CONFLICT (token_hash) DO UPDATE SET letzte_aktivitaet = now()`, [sha(config.testToken), b.id]);
}

export async function protokolliereTest(ctx) {
  await protokolliere(ctx.pool, "test", { benutzer: TEST_NUTZER, ip: clientIp(ctx), text: `${ctx.req.method} ${ctx.url.pathname}` });
}

const zufallsPasswort = () => `Test-${randomBytes(15).toString("base64url")}9a`;
const kurz = (rolle) => rolle.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");

/** Testbenutzer je eingebauter Rolle (test-<rolle>); bei erneutem Aufruf neue Passwörter. Admin mit 2FA-Geheimnis. */
export async function legeTestbenutzerAn(pool) {
  const out = [];
  for (const r of EINGEBAUTE_ROLLEN) {
    const benutzername = `test-${kurz(r.name)}`;
    const passwort = zufallsPasswort();
    const admin = r.name === ROLLE_ADMIN;
    const totp = admin ? neuesTotpGeheimnis() : null;
    await pool.query(`INSERT INTO benutzer (benutzername, name, passwort_hash, rolle_id, totp_geheimnis, totp_aktiv)
      VALUES ($1, $2, $3, (SELECT id FROM rolle WHERE name = $4), $5, $6)
      ON CONFLICT ((lower(benutzername))) DO UPDATE SET passwort_hash = EXCLUDED.passwort_hash, rolle_id = EXCLUDED.rolle_id,
        totp_geheimnis = EXCLUDED.totp_geheimnis, totp_aktiv = EXCLUDED.totp_aktiv, aktiv = true, passwort_wechsel = false`,
    [benutzername, `Test ${r.name}`, await hashePasswort(passwort), r.name, totp, admin]);
    await pool.query("DELETE FROM anmelde_versuch WHERE lower(benutzername) = lower($1)", [benutzername]);
    out.push({ benutzername, passwort, rolle: r.name, ...(totp ? { totpGeheimnis: totp } : {}) });
  }
  return out;
}

const BENUTZER_SPALTEN = ["benutzername", "name", "email", "passwort_hash", "aktiv", "totp_geheimnis", "totp_aktiv", "design", "tour", "passwort_wechsel", "mail_benachrichtigung"];

/**
 * Setzt die Datenbank auf die Demo-Daten zurück. Eigene Benutzer (z. B. admin, sam) bleiben mit Passwort und 2FA erhalten;
 * Beispiel- und Testbenutzer entstehen neu bzw. auf Abruf.
 */
export async function setzeZurueck(pool, config = {}) {
  const { rows: behalten } = await pool.query(`SELECT ${BENUTZER_SPALTEN.map((s) => "b." + s).join(", ")}, r.name AS rolle FROM benutzer b JOIN rolle r ON r.id = b.rolle_id
    WHERE r.eingebaut AND b.benutzername <> $1 AND b.benutzername NOT LIKE 'test-%'
      AND NOT EXISTS (SELECT 1 FROM beispiel x WHERE x.tabelle = 'benutzer' AND x.datensatz_id = b.id)`, [TEST_NUTZER]);
  const { rows: tabellen } = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'schema_migration'`);
  await pool.query(`TRUNCATE ${tabellen.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await sichereGrunddaten(pool, {});
  for (const b of behalten) {
    await pool.query(`INSERT INTO benutzer (${BENUTZER_SPALTEN.join(", ")}, rolle_id)
      VALUES (${BENUTZER_SPALTEN.map((_, i) => `$${i + 1}`).join(", ")}, (SELECT id FROM rolle WHERE name = $${BENUTZER_SPALTEN.length + 1}))`,
    [...BENUTZER_SPALTEN.map((s) => (s === "design" || s === "tour" ? JSON.stringify(b[s] || {}) : b[s])), b.rolle]);
  }
  await sichereGrunddaten(pool, { adminBenutzer: config.adminBenutzer, adminPasswort: config.adminPasswort });
  const { ladeBeispiel } = await import("./beispiel.js");
  const neu = await ladeBeispiel({ pool, config: hilfsConfig(config) });
  return { ok: true, level: "success", text: "Testsystem auf die Beispieldaten zurückgesetzt.", benutzerBehalten: behalten.map((b) => b.benutzername), neu };
}

/** Einstellungen für den kurzen internen Server, der die Beispieldaten über die API anlegt. */
export const hilfsConfig = (config = {}) => ({ ...config, imNetz: false, testModus: false, testToken: "", scannerTcpPort: 0,
  autoSicherung: false, hintergrundMinuten: 0, erlaubteHosts: [], absichernBeimStart: false });

export function testModul(router, kontext) {
  if (!kontext.config?.testModus) return;
  router.get("/robots.txt", { oeffentlich: true }, (ctx) => {
    ctx.res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    ctx.res.end("User-agent: *\nDisallow: /\n");
  });
  router.post("/api/v1/test/zuruecksetzen", { bereich: "verwaltung", stufe: "w" }, async (ctx) => {
    const erg = await setzeZurueck(kontext.pool, ctx.config);
    kontext.hub?.sendeJetzt?.({ typ: "system", aktion: "zurueckgesetzt" });
    return erg;
  });
  router.post("/api/v1/test/benutzer", { bereich: "verwaltung", stufe: "w" }, async () => {
    const benutzer = await legeTestbenutzerAn(kontext.pool);
    return { ok: true, benutzer, hinweis: "Die Passwörter stehen nur in dieser Antwort." };
  });
}
