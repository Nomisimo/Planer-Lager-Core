// NUTZER-01 Vom Anruf zum Angebot: Büro (Paula) arbeitet im Desktop-Productionplaner, die Lagerleitung (Lena) schaut
// parallel im Browser-Materialplaner zu. Kunde per Adresssuche (gemockt), Projekt + Job, Angebot mit Verfügbarkeit,
// Überbuchungshinweis, Rabatt, PDF, Fassung, annehmen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteApp, starteBrowser, warteBis } from "./helfer.js";
import { arbeitstag, imBrowser, melde, menue, bild, JAHR, NAECHSTES } from "./nutzer-helfer.js";

test("NUTZER-01 Vom Anruf zum Angebot: Kunde, Projekt + Job, Angebot mit Verfügbarkeit, Überbuchung, Rabatt, PDF, Fassung, annehmen", { timeout: 240000 }, async () => {
  const s = await arbeitstag({ adressSuche: async () => [{ strasse: "Marktplatz 7", plz: "67433", ort: "Neustadt", text: "Marktplatz 7, 67433 Neustadt" }] });
  const p = await starteApp("productionplaner", s.url);
  const b = await starteBrowser();
  try {
    const w = p.win;
    await melde(w, "paula");
    const m = await imBrowser(b, s, "materialplaner", "lena");
    // Anruf: neuer Kunde mit Adresssuche
    await menue(w, "Kunden");
    await w.getByRole("button", { name: "Neuer Kunde" }).click();
    await w.getByLabel("Firma").fill("Kranz Events");
    await w.getByLabel("Ansprechpartner").fill("Clara Kranz");
    await w.getByLabel("Adresse suchen").fill("Marktplatz");
    await w.getByRole("button", { name: "Marktplatz 7, 67433 Neustadt" }).click();
    assert.equal(await w.getByLabel("PLZ").inputValue(), "67433");
    await w.getByRole("button", { name: "Speichern" }).click();
    await w.getByRole("heading", { name: "Kranz Events" }).waitFor();
    // Projekt anlegen (nächstes Jahr, kein Konflikt mit Demo-Projekten außer dem Akku-Spot-Bestand)
    await menue(w, "Projekte");
    await w.getByRole("button", { name: "Neues Projekt" }).click();
    await w.getByLabel("Name").fill("Sommerfest Kranz");
    await w.getByLabel("Kunde").selectOption({ label: "Kranz Events (Clara Kranz)" });
    await w.getByLabel("Beginn").fill(`${NAECHSTES}-07-10`);
    await w.getByLabel("Ende").fill(`${NAECHSTES}-07-11`);
    await w.getByRole("button", { name: "Speichern" }).click();
    const kopf = w.getByRole("heading", { name: /^P-\d{4}-\d{3} Sommerfest Kranz$/ });
    await kopf.waitFor();
    const projektNr = (await kopf.innerText()).split(" ")[0];
    // Job für den Ton
    await w.getByRole("tab", { name: /Jobs/ }).click();
    await w.getByRole("button", { name: "Job anlegen" }).click();
    await w.getByLabel("Name").fill("Sommerfest Ton");
    await w.getByLabel("Gewerk").selectOption("Ton");
    await w.getByRole("button", { name: "Speichern" }).click();
    await w.getByRole("heading", { name: /^J-\d{4}-\d{3} Sommerfest Ton$/ }).waitFor();
    await bild(w, "NUTZER-01", "job");
    // Zurück zum Projekt, Angebot anlegen
    await w.getByText(`${projektNr} Sommerfest Kranz`, { exact: true }).click();
    await kopf.waitFor();
    await w.getByRole("tab", { name: /Angebote/ }).click();
    await w.getByRole("button", { name: "Neues Angebot" }).click();
    await w.getByRole("dialog").getByRole("button", { name: "Angebot anlegen" }).click();
    const angebotKopf = w.getByRole("heading", { name: new RegExp(`^A-${JAHR}-\\d{3}`) });
    await angebotKopf.waitFor();
    const angebotNr = (await angebotKopf.innerText()).split(" ")[0];
    assert.equal(await w.getByLabel("Miettage").inputValue(), "2", "Miettage aus dem Projektzeitraum");
    // Verfügbarkeit + Überbuchung: 12 Akku-Spots im Bestand, der Kunde will 20
    await w.getByRole("button", { name: "Material hinzufügen" }).click();
    await w.getByLabel("Artikel Position 1").selectOption({ label: "Akku-Spot" });
    await w.getByLabel("Menge Position 1").fill("4");
    await w.getByText(/Verfügbar im Zeitraum: \d+ von 12/).waitFor();
    await w.getByLabel("Menge Position 1").fill("20");
    await w.getByTestId("ueberbuchung").getByText(/Überbucht: \d+ fehlen/).waitFor();
    await bild(w, "NUTZER-01", "ueberbuchung");
    // Paula spricht mit dem Kunden: 10 reichen; Rabatt 10 %
    await w.getByLabel("Menge Position 1").fill("10");
    await w.getByTestId("ueberbuchung").waitFor({ state: "detached" });
    await w.getByLabel("Rabatt %").fill("10");
    await w.getByRole("button", { name: "Speichern" }).click();
    await w.getByText("Gespeichert.").waitFor();
    const { rows: [a] } = await s.q("SELECT id, rabatt_prozent::float AS rabatt FROM angebot WHERE nummer = $1", [angebotNr]);
    assert.equal(a.rabatt, 10);
    // PDF-Vorschau
    await w.getByRole("button", { name: "PDF", exact: true }).click();
    const pdf = w.getByRole("dialog", { name: `${angebotNr} PDF` });
    await pdf.locator("iframe, object, embed").first().waitFor();
    await pdf.getByRole("button", { name: /Schließen/ }).first().click();
    // Versenden → Fassung 1
    await w.getByRole("button", { name: "Versenden", exact: true }).click();
    await w.getByRole("dialog").getByRole("button", { name: "Versenden" }).click();
    await w.getByText(/Fassung 1 als PDF abgelegt/).waitFor();
    await w.getByText("1 (aktuell)").waitFor();
    await bild(w, "NUTZER-01", "fassung");
    // Kunde sagt zu
    await w.getByRole("button", { name: "Angenommen", exact: true }).click();
    // nicht auf den Text warten (der Knopf heißt genauso), sondern auf den gespeicherten Status
    const x = await warteBis(async () => { const { rows: [r] } = await s.q("SELECT a.status, p.status AS projekt FROM angebot a JOIN projekt p ON p.id = a.projekt_id WHERE a.nummer = $1", [angebotNr]); return r.status === "angenommen" && r; });
    assert.equal(x.status, "angenommen");
    assert.notEqual(x.projekt, "anfrage");
    // Lena sieht das Projekt im Browser-Materialplaner zum Packen (live, ohne Neuladen)
    await menue(m, "Code scannen");
    const option = m.getByLabel("Projekt").locator("option", { hasText: "Sommerfest Kranz" }).first();
    await option.waitFor({ state: "attached", timeout: 10000 });
    await m.getByLabel("Projekt").selectOption(await option.getAttribute("value"));
    assert.equal(await m.getByTestId("scanfeld").isDisabled(), false, "Lager kann packen");
    await bild(m, "NUTZER-01", "lager-sieht-projekt");
  } finally { await b.ende(); await p.ende(); await s.ende(); }
});
