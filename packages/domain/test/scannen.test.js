import { test } from "node:test";
import assert from "node:assert/strict";
import { pruefeHid, hoeher, scanText, pruefHinweis, casePruefung, packlistenHinweis, packFortschritt, hidErkenner, levelUebersprungen } from "../src/index.js";

test("R-SCAN Level: ok < warn < error; übersprungen error nur beim gescannten Gerät", () => {
  assert.equal(hoeher("ok", "warn"), "warn");
  assert.equal(hoeher("error", "warn"), "error");
  assert.equal(hoeher("warn", "ok"), "warn");
  assert.equal(levelUebersprungen(true), "error");
  assert.equal(levelUebersprungen(false), "warn");
});

test("R-SCAN Schritt 8 Texte: Gepackt inkl. Inhalte, Rückgabe-Case mit Hinweis, nicht gebucht", () => {
  assert.equal(scanText({ code: "LI-0001", artikel: "Spot", modus: "packen", gebucht: 1, inhalte: 0 }), "LI-0001 Spot – Gepackt");
  assert.equal(scanText({ code: "TA-0001", artikel: "Tasche", modus: "hinzufuegen", gebucht: 5, inhalte: 4 }), "TA-0001 Tasche – Zum Projekt hinzugefügt (inkl. 4 Inhalte)");
  assert.equal(scanText({ code: "TA-0001", artikel: "Tasche", modus: "rueckgabe", gebucht: 1, inhalte: 0, istCase: true, inhaltOffen: 4, inhaltName: "Lampen" }),
    "TA-0001 Tasche – Zurück im Lager – jetzt die 4 Teile (Lampen) darin scannen");
  assert.equal(scanText({ code: "LI-0001", artikel: "Spot", modus: "packen", gebucht: 0 }), "LI-0001 Spot – nicht gebucht");
});

test("R-SCAN Schritt 5/6/9 Hinweise: Prüfung, Case-Inhalt, Packliste", () => {
  assert.equal(pruefHinweis("LI-1", "ueberfaellig"), "LI-1: Prüfung überfällig!");
  assert.equal(pruefHinweis("LI-1", "offen"), "LI-1: Prüfung fehlt!");
  assert.equal(pruefHinweis("LI-1", "bald"), null);
  const m = casePruefung({ code: "TA-1", soll: 4, inhaltArtikelId: 1 }, [{ code: "LI-1", artikel_id: 1 }, { code: "AK-1", artikel_id: 2, artikel: "Akku" }]);
  assert.deepEqual(m, ["Case unvollständig: 2 von 4 Teilen eingetragen (TA-1).", "Falscher Inhalt in TA-1: AK-1 (Akku)."]);
  assert.deepEqual(casePruefung({ code: "TA-1", soll: 2, inhaltArtikelId: 1 }, [{ artikel_id: 1 }, { artikel_id: 1 }]), []);
  assert.equal(packlistenHinweis("Spot", undefined, 1, "packen"), "Spot steht nicht in der Packliste.");
  assert.equal(packlistenHinweis("Spot", { soll: 2 }, 3, "packen"), "Spot: 3 gepackt, aber nur 2 im Angebot.");
  assert.equal(packlistenHinweis("Spot", { soll: 2 }, 2, "packen"), null);
});

test("FA-17 Packfortschritt: gepackt bis Soll, Verbrauch zählt nicht", () => {
  assert.equal(packFortschritt([{ soll: 4, gepackt: 2 }, { soll: 4, gepackt: 9 }, { soll: 3, verbrauch: true }]), 75);
  assert.equal(packFortschritt([]), 100);
});

test("UI-3 HID-Scanner-Erkennung: schnelle Folge + Enter = Scan, Tippen = kein Scan, Präfix/Suffix", () => {
  const e = hidErkenner();
  let t = 0;
  for (const k of "LI-0001") assert.equal(e.taste(k, (t += 10)), null);
  assert.equal(e.taste("Enter", (t += 10)), "LI-0001");
  for (const k of "abcde") e.taste(k, (t += 150));
  assert.equal(e.taste("Enter", (t += 150)), null, "menschliches Tippen");
  for (const k of "ab") e.taste(k, (t += 10));
  assert.equal(e.taste("Tab", (t += 10)), null, "zu kurz");
  const p = hidErkenner({ praefix: "]C1", suffix: "#" });
  for (const k of "]C1LI-0002#") p.taste(k, (t += 5));
  assert.equal(p.taste("Enter", (t += 5)), "LI-0002");
  assert.equal(e.taste("Shift", t), null);
});

test("ARCHITEKTUR §5 Handscanner-Einstellungen: Schwellwert, Mindestlänge, Präfix/Suffix mit Grenzen", () => {
  assert.deepEqual(pruefeHid({}), { schwelleMs: 35, minZeichen: 4, praefix: "", suffix: "" });
  assert.deepEqual(pruefeHid({ schwelleMs: 50, minZeichen: 6, praefix: "]C1", suffix: "#" }), { schwelleMs: 50, minZeichen: 6, praefix: "]C1", suffix: "#" });
  assert.equal(pruefeHid({ schwelleMs: 5000 }).schwelleMs, 35);
  assert.equal(pruefeHid({ minZeichen: 1 }).minZeichen, 4);
});
