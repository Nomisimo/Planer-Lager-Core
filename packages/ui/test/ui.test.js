import { test } from "node:test";
import assert from "node:assert/strict";
import { THEMEN, DICHTEN, themaVariablen, kontrastPaare, kontrast } from "../src/themen.js";
import { menueFuer, aktiverEintrag, MENUE } from "../src/menue.js";
import { RUECKMELDUNG, pruefeFehlertext, fehlerText } from "../src/texte.js";
import { einmalig, pruefePflicht, BRAUCHT_BESTAETIGUNG } from "../src/formular.js";
import { EINGEBAUTE_ROLLEN, normalisiereRechte } from "@lager/domain";

const rechte = (n) => normalisiereRechte(EINGEBAUTE_ROLLEN.find((r) => r.name === n).rechte);

test("FA-52 UI-6 8 Farbthemen, 3 Dichten, Hell/Dunkel; groß hat Touch-Ziel ≥ 44 px", () => {
  assert.equal(Object.keys(THEMEN).length, 8);
  assert.deepEqual(Object.keys(DICHTEN), ["kompakt", "normal", "gross"]);
  assert.equal(themaVariablen({ dichte: "gross" }).css["--lp-ziel"], "44px");
  assert.notEqual(themaVariablen({ modus: "hell" }).farben.BG, themaVariablen({ modus: "dunkel" }).farben.BG);
});

test("UI-7 Kontrast ≥ 4,5:1 für alle Themen in Hell und Dunkel", () => {
  for (const thema of Object.keys(THEMEN)) for (const modus of ["hell", "dunkel"]) {
    const { farben } = themaVariablen({ thema, modus });
    for (const [vg, hg, was] of kontrastPaare(farben))
      assert.ok(kontrast(vg, hg) >= 4.5, `${thema}/${modus}: ${was} ${vg} auf ${hg} = ${kontrast(vg, hg).toFixed(2)}`);
  }
});

test("UI-1 Menü: nur erlaubte Einträge, nach Arbeitsablauf gruppiert, aktiver Eintrag nach längstem Präfix", () => {
  assert.deepEqual(MENUE.map((g) => g.gruppe), ["Start", "Aufträge", "Material & Lager", "Kalkulation", "System"]);
  const lager = menueFuer(rechte("Lager / Techniker"), "m");
  const titel = lager.flatMap((g) => g.eintraege.map((e) => e.titel));
  assert.ok(titel.includes("Code scannen"));
  assert.ok(!titel.includes("Kunden"));
  assert.ok(!titel.includes("Verwaltung"));
  assert.ok(!lager.some((g) => g.gruppe === "System"), "leere Gruppe entfällt");
  const admin = menueFuer(rechte("Administrator"), "m");
  assert.equal(admin.flatMap((g) => g.eintraege).find((e) => e.titel === "Kunden").fremd, true);
  assert.equal(admin.flatMap((g) => g.eintraege).find((e) => e.titel === "Material").fremd, false);
  const alle = [{ pfad: "/" }, { pfad: "/projekte" }, { pfad: "/projekte/aufgaben" }, { pfad: "/aufgaben" }];
  assert.equal(aktiverEintrag("/projekte/12", alle).pfad, "/projekte");
  assert.equal(aktiverEintrag("/projekte/aufgaben/3", alle).pfad, "/projekte/aufgaben");
  assert.equal(aktiverEintrag("/", alle).pfad, "/");
  assert.equal(aktiverEintrag("/projektexyz", alle), null);
});

test("UI-2 Rückmeldung: jede Stufe hat Farbe, Symbol und Text", () => {
  for (const s of ["success", "warning", "error"]) {
    assert.ok(RUECKMELDUNG[s].farbe && RUECKMELDUNG[s].symbol && RUECKMELDUNG[s].wort);
  }
  assert.notEqual(RUECKMELDUNG.success.symbol, RUECKMELDUNG.error.symbol);
});

test("UI-5 Fehlertexte: Du-Form, kein Jargon, Ursache + nächster Schritt", () => {
  assert.deepEqual(pruefeFehlertext("Das Gerät LT-0004 ist schon in Projekt P-2026-012. Gib es dort zuerst zurück."), []);
  assert.ok(pruefeFehlertext("Bitte geben Sie ein Passwort ein").includes("Sie-Form statt Du-Form"));
  assert.ok(pruefeFehlertext("JSON parse error").includes("Fachjargon"));
  assert.ok(pruefeFehlertext("Fehlgeschlagen").includes("kein nächster Schritt"));
  assert.deepEqual(pruefeFehlertext(fehlerText(new TypeError("Failed to fetch"))), []);
  assert.deepEqual(pruefeFehlertext(fehlerText({})), []);
});

test("UI-4 Formular: Speichern nur einmal bis zur Antwort, Pflichtfelder, Sicherheitsabfrage bei Löschen/Verladen/Wiederherstellen", async () => {
  let n = 0;
  const speichern = einmalig(async () => { n++; await new Promise((r) => setTimeout(r, 20)); return n; });
  const [a, b] = await Promise.all([speichern(), speichern()]);
  assert.equal(n, 1);
  assert.equal(a, b);
  await speichern();
  assert.equal(n, 2);
  assert.deepEqual(Object.keys(pruefePflicht({ name: " " }, { name: { pflicht: true, titel: "Name" }, ort: {} })), ["name"]);
  for (const x of ["loeschen", "verladen", "wiederherstellen"]) assert.ok(BRAUCHT_BESTAETIGUNG.has(x));
});

import { passeMuster, zerlegeHash, deepLinkZuPfad } from "../src/router.js";
test("Deep-Links → App-Pfade (ARCHITEKTUR §4.2) und Hash-Router", () => {
  assert.equal(deepLinkZuPfad(["geraet", "LT-0001"]), "/geraete/code/LT-0001");
  assert.equal(deepLinkZuPfad(["projekt", "12", "packen"]), "/projekte/12/packen");
  assert.equal(deepLinkZuPfad(["projekt", "P-2026-001"]), "/projekte/nummer/P-2026-001");
  assert.equal(deepLinkZuPfad(["angebot", "5"]), "/angebote/5");
  assert.equal(deepLinkZuPfad(["material", "3"]), "/material/3");
  assert.equal(deepLinkZuPfad([]), "/");
  assert.deepEqual(passeMuster("/projekte/:id", "/projekte/12"), { id: "12" });
  assert.equal(passeMuster("/projekte/:id", "/projekte/12/x"), null);
  assert.deepEqual(zerlegeHash("#/projekte/1?tab=jobs"), { pfad: "/projekte/1", query: { tab: "jobs" } });
});
