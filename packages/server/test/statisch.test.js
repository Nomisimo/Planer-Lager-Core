import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { starteTestServer } from "./helfer.js";
import { baueStationWeb } from "../../station-web/build.js";
import { STATION_DIST } from "../src/statisch.js";

test("UI-8 station-web: Asset mit Hash im Namen (dauerhaft cachebar), Seite ohne Cache", async () => {
  const { datei, hash } = await baueStationWeb({ minify: false });
  assert.match(datei, /^app\.[0-9a-f]{12}\.js$/);
  assert.ok(fs.readFileSync(path.join(STATION_DIST, "index.html"), "utf8").includes(`/assets/app.${hash}.js`));
  const s = await starteTestServer();
  try {
    const seite = await s.api("GET", "/station");
    assert.equal(seite.status, 200);
    assert.equal(seite.headers.get("cache-control"), "no-store");
    const a = await s.api("GET", `/assets/${datei}`);
    assert.equal(a.status, 200);
    assert.match(a.headers.get("cache-control"), /immutable/);
    assert.equal((await s.api("GET", "/assets/..%2Fpackage.json")).status, 404);
  } finally { await s.ende(); }
});

test("R-11 /admin/login/ leitet auf die gesicherte Anmeldeseite um", async () => {
  const s = await starteTestServer();
  try {
    const r = await fetch(s.url + "/admin/login/", { redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/login");
  } finally { await s.ende(); }
});
