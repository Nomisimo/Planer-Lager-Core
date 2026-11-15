// NUTZER-03 Rückgabe mit Schaden: Das Stadtfest kommt zurück. Tom nimmt im Desktop-Materialplaner zurück (aktive Tasche,
// Funktionstest, Mangel → Reparatur, vermisst, Wieder-Auftauchen); Lena sieht im Browser-Materialplaner die Werkstatt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteApp, starteBrowser } from "./helfer.js";
import { arbeitstag, imBrowser, melde, menue, bild } from "./nutzer-helfer.js";

test("NUTZER-03 Rückgabe mit Schaden: aktive Tasche, Funktionstest, defekt → Reparatur, vermisst, Wieder-Auftauchen", { timeout: 240000 }, async () => {
  const s = await arbeitstag();
  const q = s.q;
  // Ausgangslage: Stadtfest läuft, 4 Spots in der Spot-Tasche, 2 lose Spots, 4 PAR-Sets draußen
  const { rows: [fest] } = await q("SELECT id, nummer FROM projekt WHERE name = 'Stadtfest Neustadt'");
  const codes = async (artikel) => (await q("SELECT g.code FROM geraet g JOIN artikel a ON a.id = g.artikel_id WHERE a.name = $1 ORDER BY g.code", [artikel])).rows.map((r) => r.code);
  const spots = (await codes("Akku-Spot")).slice(0, 6);
  const pars = (await codes("PAR-Set")).slice(0, 4);
  const { rows: [spotArt] } = await q("SELECT id, kategorie_id FROM artikel WHERE name = 'Akku-Spot'");
  const { rows: [ta] } = await q("INSERT INTO artikel (name, kategorie_id, ist_case, inhalt_artikel_id, verpackungseinheit) VALUES ('Spot-Tasche', $1, true, $2, 4) RETURNING id", [spotArt.kategorie_id, spotArt.id]);
  const { rows: [tasche] } = await q("INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ('TA-0001', $1, (now() AT TIME ZONE 'Europe/Berlin')::date) RETURNING id", [ta.id]);
  await q("UPDATE geraet SET case_id = $1 WHERE code = ANY($2)", [tasche.id, spots.slice(0, 4)]);
  await q("UPDATE geraet SET status = 'gepackt', projekt_id = $1 WHERE code = ANY($2)", [fest.id, [...spots, ...pars, "TA-0001"]]);
  await q("UPDATE projekt SET status = 'laeuft', gepackt_am = now() WHERE id = $1", [fest.id]);
  const status = async (code) => (await q("SELECT status, projekt_id FROM geraet WHERE code = $1", [code])).rows[0];

  const m = await starteApp("materialplaner", s.url);
  const b = await starteBrowser();
  try {
    const w = m.win;
    await melde(w, "tom");
    const mb = await imBrowser(b, s, "materialplaner", "lena");
    await menue(mb, "Reparatur");
    await mb.getByText("Keine offenen Reparaturen.").waitFor();
    const ergebnis = w.getByTestId("scan-ergebnis");
    const scanne = async (code) => { await w.getByTestId("scanfeld").fill(code); await w.getByTestId("scanfeld").press("Enter"); };
    await menue(w, "Code scannen");
    await w.getByLabel("Projekt").selectOption(String(fest.id));
    await w.getByRole("button", { name: "Packansicht", exact: true }).click();
    await w.getByRole("button", { name: "Rückgabe", exact: true }).click();
    await w.getByRole("heading", { name: `Rückgabe ${fest.nummer} Stadtfest Neustadt` }).waitFor();
    await w.getByTestId("rueckgabe-stand").getByText("11 noch draußen").waitFor();
    // Tasche zuerst: wird aktiv, Inhalt einzeln scannen – einer fehlt
    await scanne("TA-0001");
    await ergebnis.getByText(/TA-0001 Spot-Tasche – Zurück im Lager – jetzt die 4 Teile \(Akku-Spot\) darin scannen/).waitFor();
    for (const c of spots.slice(0, 3)) { await scanne(c); await ergebnis.getByText(`${c} Akku-Spot – Zurück im Lager`).waitFor(); }
    await w.getByTestId("tasche-stand").getByText("Spot-Tasche: 4 von 4").waitFor();
    await bild(w, "NUTZER-03", "tasche");
    await w.getByRole("button", { name: "Tasche beenden" }).click();
    await w.getByTestId("tasche-stand").waitFor({ state: "detached" });
    // Lose Spots mit Funktionstest: einer hat einen Wackelkontakt
    await w.getByLabel("Funktionstest nach jedem Scan").check();
    await scanne(spots[4]);
    await ergebnis.getByText(`${spots[4]} Akku-Spot – Zurück im Lager`).waitFor();
    await w.getByRole("button", { name: "Mangel (2)", exact: true }).click();
    await w.getByLabel("Was ist kaputt?").fill("Wackelkontakt am Akku");
    await w.getByRole("button", { name: "Mangel speichern" }).click();
    await w.getByText(`${spots[4]} ist jetzt „Defekt“ und kann nicht gepackt werden, bis es repariert ist.`).waitFor();
    await scanne(spots[5]);
    await w.getByRole("button", { name: "In Ordnung (1)", exact: true }).waitFor();
    await w.keyboard.press("1");
    await w.getByText(`${spots[5]}: Funktionstest bestanden.`).waitFor();
    await w.getByLabel("Funktionstest nach jedem Scan").uncheck();
    // PAR-Sets: eins fehlt
    for (const c of pars.slice(0, 3)) { await scanne(c); await ergebnis.getByText(`${c} PAR-Set – Zurück im Lager`).waitFor(); }
    await w.getByTestId("rueckgabe-stand").getByText("2 noch draußen").waitFor();
    await w.getByRole("button", { name: "Alle offenen als vermisst melden", exact: true }).click();
    await w.getByRole("dialog").getByRole("button", { name: "Als vermisst melden" }).click();
    await w.getByText("2 Gerät(e) als vermisst gemeldet.").waitFor();
    await w.getByTestId("rueckgabe-stand").getByText("2 vermisst").waitFor();
    assert.equal((await status(pars[3])).status, "vermisst");
    await bild(w, "NUTZER-03", "vermisst");
    // Nachmittags taucht das PAR-Set im Transporter auf
    await scanne(pars[3]);
    await ergebnis.getByText(/wieder aufgetaucht/).waitFor();
    assert.equal((await status(pars[3])).status, "lager");
    await w.getByTestId("rueckgabe-stand").getByText("1 vermisst").waitFor();
    // Lena sieht den defekten Spot in der Werkstatt (Reparatur › Offen), live
    await mb.getByRole("cell", { name: spots[4] }).waitFor({ timeout: 10000 });
    await mb.getByText(/Wackelkontakt am Akku/).first().waitFor();
    await bild(mb, "NUTZER-03", "werkstatt");
    assert.equal((await status(spots[4])).status, "defekt");
  } finally { await b.ende(); await m.ende(); await s.ende(); }
});
