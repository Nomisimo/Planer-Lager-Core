#!/usr/bin/env node
// Server-Start: Migrationen → Listen. Aufruf: node packages/server/src/start.js [--port 8080] [--host 0.0.0.0]
import { erstellePool, migriere } from "@lager/db";
import { erstelleApp } from "./app.js";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const pool = erstellePool({ url: process.env.DATABASE_URL_DEV || process.env.DATABASE_URL });
await migriere(pool);
const { server } = erstelleApp({ pool });
server.listen(Number(arg("port", process.env.PORT || 8080)), arg("host", process.env.HOST || "127.0.0.1"), () => {
  const a = server.address();
  console.log(`Lager-Server läuft auf http://${a.address}:${a.port}`);
});
