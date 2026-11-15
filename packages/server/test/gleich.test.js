// GLEICH (ZUSATZ.md Phase 17, ARCHITEKTUR §12): optimistisches Sperren mit Fassung (version).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";
import { pruefeFassung, FASSUNG_TABELLEN } from "@lager/db/version.js";
import { WebSocket } from "ws";

let s, admin;
before(async () => { s = await starteTestServer(); admin = await s.als("chef"); });
after(async () => { await s.ende(); });

test("GLEICH-07 jede PUT/PATCH-Route verlangt version (Route-Registry), Ausnahmen nur mit Begründung", async () => {
  const routen = s.router.routen.filter((r) => r.methode === "PUT" || r.methode === "PATCH");
  const { FASSUNG_ROUTEN } = await import("../src/fassung.js");
  assert.deepEqual(routen.filter((r) => !r.ohneVersion).map((r) => r.pfad).sort(), Object.keys(FASSUNG_ROUTEN).sort(), "FASSUNG_ROUTEN deckt jede Speicher-Route ab");
  assert.ok(routen.length >= 25, `nur ${routen.length} Speicher-Routen gefunden`);
  const ausnahmen = routen.filter((r) => r.ohneVersion).map((r) => r.pfad).sort();
  assert.deepEqual(ausnahmen, ["/api/v1/benachrichtigungen/mail", "/api/v1/fahrten/:id/ladung", "/api/v1/ich/design", "/api/v1/ich/tour", "/api/v1/verwaltung/system/wartung"]);
  for (const r of routen.filter((x) => x.ohneVersion)) assert.ok(String(r.ohneVersion).length > 10, `${r.pfad}: Begründung fehlt`);
  for (const r of routen.filter((x) => !x.ohneVersion)) {
    const pfad = r.pfad.replace(/:\w+/g, "1");
    const a = await admin(r.methode, pfad, { name: "x" }, { "x-test-ohne-fassung": "1" });
    assert.equal(a.status, 428, `${r.methode} ${r.pfad} ohne version → ${a.status} ${a.text}`);
    assert.match(a.json.text, /Fassung/);
  }
});

test("GLEICH-07 jede Fassungs-Tabelle hat version, geaendert_von, geaendert_am und den Trigger", async () => {
  for (const t of FASSUNG_TABELLEN) {
    const { rows } = await s.db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name IN ('version', 'geaendert_von', 'geaendert_am')", [t]);
    assert.equal(rows.length, 3, `${t}: Spalten fehlen`);
    const { rows: tr } = await s.db.pool.query("SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE t.tgname = $1 AND n.nspname = current_schema()", [`fassung_${t}`]);
    assert.equal(tr.length, 1, `${t}: Trigger fehlt`);
  }
});

test("GLEICH-01 zweites Speichern mit alter Fassung bekommt 409 mit Name, Uhrzeit und aktueller Fassung; nichts geht verloren", async () => {
  const bea = await s.als("bea", "Büro / Disposition");
  await s.db.pool.query("UPDATE benutzer SET name = 'Bea Büro' WHERE benutzername = 'bea'");
  const bea2 = await s.als("bea");
  const k = (await admin("POST", "/api/v1/kunden", { name: "Anna Müller", telefon: "030 1" })).json.kunde;
  assert.equal(k.version, 1);
  const erst = await bea2("PUT", `/api/v1/kunden/${k.id}`, { ...k, telefon: "030 2" });
  assert.equal(erst.status, 200, erst.text);
  assert.equal(erst.json.kunde.version, 2);
  const zweit = await admin("PUT", `/api/v1/kunden/${k.id}`, { ...k, ort: "Berlin" });
  assert.equal(zweit.status, 409);
  assert.match(zweit.json.text, /^Das hat gerade Bea Büro geändert \(\d\d\.\d\d\., \d\d:\d\d Uhr\)\. Deine Eingaben sind noch da\. Lade die neue Fassung und übernimm deine Änderungen\.$/);
  assert.equal(zweit.json.aktuell.telefon, "030 2");
  assert.equal(zweit.json.aktuell.version, 2);
  const { rows: [db] } = await s.db.pool.query("SELECT telefon, ort, version FROM kunde WHERE id = $1", [k.id]);
  assert.deepEqual(db, { telefon: "030 2", ort: "", version: 2 }, "erste Änderung bleibt, zweite ist nicht still überschrieben");
  // Mit der aktuellen Fassung klappt es
  const dritt = await admin("PUT", `/api/v1/kunden/${k.id}`, { ...zweit.json.aktuell, ort: "Berlin" });
  assert.equal(dritt.status, 200);
  assert.equal(dritt.json.kunde.version, 3);
  void bea;
});

