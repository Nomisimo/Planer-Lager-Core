import { test } from "node:test";
import assert from "node:assert/strict";
import { PROJEKT_STATUS, statusWechselErlaubt, gibtZoneFrei, statusNachVerladen, pruefeProjekt, ordnerName, kopieName, aufgabeUeberfaellig,
  pruefeDatei, inlineErlaubt, inhaltsTyp, sichererDateiname, GEWERKE } from "../src/projekt.js";
import { naechsteProjektnummer } from "../src/codes.js";

test("R-20 Projektnummer P/J-Jahr-NNN, getrennte Zähler, höchste + 1", () => {
  assert.equal(naechsteProjektnummer("P", 2026, []), "P-2026-001");
  assert.equal(naechsteProjektnummer("P", 2026, ["P-2026-001", "P-2026-007", "J-2026-020", "P-2025-099"]), "P-2026-008");
  assert.equal(naechsteProjektnummer("J", 2026, ["P-2026-001", "J-2026-020"]), "J-2026-021");
});
test("Zustandsmodell 4.1 R-12 jeder Wechsel inkl. rückwärts; R-13 Zone frei; R-14 Verladen", () => {
  const s = Object.keys(PROJEKT_STATUS);
  assert.deepEqual(s, ["anfrage", "angebot_gesendet", "bestaetigt", "laeuft", "abgeschlossen", "storniert"]);
  for (const a of s) for (const b of s) assert.equal(statusWechselErlaubt(a, b), a !== b);
  assert.equal(statusWechselErlaubt("anfrage", "x"), false);
  assert.deepEqual(s.filter(gibtZoneFrei), ["abgeschlossen", "storniert"]);
  assert.equal(statusNachVerladen("bestaetigt"), "laeuft");
  assert.equal(statusNachVerladen("anfrage"), "anfrage");
});
test("3.2 Projekt prüfen: Name, Kunde, Gewerk, Datum", () => {
  assert.deepEqual(pruefeProjekt({ art: "projekt", name: "Stadtfest", kunde_id: 1, beginn: "2026-06-01", ende: "2026-06-03" }), {});
  const f = pruefeProjekt({ art: "projekt", name: "", beginn: "2026-06-03", ende: "2026-06-01" });
  assert.deepEqual(Object.keys(f).sort(), ["ende", "kunde_id", "name"]);
  assert.deepEqual(pruefeProjekt({ art: "job", name: "Ton", uebergeordnet_id: 3, gewerk: "Ton" }), {}, "Job erbt Kunden");
  assert.ok(pruefeProjekt({ art: "job", name: "X", uebergeordnet_id: 3, gewerk: "Catering" }).gewerk);
  assert.equal(GEWERKE.length, 8);
});
test("3.2 Projektordner-Name sicher; FA-31 Kopie-Name", () => {
  assert.equal(ordnerName("P-2026-001", "Stadtfest: Bühne/Ton"), "P-2026-001 Stadtfest Bühne Ton");
  assert.equal(ordnerName("P-2026-002", "../.."), "P-2026-002");
  assert.equal(kopieName("Stadtfest"), "Stadtfest (Kopie)");
});
test("3.4 Aufgabe überfällig = nicht erledigt und fällig < heute", () => {
  assert.equal(aufgabeUeberfaellig({ erledigt: false, faellig: "2026-11-13" }, "2026-11-14"), true);
  assert.equal(aufgabeUeberfaellig({ erledigt: false, faellig: "2026-11-14" }, "2026-11-14"), false);
  assert.equal(aufgabeUeberfaellig({ erledigt: true, faellig: "2026-11-01" }, "2026-11-14"), false);
  assert.equal(aufgabeUeberfaellig({ erledigt: false, faellig: null }, "2026-11-14"), false);
});
test("3.3 FA-33 Dateien: Endungen, 50 MB, SVG nie inline, sichere Namen", () => {
  assert.equal(pruefeDatei("plan.DWG", 10), null);
  assert.match(pruefeDatei("virus.exe", 10), /nicht erlaubt/);
  assert.match(pruefeDatei("gross.pdf", 50 * 1024 * 1024 + 1), /50 MB/);
  assert.equal(pruefeDatei("genau.pdf", 50 * 1024 * 1024), null);
  assert.equal(inlineErlaubt("rider.pdf"), true);
  assert.equal(inlineErlaubt("foto.JPG"), true);
  assert.equal(inlineErlaubt("logo.svg"), false);
  assert.equal(inhaltsTyp("logo.svg"), "application/octet-stream");
  assert.equal(sichererDateiname("../../etc/passwd"), "passwd");
  assert.equal(sichererDateiname("C:\\x\\a:b.pdf"), "a_b.pdf");
});
