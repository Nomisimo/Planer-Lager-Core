import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, starteBrowser, screenshot, anmelden } from "./helfer.js";

test("T-16 FA-25 FA-24 R-11a R-11b R-11c R-11d R-11e R-11f R-11g R-59 Arbeitsplatz-Web: einrichten, gesperrt, PIN 5× falsch, entsperren, Rückgabe mit Funktionstest, Fremdseiten gesperrt; Anzeige-Bildschirm", async () => {
  const s = await starteServer();
  await s.benutzer("chef", "Administrator", "Clara Chef");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 9) RETURNING id");
  const { rows: [art] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Spot', $1) RETURNING id", [kat.id]);
  const { rows: [zone] } = await q("INSERT INTO ladezone (bezeichnung, plaetze) VALUES ('Rampe', 2) RETURNING id");
  const { rows: [p] } = await q(`INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn, ladezone_id, zone_seit)
    VALUES ('P-2027-001', 'projekt', 'Stadtfest', $1, 'laeuft', '2027-05-01', $2, now()) RETURNING id`, [k.id, zone.id]);
  for (const c of ["LI-0001", "LI-0002"]) await q("INSERT INTO geraet (code, artikel_id, status, projekt_id, letzte_pruefung) VALUES ($1, $2, 'gepackt', $3, (now() AT TIME ZONE 'Europe/Berlin')::date)", [c, art.id, p.id]);
  const b = await starteBrowser();
  try {
    // FA-25 Admin richtet im Materialplaner ein
    const a = await starteApp("materialplaner", s.url);
    const codes = {};
    try {
      const w = a.win;
      await anmelden(w, "chef");
      await w.evaluate(() => { window.location.hash = "#/verwaltung"; });
      await w.getByRole("heading", { name: "Arbeitsplätze" }).locator("..").locator("..").getByRole("button", { name: "Öffnen" }).click();
      await w.getByRole("button", { name: "Mitarbeiter anlegen" }).click();
      let d = w.getByRole("dialog");
      await d.getByLabel("Name").fill("Lea");
      await d.getByLabel("PIN").fill("4711");
      await d.getByRole("button", { name: "Speichern" }).click();
      await w.getByText("Lea angelegt.").waitFor();
      for (const [name, artName, extra] of [["Rückgabe 1", "rueckgabe", true], ["TV Halle", "anzeige", false]]) {
        await w.getByRole("button", { name: "Arbeitsplatz anlegen" }).click();
        d = w.getByRole("dialog");
        await d.getByLabel("Name").fill(name);
        await d.getByLabel("Art").selectOption(artName);
        if (extra) await d.getByLabel("Funktionstest bei jeder Rückgabe abfragen").check();
        await d.getByRole("button", { name: "Speichern" }).click();
        codes[name] = (await w.getByTestId("einrichtungscode").textContent()).trim();
        await w.getByRole("button", { name: "Notiert" }).click();
      }
      assert.match(codes["Rückgabe 1"], /^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
      await screenshot(w, "FA-25-arbeitsplaetze");
    } finally { await a.ende(); }

    // R-11a Einrichten → gesperrt
    const sp = b.seite;
    await sp.goto(`${s.url}/station`);
    await sp.getByLabel("Einrichtungscode").fill("FALSCH-CODE");
    await sp.getByRole("button", { name: "Einrichten" }).click();
    await sp.getByText(/Einrichtungscode ist falsch oder abgelaufen/).waitFor();
    await sp.getByLabel("Einrichtungscode").fill(codes["Rückgabe 1"]);
    await sp.getByRole("button", { name: "Einrichten" }).click();
    await sp.getByTestId("sperrbildschirm").waitFor();
    await sp.getByRole("heading", { name: "Rückgabe 1" }).waitFor();
    // R-11d: gesperrt → API 423, Fremdseite 403
    const status = (pfad, methode = "GET", body) => sp.evaluate(async ([pf, m, bd]) => (await fetch(pf, { method: m, headers: { "Content-Type": "application/json" }, body: bd ? JSON.stringify(bd) : undefined })).status, [pfad, methode, body]);
    assert.equal(await status("/api/v1/projekte/1/rueckgabe"), 423);
    assert.equal(await status("/api/v1/kunden"), 403);
    // R-11c 5× falsche PIN → Wartezeit
    await sp.getByRole("button", { name: /Lea/ }).click();
    for (let i = 0; i < 5; i++) {
      await sp.getByLabel("PIN für Lea").fill("0000");
      await sp.getByRole("button", { name: "Entsperren" }).click();
      await sp.getByText(i < 4 ? `Falsche PIN. Noch ${4 - i} Versuch(e)` : /5 falsche PINs in Folge/).waitFor();
    }
    await sp.getByText(/Neuer Versuch in \d+ Sekunden/).waitFor();
    assert.equal(await sp.getByRole("button", { name: "Entsperren" }).isDisabled(), true);
    await screenshot(sp, "T-16-sperrbildschirm");
    await q("UPDATE arbeitsplatz SET gesperrt_bis = now() WHERE name = 'Rückgabe 1'");
    await sp.reload();
    await sp.getByRole("button", { name: /Lea/ }).click();
    await sp.getByLabel("PIN für Lea").fill("4711");
    await sp.getByRole("button", { name: "Entsperren" }).click();
    await sp.getByTestId("mitarbeiter").getByText("Lea").waitFor();
    // R-11d nach Entsperren: Fremdseiten weiter gesperrt, Rückgabe erlaubt
    assert.equal(await status("/api/v1/kunden"), 403);
    assert.equal(await status("/api/v1/verwaltung/arbeitsplaetze"), 403);
    // R-11e Rückgabe ohne Projektwahl, R-11g Funktionstest mit Taste 2 = Mangel, R-11f Mitarbeiter an der Buchung
    await sp.getByTestId("scanfeld").fill("li1");
    await sp.getByTestId("scanfeld").press("Enter");
    await sp.getByTestId("scan-ergebnis").getByText("LI-0001 Spot – Zurück im Lager").waitFor();
    await sp.getByRole("button", { name: "Mangel (2)" }).waitFor();
    await sp.keyboard.press("2");
    await sp.getByLabel("Was ist kaputt?").fill("Linse gesprungen");
    await sp.getByRole("button", { name: "Mangel speichern" }).click();
    await sp.getByText(/LI-0001 ist jetzt „Defekt“/).waitFor();
    const { rows: bw } = await q("SELECT aktion, mitarbeiter FROM bewegung b JOIN geraet g ON g.id = b.geraet_id WHERE g.code = 'LI-0001' ORDER BY b.id");
    assert.deepEqual(bw.map((x) => x.mitarbeiter), ["Lea", "Lea"]);
    assert.equal(bw[1].aktion, "Mangel bei Rückgabe: Linse gesprungen");
    await screenshot(sp, "R-11g-funktionstest");
    // R-11b: nach Sperrzeit ohne Eingabe gesperrt (Server-Seite)
    await q("UPDATE arbeitsplatz SET letzte_aktivitaet = now() - interval '11 minutes' WHERE name = 'Rückgabe 1'");
    await sp.getByTestId("scanfeld").fill("LI-0002");
    await sp.getByTestId("scanfeld").press("Enter");
    await sp.getByTestId("sperrbildschirm").waitFor();
    assert.equal((await q("SELECT status FROM geraet WHERE code = 'LI-0002'")).rows[0].status, "gepackt", "nicht gebucht, weil gesperrt");
    // Sperren per Knopf
    await sp.getByRole("button", { name: /Lea/ }).click();
    await sp.getByLabel("PIN für Lea").fill("4711");
    await sp.getByRole("button", { name: "Entsperren" }).click();
    await sp.getByRole("button", { name: "Sperren" }).click();
    await sp.getByTestId("sperrbildschirm").waitFor();

    // R-59 / FA-24 Anzeige-Bildschirm: nie gesperrt, QR, aktualisiert sich selbst
    const tv = await b.neueSeite();
    await tv.goto(`${s.url}/station`);
    await tv.getByLabel("Einrichtungscode").fill(codes["TV Halle"]);
    await tv.getByRole("button", { name: "Einrichten" }).click();
    const rampe = tv.getByTestId("anzeige-zone-Rampe");
    await rampe.getByText("P-2027-001").waitFor();
    assert.equal(await rampe.locator(".lp-anzeige-qr svg").count(), 1);
    await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-002', 'projekt', 'Messe', $1, 'bestaetigt', '2027-05-03')", [k.id]);
    const r = await fetch(`${s.url}/api/v1/anmelden`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ benutzername: "chef", passwort: "Sicheres-Testpasswort-1" }) });
    assert.equal(r.status, 200, "R-58 Anmeldung verteilt P-2027-002 auf den freien Platz der Rampe");
    await rampe.getByText("P-2027-002").waitFor(); // live, ohne Neuladen
    await screenshot(tv, "FA-24-anzeige");
  } finally { await b.ende(); await s.ende(); }
});
