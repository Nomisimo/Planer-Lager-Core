#!/usr/bin/env node
// Vergleicht die IDs der Spec (docs/spec/INDEX.md) mit den IDs in Testnamen aller drei Repos.
// Aufruf: node scripts/spec-abdeckung.js [--json]
// Weitere Repos: LAGER_REPOS="../Materialplaner:../Productionplaner" (Standard: Geschwister-Ordner)
"use strict";
const fs = require("fs");
const path = require("path");

const CORE = path.join(__dirname, "..");
const repos = (process.env.LAGER_REPOS || ["../Materialplaner", "../Productionplaner"].join(":"))
  .split(":").map((r) => path.resolve(CORE, r)).filter((r) => fs.existsSync(r));
repos.unshift(CORE);

// Spec-IDs. E-x sind Entscheidungen, keine testbaren Anforderungen.
const ID_RE = /\b(?:R-\d+[a-z]?|FA-\d+|NFA-\d+|T-\d+|UI-\d+)\b/g;
const index = fs.readFileSync(path.join(CORE, "docs/spec/INDEX.md"), "utf8");
const specIds = new Set(index.match(ID_RE) || []);
// R-11 hat Unterregeln R-11a–g; R-SCAN-n aus D-16 zählt zusätzlich, ist aber kein Muss.

const IGNORIER = new Set(["node_modules", ".git", "dist", "dist-app", "dist-test", "core", "e2e/artefakte"]);
const TEST_DATEI = /\.(test|spec)\.(m?js|jsx)$/;
const TEST_AUFRUF = /\b(?:test|it|describe)(?:\.\w+)?\(\s*(["'`])([\s\S]*?)\1/g;

function* dateien(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORIER.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* dateien(p);
    else if (TEST_DATEI.test(e.name)) yield p;
  }
}

const gefunden = new Map(); // id -> [datei]
for (const repo of repos) {
  for (const datei of dateien(repo)) {
    const text = fs.readFileSync(datei, "utf8");
    for (const m of text.matchAll(TEST_AUFRUF)) {
      for (const id of m[2].match(ID_RE) || []) {
        if (!gefunden.has(id)) gefunden.set(id, []);
        gefunden.get(id).push(path.relative(path.dirname(CORE), datei));
      }
    }
  }
}

const sortiere = (a, b) => {
  const [pa, na] = a.split("-"), [pb, nb] = b.split("-");
  return pa === pb ? parseInt(na, 10) - parseInt(nb, 10) || na.localeCompare(nb) : pa.localeCompare(pb);
};
const fehlend = [...specIds].filter((id) => !gefunden.has(id)).sort(sortiere);
const abgedeckt = [...specIds].filter((id) => gefunden.has(id)).length;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ gesamt: specIds.size, abgedeckt, fehlend }, null, 2));
} else {
  console.log(`Spec-Abdeckung: ${abgedeckt}/${specIds.size} IDs haben mindestens einen Test (Repos: ${repos.map((r) => path.basename(r)).join(", ")})`);
  if (fehlend.length) console.log(`Fehlend (${fehlend.length}): ${fehlend.join(" ")}`);
  else console.log("Keine fehlenden IDs.");
}
process.exitCode = fehlend.length ? 1 : 0;
