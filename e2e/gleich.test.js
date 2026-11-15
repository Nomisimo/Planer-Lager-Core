// Phase 17 GLEICH (ZUSATZ.md, ARCHITEKTUR §12): gleichzeitig arbeiten in Desktop-Apps und Browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { starteServer, starteApp, starteBrowser, anmelden, screenshot, warteBis, webAppsDir } from "./helfer.js";

const PW = "Sicheres-Testpasswort-1";
const imBrowserAnmelden = async (seite, benutzer) => {
  await seite.getByLabel("Benutzername").fill(benutzer);
  await seite.getByLabel("Passwort").fill(PW);
  await seite.getByRole("button", { name: "Anmelden" }).click();
  await seite.getByTestId("benutzer").waitFor({ timeout: 10000 });
};
const jahrJetzt = () => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(new Date());

/** Kunde, Artikel mit Geräten, Projekt mit angenommenem Angebot (Akku × 2). */
async function grunddaten(s, { mitAngebot = true, nr = 1 } = {}) {
  const q = (sql, w) => s.db.pool.query(sql, w);
  const jahr = jahrJetzt();
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ($1) RETURNING id", [`Anna Müller ${nr}`]);
  const { rows: [p] } = await q(`INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ($1, 'projekt', $2, $3, 'bestaetigt', '2027-05-01') RETURNING id, nummer`,
    [`P-${jahr}-00${nr}`, `Stadtfest ${nr}`, k.id]);
  if (!mitAngebot) return { p };
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 3) RETURNING id");
  const { rows: [akku] } = await q("INSERT INTO artikel (name, kategorie_id, preis_tag) VALUES ('Akku', $1, 1500) RETURNING id", [kat.id]);
  for (const c of ["LI-0001", "LI-0002", "LI-0003"]) await q("INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ($1, $2, (now() AT TIME ZONE 'Europe/Berlin')::date)", [c, akku.id]);
  const { rows: [a] } = await q("INSERT INTO angebot (nummer, projekt_id, status, betreff) VALUES ($1, $2, 'entwurf', 'Licht') RETURNING id, nummer", [`A-${jahr}-00${nr}`, p.id]);
  await q("INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, bezeichnung, menge, einzelpreis) VALUES ($1, 1, 'miete', $2, 'Akku', 2, 1500)", [a.id, akku.id]);
  return { p, a, akku };
}

