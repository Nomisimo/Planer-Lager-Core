// FA-39 Projektvorlage beim Anlegen wählen, FA-40 wiederkehrende Aufgabe + Benachrichtigung in der Glocke.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";
import { hintergrundLauf } from "../packages/server/src/benachrichtigungen.js";

test("FA-39 FA-40 Projekt aus Vorlage, wiederkehrende Aufgabe, Glocke zeigt Frist", async () => {
  const s = await starteServer();
  await s.benutzer("buero", "Büro / Disposition", "Bea Büro");
  const q = (sql, w) => s.db.pool.query(sql, w);
  await q("INSERT INTO kunde (name) VALUES ('Anna Müller')");
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix) VALUES ('Licht', 'LI') RETURNING id");
  const { rows: [a] } = await q("INSERT INTO artikel (name, kategorie_id, preis_tag) VALUES ('Spot', $1, 1500) RETURNING id", [kat.id]);
  await q(`INSERT INTO projekt_vorlage (name, veranstaltung, aufgaben, positionen) VALUES ('Hochzeit klein', 'Hochzeit', $1, $2)`,
    [JSON.stringify([{ text: "Location besichtigen", tage_vorher: 14 }]), JSON.stringify([{ artikel_id: a.id, menge: 4 }])]);
  try {
    const p = await starteApp("productionplaner", s.url);
    try {
      const w = p.win;
      await anmelden(w, "buero");
      await w.evaluate(() => { location.hash = "#/projekte/neu"; });
      await w.getByLabel("Name").first().fill("Hochzeit Meier");
      await w.getByLabel("Kunde").selectOption({ label: "Anna Müller" });
      await w.getByLabel("Beginn").fill("2027-06-20");
      await w.getByLabel("Vorlage").selectOption({ label: "Hochzeit klein (Hochzeit)" });
      await w.getByRole("button", { name: "Speichern" }).first().click();
      await w.getByRole("heading", { name: /Hochzeit Meier/ }).waitFor();
      await w.getByRole("tab", { name: /Aufgaben \(1\)/ }).click();
      await w.getByText("Location besichtigen").waitFor();
      await w.getByText("06.06.2027").waitFor();
      assert.equal((await q("SELECT count(*)::int AS n FROM angebot_position")).rows[0].n, 1);
      // Wiederkehrend
      await w.evaluate(() => { location.hash = "#/aufgaben"; });
      await w.getByRole("tab", { name: "Wiederkehrend" }).click();
      await w.getByRole("button", { name: "Wiederkehrende Aufgabe" }).click();
      const dlg = w.getByRole("dialog");
      await dlg.getByLabel("Aufgabe").fill("Akkus laden");
      await dlg.getByLabel("Zuständig").selectOption({ label: "Bea Büro" });
      await dlg.getByRole("button", { name: "Speichern" }).click();
      await w.getByText(/Wiederkehrende Aufgabe „Akkus laden“ angelegt \(wöchentlich\)\. Die erste Aufgabe steht schon in der Liste\./).waitFor();
      await screenshot(w, "FA-40-wiederkehrend");
      await hintergrundLauf(s.db.pool, {}, s.hub);
      await w.getByTestId("glocke-zahl").waitFor({ timeout: 10000 });
      await w.getByTestId("glocke").click();
      await w.getByRole("dialog", { name: "Benachrichtigungen" }).getByText("Fällig heute: Akkus laden").waitFor();
      await screenshot(w, "FA-40-glocke");
      await w.getByRole("dialog", { name: "Benachrichtigungen" }).getByText("Fällig heute: Akkus laden").click();
      await w.getByRole("heading", { name: "Aufgaben", exact: true }).first().waitFor();
      await w.getByTestId("glocke-zahl").waitFor({ state: "detached" });
    } finally { await p.ende(); }
  } finally { await s.ende(); }
});
