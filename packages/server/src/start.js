#!/usr/bin/env node
// Server-Start: Migrationen → Grunddaten → Listen. Aufruf: node packages/server/src/start.js [--port 8080] [--host 127.0.0.1]
// LAGER_SEED=demo: beim ersten Start (keine Projekte, keine Geräte) die Beispieldaten laden (Testserver, Phase S).
import { erstellePool } from "@lager/db";
import { erstelleLagerServer } from "./server.js";
import { configAusEnv } from "./config.js";
import { hilfsConfig } from "./testmodus.js";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const pool = erstellePool({ url: process.env.DATABASE_URL_DEV || process.env.DATABASE_URL });
const config = configAusEnv();
const { server } = await erstelleLagerServer({ pool, config });
if (process.env.LAGER_SEED === "demo") {
  const { rows: [z] } = await pool.query("SELECT (SELECT count(*) FROM projekt)::int + (SELECT count(*) FROM geraet)::int AS n");
  if (z.n === 0) {
    const { ladeBeispiel } = await import("./beispiel.js");
    const neu = await ladeBeispiel({ pool, config: hilfsConfig(config) });
    console.log(`Beispieldaten geladen (${Object.values(neu).reduce((a, b) => a + b, 0)} Zeilen).`);
  }
}
server.listen(Number(arg("port", process.env.PORT || 8080)), arg("host", process.env.HOST || "127.0.0.1"), () => {
  const a = server.address();
  console.log(`Lager-Server läuft auf http://${a.address}:${a.port}${config.testModus ? " (TESTSYSTEM)" : ""}`);
});
