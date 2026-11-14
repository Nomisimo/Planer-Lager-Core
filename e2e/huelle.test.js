import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden, warteBis } from "./helfer.js";

test("UI-1 App-Hülle: Anmeldung, Seitenmenü nur mit erlaubten Einträgen, aktiver Eintrag, Online-Status, Darstellung", async () => {
  const s = await starteServer();
  await s.benutzer("lager", "Lager / Techniker", "Lea Lager");
  await s.benutzer("chef", "Administrator", "Chris Chef");
  try {
    const m = await starteApp("materialplaner", s.url);
    try {
      await m.win.getByLabel("Benutzername").fill("lager");
      await m.win.getByLabel("Passwort").fill("falsch-falsch");
      await m.win.getByRole("button", { name: "Anmelden" }).click();
      await m.win.getByText("Benutzername oder Passwort ist falsch").waitFor();
      await anmelden(m.win, "lager");
      const menue = m.win.getByRole("navigation", { name: "Hauptmenü" });
      await menue.getByText("Code scannen").waitFor();
      assert.equal(await menue.getByText("Kunden").count(), 0, "Lager sieht keine Kunden");
      assert.equal(await menue.getByText("Verwaltung").count(), 0);
      assert.equal(await m.win.locator('[aria-current="page"]').innerText(), "Übersicht");
      await m.win.getByTestId("online-status").getByText("Online").waitFor({ timeout: 10000 });
      await screenshot(m.win, "UI-1-materialplaner-lager");
      await m.win.getByRole("button", { name: "Darstellung" }).click();
      await m.win.getByLabel("Hell / Dunkel").selectOption("hell");
      await m.win.getByLabel("Farbthema").selectOption("blau");
      assert.equal(await m.win.evaluate(() => document.documentElement.dataset.modus), "hell");
      await m.win.keyboard.press("Escape");
      await screenshot(m.win, "UI-6-materialplaner-hell-blau");
    } finally { await m.ende(); }
    const p = await starteApp("productionplaner", s.url);
    try {
      await anmelden(p.win, "chef");
      const menue = p.win.getByRole("navigation", { name: "Hauptmenü" });
      for (const t of ["Kunden", "Projekte", "Angebote", "Material", "Verwaltung", "Kalkulator"]) await menue.getByText(t, { exact: true }).waitFor();
      await screenshot(p.win, "UI-1-productionplaner-admin");
    } finally { await p.ende(); }
  } finally { await s.ende(); }
});

test("INT-01 Login in P, Wechsel nach M ohne erneute Anmeldung (Handoff per Deep-Link)", async () => {
  const s = await starteServer();
  await s.benutzer("buero", "Büro / Disposition", "Bea Büro");
  try {
    const p = await starteApp("productionplaner", s.url);
    let link;
    try {
      await anmelden(p.win, "buero");
      await p.win.getByTestId("app-schalter").click();
      link = await warteBis(() => p.externeLinks().find((l) => l.startsWith("materialplaner://")));
      assert.match(link, /\?handoff=/);
    } finally { await p.ende(); }
    const m = await starteApp("materialplaner", s.url, { argv: [link] });
    try {
      await m.win.getByTestId("benutzer").getByText("Bea Büro").waitFor({ timeout: 15000 });
      assert.equal(await m.win.getByTestId("anmeldung").count(), 0);
      await screenshot(m.win, "INT-01-materialplaner-nach-handoff");
    } finally { await m.ende(); }
  } finally { await s.ende(); }
});