test("GLEICH-04 Speichern eines inzwischen gelöschten Datensatzes: „wurde von <Name> gelöscht“", async () => {
  const k = (await admin("POST", "/api/v1/kunden", { name: "Weg Kunde" })).json.kunde;
  assert.equal((await admin("DELETE", `/api/v1/kunden/${k.id}`)).status, 200);
  const r = await admin("PUT", `/api/v1/kunden/${k.id}`, { ...k, ort: "Köln" });
  assert.equal(r.status, 404);
  assert.equal(r.json.geloescht, true);
  assert.match(r.json.text, /^Der Kunde wurde (von \S.* )?gelöscht\. Zurück zur Liste\.$/);
});

test("GLEICH-07 Fassung zählt nur bei echten Änderungen und nicht bei Betriebsdaten (letzter Login)", async () => {
  const { rows: [b] } = await s.db.pool.query("SELECT id, version FROM benutzer WHERE benutzername = 'chef'");
  await s.als("chef");
  const { rows: [n] } = await s.db.pool.query("SELECT version FROM benutzer WHERE id = $1", [b.id]);
  assert.equal(n.version, b.version, "Anmelden erzeugt keine neue Fassung");
  const r = await pruefeFassung(s.db.pool, "benutzer", b.id, b.version);
  assert.equal(r.status, "ok");
  assert.equal((await pruefeFassung(s.db.pool, "benutzer", b.id, b.version + 5)).status, "konflikt");
  assert.equal((await pruefeFassung(s.db.pool, "benutzer", b.id, null)).status, "fehlt");
});

const verbinde = (url, token) => new Promise((ok, nein) => {
  const ws = new WebSocket(url.replace("http", "ws") + "/ws");
  const nachrichten = [];
  ws.on("message", (m) => nachrichten.push(JSON.parse(String(m))));
  ws.on("open", () => { ws.send(JSON.stringify({ typ: "anmelden", token })); });
  ws.on("error", nein);
  const warte = setInterval(() => { if (nachrichten.some((n) => n.typ === "hallo")) { clearInterval(warte); ok({ ws, nachrichten }); } }, 10);
});
const kurz = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const letztePraesenz = (c) => c.nachrichten.filter((n) => n.typ === "praesenz.geaendert").at(-1);

