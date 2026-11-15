// KLICK-01 bis KLICK-06 (ZUSATZ.md Phase 17): Klick-Durchlauf über beide Apps (Electron + Browser) und station-web,
// frische Datenbank mit Demo-Daten (--seed demo), je Rolle. Bericht: e2e/artefakte/klick-bericht.json.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { starteServer, starteApp, starteBrowser, warteBis, webAppsDir, screenshot } from "./helfer.js";
import { beobachte, durchlaufe, pruefeSeite, warteFertig, schreibeBericht } from "./klick-helfer.js";
import { ladeBeispiel, BEISPIEL_PASSWORT } from "../packages/server/src/beispiel.js";
import { MENUE, menueFuer } from "../packages/ui/src/menue.js";

const ROLLEN = [["beispiel-admin", "Administrator"], ["lena", "Lagerleitung"], ["tom", "Lager / Techniker"], ["paula", "Büro / Disposition"], ["platz1", "Lager-Arbeitsplatz"]];
const APPS = { materialplaner: "m", productionplaner: "p" };
const bericht = { laeufe: [], fehler: [], befunde: [], langsam: [], unbesucht: [], rechte: [] };
let s, web;

before(async () => {
  web = webAppsDir();
  s = await starteServer({ config: { webAppsDir: web } });
  await ladeBeispiel({ pool: s.db.pool, config: { dataDir: s.dataDir } });
});
after(async () => { schreibeBericht(bericht); await s?.ende(); if (web) fs.rmSync(web, { recursive: true, force: true }); });

const rechteVon = async (rolle) => (await s.db.pool.query("SELECT rechte FROM rolle WHERE name = $1", [rolle])).rows[0].rechte;

async function anmelden(seite, benutzer) {
  await seite.getByLabel("Benutzername").fill(benutzer);
  await seite.getByLabel("Passwort").fill(BEISPIEL_PASSWORT);
  await seite.getByRole("button", { name: "Anmelden" }).click();
  return Promise.race([
    seite.getByTestId("benutzer").waitFor({ timeout: 10000 }).then(() => true),
    seite.locator(".lp-meldung[data-level=error]").first().waitFor({ timeout: 10000 }).then(() => false),
  ]);
}
async function abmelden(seite) {
  await seite.getByRole("button", { name: "Abmelden" }).click();
  await seite.getByLabel("Benutzername").waitFor({ timeout: 10000 });
}

/** KLICK-06: Menü zeigt genau die erlaubten Einträge; verbotene Hash-Routen zeigen „Zugriff verweigert“. */
async function pruefeRechte(seite, app, rolle, lauf) {
  const rechte = await rechteVon(rolle);
  const erwartet = menueFuer(rechte, app).flatMap((g) => g.eintraege.map((e) => e.titel)).sort();
  const sichtbar = (await seite.locator("nav[aria-label=Hauptmenü] button.lp-menue-eintrag").allInnerTexts()).map((t) => t.trim()).sort();
  if (JSON.stringify(erwartet) !== JSON.stringify(sichtbar)) bericht.rechte.push(`${lauf}: Menü ${JSON.stringify(sichtbar)} statt ${JSON.stringify(erwartet)}`);
  const verboten = MENUE.flatMap((g) => g.eintraege).filter((e) => !erwartet.includes(e.titel) && (e.app === "beide" || e.app === app) && e.pfad !== "/");
  for (const e of verboten) {
    await seite.evaluate((p) => { location.hash = "#" + p; }, e.pfad);
    const ok = await seite.getByRole("heading", { name: "Zugriff verweigert" }).first().waitFor({ timeout: 5000 }).then(() => true, () => false);
    if (!ok) bericht.rechte.push(`${lauf}: ${e.pfad} ohne Recht zeigt nicht „Zugriff verweigert“`);
  }
  await seite.evaluate(() => { location.hash = "#/"; });
  return verboten.length;
}

