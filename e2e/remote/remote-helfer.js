// REMOTE (ZUSATZ.md Phase S): Hilfen für Tests gegen den echten Testserver (LAGER_REMOTE_URL=https://<TEST_DOMAIN>).
// In der Claude-VM hängt der Proxy den Test-Token selbst an jede Anfrage; im GitHub-Runner (remote-test.yml) kommt er aus
// LAGER_TEST_TOKEN. Benutzer-Anfragen laufen über das Sitzungs-Cookie, das vor dem Test-Token gilt (D-130).
export const URL_REMOTE = (process.env.LAGER_REMOTE_URL || "").replace(/\/$/, "");
export const OHNE = URL_REMOTE ? false : "LAGER_REMOTE_URL fehlt (npm run e2e:remote mit LAGER_REMOTE_URL=https://<TEST_DOMAIN>)";
/** true im GitHub-Runner: echte TLS-Verbindung ohne aufbrechenden Proxy (Zertifikat prüfbar). */
export const TLS_DIREKT = process.env.LAGER_REMOTE_TLS === "direkt";
const TEST_TOKEN = process.env.LAGER_TEST_TOKEN || "";

/** fetch gegen den Testserver; antwortet {status, json, text, headers}. */
export async function rufe(methode, pfad, body, kopf = {}) {
  const h = { ...(TEST_TOKEN && !kopf.Cookie ? { Authorization: `Bearer ${TEST_TOKEN}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...kopf };
  const r = await fetch(URL_REMOTE + pfad, { method: methode, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: kopf.redirect || "follow" });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* kein JSON */ }
  return { status: r.status, json, text, headers: r.headers };
}
/** Als Test-Admin (claude-test) – wirft bei Fehlerstatus. */
export async function admin(methode, pfad, body) {
  const r = await rufe(methode, pfad, body);
  if (r.status >= 300) throw new Error(`${methode} ${pfad}: ${r.status} ${r.text.slice(0, 300)}`);
  return r.json;
}

let testbenutzer = null;
/** Testbenutzer je Rolle (einmal je Lauf neu, Passwörter nur im Speicher). */
export async function testBenutzer() {
  if (!testbenutzer) testbenutzer = (await admin("POST", "/api/v1/test/benutzer", {})).benutzer;
  return testbenutzer;
}
export const benutzerMitRolle = async (rolle) => (await testBenutzer()).find((b) => b.rolle === rolle);

/** Browser-Anmeldung per Cookie; liefert api(methode, pfad, body) mit Cookie und CSRF. */
export async function alsWeb(rolle) {
  let b = await benutzerMitRolle(rolle);
  let r = await rufe("POST", "/api/v1/anmelden", { benutzername: b.benutzername, passwort: b.passwort, art: "web" });
  if (r.status === 401) { // nach Zurücksetzen/Wiederherstellen gibt es die Testbenutzer nicht mehr → neu anlegen
    testbenutzer = null; b = await benutzerMitRolle(rolle);
    r = await rufe("POST", "/api/v1/anmelden", { benutzername: b.benutzername, passwort: b.passwort, art: "web" });
  }
  if (r.status !== 200) throw new Error(`Anmeldung ${b.benutzername}: ${r.status} ${r.text}`);
  const cookie = String(r.headers.get("set-cookie") || "").split(";")[0];
  const csrf = r.json.csrf;
  const api = (m, p, body) => rufe(m, p, body, { Cookie: cookie, ...(m !== "GET" ? { "X-CSRF-Token": csrf } : {}) });
  return Object.assign(api, { cookie, csrf, benutzer: b });
}

/** Zähler für Vergleiche (Sicherung/Wiederherstellung, Neustart). */
export async function zaehler() {
  const geraete = async () => { let n = 0; for (let off = 0; ; off += 500) { const z = (await admin("GET", `/api/v1/geraete?limit=500&offset=${off}`)).zeilen; n += z.length; if (z.length < 500) return n; } };
  return {
    kunden: (await admin("GET", "/api/v1/kunden?limit=1")).gesamt,
    projekte: (await admin("GET", "/api/v1/projekte?limit=1")).gesamt,
    geraete: await geraete(),
  };
}
