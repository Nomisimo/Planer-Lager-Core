// INT-02/INT-03 Nahtlos: beide Apps gleichzeitig offen, Änderungen erscheinen live ohne Neuladen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { starteServer, starteApp, starteBrowser, screenshot, anmelden, warteBis, PW } from "./helfer.js";

test("INT-02 INT-03 Angebot in P annehmen → Packliste in M live; Packen + Verladen in M → P zeigt „Läuft“ und Zone frei live", async () => {
  const s = await starteServer();
  await s.benutzer("buero", "Büro / Disposition", "Bea Büro");
  await s.benutzer("lager", "Lager / Techniker", "Lars Lager");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const jahr = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(new Date());
  const { rows: [k] } = await q("INSERT INTO kunde (name, firma) VALUES ('Anna Müller', 'Stadtwerke') RETURNING id");
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 2) RETURNING id");
  const { rows: [akku] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Akku', $1) RETURNING id", [kat.id]);
  for (const c of ["LI-0001", "LI-0002"]) await q("INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ($1, $2, (now() AT TIME ZONE 'Europe/Berlin')::date)", [c, akku.id]);
  const { rows: [zone] } = await q("INSERT INTO ladezone (bezeichnung) VALUES ('Rampe 1') RETURNING id");
  const { rows: [p] } = await q(`INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn, ladezone_id, zone_seit)
    VALUES ($1, 'projekt', 'Stadtfest', $2, 'angebot_gesendet', '2027-05-01', $3, now()) RETURNING id, nummer`, [`P-${jahr}-001`, k.id, zone.id]);
  try {
    const m = await starteApp("materialplaner", s.url);
    const pp = await starteApp("productionplaner", s.url);
    try {
      await anmelden(m.win, "lager");
      await anmelden(pp.win, "buero");
      await m.win.evaluate((id) => { location.hash = `#/projekte/${id}/packen`; }, p.id);
      await m.win.getByText("Für dieses Projekt gibt es noch kein Angebot.").waitFor();
      // Angebot entsteht ohne Live-Ereignis (direkt in der DB) – erst das Annehmen in P muss M aktualisieren
      const { rows: [a] } = await q("INSERT INTO angebot (nummer, projekt_id, status, betreff) VALUES ($1, $2, 'versendet', 'Licht') RETURNING id, nummer", [`A-${jahr}-001`, p.id]);
      await q("INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, bezeichnung, menge, einzelpreis) VALUES ($1, 1, 'miete', $2, 'Akku', 2, 1500)", [a.id, akku.id]);
      await pp.win.evaluate((id) => { location.hash = `#/angebote/${id}`; }, a.id);
      await pp.win.getByRole("button", { name: "Angenommen", exact: true }).click();
      // INT-02: M zeigt die Packliste ohne Neuladen
      const packliste = m.win.locator("section, .lp-section").filter({ hasText: "Packliste" }).locator("table.lp-tabelle");
      await packliste.getByText("Akku").waitFor({ timeout: 10000 });
      await m.win.getByText(`Packliste aus ${a.nummer}`).waitFor();
      await m.win.getByText(/Bestätigt/).first().waitFor();
      await screenshot(m.win, "INT-02-packliste-live");
      // INT-03: P zeigt das Projekt, M packt und verlädt
      await pp.win.evaluate((id) => { location.hash = `#/projekte/${id}`; }, p.id);
      const stand = pp.win.getByTestId("lager-stand");
      await stand.getByText("Ladezone Rampe 1").waitFor();
      const kennzahlen = pp.win.getByTestId("kennzahlen");
      for (const c of ["LI-0001", "LI-0002"]) { await m.win.getByTestId("scanfeld").fill(c); await m.win.getByTestId("scanfeld").press("Enter"); await m.win.getByTestId("scan-ergebnis").getByText(`${c} Akku – Gepackt`).waitFor(); }
      await m.win.getByTestId("fortschritt").getByText("100 %").waitFor();
      await kennzahlen.getByText("2 / 2").waitFor({ timeout: 10000 });
      await m.win.getByRole("button", { name: "Packen abgeschlossen & verladen" }).click();
      await m.win.getByRole("dialog").getByRole("button", { name: "Verladen" }).click();
      await stand.getByText(/^Verladen /).waitFor({ timeout: 10000 });
      await kennzahlen.getByText("Läuft").waitFor();
      const { rows: [x] } = await q("SELECT status, ladezone_id FROM projekt WHERE id = $1", [p.id]);
      assert.deepEqual([x.status, x.ladezone_id], ["laeuft", null]);
      await screenshot(pp.win, "INT-03-laeuft-zone-frei");
    } finally { await m.ende(); await pp.ende(); }
  } finally { await s.ende(); }
});

