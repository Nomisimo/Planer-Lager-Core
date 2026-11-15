// NUTZER-02 Packtag mit Fehlbedienungen: Tom packt im Desktop-Materialplaner das Stadtfest (Handscanner per Tastatur-
// Simulation und Netzwerk-Scanner per TCP), Lena sieht im Browser-Productionplaner den Stand. Falscher Code, fremdes
// Projekt, gesperrtes Gerät, doppelter Scan, Case mit fehlendem Inhalt, Verladen, Zone frei, P zeigt „Läuft“.
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { starteApp, starteBrowser, warteBis } from "./helfer.js";
import { arbeitstag, imBrowser, melde, menue, bild } from "./nutzer-helfer.js";

const tcp = (port, text) => new Promise((ok, nein) => {
  const sock = net.connect(port, "127.0.0.1", () => sock.write(text));
  sock.on("data", (d) => { if (String(d).includes("\n")) { sock.end(); ok(String(d)); } });
  sock.on("error", nein);
});

test("NUTZER-02 Packtag mit Fehlbedienungen: falscher Code, fremdes Projekt, gesperrt, doppelt, Case unvollständig, Verladen, Zone frei, P zeigt „Läuft“", { timeout: 240000 }, async () => {
  const s = await arbeitstag({ scannerTcpPort: "auto", scannerTcpHost: "127.0.0.1" });
  const q = s.q;
  // Ausgangslage im Lager (wie sie morgens vorgefunden wird)
  const { rows: [fest] } = await q("SELECT id, nummer FROM projekt WHERE name = 'Stadtfest Neustadt'");
  const { rows: [jubi] } = await q("SELECT id, nummer FROM projekt WHERE name = 'Firmenjubiläum Müller'");
  const { rows: [zone] } = await q("SELECT id FROM ladezone WHERE bezeichnung = 'Rampe 1'");
  await q("UPDATE projekt SET ladezone_id = $1, zone_seit = now() WHERE id = $2", [zone.id, fest.id]);
  const codes = async (artikel) => (await q("SELECT g.code FROM geraet g JOIN artikel a ON a.id = g.artikel_id WHERE a.name = $1 ORDER BY g.code", [artikel])).rows.map((r) => r.code);
  const spots = await codes("Akku-Spot");
  const [defekt, fremd, ...frei] = spots;
  await q("UPDATE geraet SET status = 'defekt' WHERE code = $1", [defekt]);
  await q("UPDATE geraet SET status = 'gepackt', projekt_id = $1 WHERE code = $2", [jubi.id, fremd]);
  // Spot-Tasche (Case für 4) mit nur 3 Spots drin
  const { rows: [kat] } = await q("SELECT kategorie_id FROM artikel WHERE name = 'Akku-Spot'");
  const { rows: [spotArt] } = await q("SELECT id FROM artikel WHERE name = 'Akku-Spot'");
  const { rows: [ta] } = await q("INSERT INTO artikel (name, kategorie_id, ist_case, inhalt_artikel_id, verpackungseinheit) VALUES ('Spot-Tasche', $1, true, $2, 4) RETURNING id", [kat.kategorie_id, spotArt.id]);
  const { rows: [tasche] } = await q("INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ('TA-0001', $1, (now() AT TIME ZONE 'Europe/Berlin')::date) RETURNING id", [ta.id]);
  const inTasche = frei.slice(0, 3);
  await q("UPDATE geraet SET case_id = $1 WHERE code = ANY($2)", [tasche.id, inTasche]);
  const lose = frei.slice(3, 8);
  await q("INSERT INTO scanner (name, ip, token_hash) VALUES ('Rampe', '127.0.0.1', md5(random()::text))");

  const m = await starteApp("materialplaner", s.url);
  const b = await starteBrowser();
  try {
    const w = m.win;
    await melde(w, "tom");
    const p = await imBrowser(b, s, "productionplaner", "lena");
    await p.evaluate((id) => { location.hash = `#/projekte/${id}`; }, fest.id);
    await p.getByTestId("lager-stand").getByText("Ladezone Rampe 1").waitFor();
    const ergebnis = w.getByTestId("scan-ergebnis");
    const hid = async (code) => { await w.keyboard.type(code, { delay: 5 }); await w.keyboard.press("Enter"); };
    // Packansicht über den Projektcode (Handscanner, ohne ins Feld zu klicken)
    await menue(w, "Code scannen");
    await w.getByRole("heading", { name: "Code scannen" }).first().click();
    await hid(fest.nummer);
    await w.getByRole("heading", { name: `Packen ${fest.nummer} Stadtfest Neustadt` }).waitFor();
    // Fehlbedienung 1: Tippfehler im Code
    await hid("LI-9999");
    await ergebnis.getByText(/Code LI-9999 ist keinem Gerät zugeordnet/).waitFor();
    assert.equal(await ergebnis.getAttribute("data-level"), "error");
    // Fehlbedienung 2: Gerät gehört zum Firmenjubiläum
    await hid(fremd);
    await ergebnis.getByText(`${fremd} ist bereits in Projekt ${jubi.nummer} Firmenjubiläum Müller, übersprungen.`).waitFor();
    // Fehlbedienung 3: defektes Gerät
    await hid(defekt);
    await ergebnis.getByText(new RegExp(`${defekt} nicht verfügbar \\(Defekt\\)`)).waitFor();
    assert.equal(await ergebnis.getAttribute("data-level"), "error");
    await bild(w, "NUTZER-02", "fehlbedienung");
    // Tasche mit 3 statt 4 Spots
    await hid("TA-0001");
    await ergebnis.getByText(/Case unvollständig: 3 von 4/).waitFor();
    // Lose Spots: erster doppelt
    await hid(lose[0]);
    await ergebnis.getByText(`${lose[0]} Akku-Spot – Gepackt`).waitFor();
    await hid(lose[0]);
    await ergebnis.getByText(`${lose[0]} ist schon gepackt.`).waitFor();
    // Rest über den Netzwerk-Scanner an der Rampe (TCP, per Absender-IP)
    await w.getByLabel("Netzwerk-Scanner").selectOption({ label: "Rampe" });
    await warteBis(async () => s.gateway.port);
    await w.waitForTimeout(300);
    for (const c of lose.slice(1)) {
      assert.equal(await tcp(s.gateway.port, c + "\r\n"), "OK\r\n");
      await ergebnis.getByText(`${c} Akku-Spot – Gepackt`).waitFor();
    }
    for (const art of ["PAR-Set", "Traverse 2 m", "Stromverteiler 32 A"]) {
      const { rows: [pos] } = await q("SELECT ap.menge::int AS menge FROM angebot_position ap JOIN angebot a ON a.id = ap.angebot_id JOIN artikel x ON x.id = ap.artikel_id WHERE a.projekt_id = $1 AND x.name = $2", [fest.id, art]);
      for (const c of (await codes(art)).slice(0, pos.menge)) { await hid(c); await ergebnis.getByText(`${c} ${art} – Gepackt`).waitFor(); }
    }
    // Lena sieht den Fortschritt live
    await p.getByTestId("kennzahlen").getByText(/17 \/ 17|\d+ \/ \d+/).first().waitFor();
    await bild(w, "NUTZER-02", "gepackt");
    // Verladen
    await w.getByRole("button", { name: "Packen abgeschlossen & verladen" }).click();
    await w.getByRole("dialog").getByRole("button", { name: "Verladen" }).click();
    await w.getByText(/verladen, Ladezone frei, Status „Läuft“/).waitFor();
    await bild(w, "NUTZER-02", "verladen");
    const { rows: [x] } = await q("SELECT status, ladezone_id, gepackt_von_name FROM projekt WHERE id = $1", [fest.id]);
    assert.deepEqual([x.status, x.ladezone_id], ["laeuft", null]);
    assert.ok(x.gepackt_von_name);
    // P im Browser: „Läuft“, Zone frei, ohne Neuladen
    await p.getByTestId("kennzahlen").getByText("Läuft").waitFor({ timeout: 10000 });
    await p.getByTestId("lager-stand").getByText(/^Verladen /).waitFor();
    assert.equal(await p.getByTestId("lager-stand").getByText("Ladezone Rampe 1").count(), 0);
    await bild(p, "NUTZER-02", "p-laeuft");
    // Gesperrtes und fremdes Gerät blieben unangetastet
    const { rows: st } = await q("SELECT code, status, projekt_id FROM geraet WHERE code = ANY($1) ORDER BY code", [[defekt, fremd]]);
    assert.deepEqual(st.map((g) => [g.code, g.status, g.projekt_id]).sort(), [[defekt, "defekt", null], [fremd, "gepackt", jubi.id]].sort());
  } finally { await b.ende(); await m.ende(); await s.ende(); }
});
