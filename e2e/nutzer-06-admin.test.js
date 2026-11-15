// NUTZER-06 Admin-Tag: Server „im Netz“ (2FA Pflicht für Admins). Der Admin richtet im Desktop-Productionplaner die
// Zwei-Faktor-Anmeldung ein, legt Rolle + Benutzer an, sieht die Sperre nach Tom's Fehlversuchen (Tom im Browser-
// Materialplaner), sichert, legt einen Scanner an (Token per HTTP geprüft), stellt die Sicherung wieder her und prüft
// den Sicherheits-Check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteApp, starteBrowser } from "./helfer.js";
import { arbeitstag, BEISPIEL_PASSWORT, menue, bild } from "./nutzer-helfer.js";
import { totpCode } from "../packages/domain/src/totp.js";

test("NUTZER-06 Admin-Tag: Benutzer + Rolle, 2FA, Sperre, Sicherung + Wiederherstellung, Sicherheits-Check, Scanner", { timeout: 300000 }, async () => {
  const s = await arbeitstag({ imNetz: true });
  const p = await starteApp("productionplaner", s.url);
  const b = await starteBrowser();
  try {
    const w = p.win;
    const oeffne = async (titel) => { await menue(w, "Verwaltung"); await w.getByRole("heading", { name: titel, exact: true }).locator("xpath=../..").getByRole("button", { name: "Öffnen" }).click(); };
    // Anmeldung → Pflicht-Einrichtung 2FA
    await w.getByLabel("Benutzername").fill("beispiel-admin");
    await w.getByLabel("Passwort").fill(BEISPIEL_PASSWORT);
    await w.getByRole("button", { name: "Anmelden" }).click();
    await w.getByRole("heading", { name: "Zwei-Faktor-Anmeldung einrichten" }).waitFor();
    const geheimnis = (await w.locator(".lp-login code").innerText()).trim();
    await bild(w, "NUTZER-06", "2fa-einrichten");
    await w.getByLabel("Code").fill("000000");
    await w.getByRole("button", { name: "Bestätigen" }).click();
    await w.locator(".lp-login .lp-meldung").first().waitFor();
    await w.getByLabel("Code").fill(totpCode(geheimnis));
    await w.getByRole("button", { name: "Bestätigen" }).click();
    await w.getByTestId("benutzer").waitFor();
    await w.getByRole("dialog", { name: "Willkommen im Productionplaner" }).getByRole("button", { name: "Nicht mehr anzeigen" }).click();
    // Rolle „Aushilfe“ und Benutzerin Nina
    await oeffne("Rollen");
    await w.getByRole("button", { name: "Neue Rolle" }).click();
    await w.getByRole("dialog").getByLabel("Rollenname").fill("Aushilfe");
    await w.getByRole("dialog").getByLabel("Recht Geräte").selectOption("r");
    await w.getByRole("dialog").getByRole("button", { name: "Speichern" }).click();
    await w.getByRole("cell", { name: "Geräte (ansehen)", exact: true }).waitFor();
    await oeffne("Benutzer");
    await w.getByRole("button", { name: "Neuer Benutzer" }).click();
    const d = w.getByRole("dialog");
    await d.getByLabel("Benutzername").fill("nina");
    await d.getByLabel("Name", { exact: true }).fill("Nina Neu");
    await d.getByLabel("Rolle").selectOption({ label: "Aushilfe" });
    await d.getByLabel("Passwort").fill("Lagerhalle-Sommer-42");
    await d.getByRole("button", { name: "Speichern" }).click();
    await w.getByText("nina angelegt.").waitFor({ timeout: 8000 }).catch(async () => { throw new Error((await w.locator(".lp-inhalt").innerText()).slice(0, 900)); });
    await bild(w, "NUTZER-06", "benutzer");
    // Tom vertippt sich im Browser fünfmal → Sperre; der Admin sieht sie im Sicherheitsprotokoll
    const t = await b.neueSeite();
    await t.goto(`${s.url}/materialplaner/`);
    for (let i = 0; i < 6; i++) {
      await t.getByLabel("Benutzername").fill("tom");
      await t.getByLabel("Passwort").fill("falsch-geraten-1");
      await t.getByRole("button", { name: "Anmelden" }).click();
      await t.locator(".lp-meldung").first().waitFor();
    }
    await t.getByText(/Zu viele Fehlversuche/).first().waitFor();
    await oeffne("Sicherheit");
    await w.getByLabel("Art").selectOption("sperre");
    await w.getByRole("cell", { name: /tom/ }).first().waitFor();
    // Sicherheits-Check: HTTPS fehlt im Netz → Hinweis, Dateirechte absichern
    await w.locator('[data-check="https"]').waitFor();
    await w.getByRole("button", { name: "Dateirechte absichern" }).click();
    await w.getByText(/Dateirechte (abgesichert|waren schon)/).waitFor();
    await bild(w, "NUTZER-06", "sicherheit");
    // Sicherung
    await oeffne("Datensicherung");
    await w.getByRole("button", { name: "Jetzt sichern" }).click();
    await w.getByText(/Prüfung: In Ordnung/).waitFor();
    const sicherung = (await w.locator("td strong").first().innerText()).trim();
    // Scanner anlegen, Token per HTTP prüfen
    await oeffne("Scanner");
    await w.getByRole("button", { name: "Scanner anlegen" }).click();
    await w.getByRole("dialog").getByLabel("Name").fill("Rampe Ost");
    await w.getByRole("dialog").getByLabel("Kennung").fill("RO");
    await w.getByRole("dialog").getByRole("button", { name: "Speichern" }).click();
    const token = (await w.getByTestId("scanner-token").innerText()).trim();
    await w.getByRole("button", { name: "Notiert" }).click();
    const r = await fetch(`${s.url}/api/v1/scanner/eingang`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Scanner ${token}` }, body: JSON.stringify({ code: "LI-0001" }) });
    assert.equal(r.status, 200);
    await w.getByRole("cell", { name: "Rampe Ost", exact: true }).waitFor();
    // Wiederherstellung: Stand von heute früh, der Scanner ist danach wieder weg
    await oeffne("Datensicherung");
    await w.getByRole("button", { name: `${sicherung} wiederherstellen` }).click();
    await w.getByRole("dialog").getByLabel("Bestätigung").fill("WIEDERHERSTELLEN");
    await w.getByRole("dialog").getByRole("button", { name: "Wiederherstellen" }).click();
    await w.getByLabel("Benutzername").waitFor({ timeout: 30000 }).catch(async () => { throw new Error((await w.locator("body").innerText()).slice(0, 900)); });
    const { rows } = await s.q("SELECT name FROM scanner WHERE name = 'Rampe Ost'");
    assert.equal(rows.length, 0, "Scanner nach Wiederherstellung weg");
    const { rows: [nina] } = await s.q("SELECT 1 FROM benutzer WHERE benutzername = 'nina'");
    assert.ok(nina, "Nina war vor der Sicherung angelegt");
    // Neu anmelden mit zweitem Faktor
    await w.getByLabel("Benutzername").fill("beispiel-admin");
    await w.getByLabel("Passwort").fill(BEISPIEL_PASSWORT);
    await w.getByRole("button", { name: "Anmelden" }).click();
    await w.getByLabel("Code aus der Authenticator-App").fill(totpCode(geheimnis));
    await w.getByRole("button", { name: "Code prüfen" }).click();
    await w.getByTestId("benutzer").waitFor();
    await bild(w, "NUTZER-06", "nach-wiederherstellung");
  } finally { await b.ende(); await p.ende(); await s.ende(); }
});