test("INT-04 Codefeld in P mit Gerätecode öffnet M beim Gerät; Codefeld in M mit Projektcode öffnet P beim Projekt", async () => {
  const s = await starteServer();
  await s.benutzer("chef", "Administrator", "Chris Chef");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const jahr = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(new Date());
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 1) RETURNING id");
  const { rows: [art] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Akku', $1) RETURNING id", [kat.id]);
  await q("INSERT INTO geraet (code, artikel_id) VALUES ('LI-0001', $1)", [art.id]);
  await q("INSERT INTO projekt (nummer, art, name, kunde_id) VALUES ($1, 'projekt', 'Stadtfest', $2)", [`P-${jahr}-001`, k.id]);
  try {
    const pp = await starteApp("productionplaner", s.url);
    let zuM;
    try {
      await anmelden(pp.win, "chef");
      await pp.win.getByTestId("codefeld").fill("li1");
      await pp.win.getByTestId("codefeld").press("Enter");
      zuM = await warteBis(() => pp.externeLinks().find((l) => l.startsWith("materialplaner://")));
      assert.match(zuM, /geraete\/code\/LI-0001/);
      assert.match(zuM, /handoff=/, "mit Anmeldung (Handoff)");
    } finally { await pp.ende(); }
    const m = await starteApp("materialplaner", s.url, { argv: [zuM] });
    let zuP;
    try {
      await m.win.getByRole("heading", { name: "LI-0001" }).waitFor({ timeout: 15000 });
      assert.equal(await m.win.getByTestId("anmeldung").count(), 0, "keine erneute Anmeldung");
      await screenshot(m.win, "INT-04-geraet-in-m");
      await m.win.getByTestId("codefeld").fill(`p ${jahr} 1`);
      await m.win.getByTestId("codefeld").press("Enter");
      zuP = await warteBis(() => m.externeLinks().find((l) => l.startsWith("productionplaner://")));
      assert.match(zuP, new RegExp(`projekte/nummer/P-${jahr}-001`));
    } finally { await m.ende(); }
    const p2 = await starteApp("productionplaner", s.url, { argv: [zuP] });
    try {
      await p2.win.getByRole("heading", { name: `P-${jahr}-001 Stadtfest` }).waitFor({ timeout: 15000 });
      await screenshot(p2.win, "INT-04-projekt-in-p");
    } finally { await p2.ende(); }
  } finally { await s.ende(); }
});

