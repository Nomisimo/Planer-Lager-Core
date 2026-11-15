import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { starteTestServer, PW } from "./helfer.js";
import { legeBenutzerAn } from "../src/grunddaten.js";
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

test("REMOTE-03 /favicon.ico antwortet ohne Fehler (keine 404 in der Browser-Konsole)", async () => {
  const s = await starteTestServer();
  try {
    const r = await fetch(s.url + "/favicon.ico");
    assert.equal(r.status, 204);
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

/** Legt ein Web-Bundle wie `npm run build:web` an (index ohne Inline-Script, gehashte Assets, Manifest). */
function fakeBundle(dir, app) {
  fs.mkdirSync(path.join(dir, app, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, app, "index.html"), `<!DOCTYPE html><html><head><link rel="manifest" href="manifest.webmanifest"></head><body><div id="root"></div><script src="assets/app.0123456789ab.js"></script></body></html>`);
  fs.writeFileSync(path.join(dir, app, "assets", "app.0123456789ab.js"), "console.log(1)");
  fs.writeFileSync(path.join(dir, app, "manifest.webmanifest"), JSON.stringify({ name: app, start_url: `/${app}/` }));
}

test("WEB-14 Web-Bundle: index no-store + CSP, gehashte Assets immutable, Manifest, /app ohne Schrägstrich leitet um", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lager-web-"));
  fakeBundle(dir, "materialplaner"); fakeBundle(dir, "productionplaner");
  const s = await starteTestServer({ config: { webAppsDir: dir } });
  try {
    for (const app of ["materialplaner", "productionplaner"]) {
      const i = await s.api("GET", `/${app}/`);
      assert.equal(i.status, 200);
      assert.equal(i.headers.get("cache-control"), "no-store");
      assert.match(i.headers.get("content-security-policy"), /script-src 'self'/);
      assert.doesNotMatch(i.text, /<script>/);
      const a = await s.api("GET", `/${app}/assets/app.0123456789ab.js`);
      assert.equal(a.status, 200);
      assert.match(a.headers.get("cache-control"), /immutable/);
      assert.match(a.headers.get("content-type"), /javascript/);
      const m = await s.api("GET", `/${app}/manifest.webmanifest`);
      assert.equal(m.status, 200);
      assert.equal(m.json.start_url, `/${app}/`);
      const r = await fetch(`${s.url}/${app}`, { redirect: "manual" });
      assert.equal(r.status, 301);
      assert.equal(r.headers.get("location"), `/${app}/`);
      assert.equal((await s.api("GET", `/${app}/assets/..%2F..%2Fpackage.json`)).status, 404);
    }
  } finally { await s.ende(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("WEB-15 fehlt ein Web-Bundle, antwortet der Server 503 mit verständlichem Text", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lager-web-"));
  fakeBundle(dir, "materialplaner");
  const s = await starteTestServer({ config: { webAppsDir: dir } });
  try {
    assert.equal((await s.api("GET", "/materialplaner/")).status, 200);
    const r = await s.api("GET", "/productionplaner/");
    assert.equal(r.status, 503);
    assert.match(r.headers.get("content-type"), /text\/html/);
    assert.match(r.text, /nicht installiert\. Der Admin muss/);
  } finally { await s.ende(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("WEB-10 Portal / zeigt nur Kacheln, für die die Rolle Rechte hat", async () => {
  const s = await starteTestServer();
  try {
    const anon = await s.api("GET", "/");
    assert.equal(anon.status, 200);
    assert.doesNotMatch(anon.text, /<script/);
    assert.match(anon.text, /kachel-materialplaner/);
    assert.match(anon.text, /kachel-productionplaner/);
    const cookie = async (name, rolle) => {
      await legeBenutzerAn(s.db.pool, { benutzername: name, passwort: PW, rolle });
      const r = await s.api("POST", "/api/v1/anmelden", { benutzername: name, passwort: PW, art: "web" });
      return { Cookie: r.headers.get("set-cookie").split(";")[0] };
    };
    const admin = await s.api("GET", "/", undefined, await cookie("chef", "Administrator"));
    assert.match(admin.text, /kachel-materialplaner/);
    assert.match(admin.text, /kachel-productionplaner/);
    assert.match(admin.text, /kachel-station/);
    const lager = await s.api("GET", "/", undefined, await cookie("lager", "Lager-Arbeitsplatz"));
    assert.match(lager.text, /kachel-materialplaner/);
    assert.doesNotMatch(lager.text, /kachel-productionplaner/);
    assert.doesNotMatch(lager.text, /kachel-station/);
    const anzeige = await s.api("GET", "/", undefined, await cookie("tv", "Anzeige (Bildschirm)"));
    assert.doesNotMatch(anzeige.text, /kachel-(material|production)planer/);
    assert.match(anzeige.text, /keinen Zugriff/);
  } finally { await s.ende(); }
});