async function laufInApp(seite, app, plattform, [benutzer, rolle], { tief }) {
  const lauf = `${app} · ${plattform} · ${rolle}`;
  const wo = { seite: "Anmeldung" };
  const fehler = beobachte(seite, wo);
  const drin = await anmelden(seite, benutzer);
  if (!drin) {
    // Arbeitsplatz-Konto: kein Zugang zu den Apps, verständliche Meldung statt Absturz
    const text = await seite.locator(".lp-meldung").first().innerText().catch(() => "");
    bericht.laeufe.push({ lauf, zugang: false, meldung: text });
    bericht.fehler.push(...fehler.map((f) => `${lauf}: ${f}`));
    return null;
  }
  const r = await durchlaufe(seite, { tief, wo, fehler });
  const verboten = await pruefeRechte(seite, APPS[app], rolle, lauf);
  bericht.laeufe.push({ lauf, zugang: true, besucht: r.besucht, knoepfe: r.knoepfe, formulareLeer: r.formulareLeer, bestaetigungen: r.bestaetigungen, verbotenGeprueft: verboten, zeiten: r.zeiten });
  bericht.befunde.push(...r.befunde.map((b) => `${lauf}: ${b}`));
  for (const [t, ms] of Object.entries(r.zeiten)) if (ms > 1000) bericht.langsam.push(`${lauf}: ${t} ${ms} ms`);
  bericht.fehler.push(...fehler.map((f) => `${lauf}: ${f}`));
  await abmelden(seite);
  return r;
}

/** KLICK-04: bei 1024×768 nichts breiter als das Fenster. */
async function schmal(seite, app, plattform) {
  const menue = seite.locator("nav[aria-label=Hauptmenü] button.lp-menue-eintrag");
  for (let i = 0; i < await menue.count(); i++) {
    const e = menue.nth(i);
    if (await e.getAttribute("title")) continue;
    const titel = (await e.innerText()).trim();
    await e.click();
    await warteFertig(seite, Date.now());
    for (const b of await pruefeSeite(seite)) bericht.befunde.push(`${app} · ${plattform} · 1024×768 · ${titel}: ${b}`);
  }
}

const besuchtAlle = (app) => {
  const alle = MENUE.flatMap((g) => g.eintraege).filter((e) => e.app === "beide" || e.app === APPS[app]).map((e) => e.titel);
  const besucht = new Set(bericht.laeufe.filter((l) => l.lauf.startsWith(app) && l.besucht).flatMap((l) => l.besucht));
  return alle.filter((t) => !besucht.has(t));
};

for (const app of Object.keys(APPS)) {
  test(`KLICK-01 KLICK-02 KLICK-03 KLICK-04 KLICK-05 KLICK-06 ${app} als Electron-App: alle Menüeinträge, Tabs, Knöpfe und Dialoge je Rolle`, { timeout: 400000 }, async () => {
    const a = await starteApp(app, s.url);
    try {
      for (const rolle of ROLLEN) await laufInApp(a.win, app, "Electron", rolle, { tief: rolle[1] === "Administrator" });
      // KLICK-04: schmales Fenster
      await a.win.setViewportSize({ width: 1024, height: 768 });
      await anmelden(a.win, "beispiel-admin");
      await schmal(a.win, app, "Electron");
      await screenshot(a.win, `KLICK-${app}-1024`);
      await abmelden(a.win);
    } finally { await a.ende(); }
    bericht.unbesucht.push(...besuchtAlle(app).map((t) => `${app}: ${t}`));
  });
}

test("KLICK-01 KLICK-02 KLICK-03 KLICK-06 beide Apps im Browser: Admin tief, Fachrollen mit Rechteprüfung", { timeout: 400000 }, async () => {
  const b = await starteBrowser();
  try {
    for (const app of Object.keys(APPS)) {
      const seite = await b.neueSeite();
      await seite.goto(`${s.url}/${app}/`);
      for (const rolle of ROLLEN.filter((r) => r[1] !== "Lager-Arbeitsplatz")) await laufInApp(seite, app, "Browser", rolle, { tief: rolle[1] === "Administrator" });
      await seite.close();
    }
  } finally { await b.ende(); }
});

