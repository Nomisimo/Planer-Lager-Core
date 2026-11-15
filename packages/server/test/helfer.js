// Testhilfe: voll verdrahteter Server auf Zufallsport mit frischem DB-Schema + Anmelde-Helfer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { neueTestDb } from "@lager/db/testdb.js";
import { erstelleLagerServer } from "../src/server.js";
import { legeBenutzerAn } from "../src/grunddaten.js";
import { FASSUNG_ROUTEN } from "../src/fassung.js";

const ROUTEN_RE = Object.entries(FASSUNG_ROUTEN).map(([p, t]) => [new RegExp("^" + p.replace(/:\w+/g, "(\\d+)") + "$"), t]);

export const PW = "Sicheres-Testpasswort-1";

export async function starteTestServer({ config = {} } = {}) {
  const db = await neueTestDb({ migrieren: false });
  const dataDir = config.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "lager-data-"));
  config = { dataDir, ...config };
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
    // GLEICH: Tests ohne eigene Fassung speichern mit der aktuellen (wie ein frisch geladenes Formular).
    // Kopf "x-test-ohne-fassung" schaltet das ab (für die 428-Prüfung).
    const f = async (m, p, b, k = {}) => {
      if ((m === "PUT" || m === "PATCH") && b && typeof b === "object" && !Array.isArray(b) && b.version === undefined && !k["x-test-ohne-fassung"]) {
        const pfad = p.split("?")[0];
        for (const [re, t] of ROUTEN_RE) {
          const t1 = re.exec(pfad); if (!t1) continue;
          const id = t1[1] ? Number(t1[1]) : 1;
          const { rows: [z] } = await db.pool.query(`SELECT version FROM ${t} WHERE id = $1`, [id]);
          if (z) b = { ...b, version: z.version };
          break;
        }
      }
      return api(m, p, b, { Authorization: "Bearer " + r.json.token, ...k });
    };
    f.token = r.json.token;
    return f;
  };
  return { ...app, db, url, api, als, config, async ende() { app.server.closeAllConnections?.(); await new Promise((r) => app.server.close(r)); await db.ende(); if (!config.behalteDaten) fs.rmSync(dataDir, { recursive: true, force: true }); } , dataDir };
}
