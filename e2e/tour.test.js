// TOUR-01 bis TOUR-07 (ZUSATZ.md Phase 18): Willkommen, alle Touren mit allen Ankern, Rollen, Tasten, keine Daten-
// änderung, Browser, statische Anker-Prüfung. Je Tour ein Screenshot.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { starteServer, starteApp, starteBrowser, webAppsDir, screenshot, anmelden, PW, APP_DIRS } from "./helfer.js";
import { TOUREN, alleAnker } from "../packages/ui/src/tour/touren.js";
import { MENUE } from "../packages/ui/src/menue.js";

let s, web;
before(async () => {
  web = webAppsDir();
  s = await starteServer({ config: { webAppsDir: web } });
  await s.benutzer("chef", "Administrator", "Clara Chef");
  await s.benutzer("lager", "Lager / Techniker", "Lars Lager");
  await s.benutzer("neu", "Büro / Disposition", "Nora Neu");
  await s.db.pool.query("UPDATE benutzer SET tour = '{}' WHERE benutzername = 'neu'");
});
after(async () => { await s?.ende(); if (web) fs.rmSync(web, { recursive: true, force: true }); });

const q = (sql, w) => s.db.pool.query(sql, w);
const warnungen = (seite) => { const w = []; seite.on("console", (m) => { if (m.type() === "warning" && /Tour/.test(m.text())) w.push(m.text()); }); return w; };
const blase = (seite) => seite.getByTestId("tour-blase");

/** Startet eine Tour über die Hilfe und klickt sie bis zum Ende durch. Liefert die Schritt-Titel. */
async function laufe(seite, tour, { bild } = {}) {
  await seite.evaluate(() => { location.hash = "#/hilfe"; });
  await seite.getByRole("button", { name: `Tour „${tour.titel}“ starten` }).click();
  const titel = [];
  for (let n = 0; n < 30; n++) {
    const b = blase(seite);
    const da = await b.waitFor({ timeout: 4000 }).then(() => true, () => false);
    if (!da) break;
    const t = (await b.locator("h2").innerText()).trim();
    if (titel[titel.length - 1] !== t) titel.push(t);
    if (bild && titel.length === 2) await screenshot(seite, bild);
    const anker = await seite.getByTestId("tour").getAttribute("data-anker");
    const weiter = b.getByRole("button", { name: /^(Weiter|Fertig)$/ });
    if (await weiter.count()) await weiter.click();
    else await seite.locator(`[data-tour="${anker}"]`).first().click();
    await seite.waitForTimeout(80);
  }
  await seite.getByTestId("tour").waitFor({ state: "detached" });
  return titel;
}

