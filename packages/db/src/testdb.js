// Testhilfe: frisches Schema je Testdatei in der Test-Datenbank, migriert, danach wieder gelöscht.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { erstellePool, standardUrl } from "./pool.js";
import { migriere } from "./migrate.js";

/** @returns {Promise<{pool: import("pg").Pool, schema: string, ende: () => Promise<void>}>} */
export async function neueTestDb({ migrieren = true } = {}) {
  const schema = "t_" + randomBytes(5).toString("hex");
  const admin = new pg.Client({ connectionString: standardUrl() });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const pool = erstellePool({ schema, max: 5 });
  if (migrieren) await migriere(pool);
  return {
    pool,
    schema,
    async ende() {
      await pool.end();
      const a = new pg.Client({ connectionString: standardUrl() });
      await a.connect();
      await a.query(`DROP SCHEMA ${schema} CASCADE`);
      await a.end();
    },
  };
}