test("GLEICH-01 dasselbe Angebot in P-Desktop und P-Browser: Band bei Änderung, zweites Speichern bekommt 409 mit Vergleich, nichts geht verloren", async () => {
  const web = webAppsDir();
  const s = await starteServer({ config: { webAppsDir: web } });
  await s.benutzer("chef", "Administrator", "Clara Chef");
  await s.benutzer("bea", "Büro / Disposition", "Bea Büro");
  const { a } = await grunddaten(s);
  const pd = await starteApp("productionplaner", s.url);
  const b = await starteBrowser();
  try {
    const pb = b.seite;
    await anmelden(pd.win, "chef");
    await pd.win.evaluate((id) => { location.hash = `#/angebote/${id}`; }, a.id);
    await pb.goto(`${s.url}/productionplaner/#/angebote/${a.id}`);
    await imBrowserAnmelden(pb, "bea");
    for (const w of [pd.win, pb]) await w.getByLabel("Betreff").waitFor();
    await warteBis(async () => (await pb.getByLabel("Betreff").inputValue()) === "Licht");
    // Beide tippen, Desktop speichert zuerst
    await pb.getByLabel("Betreff").fill("Licht und Ton");
    await pd.win.getByLabel("Betreff").fill("Licht Bühne");
    await pd.win.getByRole("button", { name: "Speichern", exact: true }).click();
    await warteBis(async () => (await s.db.pool.query("SELECT betreff FROM angebot WHERE id = $1", [a.id])).rows[0].betreff === "Licht Bühne");
    // Browser hat ungespeicherte Eingaben: Band statt stillem Neuladen, Eingabe bleibt
    await pb.getByTestId("aenderungs-band").getByText("Clara Chef hat das gerade geändert.").waitFor({ timeout: 10000 });
    assert.equal(await pb.getByLabel("Betreff").inputValue(), "Licht und Ton");
    await screenshot(pb, "GLEICH-01-band");
    await pb.getByTestId("aenderungs-band").getByRole("button", { name: "Meine Eingaben behalten" }).click();
    // Zweites Speichern mit alter Fassung → 409 + Vergleich
    await pb.getByRole("button", { name: "Speichern", exact: true }).click();
    const konflikt = pb.getByTestId("fassung-konflikt");
    await konflikt.waitFor({ timeout: 10000 });
    await pb.getByText(/^Das hat gerade Clara Chef geändert \(\d\d\.\d\d\., \d\d:\d\d Uhr\)\. Deine Eingaben sind noch da\./).waitFor();
    const zeile = konflikt.getByRole("row").filter({ hasText: "Betreff" });
    await zeile.getByText("Licht und Ton").waitFor();
    await zeile.getByText("Licht Bühne").waitFor();
    assert.equal((await s.db.pool.query("SELECT betreff FROM angebot WHERE id = $1", [a.id])).rows[0].betreff, "Licht Bühne", "nichts still überschrieben");
    assert.equal(await pb.getByLabel("Betreff").inputValue(), "Licht und Ton", "Eingaben sind noch da");
    await screenshot(pb, "GLEICH-01-vergleich");
    // Bewusst die eigenen Eingaben übernehmen
    await konflikt.getByRole("button", { name: "Meine Eingaben behalten" }).click();
    await pb.getByRole("button", { name: "Speichern", exact: true }).click();
    await warteBis(async () => (await s.db.pool.query("SELECT betreff FROM angebot WHERE id = $1", [a.id])).rows[0].betreff === "Licht und Ton");
    // Desktop ohne eigene Eingaben lädt die neue Fassung live
    await warteBis(async () => (await pd.win.getByLabel("Betreff").inputValue()) === "Licht und Ton", { timeout: 10000 });
  } finally { await b.ende(); await pd.ende(); await s.ende(); fs.rmSync(web, { recursive: true, force: true }); }
});

test("GLEICH-02 GLEICH-04 Angebotsposition in P ändern, während M packt: Packliste live + Hinweis; Projekt in P löschen, während es in M offen ist", async () => {
  const s = await starteServer();
  await s.benutzer("chef", "Administrator", "Clara Chef");
  const { p, a } = await grunddaten(s);
  const { p: leer } = await grunddaten(s, { mitAngebot: false, nr: 2 });
  await s.db.pool.query("UPDATE angebot SET status = 'versendet' WHERE id = $1", [a.id]);
  const m = await starteApp("materialplaner", s.url);
  const pp = await starteApp("productionplaner", s.url);
  try {
    await anmelden(m.win, "chef");
    await anmelden(pp.win, "chef");
    await m.win.evaluate((id) => { location.hash = `#/projekte/${id}/packen`; }, p.id);
    const packliste = m.win.locator("section, .lp-section").filter({ hasText: "Packliste" }).locator("table.lp-tabelle");
    await packliste.getByText("Akku").waitFor();
    await packliste.getByRole("row").filter({ hasText: "Akku" }).getByRole("cell", { name: /^2\b/ }).first().waitFor();
    // GLEICH-02: P ändert die Menge im versendeten Angebot (Packliste kommt daraus, D-63)
    await pp.win.evaluate((id) => { location.hash = `#/angebote/${id}`; }, a.id);
    await pp.win.getByLabel("Menge Position 1").waitFor();
    await warteBis(async () => !(await pp.win.getByLabel("Menge Position 1").isDisabled()));
    await pp.win.getByLabel("Menge Position 1").fill("3");
    await pp.win.getByRole("button", { name: "Speichern", exact: true }).click();
    await m.win.getByText("Clara Chef hat das Angebot geändert. Die Packliste ist aktualisiert.").waitFor({ timeout: 10000 });
    await packliste.getByRole("row").filter({ hasText: "Akku" }).getByRole("cell", { name: /^3\b/ }).first().waitFor({ timeout: 10000 });
    await screenshot(m.win, "GLEICH-02-packliste-live");
    // GLEICH-04: leeres Projekt in M offen, in P löschen
    await m.win.evaluate((id) => { location.hash = `#/projekte/${id}/packen`; }, leer.id);
    await m.win.getByText("Stadtfest 2").first().waitFor();
    await pp.win.evaluate((id) => { location.hash = `#/projekte/${id}`; }, leer.id);
    await pp.win.getByRole("button", { name: "Projekt löschen" }).click();
    await pp.win.getByRole("dialog").getByRole("button", { name: "Löschen" }).click();
    await m.win.getByText("Das Projekt wurde von Clara Chef gelöscht.").waitFor({ timeout: 10000 });
    await screenshot(m.win, "GLEICH-04-geloescht");
    await m.win.getByRole("button", { name: "Zurück zur Liste" }).click();
    await warteBis(async () => (await m.win.evaluate(() => location.hash)) === "#/scan");
  } finally { await pp.ende(); await m.ende(); await s.ende(); }
});

