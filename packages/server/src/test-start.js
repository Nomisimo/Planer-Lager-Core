#!/usr/bin/env node
// Testserver für manuelle E2E-/UI-Prüfung: frisches Schema, schreibt URL nach e2e/.server-url.
// Aufruf: node packages/server/src/test-start.js [--port 0]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neueTestDb } from "@lager/db/testdb.js";
import { erstelleApp } from "./app.js";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const db = await neueTestDb();
const { server } = erstelleApp({ pool: db.pool });
server.listen(Number(arg("port", 0)), "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../e2e/.server-url"), url);
  console.log(`Testserver: ${url} (Schema ${db.schema})`);
});
const stopp = async () => { server.close(); await db.ende(); process.exit(0); };
process.on("SIGINT", stopp); process.on("SIGTERM", stopp);
