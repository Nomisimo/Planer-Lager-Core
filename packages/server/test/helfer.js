// Testhilfe: voll verdrahteter Server auf Zufallsport mit frischem DB-Schema + Anmelde-Helfer.
import { neueTestDb } from "@lager/db/testdb.js";
import { erstelleLagerServer } from "../src/server.js";
import { legeBenutzerAn } from "../src/grunddaten.js";

export const PW = "Sicheres-Testpasswort-1";

export async function starteTestServer({ config = {} } = {}) {
  const db = await neueTestDb({ migrieren: false });
  const app = await erstelleLagerServer({ pool: db.pool, config });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (methode, pfad, body, kopf = {}) => {
    const r = await fetch(url + pfad, { method: methode, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...kopf },
      body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* kein JSON */ }
    return { status: r.status, json, headers: r.headers, text };
  };
  /** Legt Benutzer an (falls nötig), meldet an, liefert api-Funktion mit Bearer-Token. */
  const als = async (benutzername, rolle = "Administrator") => {
    const { rows } = await db.pool.query("SELECT 1 FROM benutzer WHERE benutzername = $1", [benutzername]);
    if (!rows.length) await legeBenutzerAn(db.pool, { benutzername, passwort: PW, rolle });
    const r = await api("POST", "/api/v1/anmelden", { benutzername, passwort: PW });
    if (r.status !== 200) throw new Error("Anmeldung im Test fehlgeschlagen: " + r.text);
    const f = (m, p, b, k = {}) => api(m, p, b, { Authorization: "Bearer " + r.json.token, ...k });
    f.token = r.json.token;
    return f;
  };
  return { ...app, db, url, api, als, async ende() { app.server.closeAllConnections?.(); await new Promise((r) => app.server.close(r)); await db.ende(); } };
}
