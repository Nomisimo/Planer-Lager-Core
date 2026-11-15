#!/usr/bin/env node
// Testdaten laden: `npm run seed` (klein), `npm run seed -- --gross` (5.000 Geräte, 500 Projekte, NFA-05)
// oder `npm run seed -- --seed demo` (Beispielbetrieb über die echte API, in Verwaltung › System löschbar).
// Nur für leere Entwicklungs-Datenbanken; bricht ab, wenn schon Geräte da sind.
import { erstellePool, migriere } from "@lager/db";
import { seed, GROSS } from "../packages/server/src/seed.js";
import { ladeBeispiel, BEISPIEL_PASSWORT } from "../packages/server/src/beispiel.js";
import { configAusEnv } from "../packages/server/src/config.js";

const pool = erstellePool({ url: process.env.DATABASE_URL_DEV || process.env.DATABASE_URL, schema: process.env.LAGER_DB_SCHEMA || undefined });
try {
  await migriere(pool);
  const t = Date.now();
  const i = process.argv.indexOf("--seed");
  if (i > 0 && process.argv[i + 1] === "demo") {
    const n = await ladeBeispiel({ pool, config: configAusEnv() });
    console.log(`Beispieldaten geladen in ${Date.now() - t} ms:`, n);
    console.log(`Anmelden z. B. als beispiel-admin, lena, tom, paula oder platz1 mit „${BEISPIEL_PASSWORT}“.`);
  } else {
    const n = await seed(pool, process.argv.includes("--gross") ? GROSS : undefined);
    console.log(`Testdaten geladen in ${Date.now() - t} ms:`, n);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally { await pool.end(); }