test("KLICK-02 KLICK-03 station-web im Browser mit Arbeitsplatz-Konto: Einrichten, Entsperren, Ansichten", async () => {
  const b = await starteBrowser();
  const seite = b.seite;
  const wo = { seite: "station" };
  const fehler = beobachte(seite, wo);
  try {
    const admin = await fetch(`${s.url}/api/v1/anmelden`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ benutzername: "beispiel-admin", passwort: BEISPIEL_PASSWORT }) }).then((r) => r.json());
    // Der tiefe Durchlauf löst auch Löschen-Bestätigungen aus; die Ladezone daher hier sicherstellen.
    const { rows: [zone] } = await s.db.pool.query("INSERT INTO ladezone (bezeichnung) VALUES ('Rampe Klick') ON CONFLICT DO NOTHING RETURNING id")
      .then((r) => (r.rows.length ? r : s.db.pool.query("SELECT id FROM ladezone WHERE bezeichnung = 'Rampe Klick'")));
    const ap = await fetch(`${s.url}/api/v1/verwaltung/arbeitsplaetze`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` }, body: JSON.stringify({ name: "Packplatz Klick", art: "packen", ladezone_id: zone.id }) }).then((r) => r.json());
    assert.ok(ap.code, JSON.stringify(ap));
    await seite.goto(`${s.url}/station`);
    await seite.getByLabel("Einrichtungscode").fill(ap.code);
    await seite.getByRole("button", { name: "Einrichten" }).click();
    await seite.getByTestId("sperrbildschirm").waitFor();
    for (const x of await pruefeSeite(seite)) bericht.befunde.push(`station · Sperrbildschirm: ${x}`);
    await seite.getByRole("button", { name: /Kai Kommissionierer/ }).click();
    await seite.getByLabel("PIN für Kai Kommissionierer").fill("1234");
    await seite.getByRole("button", { name: "Entsperren" }).click();
    await seite.getByTestId("mitarbeiter").getByText("Kai Kommissionierer").waitFor();
    wo.seite = "station · Packplatz";
    for (const x of await pruefeSeite(seite)) bericht.befunde.push(`station · Packplatz: ${x}`);
    await screenshot(seite, "KLICK-station");
    const anzeige = await b.neueSeite();
    beobachte(anzeige, { seite: "anzeige" });
    await anzeige.goto(`${s.url}/anzeige`);
    await warteBis(async () => (await anzeige.locator("body").innerText()).trim().length > 5);
    bericht.laeufe.push({ lauf: "station-web · Browser · Lager-Arbeitsplatz", zugang: true, besucht: ["Sperrbildschirm", "Packplatz", "Anzeige"] });
  } finally { bericht.fehler.push(...fehler.map((f) => `station-web: ${f}`)); await b.ende(); }
});

test("KLICK-01 KLICK-02 KLICK-03 KLICK-04 KLICK-05 KLICK-06 Auswertung: jeder Menüeintrag besucht, keine Fehler, keine Befunde, Ladezeit unter 1 s, Rechte stimmen", () => {
  schreibeBericht(bericht);
  assert.deepEqual(bericht.unbesucht, [], "KLICK-01 nie besuchte Menüeinträge");
  assert.deepEqual(bericht.fehler, [], "KLICK-02 Fehler in Konsole/Seite/Server");
  assert.deepEqual(bericht.befunde, [], "KLICK-03/04 Befunde");
  assert.deepEqual(bericht.langsam, [], "KLICK-05 Seiten über 1 s");
  assert.deepEqual(bericht.rechte, [], "KLICK-06 Rechte");
  const tief = bericht.laeufe.filter((l) => l.knoepfe);
  assert.ok(tief.reduce((n, l) => n + l.knoepfe, 0) > 50, "Knöpfe ausgelöst");
  assert.ok(tief.reduce((n, l) => n + l.formulareLeer, 0) > 3, "KLICK-05 Formulare leer abgeschickt");
});
