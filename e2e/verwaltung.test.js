import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden, PW } from "./helfer.js";

test("T-17 T-18 UI-4 FA-47 FA-48 FA-49 FA-50 FA-51 Verwaltung: Sperre, Rechte, Benutzer, Rollen, Einstellungen, Sicherung, Sicherheit, System", async () => {
  const s = await starteServer();
  try {
    await s.benutzer("admin", "Administrator", "Ada Admin");
    await s.benutzer("lager", "Lager / Techniker", "Lars Lager");
    await s.benutzer("technik", "Lager / Techniker", "Tim Technik");
    const m = await starteApp("materialplaner", s.url);
    try {
      const w = m.win;
      // T-18: 5 falsche Passwörter, dann das richtige → 429 und Sperrmeldung
      for (let i = 0; i < 5; i++) {
        await w.getByLabel("Benutzername").fill("lager");
        await w.getByLabel("Passwort").fill("falsch-falsch-1");
        await w.getByRole("button", { name: "Anmelden" }).click();
        await w.getByRole("alert").or(w.locator(".lp-meldung")).first().waitFor();
      }
      await w.getByLabel("Passwort").fill(PW);
      const antwort = w.waitForResponse((r) => r.url().endsWith("/api/v1/anmelden"));
      await w.getByRole("button", { name: "Anmelden" }).click();
      assert.equal((await antwort).status(), 429);
      await w.getByText(/Zu viele Fehlversuche/).first().waitFor();
      await screenshot(w, "T-18-sperre");
      // T-17: Lager/Techniker ruft die Benutzerverwaltung auf → 403 + Protokolleintrag „verweigert“
      await anmelden(w, "technik");
      assert.equal(await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Verwaltung", { exact: true }).count(), 0, "kein Menüpunkt");
      await w.evaluate(() => { location.hash = "#/verwaltung/benutzer"; });
      await w.getByText(/Dafür fehlt dir die Berechtigung\. Deine Rolle „Lager \/ Techniker“/).first().waitFor();
      await screenshot(w, "T-17-verweigert");
      // Direkter Aufruf am Server: 403 + Protokoll
      const tok = (await (await fetch(`${s.url}/api/v1/anmelden`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ benutzername: "technik", passwort: PW }) })).json()).token;
      const verw = await fetch(`${s.url}/api/v1/verwaltung/benutzer`, { headers: { Authorization: `Bearer ${tok}` } });
      assert.equal(verw.status, 403);
      assert.equal((await verw.json()).text, "Dafür fehlt dir die Berechtigung.");
      const { rows } = await s.db.pool.query("SELECT text FROM sicherheit_ereignis WHERE art = 'verweigert' AND benutzer = 'technik'");
      assert.ok(rows.some((r) => r.text.includes("/api/v1/verwaltung/benutzer")));
      await w.getByTestId("benutzer").click();
      await w.getByRole("button", { name: "Abmelden" }).click();
      await anmelden(w, "admin");
      const menue = w.getByRole("navigation", { name: "Hauptmenü" });
      const oeffne = async (titel) => { await menue.getByText("Verwaltung", { exact: true }).click(); await w.getByRole("heading", { name: titel, exact: true }).locator("xpath=../..").getByRole("button", { name: "Öffnen" }).click(); };
      // FA-47 Benutzer anlegen
      await oeffne("Benutzer");
      await w.getByRole("button", { name: "Neuer Benutzer" }).click();
      const d = w.getByRole("dialog");
      await d.getByLabel("Benutzername").fill("berta");
      await d.getByLabel("Name", { exact: true }).fill("Berta Büro");
      await d.getByLabel("Rolle").selectOption({ label: "Büro / Disposition" });
      await d.getByLabel("Passwort").fill("kurz");
      await d.getByRole("button", { name: "Speichern" }).click();
      await d.getByText(/zu kurz/).first().waitFor();
      await d.getByLabel("Passwort").fill("Ein-gutes-Passwort-9");
      await d.getByRole("button", { name: "Speichern" }).click();
      await w.getByText("berta angelegt.").waitFor();
      // D-133: Startpasswort → Berta muss beim ersten Login ein eigenes wählen; Admin setzt zurück → wieder Pflicht
      assert.equal((await s.db.pool.query("SELECT passwort_wechsel FROM benutzer WHERE benutzername = 'berta'")).rows[0].passwort_wechsel, true);
      await w.getByRole("row", { name: /berta/ }).getByText("muss Passwort ändern").waitFor();
      await w.getByRole("button", { name: "Passwort von berta zurücksetzen" }).click();
      await w.getByRole("dialog").getByRole("button", { name: "Zurücksetzen" }).click();
      const startPw = (await w.getByTestId("startpasswort").innerText()).trim();
      assert.match(startPw, /^Start-/);
      await screenshot(w, "FA-47-startpasswort");
      await w.getByRole("dialog").getByRole("button", { name: "Notiert" }).click();
      await w.getByRole("button", { name: "Abmelden" }).click();
      await w.getByLabel("Benutzername").fill("berta");
      await w.getByLabel("Passwort").fill(startPw);
      await w.getByRole("button", { name: "Anmelden" }).click();
      await w.getByRole("heading", { name: "Eigenes Passwort vergeben" }).waitFor();
      await w.getByLabel("Neues Passwort", { exact: true }).fill("Sonnenblume-im-Lager-4");
      await w.getByLabel("Neues Passwort wiederholen").fill("Sonnenblume-im-Lager-4");
      await w.getByRole("button", { name: "Passwort speichern" }).click();
      await w.getByTestId("benutzer").waitFor({ timeout: 8000 }).catch(async () => { throw new Error((await w.locator("body").innerText()).slice(0, 600)); });
      assert.equal((await s.db.pool.query("SELECT passwort_wechsel FROM benutzer WHERE benutzername = 'berta'")).rows[0].passwort_wechsel, false);
      const willkommen = w.getByRole("dialog", { name: /^Willkommen im / });
      if (await willkommen.waitFor({ timeout: 2500 }).then(() => true, () => false)) await willkommen.getByRole("button", { name: "Nicht mehr anzeigen" }).click();
      await w.getByRole("button", { name: "Abmelden" }).click();
      await anmelden(w, "admin");
      await oeffne("Benutzer");
      await w.getByRole("cell", { name: "berta", exact: true }).click();
      await w.getByRole("dialog").getByLabel("Aktiv (darf sich anmelden)").uncheck();
      await w.getByRole("dialog").getByRole("button", { name: "Speichern" }).click();
      await w.getByText("berta gespeichert.").waitFor();
      assert.equal((await s.db.pool.query("SELECT aktiv FROM benutzer WHERE benutzername = 'berta'")).rows[0].aktiv, false);
      await screenshot(w, "FA-47-benutzer");
      // Rollen
      await oeffne("Rollen");
      await w.getByRole("button", { name: "Neue Rolle" }).click();
      await w.getByRole("dialog").getByLabel("Rollenname").fill("Aushilfe");
      await w.getByRole("dialog").getByLabel("Recht Geräte").selectOption("r");
      await w.getByRole("dialog").getByRole("button", { name: "Speichern" }).click();
      await w.getByRole("cell", { name: "Geräte (ansehen)", exact: true }).waitFor();
      // FA-48 Einstellungen
      await oeffne("Einstellungen");
      await w.getByLabel("Firmenname").fill("Eventtechnik Müller");
      await w.getByRole("heading", { name: "Firma" }).locator("xpath=../..").getByRole("button", { name: "Speichern" }).click();
      await w.getByText("Einstellungen gespeichert.").waitFor();
      await w.getByLabel("Etikettenformat").fill("62 mal 29");
      await w.getByRole("heading", { name: "Etiketten" }).locator("xpath=../..").getByRole("button", { name: "Speichern" }).click();
      await w.getByText(/Breite x Höhe in mm/).first().waitFor();
      assert.equal((await s.db.pool.query("SELECT werte->'firma'->>'name' AS n FROM einstellungen")).rows[0].n, "Eventtechnik Müller");
      // FA-49 Sicherung
      await oeffne("Datensicherung");
      await w.getByRole("button", { name: "Jetzt sichern" }).click();
      await w.getByText(/Prüfung: In Ordnung/).waitFor();
      const name = (await w.locator("td strong").first().innerText()).trim();
      assert.match(name, /^lager-.*\.zip$/);
      await w.getByRole("button", { name: `${name} wiederherstellen` }).click();
      assert.equal(await w.getByRole("dialog").getByRole("button", { name: "Wiederherstellen" }).isDisabled(), true, "erst nach Bestätigung");
      await w.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click();
      await screenshot(w, "FA-49-sicherung");
      // FA-50 Sicherheit
      await oeffne("Sicherheit");
      await w.locator('[data-check="dateirechte"]').waitFor();
      await w.getByRole("button", { name: "Dateirechte absichern" }).click();
      await w.getByText(/Dateirechte (abgesichert|waren schon)/).waitFor();
      await w.getByRole("cell", { name: /\/api\/v1\/verwaltung\/benutzer/ }).first().waitFor();
      await screenshot(w, "FA-50-sicherheit");
      // FA-51 Wartung
      await oeffne("System");
      await w.getByRole("button", { name: "Ping" }).click();
      await w.getByTestId("ping").waitFor();
      await w.getByLabel("Wartungsmeldung").fill("Update bis 14 Uhr.");
      await w.getByRole("button", { name: "Wartung starten" }).click();
      await w.getByText("Wartung ist an: Nur Administratoren können arbeiten.").first().waitFor();
      const r = await fetch(`${s.url}/api/v1/kunden`, { headers: { Authorization: `Bearer ${(await (await fetch(`${s.url}/api/v1/anmelden`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ benutzername: "technik", passwort: PW }) })).json()).token}` } });
      assert.equal(r.status, 503);
      await w.getByRole("button", { name: "Wartung beenden" }).click();
      await w.getByText("Wartung ist aus.").waitFor();
      await screenshot(w, "FA-51-system");
    } finally { await m.ende(); }
  } finally { await s.ende(); }
});
