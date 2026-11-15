// NUTZER-05 Planung über die Woche: Paula plant im Desktop-Productionplaner (Kalender, Aufgaben, Planungszeit-Timer),
// wechselt in den Materialplaner (Browser) und zurück, bucht Zeit nach und lädt die Auswertung als CSV im Browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { starteApp, starteBrowser, warteBis } from "./helfer.js";
import { arbeitstag, imBrowser, melde, menue, bild } from "./nutzer-helfer.js";

test("NUTZER-05 Planung über die Woche: Kalender, Aufgaben, Planungszeit-Timer, Wechsel M ↔ P, CSV", { timeout: 240000 }, async () => {
  const s = await arbeitstag();
  const q = s.q;
  const { rows: [fest] } = await q("SELECT id, nummer FROM projekt WHERE name = 'Stadtfest Neustadt'");
  const eintraege = async () => (await q("SELECT minuten, quelle, laeuft_seit FROM zeiteintrag WHERE projekt_id = $1 ORDER BY id", [fest.id])).rows;
  const p = await starteApp("productionplaner", s.url);
  const b = await starteBrowser();
  try {
    const w = p.win;
    await melde(w, "paula");
    // Montag: Wochenblick im Kalender, Stadtfest anklicken
    await menue(w, "Kalender");
    const balken = w.locator(".lp-kalender-balken[title*=\"Stadtfest Neustadt\"]").first();
    await w.locator(".lp-kalender-balken").first().waitFor();
    if (!(await balken.isVisible().catch(() => false))) await w.getByRole("button", { name: "Nächster Monat" }).click();
    await balken.waitFor({ timeout: 5000 }).catch(async () => { await bild(w, "NUTZER-05", "kalender-fehler"); throw new Error(await w.locator(".lp-inhalt").innerText()); });
    await bild(w, "NUTZER-05", "kalender");
    await balken.click();
    await w.getByRole("heading", { name: `${fest.nummer} Stadtfest Neustadt` }).waitFor();
    // Aufgabe für Mittwoch anlegen
    await w.getByRole("tab", { name: /Aufgaben/ }).click();
    const mittwoch = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + 2 * 86400000));
    await w.getByLabel("Neue Aufgabe").fill("Bühnenplan an den Ton schicken");
    await w.getByLabel("Fällig am").fill(mittwoch);
    await w.getByLabel("Zuständig").selectOption({ label: "Paula Projekt" });
    await w.getByRole("button", { name: "Hinzufügen" }).click();
    await w.getByRole("cell", { name: "Bühnenplan an den Ton schicken", exact: true }).waitFor();
    // Planungszeit starten
    await w.getByRole("tab", { name: "Übersicht" }).click();
    await w.getByRole("button", { name: "Planungszeit starten" }).click();
    await w.getByTestId("timer").getByText(new RegExp(`${fest.nummer} · 0:00 h`)).waitFor();
    await bild(w, "NUTZER-05", "timer");
    await q("UPDATE zeiteintrag SET laeuft_seit = now() - interval '25 minutes', zuletzt_aktiv = now() WHERE laeuft_seit IS NOT NULL");
    // Wechsel in den Materialplaner (Browser), Packliste ansehen → Timer stoppt, Zeit vorgemerkt
    const m = await imBrowser(b, s, "materialplaner", "paula");
    await m.evaluate((id) => { location.hash = `#/projekte/${id}/packen`; }, fest.id);
    await warteBis(async () => (await eintraege())[0]?.laeuft_seit === null, { timeout: 10000 });
    await m.getByTestId("zeit-meldung").waitFor();
    const [e] = await eintraege();
    assert.equal(e.quelle, "timer");
    assert.ok(e.minuten >= 24 && e.minuten <= 26, `25 Minuten gebucht, war ${e.minuten}`);
    await w.getByTestId("timer").waitFor({ state: "detached" });
    // Zurück in P: globale Aufgaben, Aufgabe erledigt
    await menue(w, "Aufgaben");
    await w.getByLabel("Bühnenplan an den Ton schicken erledigt").click();
    await w.getByRole("cell", { name: "Bühnenplan an den Ton schicken", exact: true }).waitFor({ state: "detached" });
    // Freitag: Telefonat nachbuchen, Auswertung
    await menue(w, "Planungszeit");
    await w.getByRole("button", { name: "Zeit nachbuchen" }).click();
    await w.getByRole("dialog").getByLabel("Projekt").selectOption(String(fest.id));
    await w.getByRole("dialog").getByLabel("Dauer").fill("0:45");
    await w.getByRole("button", { name: "Nachbuchen", exact: true }).click();
    await w.getByText(/0:45 h nachgebucht/).waitFor();
    await w.getByTestId("zeit-summe").getByText(/Gesamt: 1:(09|1\d) h/).waitFor();
    await bild(w, "NUTZER-05", "auswertung");
    // CSV im Browser-Productionplaner herunterladen
    const pb = await imBrowser(b, s, "productionplaner", "paula");
    await menue(pb, "Planungszeit");
    const [download] = await Promise.all([pb.waitForEvent("download"), pb.getByRole("button", { name: /CSV/ }).first().click()]);
    const csv = fs.readFileSync(await download.path(), "utf8");
    assert.match(csv, new RegExp(fest.nummer));
    assert.ok(csv.split(/\r?\n/).filter(Boolean).length >= 3, "Kopfzeile + 2 Einträge");
  } finally { await b.ende(); await p.ende(); await s.ende(); }
});
