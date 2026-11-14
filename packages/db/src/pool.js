// Verbindungspool zu PostgreSQL. Optional mit eigenem Schema (Tests laufen je Datei in einem frischen Schema).
import pg from "pg";

// BIGINT (Zählwerte, Cent-Summen) als Zahl statt String liefern. Beträge bleiben weit unter 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
// DATE als 'JJJJ-MM-TT'-Text lassen, nie in Date umwandeln (Zeitzonen-Falle).
pg.types.setTypeParser(1082, (v) => v);

export const standardUrl = () =>
  process.env.DATABASE_URL || "postgres://lager:lager@localhost:5432/lager_test";

/**
 * @param {{url?: string, schema?: string, max?: number}} [opt]
 * @returns {import("pg").Pool}
 */
export function erstellePool(opt = {}) {
  const pool = new pg.Pool({ connectionString: opt.url || standardUrl(), max: opt.max || 10 });
  if (opt.schema) {
    if (!/^[a-z_][a-z0-9_]*$/.test(opt.schema)) throw new Error(`Ungültiger Schemaname: ${opt.schema}`);
    pool.on("connect", (c) => c.query(`SET search_path TO ${opt.schema}, public`));
  }
  return pool;
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
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
