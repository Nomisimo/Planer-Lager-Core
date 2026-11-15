// NFA-06 Integrität: Fremdschlüssel schützen Nachweise, Historie ist unveränderlich, Buchungen laufen in Transaktionen.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { neueTestDb } from "../src/testdb.js";
import { transaktion, nachCommit } from "../src/pool.js";

let db;
before(async () => { db = await neueTestDb(); });
after(() => db?.ende());

// Nur reine Unterteile dürfen mit dem Eltern-Datensatz verschwinden (Sitzungen, Positionen, Dateien, Aufgaben).
// Jede neue CASCADE-Beziehung muss hier bewusst eingetragen werden.
const ERLAUBTE_KASKADEN = [
  "angebot_fassung.angebot_id", "angebot_position.angebot_id", "aufgabe.projekt_id", "etikett_code.bestellung_id",
  "handoff.benutzer_id", "aufgabe_regel.projekt_id", "benachrichtigung.benutzer_id", "inventur_scan.inventur_id", "kunde_historie.kunde_id", "kunde_kontakt.kunde_id", "fahrt_ladung.fahrt_id", "personal_abwesenheit.personal_id", "projekt_datei.projekt_id", "rechnung_position.rechnung_id", "rechnung_position.zeiteintrag_id", "sitzung.benutzer_id",
];

test("NFA-06 Fremdschlüssel auf Nachweise sind RESTRICT/SET NULL, Kaskaden nur für Unterteile", async () => {
  const { rows } = await db.pool.query(`SELECT c.conrelid::regclass::text AS tabelle, a.attname AS spalte, c.confrelid::regclass::text AS ziel, c.confdeltype AS art
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.connamespace = current_schema()::regnamespace`);
  const kaskaden = rows.filter((r) => r.art === "c").map((r) => `${r.tabelle}.${r.spalte}`).sort();
  assert.deepEqual(kaskaden, [...ERLAUBTE_KASKADEN].sort());
  const schutz = (t, s) => rows.find((r) => r.tabelle === t && r.spalte === s)?.art;
  for (const [t, s] of [["geraet", "artikel_id"], ["bewegung", "geraet_id"], ["artikel", "kategorie_id"], ["projekt", "kunde_id"], ["angebot", "projekt_id"], ["angebot_position", "artikel_id"]]) {
    assert.ok(["r", "a"].includes(schutz(t, s)), `${t}.${s} muss RESTRICT sein`);
  }
});

test("NFA-06 Gerät mit Historie lässt sich auch direkt in der Datenbank nicht löschen; Historie ist nur anfügbar", async () => {
  const { rows: [k] } = await db.pool.query("INSERT INTO kategorie (name, praefix) VALUES ('Integrität', 'IN') RETURNING id");
  const { rows: [a] } = await db.pool.query("INSERT INTO artikel (name, kategorie_id) VALUES ('Probe', $1) RETURNING id", [k.id]);
  const { rows: [g] } = await db.pool.query("INSERT INTO geraet (code, artikel_id) VALUES ('IN-0001', $1) RETURNING id", [a.id]);
  await db.pool.query("INSERT INTO bewegung (geraet_id, aktion) VALUES ($1, 'angelegt')", [g.id]);
  await assert.rejects(db.pool.query("DELETE FROM geraet WHERE id = $1", [g.id]), /foreign key|Fremdschlüssel/i);
  await assert.rejects(db.pool.query("UPDATE bewegung SET aktion = 'x' WHERE geraet_id = $1", [g.id]));
  await assert.rejects(db.pool.query("DELETE FROM bewegung WHERE geraet_id = $1", [g.id]));
  await assert.rejects(db.pool.query("DELETE FROM artikel WHERE id = $1", [a.id]), /foreign key|Fremdschlüssel/i);
});

test("NFA-06 Buchung in Transaktion: Fehler mitten in der Buchung lässt keinen Teilstand zurück", async () => {
  const { rows: [g] } = await db.pool.query("SELECT id, status FROM geraet WHERE code = 'IN-0001'");
  await assert.rejects(transaktion(db.pool, async (c) => {
    await c.query("UPDATE geraet SET status = 'gepackt' WHERE id = $1", [g.id]);
    await c.query("INSERT INTO bewegung (geraet_id, aktion) VALUES ($1, 'gepackt')", [g.id]);
    throw new Error("Abbruch mitten in der Buchung");
  }), /Abbruch/);
  const { rows: [nach] } = await db.pool.query("SELECT status FROM geraet WHERE id = $1", [g.id]);
  const { rows: [{ n }] } = await db.pool.query("SELECT count(*)::int AS n FROM bewegung WHERE geraet_id = $1", [g.id]);
  assert.equal(nach.status, g.status);
  assert.equal(n, 1);
});

test("BUG-14 Live-Ereignisse aus einer Transaktion erst nach COMMIT (Nachladen sieht den neuen Stand), bei ROLLBACK nie", async () => {
  const gesehen = [];
  const { rows: [g] } = await db.pool.query("SELECT id FROM geraet WHERE code = 'IN-0001'");
  await transaktion(db.pool, async (c) => {
    await c.query("UPDATE geraet SET notizen = 'nach commit' WHERE id = $1", [g.id]);
    nachCommit(async () => gesehen.push((await db.pool.query("SELECT notizen FROM geraet WHERE id = $1", [g.id])).rows[0].notizen));
    assert.deepEqual(gesehen, [], "nicht vor dem COMMIT");
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(gesehen, ["nach commit"]);
  await assert.rejects(transaktion(db.pool, async () => { nachCommit(() => gesehen.push("rollback")); throw new Error("weg"); }), /weg/);
  let sofort = false;
  nachCommit(() => { sofort = true; });
  assert.ok(sofort, "ohne Transaktion sofort");
  assert.deepEqual(gesehen, ["nach commit"]);
});
