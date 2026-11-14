#!/usr/bin/env node
// Startet alle Unit- und API-Tests (packages/*/test/**/*.test.js) mit node --test.
// Vorher: PostgreSQL bereit (bash scripts/db-test.sh). Filter: node scripts/test.js domain server
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const filter = process.argv.slice(2);
const dateien = [];
const sammle = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sammle(p);
    else if (/\.test\.m?js$/.test(e.name)) dateien.push(path.relative(ROOT, p));
  }
};
for (const pkg of fs.readdirSync(path.join(ROOT, "packages")).sort()) {
  if (filter.length && !filter.includes(pkg)) continue;
  sammle(path.join(ROOT, "packages", pkg, "test"));
}
if (!dateien.length) { console.log("Keine Tests gefunden."); process.exit(0); }
const r = spawnSync(process.execPath, ["--test", "--test-reporter=dot", ...dateien], {
  cwd: ROOT, stdio: "inherit", env: { TZ: "Europe/Berlin", ...process.env },
});
process.exit(r.status ?? 1);
