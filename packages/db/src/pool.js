// Verbindungspool zu PostgreSQL. Optional mit eigenem Schema (Tests laufen je Datei in einem frischen Schema).
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";

// Live-Ereignisse aus einer Transaktion erst nach COMMIT senden (BUG-14: Clients luden sonst den alten Stand nach)
const offeneTx = new AsyncLocalStorage();
/** Führt fn nach dem COMMIT der laufenden Transaktion aus (ohne Transaktion sofort); bei ROLLBACK nie. */
export function nachCommit(fn) {
  const liste = offeneTx.getStore();
  if (liste) liste.push(fn); else fn();
}

// BIGINT (Zählwerte, Cent-Summen) als Zahl statt String liefern. Beträge bleiben weit unter 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
// DATE als 'JJJJ-MM-TT'-Text lassen, nie in Date umwandeln (Zeitzonen-Falle).
pg.types.setTypeParser(1082, (v) => v);
// NUMERIC nur für Längen (m), nie für Geld → als Zahl.
pg.types.setTypeParser(1700, (v) => Number(v));

export const standardUrl = () =>
  process.env.DATABASE_URL || "postgres://lager:lager@localhost:5432/lager_test";

/**
 * @param {{url?: string, schema?: string, max?: number}} [opt]
 * @returns {import("pg").Pool}
 */
export function erstellePool(opt = {}) {
  if (opt.schema && !/^[a-z_][a-z0-9_]*$/.test(opt.schema)) throw new Error(`Ungültiger Schemaname: ${opt.schema}`);
  // search_path als Verbindungsoption: gilt schon für die erste Abfrage jeder Verbindung
  return new pg.Pool({ connectionString: opt.url || standardUrl(), max: opt.max || 10, ...(opt.schema ? { options: `-c search_path=${opt.schema},public` } : {}) });
}

/**
 * Führt fn in einer Transaktion aus (NFA-06). Fehler → ROLLBACK, sonst COMMIT.
 * @template T
 * @param {import("pg").Pool} pool
 * @param {(c: import("pg").PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function transaktion(pool, fn) {
  const c = await pool.connect();
  const danach = [];
  try {
    await c.query("BEGIN");
    const r = await offeneTx.run(danach, () => fn(c));
    await c.query("COMMIT");
    for (const f of danach) { try { f(); } catch (e) { console.error(`Nach COMMIT: ${e.message}`); } }
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
