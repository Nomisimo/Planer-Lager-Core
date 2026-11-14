#!/usr/bin/env node
// Aufruf: node packages/db/src/cli.js migrate
import { erstellePool } from "./pool.js";
import { migriere } from "./migrate.js";

const [befehl] = process.argv.slice(2);
if (befehl === "migrate") {
  const pool = erstellePool();
  const neu = await migriere(pool);
  console.log(neu.length ? `Migriert: ${neu.join(", ")}` : "Datenbank ist aktuell.");
  await pool.end();
} else {
  console.error("Unbekannter Befehl. Nutze: migrate");
  process.exitCode = 2;
}
