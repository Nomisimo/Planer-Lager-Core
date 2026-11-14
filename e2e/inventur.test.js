// FA-06 Inventur und FA-07 Reparatur/Wartung in der Oberfläche des Materialplaners.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

test("FA-06 FA-07 Inventur je Kategorie bis zum Protokoll; Defekt melden, Reparatur erst nach Prüfung zurück; Wartung erledigen", async () => {
  const s = await starteServer();
  await s.benutzer("leitung", "Lagerleitung", "Lena Leitung");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 9) RETURNING id");
  const { rows: [art] } = await q("INSERT INTO artikel (name, kategorie_id, wartung_intervall_monate, wartung_text) VALUES ('Spot', $1, 6, 'Lüfter reinigen') RETURNING id", [kat.id]);
  for (const n of [1, 2, 3, 4]) await q("INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ($1, $2, (now() AT TIME ZONE 'Europe/Berlin')::date)", [`LI-000${n}`, art.id]);
  try {
    const m = await starteApp("materialplaner", s.url);
    try {
      const w = m.win;
      await anmelden(w, "leitung");
      const menue = w.getByRole("navigation", { name: "Hauptmenü" });
      // FA-06
      await menue.getByText("Inventur", { exact: true }).click();
      await w.getByRole("button", { name: "Inventur starten" }).click();
      await w.getByRole("dialog").getByLabel("Bereich (Kategorie)").selectOption({ label: "Licht" });
      await w.getByRole("dialog").getByRole("button", { name: "Starten" }).click();
      await w.getByRole("heading", { name: "Inventur Licht" }).waitFor();
      await w.getByTestId("inventur-soll").getByText("4").waitFor();
      const feld = w.getByTestId("inventur-scanfeld");
      for (const c of ["li1", "LI-0003", "ZZ-0001"]) { await feld.fill(c); await feld.press("Enter"); await w.getByTestId("inventur-ergebnis").getByText(new RegExp(c.toUpperCase().replace("LI1", "LI-0001"))).waitFor(); }
      assert.equal(await w.getByTestId("inventur-ergebnis").getAttribute("data-level"), "error", "unbekannter Code rot");
      // UI-3 Handscanner ohne Fokus
      await w.getByRole("button", { name: "Alle Inventuren" }).focus();
      await w.keyboard.type("LI-0004", { delay: 5 });
      await w.keyboard.press("Enter");
      await w.getByTestId("inventur-gezählt").getByText("3").waitFor();
      await w.getByTestId("inventur-fehlt").getByText("1").waitFor();
      await w.getByRole("tab", { name: "Fehlt (1)" }).waitFor();
      await w.getByRole("cell", { name: "LI-0002" }).waitFor();
      await screenshot(w, "FA-06-inventur");
      await w.getByRole("button", { name: "Abschließen" }).click();
      await w.getByRole("dialog").getByText(/1 Gerät\(e\) wurden nicht gefunden/).waitFor();
      await w.getByRole("dialog").getByRole("button", { name: "Abschließen und buchen" }).click();
      await w.getByText(/Inventur abgeschlossen: 3 gezählt, 1 als vermisst gemeldet/).waitFor();
      assert.equal((await q("SELECT status FROM geraet WHERE code = 'LI-0002'")).rows[0].status, "vermisst");
      assert.equal(await w.getByTestId("inventur-scanfeld").count(), 0, "nach Abschluss kein Scannen mehr");
      await w.getByRole("button", { name: "Protokoll (PDF)" }).waitFor();
      // FA-07 Defekt melden von der Geräteseite
      await w.evaluate(() => { location.hash = "#/geraete/code/LI-0001"; });
      await w.getByRole("heading", { name: "LI-0001" }).waitFor();
      await w.getByText("Lüfter reinigen alle 6 Monate").waitFor();
      await w.getByRole("button", { name: "Defekt melden" }).click();
      const d = w.getByRole("dialog");
      await d.getByLabel("Was ist defekt?").fill("Lampe flackert");
      await d.getByLabel("Verantwortlich").selectOption({ label: "Lena Leitung" });
      await d.getByLabel("Foto").setInputFiles({ name: "defekt.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex") });
      await d.getByRole("button", { name: "Melden" }).click();
      await w.getByText(/Defekt für LI-0001 gemeldet/).waitFor();
      assert.ok((await q("SELECT foto FROM reparatur")).rows[0].foto.startsWith("foto-"), "Foto gespeichert");
      await w.getByRole("cell", { name: "Lampe flackert" }).click();
      const r = w.getByRole("dialog");
      await r.getByRole("button", { name: "In Reparatur" }).click();
      await w.getByText("LI-0001: In Reparatur.").waitFor();
      await w.getByRole("cell", { name: "Lampe flackert" }).click();
      const zurueck = w.getByRole("dialog").getByRole("button", { name: /zurück ins Lager/ });
      assert.equal(await zurueck.isDisabled(), true, "erst nach Prüfung");
      await w.getByRole("dialog").getByLabel(/Prüfung bestanden/).check();
      await screenshot(w, "FA-07-reparatur");
      await zurueck.click();
      await w.getByText(/Das Gerät ist wieder im Lager/).waitFor();
      assert.equal((await q("SELECT status FROM geraet WHERE code = 'LI-0001'")).rows[0].status, "lager");
      // Wartung
      await w.getByRole("tab", { name: /Wartung fällig \(4\)/ }).click();
      await w.getByRole("row").filter({ hasText: "LI-0003" }).getByRole("button", { name: "Erledigt" }).click();
      await w.getByText(/LI-0003: Wartung am .* eingetragen/).waitFor();
      await w.getByRole("tab", { name: /Wartung fällig \(3\)/ }).waitFor();
      await screenshot(w, "FA-07-wartung");
    } finally { await m.ende(); }
  } finally { await s.ende(); }
});
