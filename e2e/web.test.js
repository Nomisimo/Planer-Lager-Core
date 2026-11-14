// Phase 16 W – Browser-Version beider Apps (ZUSATZ.md, ARCHITEKTUR §10). Browser = Chromium ohne Electron-Brücke.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { starteServer, starteApp, starteBrowser, anmelden, screenshot, warteBis, webAppsDir, sammleFehler } from "./helfer.js";

const imBrowserAnmelden = async (seite, benutzer) => {
  await seite.getByLabel("Benutzername").fill(benutzer);
  await seite.getByLabel("Passwort").fill("Sicheres-Testpasswort-1");
  await seite.getByRole("button", { name: "Anmelden" }).click();
  await seite.getByTestId("benutzer").waitFor({ timeout: 10000 });
};

test("WEB-01 WEB-02 WEB-05 WEB-06 WEB-07 WEB-08 WEB-10 WEB-12 Login im Browser, Wechsel ohne neue Anmeldung, Neuladen, Rücksprung, Abmelden beider Apps", async () => {
  const web = webAppsDir();
  const s = await starteServer({ config: { webAppsDir: web } });
  await s.benutzer("chef", "Administrator", "Clara Chef");
  await s.db.pool.query("INSERT INTO kunde (name) VALUES ('Anna Müller')");
  const b = await starteBrowser();
  try {
    const seite = b.seite;
    const fehler = sammleFehler(seite);
    const csp = [];
    seite.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
    // WEB-07: nicht angemeldet, direkt auf eine Unterseite → Login, danach dieselbe Seite
    await seite.goto(`${s.url}/productionplaner/#/kunden`);
    await seite.getByLabel("Benutzername").waitFor();
    await screenshot(seite, "WEB-01-login-browser");
    assert.deepEqual(fehler, [], "BUG-2: keine Konsolenfehler vor der Anmeldung");
    await imBrowserAnmelden(seite, "chef");
    await seite.getByRole("heading", { name: "Kunden" }).first().waitFor();
    assert.equal(new URL(seite.url()).hash, "#/kunden");
    // WEB-01: Cookie-Sitzung (HttpOnly), kein Token im localStorage
    const cookies = await seite.context().cookies();
    const c = cookies.find((x) => x.name === "lager_sitzung");
    assert.ok(c?.httpOnly && c.path === "/" && c.sameSite === "Lax");
    assert.equal(await seite.evaluate(() => Object.keys(localStorage).some((k) => /token/i.test(k))), false);
    // WEB-06: Hash-Route überlebt Neuladen
    await seite.reload();
    await seite.getByRole("heading", { name: "Kunden" }).first().waitFor();
    await seite.getByText("Anna Müller").first().waitFor();
    // WEB-02: Wechsel in den Materialplaner ohne neue Anmeldung
    await seite.getByTestId("app-schalter").click();
    await seite.waitForURL(/\/materialplaner\//);
    await seite.getByTestId("benutzer").waitFor();
    assert.equal(await seite.getByLabel("Passwort").count(), 0);
    // WEB-08: Nur-Desktop-Funktionen gekennzeichnet bzw. verborgen
    await seite.evaluate(() => { location.hash = "#/verwaltung/scanner"; });
    await seite.getByTestId("nur-desktop-seriell").waitFor();
    assert.equal(await seite.getByRole("button", { name: "Scanner wählen" }).count(), 0);
    assert.equal(await seite.getByTestId("im-browser").count(), 0);
    await screenshot(seite, "WEB-08-nur-desktop");
    // WEB-10: Portal zeigt beide Kacheln für den Admin
    const portal = await b.neueSeite();
    await portal.context().addCookies(cookies);
    await portal.goto(`${s.url}/`);
    await portal.getByTestId("kachel-materialplaner").waitFor();
    await portal.getByTestId("kachel-productionplaner").waitFor();
    await screenshot(portal, "WEB-10-portal");
    // WEB-12: Abmelden in einer App meldet beide ab
    await seite.getByRole("button", { name: "Abmelden" }).click();
    await seite.getByLabel("Benutzername").waitFor();
    await seite.goto(`${s.url}/productionplaner/#/kunden`);
    await seite.getByLabel("Benutzername").waitFor();
    // WEB-05: keine CSP-Fehler, keine Seitenfehler
    assert.deepEqual(csp, []);
    assert.deepEqual(fehler.filter((f) => !/401|Failed to load resource/.test(f)), []);
  } finally { await b.ende(); await s.ende(); fs.rmSync(web, { recursive: true, force: true }); }
});

test("WEB-04 Etikett drucken im Browser öffnet ein Druckfenster mit der Seitengröße der Vorlage", async () => {
  const web = webAppsDir();
  const s = await starteServer({ config: { webAppsDir: web } });
  await s.benutzer("chef", "Administrator", "Clara Chef");
  await s.db.pool.query("INSERT INTO kategorie (name, praefix) VALUES ('Scheinwerfer', 'SW')");
  const b = await starteBrowser();
  try {
    const seite = b.seite;
    await seite.addInitScript(() => {
      // window.print gestubbt: Druckfenster merken statt Dialog
      const offen = window.open.bind(window);
      window.open = (...a) => { const w = offen(...a); if (w) { w.print = () => { window.__druck = { groesse: w.__seitengroesse, seiten: w.document.querySelectorAll(".seite").length, stil: w.document.querySelector("style")?.textContent || "" }; }; w.close = () => {}; } return w; };
    });
    await seite.goto(`${s.url}/materialplaner/#/material`);
    await imBrowserAnmelden(seite, "chef");
    await seite.getByRole("button", { name: "Material aufnehmen" }).click();
    await seite.getByLabel("Name").fill("PAR 64");
    await seite.getByLabel("Kategorie").selectOption({ label: "Scheinwerfer (SW)" });
    await seite.getByLabel("Anzahl Geräte").fill("2");
    await seite.getByRole("button", { name: "Speichern" }).click();
    await seite.getByRole("heading", { name: "Etiketten drucken" }).waitFor();
    await seite.getByTestId("druck-hinweis").getByText(/Druckfenster des Browsers/).waitFor();
    await seite.getByRole("button", { name: "2 drucken" }).click();
    const d = await warteBis(() => seite.evaluate(() => window.__druck));
    assert.equal(d.groesse, "62x29");
    assert.match(d.stil, /@page \{ size: 62mm 29mm/);
    assert.equal(d.seiten, 2);
    await screenshot(seite, "WEB-04-druck-browser");
  } finally { await b.ende(); await s.ende(); fs.rmSync(web, { recursive: true, force: true }); }
});

test("WEB-03 WEB-13 Änderung im Browser-Productionplaner erscheint live im Desktop-Materialplaner; „Im Browser öffnen“ mit Handoff", async () => {
  const web = webAppsDir();
  const s = await starteServer({ config: { webAppsDir: web } });
  await s.benutzer("chef", "Administrator", "Clara Chef");
  const { rows: [k] } = await s.db.pool.query("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [p] } = await s.db.pool.query("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-001', 'projekt', 'Stadtfest', $1, 'bestaetigt', '2027-05-03') RETURNING id", [k.id]);
  const m = await starteApp("materialplaner", s.url);
  const b = await starteBrowser();
  try {
    await anmelden(m.win, "chef");
    // WEB-13: Desktop → Browser mit Handoff-Code, gleiche Ansicht
    await m.win.evaluate(() => { location.hash = "#/geraete"; });
    await m.win.getByTestId("im-browser").click();
    const link = await warteBis(() => m.externeLinks().find((l) => l.includes("/materialplaner/?handoff=")));
    assert.match(link, /#\/geraete$/);
    const seite = b.seite;
    await seite.goto(link);
    await seite.getByTestId("benutzer").waitFor();
    assert.equal(new URL(seite.url()).search, "", "Handoff-Code bleibt nicht in der Adresse");
    assert.equal(new URL(seite.url()).hash, "#/geraete");
    // WEB-13 Gegenrichtung: Browser → Desktop-App per Deep-Link mit Handoff-Code, Desktop löst ihn ein
    await seite.getByTestId("in-desktop").click();
    const zurueck = await warteBis(() => seite.evaluate(() => window.__lagerDesktopLink));
    assert.match(zurueck, /^materialplaner:\/\/geraete\?handoff=/);
    const m2 = await starteApp("materialplaner", s.url, { argv: [zurueck] });
    try {
      await m2.win.getByTestId("benutzer").waitFor({ timeout: 15000 });
      assert.equal(await m2.win.evaluate(() => location.hash), "#/geraete");
    } finally { await m2.ende(); }
    // WEB-03: im Browser in den Productionplaner, Projekt umbenennen → Desktop-Materialplaner zeigt es live
    await m.win.evaluate((id) => { location.hash = `#/projekte/${id}/packen`; }, p.id);
    await m.win.getByText("Stadtfest").first().waitFor();
    await m.win.getByTestId("online-status").getByText("Online").waitFor();
    await seite.goto(`${s.url}/productionplaner/#/projekte/${p.id}/bearbeiten`);
    await seite.waitForFunction(() => [...document.querySelectorAll("input")].some((i) => i.value === "Stadtfest"));
    await seite.getByLabel(/^Name/).first().fill("Stadtfest Nord");
    await seite.getByRole("button", { name: "Speichern" }).click();
    await warteBis(async () => (await s.db.pool.query("SELECT name FROM projekt WHERE id = $1", [p.id])).rows[0].name === "Stadtfest Nord");
    await m.win.getByText("Stadtfest Nord").first().waitFor({ timeout: 10000 });
    await screenshot(m.win, "WEB-03-live-desktop");
  } finally { await b.ende(); await m.ende(); await s.ende(); fs.rmSync(web, { recursive: true, force: true }); }
});

const jahrJetzt = () => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(new Date());

test("INT-07 INT-01 INT-02 INT-03 Browser + Desktop: Angebot im Browser-P annehmen → Desktop-M packt live → Browser-P zeigt „Läuft“", async () => {
  const web = webAppsDir();
  const s = await starteServer({ config: { webAppsDir: web } });
  await s.benutzer("buero", "Büro / Disposition", "Bea Büro");
  await s.benutzer("lager", "Lager / Techniker", "Lars Lager");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const jahr = jahrJetzt();
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 2) RETURNING id");
  const { rows: [akku] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Akku', $1) RETURNING id", [kat.id]);
  for (const c of ["LI-0001", "LI-0002"]) await q("INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ($1, $2, (now() AT TIME ZONE 'Europe/Berlin')::date)", [c, akku.id]);
  const { rows: [zone] } = await q("INSERT INTO ladezone (bezeichnung) VALUES ('Rampe 1') RETURNING id");
  const { rows: [p] } = await q(`INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn, ladezone_id, zone_seit)
    VALUES ($1, 'projekt', 'Stadtfest', $2, 'angebot_gesendet', '2027-05-01', $3, now()) RETURNING id`, [`P-${jahr}-001`, k.id, zone.id]);
  const { rows: [a] } = await q("INSERT INTO angebot (nummer, projekt_id, status, betreff) VALUES ($1, $2, 'versendet', 'Licht') RETURNING id, nummer", [`A-${jahr}-001`, p.id]);
  await q("INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, bezeichnung, menge, einzelpreis) VALUES ($1, 1, 'miete', $2, 'Akku', 2, 1500)", [a.id, akku.id]);
  const m = await starteApp("materialplaner", s.url);
  const b = await starteBrowser();
  try {
    const pb = b.seite;
    await anmelden(m.win, "lager");
    // INT-01 im Browser: Anmeldung in P gilt auch für M (Cookie, ohne zweite Anmeldung)
    await pb.goto(`${s.url}/productionplaner/#/angebote/${a.id}`);
    await imBrowserAnmelden(pb, "buero");
    const mb = await b.neueSeite();
    await mb.context().addCookies(await pb.context().cookies());
    await mb.goto(`${s.url}/materialplaner/#/geraete`);
    await mb.getByTestId("benutzer").getByText("Bea Büro").waitFor();
    await mb.close();
    await m.win.evaluate((id) => { location.hash = `#/projekte/${id}/packen`; }, p.id);
    await m.win.getByText("Projektstatus").first().waitFor().catch(() => {});
    // INT-02: Angebot im Browser-P annehmen → Packliste im Desktop-M live
    await pb.getByRole("button", { name: "Angenommen", exact: true }).click();
    const packliste = m.win.locator("section, .lp-section").filter({ hasText: "Packliste" }).locator("table.lp-tabelle");
    await packliste.getByText("Akku").waitFor({ timeout: 10000 });
    // INT-03: Desktop-M packt + verlädt → Browser-P zeigt „Läuft“ und Zone frei
    await pb.evaluate((id) => { location.hash = `#/projekte/${id}`; }, p.id);
    const kennzahlen = pb.getByTestId("kennzahlen");
    await pb.getByTestId("lager-stand").getByText("Ladezone Rampe 1").waitFor();
    for (const c of ["LI-0001", "LI-0002"]) { await m.win.getByTestId("scanfeld").fill(c); await m.win.getByTestId("scanfeld").press("Enter"); await m.win.getByTestId("scan-ergebnis").getByText(`${c} Akku – Gepackt`).waitFor(); }
    await kennzahlen.getByText("2 / 2").waitFor({ timeout: 10000 });
    await m.win.getByRole("button", { name: "Packen abgeschlossen & verladen" }).click();
    await m.win.getByRole("dialog").getByRole("button", { name: "Verladen" }).click();
    await kennzahlen.getByText("Läuft").waitFor({ timeout: 10000 });
    await pb.getByTestId("lager-stand").getByText(/^Verladen /).waitFor();
    await screenshot(pb, "INT-07-browser-p-laeuft");
  } finally { await b.ende(); await m.ende(); await s.ende(); fs.rmSync(web, { recursive: true, force: true }); }
});

test("INT-07 INT-04 INT-05 INT-06 Browser + Desktop: Codefeld im Browser-P öffnet Browser-M; Netzwerk-Scanner und Offline-Scans im Browser-M erscheinen live im Desktop-P", async () => {
  const web = webAppsDir();
  const s = await starteServer({ config: { webAppsDir: web } });
  await s.benutzer("chef", "Administrator", "Clara Chef");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const jahr = jahrJetzt();
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 5) RETURNING id");
  const { rows: [akku] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Akku', $1) RETURNING id", [kat.id]);
  const { rows: [p] } = await q(`INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ($1, 'projekt', 'Stadtfest', $2, 'bestaetigt', '2027-05-01') RETURNING id`, [`P-${jahr}-001`, k.id]);
  for (const c of ["LI-0001", "LI-0002", "LI-0003"]) await q("INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ($1, $2, (now() AT TIME ZONE 'Europe/Berlin')::date)", [c, akku.id]);
  const { rows: [a] } = await q("INSERT INTO angebot (nummer, projekt_id, status) VALUES ($1, $2, 'angenommen') RETURNING id", [`A-${jahr}-001`, p.id]);
  await q("INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, menge) VALUES ($1, 1, 'miete', $2, 3)", [a.id, akku.id]);
  const pp = await starteApp("productionplaner", s.url);
  const b = await starteBrowser();
  try {
    await anmelden(pp.win, "chef");
    await pp.win.evaluate((id) => { location.hash = `#/projekte/${id}`; }, p.id);
    const kennzahlen = pp.win.getByTestId("kennzahlen");
    await kennzahlen.getByText("0 / 0").waitFor();
    // INT-04: Codefeld im Browser-P mit Gerätecode → Browser-M beim Gerät, ohne neue Anmeldung
    const w = b.seite;
    await w.goto(`${s.url}/productionplaner/#/`);
    await imBrowserAnmelden(w, "chef");
    await w.getByTestId("codefeld").fill("li1");
    await w.getByTestId("codefeld").press("Enter");
    await w.waitForURL(/\/materialplaner\/#\/geraete\/code\/LI-0001/);
    await w.getByRole("heading", { name: "LI-0001" }).waitFor({ timeout: 15000 });
    assert.equal(await w.getByLabel("Passwort").count(), 0);
    // INT-06: Browser-M offline packen (3 Scans), wieder online → alle gebucht, Desktop-P zeigt es live
    await w.evaluate((id) => { location.hash = `#/projekte/${id}/packen`; }, p.id);
    await w.route("**/api/v1/scan", (r) => r.abort("internetdisconnected"));
    const codes = ["LI-0003", "LI-0001", "LI-0002"];
    for (const [i, c] of codes.entries()) {
      await w.getByTestId("scanfeld").fill(c);
      await w.getByTestId("scanfeld").press("Enter");
      await w.getByTestId("offline-warten").getByText(`Offline – ${i + 1} ${i ? "Scans warten" : "Scan wartet"} auf die Verbindung.`).waitFor();
    }
    assert.equal((await q("SELECT count(*)::int AS n FROM bewegung")).rows[0].n, 0);
    await w.unroute("**/api/v1/scan");
    await w.getByRole("button", { name: "Jetzt senden" }).click();
    await w.getByTestId("offline-warten").waitFor({ state: "detached", timeout: 15000 });
    await kennzahlen.getByText("3 / 3").waitFor({ timeout: 10000 });
    const { rows } = await q("SELECT g.code FROM bewegung b JOIN geraet g ON g.id = b.geraet_id ORDER BY b.id");
    assert.deepEqual(rows.map((r) => r.code), codes);
    // INT-05: Netzwerk-Scanner bucht (Rückgabe am Arbeitsplatz) → Browser-M beim Gerät und Desktop-P live
    await q("UPDATE projekt SET status = 'laeuft' WHERE id = $1", [p.id]);
    const anm = await (await fetch(`${s.url}/api/v1/anmelden`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ benutzername: "chef", passwort: "Sicheres-Testpasswort-1" }) })).json();
    const admin = async (pfad, body) => (await fetch(s.url + pfad, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${anm.token}` }, body: JSON.stringify(body) })).json();
    await admin("/api/v1/verwaltung/mitarbeiter", { name: "Lea", pin: "4711" });
    const ap = await admin("/api/v1/verwaltung/arbeitsplaetze", { name: "Rückgabe 1", art: "rueckgabe" });
    const token = "e2e-netzwerk-scanner-token-int07";
    const { createHash } = await import("node:crypto");
    await q("INSERT INTO scanner (name, token_hash, arbeitsplatz_id) VALUES ('Rampe', $1, $2)", [createHash("sha256").update(token).digest("hex"), ap.id]);
    const sp = await b.neueSeite();
    await sp.goto(`${s.url}/station`);
    await sp.getByLabel("Einrichtungscode").fill(ap.code);
    await sp.getByRole("button", { name: "Einrichten" }).click();
    await sp.getByRole("button", { name: /Lea/ }).click();
    await sp.getByLabel("PIN für Lea").fill("4711");
    await sp.getByRole("button", { name: "Entsperren" }).click();
    await sp.getByTestId("mitarbeiter").getByText("Lea").waitFor();
    await w.evaluate(() => { location.hash = "#/geraete/code/LI-0001"; });
    await w.getByRole("heading", { name: "LI-0001" }).waitFor();
    const r = await fetch(`${s.url}/api/v1/scanner/eingang`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Scanner ${token}` }, body: JSON.stringify({ code: "LI-0001" }) });
    assert.equal(r.status, 200, await r.text());
    await w.getByText("Im Lager").first().waitFor({ timeout: 10000 });
    await kennzahlen.getByText("2 / 2").waitFor({ timeout: 10000 });
    await screenshot(w, "INT-07-browser-m");
    await screenshot(pp.win, "INT-07-desktop-p");
  } finally { await b.ende(); await pp.ende(); await s.ende(); fs.rmSync(web, { recursive: true, force: true }); }
});