test("GLEICH-05 GLEICH-06 derselbe Nutzer in M-Desktop, P-Desktop und P-Browser: Präsenz-Chips erscheinen und verschwinden, Status überall synchron", async () => {
  const web = webAppsDir();
  const s = await starteServer({ config: { webAppsDir: web } });
  await s.benutzer("chef", "Administrator", "Clara Chef");
  await s.benutzer("bea", "Büro / Disposition", "Bea Büro");
  const { p } = await grunddaten(s);
  const m = await starteApp("materialplaner", s.url);
  const pd = await starteApp("productionplaner", s.url);
  const b = await starteBrowser();
  try {
    await anmelden(m.win, "chef");
    await anmelden(pd.win, "chef");
    await m.win.evaluate((id) => { location.hash = `#/projekte/${id}/packen`; }, p.id);
    await m.win.getByText("Stadtfest 1").first().waitFor();
    assert.equal(await m.win.getByTestId("praesenz-chip").count(), 0, "allein: keine Chips");
    await pd.win.evaluate((id) => { location.hash = `#/projekte/${id}`; }, p.id);
    await m.win.getByTestId("praesenz-chip").getByText("Du (Productionplaner)").waitFor({ timeout: 10000 });
    const pb = b.seite;
    await pb.goto(`${s.url}/productionplaner/#/projekte/${p.id}`);
    await imBrowserAnmelden(pb, "chef");
    await m.win.getByTestId("praesenz-chip").getByText("Du (Productionplaner im Browser)").waitFor({ timeout: 10000 });
    await pd.win.getByTestId("praesenz-chip").getByText("Du (Materialplaner)").waitFor();
    // Andere Person kommt dazu: Name als Chip
    const zweit = await b.neueSeite();
    await zweit.goto(`${s.url}/productionplaner/#/projekte/${p.id}`);
    await imBrowserAnmelden(zweit, "bea");
    await m.win.getByTestId("praesenz-chip").getByText("Bea Büro").waitFor({ timeout: 10000 });
    await screenshot(m.win, "GLEICH-06-praesenz");
    // GLEICH-05: Status im Browser ändern → beide Desktop-Apps zeigen ihn live
    await pb.getByLabel("Status ändern").selectOption({ label: "Läuft" });
    await m.win.getByText(/· Läuft/).first().waitFor({ timeout: 10000 });
    await warteBis(async () => (await pd.win.getByLabel("Status ändern").inputValue()) === "laeuft", { timeout: 10000 });
    // Verlassen: Chips verschwinden
    await zweit.close();
    await m.win.getByTestId("praesenz-chip").getByText("Bea Büro").waitFor({ state: "detached", timeout: 10000 });
    await pd.win.evaluate(() => { location.hash = "#/kunden"; });
    await m.win.getByTestId("praesenz-chip").getByText("Du (Productionplaner)", { exact: true }).waitFor({ state: "detached", timeout: 10000 });
    await m.win.getByTestId("praesenz-chip").getByText("Du (Productionplaner im Browser)").waitFor();
  } finally { await b.ende(); await pd.ende(); await m.ende(); await s.ende(); fs.rmSync(web, { recursive: true, force: true }); }
});
