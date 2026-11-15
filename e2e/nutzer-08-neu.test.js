// NUTZER-08 Neuer Mitarbeiter: Nina (Büro / Disposition) meldet sich zum ersten Mal im Desktop-Productionplaner an,
// startet die Tour aus dem Willkommen-Dialog, klickt sie durch und erledigt danach eine einfache Aufgabe nur mit dem
// Gezeigten: im Kalender das Stadtfest finden und öffnen, über das Codefeld zurückspringen, in der Hilfe den Stand sehen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteApp, anmelden } from "./helfer.js";
import { arbeitstag, menue, bild } from "./nutzer-helfer.js";
import { TOUREN } from "../packages/ui/src/tour/touren.js";

test("NUTZER-08 Neuer Mitarbeiter: erster Login, Willkommen, Tour bis zum Ende, Projekt im Kalender finden, Hilfe zeigt „erledigt“", { timeout: 240000 }, async () => {
  const s = await arbeitstag();
  await s.benutzer("nina", "Büro / Disposition", "Nina Neu");
  await s.q("UPDATE benutzer SET tour = '{}' WHERE benutzername = 'nina'");
  const { rows: [fest] } = await s.q("SELECT id, nummer FROM projekt WHERE name = 'Stadtfest Neustadt'");
  const p = await starteApp("productionplaner", s.url);
  try {
    const w = p.win;
    await anmelden(w, "nina");
    // Erster Login: Willkommen, „Tour starten“
    const willkommen = w.getByRole("dialog", { name: "Willkommen im Productionplaner" });
    await willkommen.waitFor({ timeout: 8000 });
    await bild(w, "NUTZER-08", "willkommen");
    await willkommen.getByRole("button", { name: "Tour starten" }).click();
    const blase = w.getByTestId("tour-blase");
    const tour = TOUREN.find((t) => t.id === "productionplaner");
    const gesehen = [];
    for (let n = 0; n < 20; n++) {
      if (!(await blase.waitFor({ timeout: 4000 }).then(() => true, () => false))) break;
      const t = (await blase.locator("h2").innerText()).trim();
      if (gesehen.at(-1) !== t) gesehen.push(t);
      if (gesehen.length === 3) await bild(w, "NUTZER-08", "tour");
      await blase.getByRole("button", { name: /^(Weiter|Fertig)$/ }).click();
      await w.waitForTimeout(80);
    }
    await w.getByTestId("tour").waitFor({ state: "detached" });
    // Büro / Disposition: keine Admin-Schritte, aber Projekte, Kalender, Angebote
    assert.ok(!gesehen.includes("Verwaltung (nur Admins)"), gesehen.join(", "));
    for (const t of ["Das Menü", "Codefeld", "Projekte", "Kalender", "Angebote", "Hilfe"]) assert.ok(gesehen.includes(t), `${t} fehlt: ${gesehen.join(", ")}`);
    assert.ok(gesehen.length <= tour.schritte.length);
    // Einfache Aufgabe mit dem Gezeigten: Kalender → Stadtfest öffnen
    await menue(w, "Kalender");
    await w.locator(".lp-kalender-balken").first().waitFor();
    const balken = w.locator(".lp-kalender-balken[title*=\"Stadtfest Neustadt\"]").first();
    if (!(await balken.isVisible().catch(() => false))) await w.getByRole("button", { name: "Nächster Monat" }).click();
    await balken.click();
    await w.getByRole("heading", { name: `${fest.nummer} Stadtfest Neustadt` }).waitFor();
    await bild(w, "NUTZER-08", "projekt");
    // Codefeld: Projektnummer eintippen und Enter
    await menue(w, "Übersicht");
    const codefeld = w.getByTestId("codefeld");
    await codefeld.fill(fest.nummer);
    await codefeld.press("Enter");
    await w.getByRole("heading", { name: `${fest.nummer} Stadtfest Neustadt` }).waitFor();
    // Hilfe zeigt die Tour als erledigt; der Stand ist am Konto gespeichert
    await menue(w, "Hilfe");
    const zeile = w.getByRole("row").filter({ hasText: tour.titel });
    await zeile.getByText("erledigt").waitFor();
    await bild(w, "NUTZER-08", "hilfe");
    const { rows: [u] } = await s.q("SELECT tour FROM benutzer WHERE benutzername = 'nina'");
    assert.equal(u.tour.willkommen, true);
    assert.ok(u.tour.erledigt.includes("productionplaner"));
    // Nächster Login: kein Willkommen mehr
    await w.getByRole("button", { name: "Abmelden" }).click();
    await anmelden(w, "nina");
    await w.waitForTimeout(800);
    assert.equal(await w.getByRole("dialog", { name: /^Willkommen/ }).count(), 0);
  } finally { await p.ende(); await s.ende(); }
});
