// NUTZER-04 Etiketten: Lena (Lagerleitung) nimmt im Desktop-Materialplaner neue Nebelmaschinen auf: Kategorie, Artikel mit
// Geräten, Etikettendruck (gestubbt), eigene Vorlage im Designer, Etiketten-Bestellung, Lieferung. Tom scannt im
// Browser-Materialplaner ein bestelltes und danach ein geliefertes Etikett.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteApp, starteBrowser, warteBis } from "./helfer.js";
import { arbeitstag, imBrowser, melde, menue, bild } from "./nutzer-helfer.js";

test("NUTZER-04 Etiketten: Kategorie, Artikel, Geräte, Designer, Druck gestubbt, Bestellung, Lieferung, Scan des neuen Etiketts", { timeout: 240000 }, async () => {
  const s = await arbeitstag();
  const m = await starteApp("materialplaner", s.url);
  const b = await starteBrowser();
  try {
    const w = m.win;
    await melde(w, "lena");
    const tb = await imBrowser(b, s, "materialplaner", "tom");
    // Kategorie
    await menue(w, "Material");
    await w.getByRole("tab", { name: "Kategorien" }).click();
    await w.getByRole("button", { name: "Neue Kategorie" }).click();
    await w.getByLabel("Name").fill("Nebelmaschinen");
    await w.getByLabel("Name").blur();
    await w.waitForFunction(() => document.querySelector('input[maxlength="4"]')?.value);
    const praefix = await w.locator('input[maxlength="4"]').inputValue();
    await w.getByRole("button", { name: "Speichern" }).click();
    await w.getByRole("cell", { name: praefix, exact: true }).waitFor();
    // Artikel mit 2 Geräten, Etiketten gleich drucken
    await w.getByRole("tab", { name: "Artikel" }).click();
    await w.getByRole("button", { name: "Material aufnehmen" }).click();
    await w.getByLabel("Name").fill("Hazer HZ-500");
    await w.getByLabel("Kategorie").selectOption({ label: `Nebelmaschinen (${praefix})` });
    await w.getByLabel("Anzahl Geräte").fill("2");
    await w.getByLabel("Kennzeichnung").selectOption("qr");
    await w.getByRole("button", { name: "Speichern" }).click();
    await w.getByRole("heading", { name: "Etiketten drucken" }).waitFor();
    await w.locator(`[data-code="${praefix}-0001"] svg path`).waitFor();
    await bild(w, "NUTZER-04", "druckvorschau");
    await w.getByRole("button", { name: "2 drucken" }).click();
    await w.getByText(/2 Etikett\(en\) .* an den Drucker gesendet/).waitFor();
    const [auftrag] = await warteBis(() => m.druckauftraege().length && m.druckauftraege());
    assert.ok(auftrag.groesse, "Druck mit Seitengröße der Vorlage");
    // Eigene Vorlage im Designer
    await menue(w, "Etiketten");
    await w.getByRole("tab", { name: "Vorlagen" }).click();
    await w.locator('[data-vorlage="Standard 62×29"]').getByRole("button", { name: "Kopieren" }).click();
    await w.locator('[data-vorlage="Kopie von Standard 62×29"]').getByRole("button", { name: "Bearbeiten" }).click();
    await w.getByTestId("designer").waitFor();
    await w.getByRole("button", { name: "Code (Text) auswählen" }).click();
    await w.getByRole("button", { name: "Waagrecht zentrieren" }).click();
    await bild(w, "NUTZER-04", "designer");
    await w.getByRole("button", { name: "Speichern" }).click();
    await w.getByText("Vorlage gespeichert.").waitFor();
    // Drei weitere Maschinen: Etiketten beim Lieferanten bestellen
    await menue(w, "Material");
    await w.getByRole("button", { name: "Material aufnehmen" }).click();
    await w.getByLabel("Name").fill("Hazer HZ-500 Tour");
    await w.getByLabel("Kategorie").selectOption({ label: `Nebelmaschinen (${praefix})` });
    await w.getByLabel("Anzahl Geräte").fill("3");
    await w.getByLabel("Kennzeichnung").selectOption("bestellen");
    await w.getByRole("button", { name: "Speichern" }).click();
    const kopf = w.getByRole("heading", { name: /Etiketten-Bestellung EB-\d{4}-\d{3}/ });
    await kopf.waitFor();
    const nummer = (await kopf.textContent()).match(/EB-\d{4}-\d{3}/)[0];
    const codes = [3, 4, 5].map((n) => `${praefix}-000${n}`);
    for (const c of codes) await w.getByRole("cell", { name: c, exact: true }).waitFor();
    // Tom scannt ein Etikett, bevor die Lieferung gebucht ist → rot mit Bestellnummer
    await tb.getByTestId("codefeld").fill(codes[0]);
    await tb.getByTestId("codefeld").press("Enter");
    await tb.locator(".lp-meldung-error, [data-level='error']").filter({ hasText: nummer }).first().waitFor();
    // Lieferung: einen scannen, zwei abhaken
    await w.getByLabel("Gelieferten Code scannen").fill(codes[0].toLowerCase().replace("-", ""));
    await w.getByLabel("Gelieferten Code scannen").press("Enter");
    await w.getByText("1 Gerät(e) gebucht.").waitFor();
    for (const c of codes.slice(1)) await w.getByLabel(`${c} abhaken`).check();
    await w.getByRole("button", { name: "2 abgehakte buchen" }).click();
    await w.getByText("2 Gerät(e) gebucht.").waitFor();
    await w.getByText(/· geliefert$/).waitFor();
    await bild(w, "NUTZER-04", "geliefert");
    // Tom scannt das neue Etikett erneut → Gerät öffnet sich
    await tb.getByTestId("codefeld").fill(codes[0]);
    await tb.getByTestId("codefeld").press("Enter");
    await tb.getByRole("heading", { name: codes[0], exact: true }).waitFor();
    await tb.locator(".lp-inhalt").getByText(/Hazer HZ-500 Tour/).first().waitFor({ timeout: 5000 }).catch(async () => { throw new Error((await tb.locator(".lp-inhalt").innerText()).slice(0, 500)); });
    await bild(tb, "NUTZER-04", "scan-neues-etikett");
    const { rows } = await s.q("SELECT g.code FROM geraet g JOIN artikel a ON a.id = g.artikel_id WHERE a.name LIKE 'Hazer%' ORDER BY g.code");
    assert.deepEqual(rows.map((r) => r.code), [`${praefix}-0001`, `${praefix}-0002`, ...codes]);
  } finally { await b.ende(); await m.ende(); await s.ende(); }
});