test("INT-05 Netzwerk-Scanner bucht am Arbeitsplatz → Arbeitsplatz-Web, M und P aktualisieren sich live", async () => {
  const s = await starteServer();
  await s.benutzer("chef", "Administrator", "Clara Chef");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 2) RETURNING id");
  const { rows: [art] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Spot', $1) RETURNING id", [kat.id]);
  const { rows: [p] } = await q(`INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-001', 'projekt', 'Stadtfest', $1, 'laeuft', '2027-05-01') RETURNING id`, [k.id]);
  for (const c of ["LI-0001", "LI-0002"]) await q("INSERT INTO geraet (code, artikel_id, status, projekt_id, letzte_pruefung) VALUES ($1, $2, 'gepackt', $3, (now() AT TIME ZONE 'Europe/Berlin')::date)", [c, art.id, p.id]);
  const anm = await (await fetch(`${s.url}/api/v1/anmelden`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ benutzername: "chef", passwort: PW }) })).json();
  const admin = async (pfad, body) => (await fetch(s.url + pfad, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${anm.token}` }, body: JSON.stringify(body) })).json();
  await admin("/api/v1/verwaltung/mitarbeiter", { name: "Lea", pin: "4711" });
  const ap = await admin("/api/v1/verwaltung/arbeitsplaetze", { name: "Rückgabe 1", art: "rueckgabe" });
  assert.ok(ap.code, JSON.stringify(ap));
  const token = "e2e-netzwerk-scanner-token-int05";
  await q("INSERT INTO scanner (name, token_hash, arbeitsplatz_id) VALUES ('Rampe', $1, $2)", [createHash("sha256").update(token).digest("hex"), ap.id]);
  const b = await starteBrowser();
  try {
    const sp = b.seite;
    await sp.goto(`${s.url}/station`);
    await sp.getByLabel("Einrichtungscode").fill(ap.code);
    await sp.getByRole("button", { name: "Einrichten" }).click();
    await sp.getByRole("button", { name: /Lea/ }).click();
    await sp.getByLabel("PIN für Lea").fill("4711");
    await sp.getByRole("button", { name: "Entsperren" }).click();
    await sp.getByTestId("mitarbeiter").getByText("Lea").waitFor();
    const m = await starteApp("materialplaner", s.url);
    const pp = await starteApp("productionplaner", s.url);
    try {
      await anmelden(m.win, "chef");
      await anmelden(pp.win, "chef");
      await m.win.evaluate(() => { location.hash = "#/geraete/code/LI-0001"; });
      await m.win.getByRole("heading", { name: "LI-0001" }).waitFor();
      await m.win.getByText("Gepackt").first().waitFor();
      await pp.win.evaluate((id) => { location.hash = `#/projekte/${id}`; }, p.id);
      const kennzahlen = pp.win.getByTestId("kennzahlen");
      await kennzahlen.getByText("2 / 2").waitFor();
      const r = await fetch(`${s.url}/api/v1/scanner/eingang`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Scanner ${token}` }, body: JSON.stringify({ code: "LI-0001" }) });
      assert.equal(r.status, 200, await r.text());
      await sp.getByTestId("scan-ergebnis").getByText(/LI-0001/).waitFor({ timeout: 10000 });
      await m.win.getByText("Im Lager").first().waitFor({ timeout: 10000 });
      await kennzahlen.getByText("1 / 1").waitFor({ timeout: 10000 });
      const { rows: [g] } = await q("SELECT status, projekt_id FROM geraet WHERE code = 'LI-0001'");
      assert.deepEqual([g.status, g.projekt_id], ["lager", null]);
      await screenshot(sp, "INT-05-arbeitsplatz");
      await screenshot(m.win, "INT-05-materialplaner");
      await screenshot(pp.win, "INT-05-productionplaner");
    } finally { await m.ende(); await pp.ende(); }
  } finally { await b.ende?.(); await s.ende(); }
});

test("INT-06 Offline: Verbindung trennen, 5 Scans, wiederverbinden → alle gebucht, Reihenfolge stimmt, P zeigt es live", async () => {
  const s = await starteServer();
  await s.benutzer("lager", "Lager / Techniker", "Lars Lager");
  await s.benutzer("buero", "Büro / Disposition", "Bea Büro");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const codes = ["LI-0004", "LI-0002", "LI-0005", "LI-0001", "LI-0003"]; // bewusst nicht sortiert
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 5) RETURNING id");
  const { rows: [akku] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Akku', $1) RETURNING id", [kat.id]);
  for (const c of [...codes].sort()) await q("INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ($1, $2, (now() AT TIME ZONE 'Europe/Berlin')::date)", [c, akku.id]);
  const { rows: [p] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-001', 'projekt', 'Stadtfest', $1, 'bestaetigt', '2027-05-01') RETURNING id", [k.id]);
  const { rows: [a] } = await q("INSERT INTO angebot (nummer, projekt_id, status) VALUES ('A-2027-001', $1, 'angenommen') RETURNING id", [p.id]);
  await q("INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, menge) VALUES ($1, 1, 'miete', $2, 5)", [a.id, akku.id]);
  try {
    const m = await starteApp("materialplaner", s.url);
    const pp = await starteApp("productionplaner", s.url);
    try {
      await anmelden(m.win, "lager");
      await anmelden(pp.win, "buero");
      await pp.win.evaluate((id) => { location.hash = `#/projekte/${id}`; }, p.id);
      const kennzahlen = pp.win.getByTestId("kennzahlen");
      await kennzahlen.getByText("0 / 0").waitFor();
      const w = m.win;
      await w.evaluate((id) => { location.hash = `#/projekte/${id}/packen`; }, p.id);
      await w.route("**/api/v1/scan", (r) => r.abort("internetdisconnected"));
      for (const [i, c] of codes.entries()) {
        await w.getByTestId("scanfeld").fill(c);
        await w.getByTestId("scanfeld").press("Enter");
        await w.getByTestId("offline-warten").getByText(`Offline – ${i + 1} ${i ? "Scans warten" : "Scan wartet"} auf die Verbindung.`).waitFor();
      }
      assert.equal((await q("SELECT count(*)::int AS n FROM bewegung")).rows[0].n, 0, "offline nichts gebucht");
      await screenshot(w, "INT-06-offline-5");
      await w.unroute("**/api/v1/scan");
      await w.getByRole("button", { name: "Jetzt senden" }).click();
      await w.getByTestId("offline-warten").waitFor({ state: "detached", timeout: 15000 });
      await w.getByTestId("fortschritt").getByText("100 %").waitFor();
      await kennzahlen.getByText("5 / 5").waitFor({ timeout: 10000 });
      const { rows } = await q("SELECT g.code FROM bewegung b JOIN geraet g ON g.id = b.geraet_id ORDER BY b.id");
      assert.deepEqual(rows.map((r) => r.code), codes, "in Erfassungsreihenfolge gebucht");
      assert.equal((await q("SELECT count(*)::int AS n FROM scan_offline")).rows[0].n, 5);
      await screenshot(pp.win, "INT-06-p-live");
    } finally { await m.ende(); await pp.ende(); }
  } finally { await s.ende(); }
});
