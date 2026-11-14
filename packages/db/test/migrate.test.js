import { test } from "node:test";
import assert from "node:assert/strict";
import { neueTestDb } from "../src/testdb.js";
import { migriere, migrationsDateien } from "../src/migrate.js";

test("Gerüst: Migrationen laufen in frischem Schema und sind wiederholbar", async () => {
  const db = await neueTestDb();
  try {
    const { rows } = await db.pool.query("SELECT nr FROM schema_migration ORDER BY nr");
    assert.deepEqual(rows.map((r) => r.nr), migrationsDateien().map((m) => m.nr));
    assert.deepEqual(await migriere(db.pool), [], "zweiter Lauf wendet nichts an");
  } finally {
    await db.ende();
  }
});
