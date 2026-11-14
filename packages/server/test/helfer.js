// Testhilfe: Server auf Zufallsport mit frischem DB-Schema.
import { neueTestDb } from "@lager/db/testdb.js";
import { erstelleApp } from "../src/app.js";

export async function starteTestServer(extra = {}) {
  const db = await neueTestDb();
  const app = erstelleApp({ pool: db.pool, ...extra });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (methode, pfad, body, kopf = {}) => {
    const r = await fetch(url + pfad, { method: methode, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...kopf },
      body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* kein JSON */ }
    return { status: r.status, json, headers: r.headers, text };
  };
  return { ...app, db, url, api, async ende() { await new Promise((r) => app.server.close(r)); await db.ende(); } };
}
