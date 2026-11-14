import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ORDNER = [path.join(CORE, "packages"), path.join(CORE, "../Materialplaner/src"), path.join(CORE, "../Productionplaner/src")];
const ERLAUBT = [path.join(CORE, "packages/ui/src/plattform.js"), path.join(CORE, "packages/shell") + path.sep, path.join(CORE, "packages/ui/test") + path.sep];

function* dateien(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith("dist")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* dateien(p);
    else if (/\.(m?js|jsx|cjs)$/.test(e.name)) yield p;
  }
}

test("WEB-11 window.lagerShell nur in plattform.js und packages/shell", () => {
  const treffer = [];
  for (const d of ORDNER) for (const f of dateien(d)) {
    if (ERLAUBT.some((e) => f === e || f.startsWith(e))) continue;
    if (/\blagerShell\b/.test(fs.readFileSync(f, "utf8"))) treffer.push(path.relative(CORE, f));
  }
  assert.deepEqual(treffer, []);
});

test("WEB-08 Browser: Desktop-Funktionen nicht verfügbar, Desktop: verfügbar", async () => {
  globalThis.window = {};
  const { plattform, NUR_DESKTOP } = await import("../src/plattform.js");
  assert.equal(plattform.istWeb, true);
  assert.equal(plattform.anmeldungsArt, "cookie");
  for (const f of Object.keys(NUR_DESKTOP)) assert.equal(plattform.kann(f), false, f);
  assert.equal(plattform.kann("etikettenVorschau"), true);
  window.lagerShell = { serverSetzen() {} };
  assert.equal(plattform.istWeb, false);
  assert.equal(plattform.anmeldungsArt, "token");
  assert.equal(plattform.kann("kiosk"), true);
  assert.equal(plattform.kann("serverAdresse"), true);
  delete globalThis.window;
});
