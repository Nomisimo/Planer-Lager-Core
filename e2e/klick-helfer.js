// KLICK (ZUSATZ.md Phase 17): Hilfen für den Klick-Durchlauf. Prüft je Seite Fehler (KLICK-02), Inhalt (KLICK-03),
// Knopf-Namen und Fensterbreite (KLICK-04), Ladezeit und Formulare (KLICK-05); der Test sammelt alles im Bericht.
import fs from "node:fs";
import path from "node:path";
import { ARTEFAKTE } from "./helfer.js";

/** Knöpfe, die das System verlassen oder die Testumgebung stören (Druck-/Datei-Dialoge, Neustart, Abmelden). */
const NICHT_KLICKEN = /Abmelden|Neu starten|Neustart|Server neu|Wiederherstellen|herunterladen|Herunterladen|Download|drucken|Drucken|Export|CSV|ICS|PDF|ZIP|hochladen|Hochladen|Datei wählen|Foto|Kamera|Scanner wählen|Im Browser öffnen|In der Desktop-App|Desktop-App herunterladen|Beispieldaten löschen|Sicherung erstellen|Tour|Vollbild|Wartung/;
/** Englische Fehlertexte, Stacktraces, kaputte Werte (KLICK-03). */
const KAPUTT = /TypeError|ReferenceError|SyntaxError|Cannot read|is not a function|is not defined|Unexpected token|Internal Server Error|\bat [\w.$]+ \(|\[object Object\]|\bundefined\b|\bNaN\b|Something went wrong|Error:/;

/** KLICK-02: pageerror, console.error, Server-Antworten ≥ 500. Erwartete 4xx-Ladefehler (Rechte, Konflikt) zählen nicht. */
export function beobachte(seite, wo) {
  const fehler = [];
  const jetzt = () => wo.seite || "?";
  seite.on("pageerror", (e) => fehler.push(`${jetzt()}: pageerror ${e.message}`));
  seite.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(t)) return;
    fehler.push(`${jetzt()}: console ${t.slice(0, 200)}`);
  });
  seite.on("response", (r) => { if (r.status() >= 500) fehler.push(`${jetzt()}: HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
  return fehler;
}

/** Wartet, bis die Seite gerendert ist (Überschrift da, kein „Lädt …“). Liefert ms seit `start`. */
export async function warteFertig(seite, start) {
  await seite.waitForFunction(() => {
    const m = document.querySelector(".lp-inhalt, main");
    return m && m.querySelector("h1, h2") && !/Lädt …/.test(m.innerText);
  }, null, { timeout: 10000 }).catch(() => {});
  return Date.now() - start;
}

/** KLICK-03/04: prüft die sichtbare Seite und liefert Befunde. */
export async function pruefeSeite(seite) {
  return seite.evaluate((muster) => {
    const kaputt = new RegExp(muster);
    const b = [];
    const m = document.querySelector(".lp-inhalt, main") || document.body;
    const text = (m?.innerText || "").trim();
    if (text.length < 5) b.push("leere Seite");
    const treffer = text.match(kaputt);
    if (treffer) b.push(`Fehltext „${treffer[0]}“`);
    for (const k of document.querySelectorAll("button, [role=button]")) {
      const r = k.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const name = [k.getAttribute("aria-label"), k.innerText, k.getAttribute("title")].map((x) => (x || "").trim()).find(Boolean);
      if (!name) b.push(`Knopf ohne Namen (${k.outerHTML.slice(0, 80)})`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) b.push(`breiter als das Fenster (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
    return b;
  }, KAPUTT.source);
}

/** Sichtbare, benutzbare Knöpfe im Inhalt (ohne Kopfleiste/Menü), Namen eindeutig. */
async function knopfNamen(seite) {
  return seite.evaluate((muster) => {
    const verboten = new RegExp(muster);
    const m = document.querySelector(".lp-inhalt");
    if (!m) return [];
    const namen = [];
    for (const k of m.querySelectorAll("button")) {
      const r = k.getBoundingClientRect();
      if (!r.width || k.disabled || k.closest("[role=dialog], table tbody, [role=tablist]")) continue;
      const n = (k.getAttribute("aria-label") || k.innerText || "").trim();
      if (n && !verboten.test(n) && !namen.includes(n)) namen.push(n);
    }
    return namen;
  }, NICHT_KLICKEN.source);
}

/** Dialog behandeln: leer abschicken (Pflichtfehler erwartet), dann Abbrechen/Esc. Bestätigungen: erst Nein, dann Ja. */
async function behandleDialog(seite, name, bericht, oeffnen) {
  const d = seite.getByRole("dialog").last();
  if (!(await d.isVisible().catch(() => false))) return false;
  const felder = await d.locator("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select").count();
  if (felder) {
    // KLICK-05: leer abschicken → Pflichtfeld-Fehler oder Dialog bleibt offen
    const leer = await d.evaluate((el) => { for (const i of el.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea")) if (!i.value) return true; return false; });
    const primaer = d.locator("button.lp-btn-primaer").first();
    if (leer && await primaer.isVisible().catch(() => false) && await primaer.isEnabled().catch(() => false)) {
      await primaer.click().catch(() => {});
      await seite.waitForTimeout(250);
      if (await d.isVisible().catch(() => false)) bericht.formulareLeer++;
    }
  }
  const schliessen = async () => {
    if (!(await d.isVisible().catch(() => false))) return;
    const ab = d.getByRole("button", { name: /^(Abbrechen|Schließen|Nein|Zurück|Notiert)$/ }).first();
    if (await ab.isVisible().catch(() => false)) await ab.click().catch(() => {});
    else await seite.keyboard.press("Escape");
    await seite.waitForTimeout(150);
  };
  if (!felder) {
    // Bestätigung: erst abbrechen, dann erneut öffnen und bestätigen (buchende/löschende Knöpfe werden ausgelöst)
    await schliessen();
    bericht.bestaetigungen++;
    await oeffnen().catch(() => {});
    await seite.waitForTimeout(150);
    const d2 = seite.getByRole("dialog").last();
    if (await d2.isVisible().catch(() => false)) {
      const ja = d2.locator("button.lp-btn-primaer, button.lp-btn-gefahr").last();
      if (await ja.isVisible().catch(() => false)) await ja.click().catch(() => {});
      await seite.waitForTimeout(250);
    }
  }
  await schliessen();
  await raeumeAuf(seite, name, bericht);
  return true;
}

/** Offene Dialoge schließen; lässt sich einer weder per Knopf noch Esc schließen, ist das ein Befund (UI-4). */
export async function raeumeAuf(seite, name, bericht) {
  for (let i = 0; i < 3; i++) {
    const d = seite.getByRole("dialog").last();
    if (!(await d.isVisible().catch(() => false))) return;
    const titel = await d.getAttribute("aria-label").catch(() => "");
    const zu = d.getByRole("button", { name: /^(Abbrechen|Schließen|Nein|Zurück|Notiert|Fertig|OK|Verstanden)$/ }).last();
    if (await zu.isVisible().catch(() => false)) await zu.click().catch(() => {});
    else await seite.keyboard.press("Escape");
    await seite.waitForTimeout(200);
    if (i === 2 && await d.isVisible().catch(() => false)) {
      bericht.befunde.push(`${name}: Dialog „${titel}“ ließ sich nicht schließen`);
      await seite.reload(); await warteFertig(seite, Date.now());
    }
  }
}

/**
 * Besucht alle Menüeinträge der App (nur eigene, keine Sprünge in die andere App) und deren Tabs.
 * tief: zusätzlich Knöpfe/Dialoge auslösen und die erste Tabellenzeile öffnen.
 * @returns {Promise<{besucht: string[], befunde: string[], zeiten: Record<string, number>, knoepfe: number, formulareLeer: number, bestaetigungen: number}>}
 */
export async function durchlaufe(seite, { tief = false, wo, fehler, maxKnoepfe = 18 } = {}) {
  const bericht = { besucht: [], befunde: [], zeiten: {}, knoepfe: 0, formulareLeer: 0, bestaetigungen: 0 };
  const menue = seite.locator("nav[aria-label=Hauptmenü] button.lp-menue-eintrag");
  const eintraege = [];
  for (let i = 0; i < await menue.count(); i++) {
    const e = menue.nth(i);
    eintraege.push({ titel: (await e.innerText()).trim(), fremd: !!(await e.getAttribute("title")) });
  }
  for (const e of eintraege.filter((x) => !x.fremd)) {
    await raeumeAuf(seite, `vor ${e.titel}`, bericht);
    wo.seite = e.titel;
    const start = Date.now();
    await seite.locator("nav[aria-label=Hauptmenü] button.lp-menue-eintrag", { hasText: e.titel }).first().click();
    const ms = await warteFertig(seite, start);
    const hash = await seite.evaluate(() => location.hash);
    bericht.zeiten[e.titel] = ms;
    bericht.besucht.push(e.titel);
    for (const b of await pruefeSeite(seite)) bericht.befunde.push(`${e.titel}: ${b}`);
    // Tabs
    const tabNamen = (await seite.locator(".lp-inhalt [role=tab]").allInnerTexts()).map((t) => t.trim());
    for (const name of tabNamen) {
      const tab = seite.locator(".lp-inhalt [role=tab]", { hasText: name }).first();
      if (!(await tab.isVisible().catch(() => false))) continue;
      await tab.click({ timeout: 3000 }).catch(() => {});
      await warteFertig(seite, Date.now());
      bericht.besucht.push(`${e.titel} › ${name}`);
      for (const b of await pruefeSeite(seite)) bericht.befunde.push(`${e.titel} › ${name}: ${b}`);
    }
    if (!tief) continue;
    // Knöpfe und Dialoge
    const zurueck = async () => { if ((await seite.evaluate(() => location.hash)) !== hash) { await seite.evaluate((h) => { location.hash = h; }, hash); await warteFertig(seite, Date.now()); } };
    for (const name of (await knopfNamen(seite)).slice(0, maxKnoepfe)) {
      await zurueck();
      const k = seite.locator(".lp-inhalt").getByRole("button", { name, exact: true }).first();
      if (!(await k.isVisible().catch(() => false)) || !(await k.isEnabled().catch(() => false))) continue;
      wo.seite = `${e.titel} › ${name}`;
      await k.click().catch(() => {});
      bericht.knoepfe++;
      await seite.waitForTimeout(200);
      await behandleDialog(seite, wo.seite, bericht, () => k.click());
      if ((await seite.evaluate(() => location.hash)) !== hash) {
        await warteFertig(seite, Date.now());
        for (const b of await pruefeSeite(seite)) bericht.befunde.push(`${wo.seite}: ${b}`);
      }
    }
    await zurueck();
    // erste Tabellenzeile öffnen (Detailseite)
    const zeile = seite.locator(".lp-inhalt table.lp-tabelle tbody tr.lp-klickbar, .lp-inhalt table.lp-tabelle tbody tr[style*=pointer]").first();
    if (await zeile.isVisible().catch(() => false)) {
      wo.seite = `${e.titel} › Detail`;
      await zeile.click().catch(() => {});
      await seite.waitForFunction((h) => location.hash !== h, hash, { timeout: 3000 }).catch(() => {});
      await warteFertig(seite, Date.now());
      if ((await seite.evaluate(() => location.hash)) !== hash) {
        bericht.besucht.push(`${e.titel} › Detail`);
        for (const b of await pruefeSeite(seite)) bericht.befunde.push(`${e.titel} › Detail: ${b}`);
      }
      await zurueck();
    }
  }
  wo.seite = "–";
  void fehler;
  return bericht;
}

/** Schreibt den Abdeckungsbericht (KLICK-01). */
export function schreibeBericht(bericht) {
  fs.mkdirSync(ARTEFAKTE, { recursive: true });
  const datei = path.join(ARTEFAKTE, "klick-bericht.json");
  fs.writeFileSync(datei, JSON.stringify(bericht, null, 2));
  return datei;
}
