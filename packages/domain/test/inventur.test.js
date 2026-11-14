import { test } from "node:test";
import assert from "node:assert/strict";
import { inventurAbgleich, reparaturWechselFehler, wartungStatus, GERAET_ZU_REPARATUR } from "../src/index.js";

test("FA-06 nach Scan aller Geräte einer Kategorie bis auf zwei zeigt der Abgleich genau diese als „fehlt“", () => {
  const soll = [1, 2, 3, 4, 5].map((id) => ({ id, code: `LI-000${id}` }));
  const scans = [{ code: "LI-0001", geraet_id: 1 }, { code: "LI-0003", geraet_id: 3 }, { code: "LI-0005", geraet_id: 5 },
    { code: "TO-0001", geraet_id: 99 }, { code: "XX-0001", geraet_id: null }];
  const r = inventurAbgleich(soll, scans);
  assert.deepEqual(r.fehlt.map((g) => g.code), ["LI-0002", "LI-0004"]);
  assert.deepEqual(r.ok.map((g) => g.id), [1, 3, 5]);
  assert.deepEqual(r.zuViel.map((s) => s.code), ["TO-0001"]);
  assert.deepEqual(r.unbekannt.map((s) => s.code), ["XX-0001"]);
  assert.equal(inventurAbgleich(soll, soll.map((g) => ({ code: g.code, geraet_id: g.id }))).fehlt.length, 0);
});

test("FA-07 Reparatur: Statuswege, Rückgabe in den Bestand erst nach Prüfung, Gerätestatus passend", () => {
  assert.equal(reparaturWechselFehler("gemeldet", "in_reparatur"), null);
  assert.match(reparaturWechselFehler("in_reparatur", "repariert"), /erst nach bestandener Prüfung/);
  assert.equal(reparaturWechselFehler("in_reparatur", "repariert", { pruefungOk: true }), null);
  assert.match(reparaturWechselFehler("repariert", "in_reparatur"), /schon abgeschlossen/);
  assert.equal(reparaturWechselFehler("gemeldet", "ausgemustert"), null);
  assert.deepEqual(GERAET_ZU_REPARATUR, { gemeldet: "defekt", in_reparatur: "reparatur", repariert: "lager", ausgemustert: "ausgemustert" });
});

test("FA-07 Wartungsintervall: fällig nach Ablauf, ohne Intervall keine Wartung", () => {
  const a = { wartung_intervall_monate: 6 };
  assert.deepEqual(wartungStatus({}, "2026-01-01", "2026-11-14"), { status: "keine", naechste: null });
  assert.equal(wartungStatus(a, null, "2026-11-14").status, "offen");
  assert.deepEqual(wartungStatus(a, "2026-05-14", "2026-11-14"), { status: "faellig", naechste: "2026-11-14" });
  assert.equal(wartungStatus(a, "2026-06-01", "2026-11-14").status, "bald", "in 30 Tagen fällig");
  assert.equal(wartungStatus(a, "2026-06-14", "2026-11-14").status, "bald", "genau 30 Tage");
  assert.equal(wartungStatus(a, "2026-06-15", "2026-11-14").status, "ok", "31 Tage");
});
