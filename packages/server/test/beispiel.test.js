// Demo-Daten (ZUSATZ.md Phase 17): `--seed demo`, als Beispiel vermerkt, vom Admin löschbar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";
import { ladeBeispiel, BEISPIEL_PASSWORT } from "../src/beispiel.js";

test("KLICK-01 Demo-Seed: Beispielbetrieb über die API, Anmeldung je Rolle, vom Admin samt Verlauf löschbar; eigene Daten bleiben", async () => {
  const s = await starteTestServer();
  try {
    const n = await ladeBeispiel({ pool: s.db.pool, config: { dataDir: s.dataDir } });
    assert.ok(n.projekt >= 4 && n.geraet >= 50 && n.angebot >= 4 && n.benutzer >= 5, JSON.stringify(n));
    await assert.rejects(ladeBeispiel({ pool: s.db.pool, config: { dataDir: s.dataDir } }), /leere Datenbank/);
    for (const b of ["beispiel-admin", "lena", "tom", "paula", "platz1"])
      assert.equal((await s.api("POST", "/api/v1/anmelden", { benutzername: b, passwort: BEISPIEL_PASSWORT })).status, 200, b);
    const admin = await s.als("chef");
    const sys = (await admin("GET", "/api/v1/verwaltung/system")).json;
    assert.ok(sys.beispiel > 100);
    const { rows: [fest] } = await s.db.pool.query("SELECT id FROM projekt WHERE name = 'Stadtfest Neustadt'");
    const { rows: [a] } = await s.db.pool.query("SELECT status, summe_netto FROM angebot WHERE projekt_id = $1", [fest.id]);
    assert.equal(a.status, "angenommen");
    assert.ok(a.summe_netto > 0);
    // Verlauf am Beispiel: ein Gerät packen (Bewegung, nur anfügen)
    const { rows: [g] } = await s.db.pool.query("SELECT g.code FROM geraet g JOIN artikel a ON a.id = g.artikel_id WHERE a.name = 'Akku-Spot' LIMIT 1");
    assert.equal((await admin("POST", "/api/v1/scan", { code: g.code, modus: "hinzufuegen", projekt: fest.id })).json.level, "ok");
    // Eigener Kunde mit Projekt bleibt; eigenes Projekt beim Beispielkunden blockiert das Löschen
    const eigen = (await admin("POST", "/api/v1/kunden", { name: "Eigener Kunde" })).json.kunde;
    const { rows: [bk] } = await s.db.pool.query("SELECT id FROM kunde WHERE firma = 'Müller Maschinenbau GmbH'");
    const fremd = (await admin("POST", "/api/v1/projekte", { name: "Eigenes beim Beispielkunden", kunde_id: bk.id, beginn: "2027-01-01" })).json.projekt;
    const blockiert = await admin("POST", "/api/v1/verwaltung/system/beispiel-loeschen", {});
    assert.equal(blockiert.status, 409, blockiert.text);
    assert.match(blockiert.json.text, /Eigene Daten verweisen noch auf Beispieldaten \(1 × projekt\)/);
    assert.ok((await s.db.pool.query("SELECT count(*)::int AS n FROM beispiel")).rows[0].n > 100, "nichts halb gelöscht");
    assert.equal((await admin("DELETE", `/api/v1/projekte/${fremd.id}`)).status, 200);
    const ok = await admin("POST", "/api/v1/verwaltung/system/beispiel-loeschen", {});
    assert.equal(ok.status, 200, ok.text);
    const zahl = async (sql) => (await s.db.pool.query(sql)).rows[0].n;
    assert.equal(await zahl("SELECT count(*)::int AS n FROM projekt"), 0);
    assert.equal(await zahl("SELECT count(*)::int AS n FROM geraet"), 0);
    assert.equal(await zahl("SELECT count(*)::int AS n FROM benutzer WHERE benutzername IN ('beispiel-admin','lena','tom','paula','platz1')"), 0);
    assert.equal(await zahl(`SELECT count(*)::int AS n FROM kunde WHERE id = ${eigen.id}`), 1, "eigener Kunde bleibt");
    assert.equal(await zahl("SELECT count(*)::int AS n FROM beispiel"), 0);
    assert.equal((await admin("GET", "/api/v1/verwaltung/system")).json.beispiel, 0);
    // Bewegungen bleiben nur anfügbar
    const { rows: tr } = await s.db.pool.query("SELECT t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE t.tgname = 'bewegung_nur_anfuegen' AND n.nspname = current_schema()");
    assert.equal(tr[0].tgenabled, "O", "Sperre wieder aktiv");
    assert.ok((await s.db.pool.query("SELECT count(*)::int AS n FROM sicherheit_ereignis WHERE text LIKE 'Beispieldaten gelöscht%'")).rows[0].n === 1);
  } finally { await s.ende(); }
});
