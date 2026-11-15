// NUTZER-07 Offline im Lager: Tom packt im Browser-Materialplaner (Tablet am Packplatz), mitten im Packen fällt das WLAN
// aus. Er scannt weiter, die Scans warten sichtbar; nach der Rückkehr der Verbindung werden sie ohne weiteren Scan
// nachgebucht. Paula sieht im Desktop-Productionplaner den richtigen Stand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteApp, starteBrowser, warteBis } from "./helfer.js";
import { arbeitstag, imBrowser, melde, menue, bild } from "./nutzer-helfer.js";

test("NUTZER-07 Offline im Lager: Verbindung weg beim Packen, weiterscannen, zurück, P sieht richtigen Stand", { timeout: 240000 }, async () => {
  const s = await arbeitstag();
  const q = s.q;
  const { rows: [fest] } = await q("SELECT id, nummer FROM projekt WHERE name = 'Stadtfest Neustadt'");
  const spots = (await q("SELECT g.code FROM geraet g JOIN artikel a ON a.id = g.artikel_id WHERE a.name = 'Akku-Spot' ORDER BY g.code LIMIT 5")).rows.map((r) => r.code);
  const gepackt = async () => (await q("SELECT count(*)::int AS n FROM geraet WHERE projekt_id = $1 AND status = 'gepackt'", [fest.id])).rows[0].n;
  const p = await starteApp("productionplaner", s.url);
  const b = await starteBrowser();
  try {
    await melde(p.win, "paula");
    await p.win.evaluate((id) => { location.hash = `#/projekte/${id}`; }, fest.id);
    const kennzahlen = p.win.getByTestId("kennzahlen");
    const m = await imBrowser(b, s, "materialplaner", "tom");
    await menue(m, "Code scannen");
    await m.getByLabel("Projekt").selectOption(String(fest.id));
    const ergebnis = m.getByTestId("scan-ergebnis");
    const scanne = async (code) => { await m.getByTestId("scanfeld").fill(code); await m.getByTestId("scanfeld").press("Enter"); };
    // Zwei Spots online
    for (const c of spots.slice(0, 2)) { await scanne(c); await ergebnis.getByText(`${c} Akku-Spot – Gepackt`).waitFor(); }
    await kennzahlen.getByText(/^2 \/ \d+$/).waitFor({ timeout: 10000 });
    // WLAN weg
    await m.context().setOffline(true);
    await m.getByTestId("online-status").getByText(/Offline|Getrennt|Verbindung/).first().waitFor({ timeout: 15000 }).catch(() => {});
    for (const c of spots.slice(2)) await scanne(c);
    await m.getByTestId("offline-warten").getByText("Offline – 3 Scans warten auf die Verbindung.").waitFor();
    await bild(m, "NUTZER-07", "offline");
    assert.equal(await gepackt(), 2, "offline noch nichts gebucht");
    await kennzahlen.getByText(/^2 \/ \d+$/).waitFor();
    // WLAN zurück: ohne weiteren Scan wird nachgebucht
    await m.context().setOffline(false);
    await m.getByTestId("offline-warten").waitFor({ state: "detached", timeout: 20000 });
    await m.getByText(/Nachgebucht \(offline erfasst \d{2}:\d{2}\)/).first().waitFor();
    await warteBis(async () => (await gepackt()) === 5, { timeout: 10000 });
    await bild(m, "NUTZER-07", "nachgebucht");
    // Reihenfolge wie erfasst
    const { rows } = await q("SELECT g.code FROM bewegung b JOIN geraet g ON g.id = b.geraet_id WHERE b.projekt_id = $1 ORDER BY b.id", [fest.id]);
    assert.deepEqual(rows.map((r) => r.code), spots);
    // Paula sieht den richtigen Stand live
    await kennzahlen.getByText(/^5 \/ \d+$/).waitFor({ timeout: 10000 });
    await bild(p.win, "NUTZER-07", "p-stand");
  } finally { await b.ende(); await p.ende(); await s.ende(); }
});
