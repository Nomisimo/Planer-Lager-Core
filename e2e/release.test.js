// REL-01, REL-02, REL-04 (ZUSATZ.md Phase 19): statische Prüfung über alle drei Repos (der E2E-Job hat alle ausgecheckt).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { APP_DIRS, starteServer, starteApp, anmelden, screenshot, webAppsDir } from "./helfer.js";
import { changelogAbschnitt } from "../packages/ui/src/version.js";

const CORE = path.join(import.meta.dirname, "..");
const APPS = Object.values(APP_DIRS);

test("REL-02 jede App hat im CHANGELOG einen Abschnitt für ihre Version", () => {
  for (const d of APPS) {
    const v = JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8")).version;
    assert.ok(changelogAbschnitt(fs.readFileSync(path.join(d, "CHANGELOG.md"), "utf8"), v), `${path.basename(d)}: CHANGELOG hat keinen Abschnitt für ${v}`);
  }
});

test("REL-01 beide Apps tragen dieselbe Version; Release-Workflow legt Tag, Release, Installer und latest*.yml an", () => {
  const versionen = APPS.map((d) => JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8")).version);
  assert.equal(versionen[0], versionen[1]);
  for (const d of APPS) {
    const wf = fs.readFileSync(path.join(d, ".github", "workflows", "release.yml"), "utf8");
    assert.match(wf, /workflow_dispatch/);
    assert.match(wf, /latest.*\.yml/);
    assert.match(wf, /\.(exe|dmg)/);
    assert.match(wf, /gh release|softprops|action-gh-release|releases/);
  }
});

test("REL-04 LICENSE, NOTICE und Lizenz Apache-2.0 in allen drei Repos", () => {
  for (const d of [CORE, ...APPS]) {
    const n = path.basename(d);
    assert.match(fs.readFileSync(path.join(d, "LICENSE"), "utf8"), /Apache License\s+Version 2\.0/, `${n}: LICENSE`);
    assert.match(fs.readFileSync(path.join(d, "NOTICE"), "utf8"), /Apache License, Version 2\.0/, `${n}: NOTICE`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8")).license, "Apache-2.0", `${n}: package.json`);
  }
});

test("REL-02 REL-03 Desktop: Update-Hinweis bei neuerer Version auf GitHub, „Was ist neu?“ zeigt den CHANGELOG-Abschnitt", { timeout: 120000 }, async () => {
  const d = APP_DIRS.materialplaner;
  const v = JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8")).version;
  const abschnitt = changelogAbschnitt(fs.readFileSync(path.join(d, "CHANGELOG.md"), "utf8"), v);
  const ersteZeile = abschnitt.split("\n").find((z) => z.startsWith("- ")).slice(2).replace(/`([^`]+)`/g, "$1");
  // Ersatz für die GitHub-API: eine neuere Vorabversion und ein Entwurf
  const anfragen = [];
  const gh = http.createServer((req, res) => {
    anfragen.push(req.url);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify([{ tag_name: "v99.0.0", draft: true }, { tag_name: "v98.1.0-beta.1", prerelease: true, html_url: "https://github.com/Nomisimo/Materialplaner/releases/tag/v98.1.0-beta.1" }, { tag_name: `v${v}`, html_url: "x" }]));
  });
  await new Promise((r) => gh.listen(0, "127.0.0.1", r));
  const s = await starteServer();
  await s.benutzer("chef", "Administrator", "Clara Chef");
  const m = await starteApp("materialplaner", s.url, { env: { LAGER_UPDATE_URL: `http://127.0.0.1:${gh.address().port}/releases` } });
  try {
    const w = m.win;
    await anmelden(w, "chef");
    const hinweis = w.getByTestId("update-hinweis");
    await hinweis.getByText(`Version 98.1.0-beta.1 ist verfügbar (du hast ${v})`, { exact: false }).waitFor({ timeout: 10000 });
    await screenshot(w, "REL-03-update-hinweis");
    await hinweis.getByRole("button", { name: "Herunterladen" }).click();
    await w.waitForTimeout(200);
    assert.ok(m.externeLinks().includes("https://github.com/Nomisimo/Materialplaner/releases/tag/v98.1.0-beta.1"), m.externeLinks().join(", "));
    assert.ok(anfragen.length >= 1);
    // REL-02
    await w.getByTestId("version").click();
    const dlg = w.getByRole("dialog", { name: `Was ist neu in Version ${v}?` });
    await dlg.getByText(ersteZeile, { exact: false }).waitFor();
    await screenshot(w, "REL-02-was-ist-neu");
    await w.keyboard.press("Escape");
    await dlg.waitFor({ state: "detached" });
    await w.evaluate(() => { location.hash = "#/hilfe"; });
    await w.getByTestId("was-ist-neu").getByText(ersteZeile, { exact: false }).waitFor();
  } finally { await m.ende(); await s.ende(); gh.close(); }
});

test("REL-03 ohne neuere Version kein Hinweis; im Test ohne LAGER_UPDATE_URL keine Anfrage an GitHub", { timeout: 60000 }, async () => {
  const s = await starteServer();
  await s.benutzer("chef", "Administrator", "Clara Chef");
  const m = await starteApp("productionplaner", s.url);
  try {
    await anmelden(m.win, "chef");
    assert.equal(await m.win.evaluate(() => window.lagerShell.info().then((i) => i.updateUrl)), null);
    await m.win.waitForTimeout(500);
    assert.equal(await m.win.getByTestId("update-hinweis").count(), 0);
  } finally { await m.ende(); await s.ende(); }
});

test("WEB-14 echtes Web-Bundle beider Apps (npm run build:web): index ohne Inline-Script, gehashte Assets immutable, index no-store, Manifest", async () => {
  const web = webAppsDir();
  const s = await starteServer({ config: { webAppsDir: web } });
  try {
    for (const app of ["materialplaner", "productionplaner"]) {
      const i = await fetch(`${s.url}/${app}/`);
      const html = await i.text();
      assert.equal(i.headers.get("cache-control"), "no-store", app);
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${app}: Inline-Script im index`);
      const skripte = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
      assert.ok(skripte.length >= 1, `${app}: kein Script`);
      for (const src of skripte) {
        assert.match(src, /\.[0-9a-f]{8,}\.js$/, `${app}: ${src} ohne Hash`);
        const a = await fetch(new URL(src, `${s.url}/${app}/`));
        assert.equal(a.status, 200);
        assert.match(a.headers.get("cache-control") || "", /immutable/);
      }
      const m = html.match(/<link[^>]*rel="manifest"[^>]*href="([^"]+)"/);
      assert.ok(m, `${app}: Manifest-Link fehlt`);
      assert.equal((await fetch(new URL(m[1], `${s.url}/${app}/`))).status, 200);
    }
  } finally { await s.ende(); fs.rmSync(web, { recursive: true, force: true }); }
});