async function zaehle() {
  const { rows } = await q("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name !~ '(sitzung|sicherheit|protokoll|anmeld)'");
  const z = {};
  for (const { t } of rows) z[t] = (await q(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n;
  return z;
}

test("TOUR-01 Willkommen genau beim ersten Login; „Später“ zeigt es wieder, „Nicht mehr anzeigen“ nie wieder, auch nicht in der anderen App", async () => {
  const m = await starteApp("materialplaner", s.url);
  try {
    const w = m.win;
    await anmelden(w, "neu");
    const willkommen = w.getByRole("dialog", { name: "Willkommen im Materialplaner" });
    await willkommen.waitFor({ timeout: 8000 }).catch(async () => { await screenshot(w, "TOUR-01-fehler"); throw new Error((await w.locator("body").innerText()).slice(0, 400)); });
    await screenshot(w, "TOUR-01-willkommen");
    await willkommen.getByRole("button", { name: "Später" }).click();
    await willkommen.waitFor({ state: "detached" });
    await w.getByRole("button", { name: "Abmelden" }).click();
    await anmelden(w, "neu");
    await willkommen.waitFor();
    await willkommen.getByRole("button", { name: "Nicht mehr anzeigen" }).click();
    await willkommen.waitFor({ state: "detached" });
    assert.equal((await q("SELECT tour->>'willkommen' AS w FROM benutzer WHERE benutzername = 'neu'")).rows[0].w, "true");
    await w.getByRole("button", { name: "Abmelden" }).click();
    await anmelden(w, "neu");
    await w.waitForTimeout(800);
    assert.equal(await w.getByRole("dialog", { name: /^Willkommen/ }).count(), 0, "nie wieder");
  } finally { await m.ende(); }
  const p = await starteApp("productionplaner", s.url);
  try {
    await anmelden(p.win, "neu");
    await p.win.waitForTimeout(800);
    assert.equal(await p.win.getByRole("dialog", { name: /^Willkommen/ }).count(), 0, "auch nicht in der anderen App");
  } finally { await p.ende(); }
});

test("TOUR-02 TOUR-04 TOUR-05 Admin: jede Tour beider Apps findet jeden Anker; Tasten → ← Esc; Touren ändern keine Daten", async () => {
  const vorher = await zaehle();
  for (const app of ["materialplaner", "productionplaner"]) {
    const a = await starteApp(app, s.url);
    try {
      const w = a.win;
      const warn = warnungen(w);
      await anmelden(w, "chef");
      for (const t of TOUREN.filter((x) => x.app === (app === "materialplaner" ? "m" : "p") || x.app === "beide")) {
        const titel = await laufe(w, t, { bild: `TOUR-02-${app}-${t.id}` });
        const erwartet = t.schritte.filter((x) => !x.nurWeb).map((x) => x.titel);
        assert.deepEqual(titel, erwartet, `${app}/${t.id}: alle Schritte gezeigt`);
      }
      assert.deepEqual(warn, [], `${app}: kein Anker fehlt`);
      const { rows: [u] } = await q("SELECT tour FROM benutzer WHERE benutzername = 'chef'");
      assert.ok(u.tour.erledigt.includes(app) && u.tour.erledigt.includes("zusammenspiel"), "erledigt gemerkt");
      // TOUR-04 Tasten
      await w.evaluate(() => { location.hash = "#/hilfe"; });
      await w.getByRole("button", { name: `Tour „${TOUREN.find((x) => x.id === "zusammenspiel").titel}“ starten` }).click();
      await blase(w).getByText(/Schritt 1 von/).waitFor();
      await w.keyboard.press("ArrowRight");
      await blase(w).getByText(/Schritt 2 von/).waitFor();
      await w.keyboard.press("ArrowLeft");
      await blase(w).getByText(/Schritt 1 von/).waitFor();
      await w.keyboard.press("Enter");
      await blase(w).getByText(/Schritt 2 von/).waitFor();
      await w.keyboard.press("Escape");
      await w.getByTestId("tour").waitFor({ state: "detached" });
    } finally { await a.ende(); }
  }
  assert.deepEqual(await zaehle(), vorher, "TOUR-05: keine Daten geändert");
});

test("TOUR-03 Lager-Rolle sieht keine Admin-Schritte und keine Schritte ohne Recht", async () => {
  const m = await starteApp("materialplaner", s.url);
  try {
    await anmelden(m.win, "lager");
    const t = TOUREN.find((x) => x.id === "materialplaner");
    const titel = await laufe(m.win, t);
    assert.ok(!titel.includes("Verwaltung (nur Admins)"), titel.join(", "));
    assert.ok(!titel.includes("Material aufnehmen"), "Lager / Techniker darf kein Material anlegen");
    assert.ok(titel.includes("Scanfeld") && titel.includes("Hilfe"));
  } finally { await m.ende(); }
});

test("TOUR-06 Touren laufen im Browser (beide Apps) und im Arbeitsplatz-Web", async () => {
  const b = await starteBrowser();
  try {
    for (const app of ["materialplaner", "productionplaner"]) {
      const seite = await b.neueSeite();
      const warn = warnungen(seite);
      await seite.goto(`${s.url}/${app}/`);
      await anmelden(seite, "chef");
      const t = TOUREN.find((x) => x.id === "zusammenspiel");
      const titel = await laufe(seite, t, { bild: `TOUR-06-browser-${app}` });
      assert.deepEqual(titel, t.schritte.filter((x) => !x.nurDesktop).map((x) => x.titel));
      assert.deepEqual(warn, []);
      await seite.close();
    }
    // Arbeitsplatz-Web: kurze Einführung
    const admin = await fetch(`${s.url}/api/v1/anmelden`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ benutzername: "chef", passwort: PW }) }).then((r) => r.json());
    const h = { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` };
    const zone = (await q("INSERT INTO ladezone (bezeichnung) VALUES ('Rampe Tour') RETURNING id")).rows[0];
    const ap = await fetch(`${s.url}/api/v1/verwaltung/arbeitsplaetze`, { method: "POST", headers: h, body: JSON.stringify({ name: "Packplatz Tour", art: "packen", ladezone_id: zone.id }) }).then((r) => r.json());
    await fetch(`${s.url}/api/v1/verwaltung/mitarbeiter`, { method: "POST", headers: h, body: JSON.stringify({ name: "Kim Kommission", pin: "4711" }) });
    const seite = b.seite;
    const warn = warnungen(seite);
    await seite.goto(`${s.url}/station`);
    await seite.getByLabel("Einrichtungscode").fill(ap.code);
    await seite.getByRole("button", { name: "Einrichten" }).click();
    await seite.getByRole("button", { name: /Kim Kommission/ }).click();
    await seite.getByLabel("PIN für Kim Kommission").fill("4711");
    await seite.getByRole("button", { name: "Entsperren" }).click();
    await seite.getByTestId("mitarbeiter").getByText("Kim Kommission").waitFor();
    await seite.getByRole("button", { name: "Kurze Einführung" }).click();
    const t = TOUREN.find((x) => x.id === "arbeitsplatz");
    for (let i = 0; i < t.schritte.length; i++) {
      await blase(seite).getByText(`Schritt ${i + 1} von ${t.schritte.length}`).waitFor();
      if (i === 1) await screenshot(seite, "TOUR-06-arbeitsplatz");
      await blase(seite).getByRole("button", { name: /^(Weiter|Fertig)$/ }).click();
    }
    await seite.getByTestId("tour").waitFor({ state: "detached" });
    assert.deepEqual(warn, []);
    await seite.getByTestId("mitarbeiter").getByText("Kim Kommission").waitFor(); // Tour hat nicht gesperrt
  } finally { await b.ende(); }
});

test("TOUR-07 Alle Anker aus touren.js kommen als tour=\"…\" / data-tour=\"…\" im Code vor", () => {
  const dateien = [];
  const sammle = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/node_modules|dist/.test(e.name)) sammle(p); } else if (/\.(jsx?|mjs)$/.test(e.name)) dateien.push(p); } };
  sammle(path.join(import.meta.dirname, "..", "packages"));
  for (const d of Object.values(APP_DIRS)) sammle(path.join(d, "src"));
  const code = dateien.filter((f) => !f.endsWith("touren.js")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const fehlt = alleAnker().filter((a) => {
    if (a.startsWith("menue-")) return !MENUE.some((g) => g.eintraege.some((e) => `menue-${e.pfad}` === a)) || !code.includes("data-tour={`menue-${e.pfad}`}");
    return !code.includes(`tour="${a}"`);
  });
  assert.deepEqual(fehlt, []);
});
