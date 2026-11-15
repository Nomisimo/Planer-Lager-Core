// REMOTE (ZUSATZ.md Phase S): Oberflächen gegen den echten Testserver – Chromium (CSP, Band) und beide Electron-Apps.
// Im GitHub-Runner (remote-test.yml) direkt. In der Claude-VM über den Proxy (--proxy-server), der TLS aufbricht: nur dann
// --ignore-certificate-errors; im Hauptprozess vertraut Node dem Proxy-Zertifikat über NODE_EXTRA_CA_CERTS. Nie in einem Build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteApp, screenshot, playwright } from "../helfer.js";
import { URL_REMOTE, OHNE, admin, testBenutzer } from "./remote-helfer.js";

const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const OHNE_UI = OHNE;
// Nur hinter dem aufbrechenden Proxy der Claude-VM; im GitHub-Runner gilt das echte Zertifikat.
const appArgs = PROXY ? [`--proxy-server=${PROXY}`, "--ignore-certificate-errors"] : [];
const appEnv = { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS || `${process.env.HOME}/.ccr/ca-bundle.crt` };

async function browser() {
  const { chromium } = playwright();
  const b = await chromium.launch({ ...(PROXY ? { proxy: { server: PROXY } } : {}), ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}) });
  const k = await b.newContext({ ignoreHTTPSErrors: !!PROXY, locale: "de-DE", timezoneId: "Europe/Berlin", viewport: { width: 1280, height: 800 } });
  return { b, k };
}
const fehlerSammler = (seite) => {
  const f = [];
  seite.on("console", (m) => { if (m.type() === "error") f.push(m.text()); });
  seite.on("pageerror", (e) => f.push(String(e?.message || e)));
  seite.on("response", (r) => { if (r.status() >= 400 && r.status() !== 401) f.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
  return f;
};
const ohneTestToken = (f) => f.filter((t) => !/401|Unauthorized/.test(t));

async function melde(win, b) {
  await win.getByLabel("Benutzername").fill(b.benutzername);
  await win.getByLabel("Passwort").fill(b.passwort);
  await win.getByRole("button", { name: "Anmelden" }).click();
  await win.getByTestId("benutzer").waitFor({ timeout: 20000 });
  const w = win.getByRole("dialog", { name: /^Willkommen im / });
  if (await w.waitFor({ timeout: 2500 }).then(() => true, () => false)) await w.getByRole("button", { name: "Nicht mehr anzeigen" }).click();
}

test("REMOTE-03 Seiten im Browser ohne CSP- und Konsolenfehler; REMOTE-07 Band TESTSYSTEM sichtbar", { skip: OHNE_UI, timeout: 240000 }, async () => {
  const { b, k } = await browser();
  try {
    for (const p of ["/", "/materialplaner/", "/productionplaner/", "/station", "/anzeige"]) {
      const s = await k.newPage();
      const f = fehlerSammler(s);
      await s.goto(URL_REMOTE + p, { waitUntil: "networkidle" });
      await s.getByTestId("testsystem-band").waitFor({ timeout: 15000 });
      assert.equal(await s.getByTestId("testsystem-band").textContent(), "TESTSYSTEM – nur Beispieldaten", p);
      assert.deepEqual(f.filter((t) => /Content Security Policy|Refused to/.test(t)), [], `${p}: CSP-Fehler`);
      assert.deepEqual(ohneTestToken(f), [], `${p}: Konsolenfehler`);
      await screenshot(s, `REMOTE-03${p.replace(/\//g, "_") || "_"}`);
      await s.close();
    }
    // Browser-Login mit Testbenutzer, Band bleibt
    const buero = (await testBenutzer()).find((x) => x.rolle === "Büro / Disposition");
    const s = await k.newPage();
    const f = fehlerSammler(s);
    await s.goto(`${URL_REMOTE}/productionplaner/`);
    await melde(s, buero);
    await s.getByTestId("testsystem-band").waitFor();
    assert.deepEqual(f.filter((t) => /Content Security Policy|Refused to/.test(t)), []);
    await screenshot(s, "REMOTE-07-band-browser");
  } finally { await b.close(); }
});

/** Jeder eigene Menüpunkt einmal, ohne Fehlermeldung. */
async function menueDurchlauf(win, app) {
  const nav = win.getByRole("navigation", { name: "Hauptmenü" });
  const eintraege = await nav.locator("a, button").evaluateAll((els) => els.map((e) => ({ text: e.textContent.trim(), fremd: !!e.querySelector("[data-fremd], .lp-fremd") || e.dataset.fremd === "true" || /↗/.test(e.textContent) })));
  let besucht = 0;
  for (const e of eintraege) {
    if (!e.text || e.fremd) continue;
    await nav.getByText(e.text, { exact: true }).first().click();
    await win.waitForTimeout(400);
    const fehler = await win.locator(".lp-meldung[data-level='error'], [data-testid='fehlerseite']").count();
    assert.equal(fehler, 0, `${app}: „${e.text}“ zeigt einen Fehler`);
    besucht++;
  }
  assert.ok(besucht >= 5, `${app}: nur ${besucht} Menüpunkte besucht`);
  return besucht;
}

test("REMOTE-04 Beide Electron-Apps gegen den echten Server: Login, jeder Menüpunkt, NUTZER-02 Packtag light", { skip: OHNE_UI, timeout: 600000 }, async () => {
  await admin("POST", "/api/v1/test/zuruecksetzen", {});
  const tb = await testBenutzer(true); // Zurücksetzen löscht die Testbenutzer aus REMOTE-03
  const tom = tb.find((x) => x.rolle === "Lager / Techniker"), paula = tb.find((x) => x.rolle === "Büro / Disposition"), lena = tb.find((x) => x.rolle === "Lagerleitung");
  const fest = (await admin("GET", "/api/v1/projekte?limit=500")).zeilen.find((p) => p.name === "Stadtfest Neustadt");
  const m = await starteApp("materialplaner", URL_REMOTE, { argv: appArgs, env: appEnv });
  const p = await starteApp("productionplaner", URL_REMOTE, { argv: appArgs, env: appEnv });
  try {
    // Klick-Durchlauf light: Lagerleitung im Materialplaner, Büro im Productionplaner
    await melde(m.win, lena);
    assert.match(await m.win.getByTestId("benutzer").textContent(), /Lagerleitung/);
    await m.win.getByTestId("testsystem-band").waitFor();
    await menueDurchlauf(m.win, "Materialplaner");
    await melde(p.win, paula);
    assert.match(await p.win.getByTestId("benutzer").textContent(), /Büro/);
    await menueDurchlauf(p.win, "Productionplaner");
    await screenshot(p.win, "REMOTE-04-productionplaner");
    // Packtag: Tom packt das Stadtfest per Handscanner (Tastatur), Paula sieht live „Läuft“
    await m.win.getByRole("button", { name: "Abmelden" }).click();
    await melde(m.win, tom);
    await p.win.evaluate((id) => { location.hash = `#/projekte/${id}`; }, fest.id);
    await p.win.getByRole("heading", { name: /Stadtfest Neustadt/ }).waitFor();
    const w = m.win;
    const hid = async (code) => { await w.keyboard.type(code, { delay: 5 }); await w.keyboard.press("Enter"); };
    await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Code scannen", { exact: true }).click();
    await w.getByRole("heading", { name: "Code scannen" }).first().click();
    await hid(fest.nummer);
    await w.getByRole("heading", { name: `Packen ${fest.nummer} Stadtfest Neustadt` }).waitFor();
    const ergebnis = w.getByTestId("scan-ergebnis");
    await hid("LI-9999"); // Tippfehler
    await ergebnis.getByText(/Code LI-9999 ist keinem Gerät zugeordnet/).waitFor();
    const stand = await admin("GET", `/api/v1/projekte/${fest.id}/packstatus`);
    for (const z of stand.zeilen.filter((x) => !x.verbrauch)) {
      const frei = (await admin("GET", `/api/v1/geraete?artikel=${z.artikel_id}&status=lager&limit=100`)).zeilen.filter((g) => !g.case_id);
      for (const g of frei.slice(0, Math.max(0, z.soll - (z.gepackt || 0)))) { await hid(g.code); await ergebnis.getByText(new RegExp(`^${g.code} .* – Gepackt`)).waitFor(); }
    }
    await screenshot(w, "REMOTE-04-gepackt");
    await w.getByRole("button", { name: "Packen abgeschlossen & verladen" }).click();
    await w.getByRole("dialog").getByRole("button", { name: "Verladen" }).click();
    await w.getByText(/verladen.*Status „Läuft“/).waitFor({ timeout: 20000 });
    await p.win.getByTestId("kennzahlen").getByText("Läuft").waitFor({ timeout: 15000 });
    await screenshot(p.win, "REMOTE-04-p-laeuft");
    assert.equal((await admin("GET", `/api/v1/projekte/${fest.id}`)).projekt?.status ?? (await admin("GET", `/api/v1/projekte/${fest.id}`)).status, "laeuft");
  } finally { await m.ende(); await p.ende(); }
});