test("GLEICH-06 Präsenz: Chips erscheinen am selben Projekt, verschwinden beim Verlassen, Schließen und nach 30 s ohne Erneuerung", async () => {
  const bea = await s.als("bea6", "Büro / Disposition");
  await s.db.pool.query("UPDATE benutzer SET name = 'Bea Sechs' WHERE benutzername = 'bea6'");
  const a = await verbinde(s.url, admin.token);
  const b = await verbinde(s.url, (await s.als("bea6")).token);
  void bea;
  a.ws.send(JSON.stringify({ typ: "praesenz", ort: "projekt:5", app: "m" }));
  await kurz();
  assert.deepEqual(letztePraesenz(a).wer, [], "allein am Projekt: keine Chips");
  b.ws.send(JSON.stringify({ typ: "praesenz", ort: "projekt:5", app: "p-web" }));
  await kurz();
  assert.deepEqual(letztePraesenz(a).wer.map((w) => [w.name, w.app]), [["Bea Sechs", "p-web"]]);
  assert.equal(letztePraesenz(b).wer[0].app, "m");
  // anderes Projekt: niemand sieht den anderen
  b.ws.send(JSON.stringify({ typ: "praesenz", ort: "projekt:6", app: "p-web" }));
  await kurz();
  assert.deepEqual(letztePraesenz(a).wer, []);
  b.ws.send(JSON.stringify({ typ: "praesenz", ort: "projekt:5", app: "p-web" }));
  await kurz();
  assert.equal(letztePraesenz(a).wer.length, 1);
  b.ws.close();
  await kurz();
  assert.deepEqual(letztePraesenz(a).wer, [], "Schließen entfernt den Chip");
  // 30 s ohne Erneuerung: Eintrag verfällt beim nächsten Hub-Takt
  const c = await verbinde(s.url, admin.token);
  c.ws.send(JSON.stringify({ typ: "praesenz", ort: "projekt:5", app: "p" }));
  await kurz();
  assert.equal(letztePraesenz(a).wer.length, 1);
  assert.equal(letztePraesenz(a).wer[0].ich, true, "derselbe Nutzer in einer zweiten App ist als „Du“ markiert");
  for (const ws of s.hub.clients) if (ws.praesenz?.app === "p") ws.praesenz.zeit -= 31_000;
  s.hub.pruefePraesenz();
  await kurz();
  assert.deepEqual(letztePraesenz(a).wer, []);
  a.ws.close(); c.ws.close();
});

test("GLEICH-03 zwei Arbeitsplätze scannen dasselbe Gerät gleichzeitig: genau einer grün, der andere rot „bereits in Projekt“, eine Bewegung", async () => {
  const lager = await s.als("lager3", "Lager / Techniker");
  const kunde = (await admin("POST", "/api/v1/kunden", { name: "Gleich Kunde" })).json.kunde;
  const kat = (await admin("POST", "/api/v1/kategorien", { name: "Ton", praefix: "TO" })).json;
  const art = (await admin("POST", "/api/v1/artikel", { kategorie_id: kat.id, name: "Mikrofon", preis_tag: 100, anzahl: 1, kennzeichnung: "qr" })).json.artikel;
  await s.db.pool.query("UPDATE geraet SET letzte_pruefung = (now() AT TIME ZONE 'Europe/Berlin')::date");
  const { rows: [g] } = await s.db.pool.query("SELECT id, code FROM geraet WHERE artikel_id = $1", [art.id]);
  const pr = async (name) => (await admin("POST", "/api/v1/projekte", { name, kunde_id: kunde.id, beginn: "2027-06-01", ende: "2027-06-02" })).json.projekt;
  const [p1, p2] = [await pr("Links"), await pr("Rechts")];
  for (let runde = 0; runde < 3; runde++) {
    await s.db.pool.query("UPDATE geraet SET projekt_id = NULL, status = 'lager' WHERE id = $1", [g.id]);
    const vorher = (await s.db.pool.query("SELECT count(*)::int AS n FROM bewegung WHERE geraet_id = $1", [g.id])).rows[0].n;
    const [r1, r2] = await Promise.all([p1, p2].map((p) => lager("POST", "/api/v1/scan", { code: g.code, modus: "hinzufuegen", projekt: p.id })));
    const gruen = [r1, r2].filter((r) => r.json.level === "ok");
    const rot = [r1, r2].filter((r) => r.json.level === "error");
    assert.equal(gruen.length, 1, `Runde ${runde}: ${r1.text} | ${r2.text}`);
    assert.equal(rot.length, 1);
    assert.match([rot[0].json.text, ...rot[0].json.meldungen.map((m) => m.text)].join(" "), /ist bereits in Projekt P-\d{4}-\d{3}/, JSON.stringify(rot[0].json));
    const { rows } = await s.db.pool.query("SELECT count(*)::int AS n FROM bewegung WHERE geraet_id = $1", [g.id]);
    assert.equal(rows[0].n - vorher, 1, "genau eine Bewegung");
  }
});
