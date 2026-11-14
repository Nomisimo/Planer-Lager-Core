#!/usr/bin/env node
// Server-Start: Migrationen → Grunddaten → Listen. Aufruf: node packages/server/src/start.js [--port 8080] [--host 127.0.0.1]
import { erstellePool } from "@lager/db";
import { erstelleLagerServer } from "./server.js";
import { configAusEnv } from "./config.js";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const pool = erstellePool({ url: process.env.DATABASE_URL_DEV || process.env.DATABASE_URL });
const { server } = await erstelleLagerServer({ pool, config: configAusEnv() });
server.listen(Number(arg("port", process.env.PORT || 8080)), arg("host", process.env.HOST || "127.0.0.1"), () => {
  const a = server.address();
  console.log(`Lager-Server läuft auf http://${a.address}:${a.port}`);
});
