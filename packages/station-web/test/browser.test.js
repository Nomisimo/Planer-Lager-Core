// NFA-09 Browser: Arbeitsplatz-Web läuft in aktuellen Safari, Chrome, Firefox, Edge.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { BROWSER_ZIELE, baueStationWeb } from "../build.js";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

test("NFA-09 Bundle ist für Safari, Chrome, Firefox und Edge übersetzt", async () => {
  for (const b of ["safari", "chrome", "firefox", "edge"]) assert.ok(BROWSER_ZIELE.some((z) => z.startsWith(b)), `${b} fehlt`);
  const { datei } = await baueStationWeb(); // scheitert, wenn Code für diese Ziele nicht übersetzbar ist
  // Zweite Übersetzung mit denselben Zielen muss ohne Fehler durchgehen: keine Syntax, die diese Browser nicht kennen.
  const r = await esbuild.transform(fs.readFileSync(path.join(DIST, datei), "utf8"), { target: BROWSER_ZIELE, logLevel: "silent" });
  assert.ok(r.code.length > 1000);
});
