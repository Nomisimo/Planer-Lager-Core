// Migrations-Runner: wendet nummerierte SQL-Dateien aus packages/db/migrations der Reihe nach an.
// Jede Datei läuft in einer eigenen Transaktion; bereits angewandte Nummern werden übersprungen.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** @returns {{nr: number, name: string, datei: string}[]} */
export function migrationsDateien(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir)
    .filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((f) => ({ nr: parseInt(f.slice(0, 3), 10), name: f.replace(/\.sql$/, ""), datei: path.join(dir, f) }));
}

/**
 * @param {import("pg").Pool} pool
 * @returns {Promise<string[]>} Namen der neu angewandten Migrationen
 */
export async function migriere(pool, dir = MIGRATIONS_DIR) {
  const c = await pool.connect();
  const neu = [];
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migration (
      nr integer PRIMARY KEY, name text NOT NULL, angewandt timestamptz NOT NULL DEFAULT now())`);
    // Sperre, damit zwei Server-Instanzen nicht gleichzeitig migrieren.
    await c.query("SELECT pg_advisory_lock(424242)");
    const { rows } = await c.query("SELECT nr FROM schema_migration");
    const da = new Set(rows.map((r) => r.nr));
    for (const m of migrationsDateien(dir)) {
      if (da.has(m.nr)) continue;
      const sql = fs.readFileSync(m.datei, "utf8");
      try {
        await c.query("BEGIN");
        await c.query(sql);
        await c.query("INSERT INTO schema_migration (nr, name) VALUES ($1, $2)", [m.nr, m.name]);
        await c.query("COMMIT");
        neu.push(m.name);
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${m.name} fehlgeschlagen: ${e.message}`);
      }
    }
  } finally {
    await c.query("SELECT pg_advisory_unlock(424242)").catch(() => {});
    c.release();
  }
  return neu;
}
