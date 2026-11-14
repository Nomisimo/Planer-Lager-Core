#!/usr/bin/env node
// Testdaten laden: `npm run seed` (klein) oder `npm run seed -- --gross` (5.000 Geräte, 500 Projekte, NFA-05).
// Nur für leere Entwicklungs-Datenbanken; bricht ab, wenn schon Geräte da sind.
import { erstellePool, migriere } from "@lager/db";
import { seed, GROSS } from "../packages/server/src/seed.js";

const pool = erstellePool({ url: process.env.DATABASE_URL_DEV || process.env.DATABASE_URL, schema: process.env.LAGER_DB_SCHEMA || undefined });
try {
  await migriere(pool);
  const t = Date.now();
  const n = await seed(pool, process.argv.includes("--gross") ? GROSS : undefined);
  console.log(`Testdaten geladen in ${Date.now() - t} ms:`, n);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally { await pool.end(); }
