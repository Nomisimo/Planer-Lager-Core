import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, admin, leitung, lager, kat, kat2, art;
const q = (sql, w) => s.db.pool.query(sql, w);
const geraet = async (code, artikel = art, status = "lager") => (await q("INSERT INTO geraet (code, artikel_id, status) VALUES ($1, $2, $3) RETURNING id", [code, artikel, status])).rows[0].id;
const statusVon = async (code) => (await q("SELECT status FROM geraet WHERE code = $1", [code])).rows[0].status;

before(async () => {
  s = await starteTestServer();
  admin = await s.als("admin", "Administrator");
  leitung = await s.als("leitung", "Lagerleitung");
  lager = await s.als("lager", "Lager / Techniker");
  kat = (await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 9) RETURNING id")).rows[0].id;
  kat2 = (await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Ton', 'TO', 9) RETURNING id")).rows[0].id;
  art = (await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Spot', $1) RETURNING id", [kat])).rows[0].id;
});
after(() => s?.ende());

test("FA-06 Inventur je Kategorie: Scan aller Geräte bis auf zwei → genau diese „fehlt“; zu viel, unbekannt; Abschluss bucht vermisst + Protokoll-PDF", async () => {
  for (const n of [1, 2, 3, 4, 5]) await geraet(`LI-000${n}`);
  await geraet("LI-0006", art, "gepackt");      // unterwegs: nicht im Soll
  await geraet("LI-0007", art, "vermisst");     // wird gefunden
  const ton = (await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Box', $1) RETURNING id", [kat2])).rows[0].id;
  await geraet("TO-0001", ton);
  assert.equal((await lager("POST", "/api/v1/inventuren", { kategorie_id: kat })).status, 403, "nur mit Recht Geräte ändern");
  const start = await leitung("POST", "/api/v1/inventuren", { kategorie_id: kat });
  assert.equal(start.status, 200, start.text);
  const id = start.json.id;
  assert.equal((await leitung("POST", "/api/v1/inventuren", { kategorie_id: kat })).status, 409, "nur eine offene je Bereich");
  const scan = async (code) => (await leitung("POST", `/api/v1/inventuren/${id}/scan`, { code })).json;
  assert.equal((await scan("li1")).level, "ok");
  assert.equal((await scan("LI-0001")).level, "info", "doppelt");
  await scan("LI-0003"); await scan("LI-0005");
  assert.match((await scan("TO-0001")).text, /gehört zur Kategorie Ton, zählt als „zu viel“/);
  assert.match((await scan("LI-0007")).text, /als „Vermisst“ gebucht/);
  assert.equal((await scan("XY-9999")).level, "error");
  const d = (await leitung("GET", `/api/v1/inventuren/${id}`)).json;
  assert.equal(d.soll_anzahl, 5);
  assert.deepEqual(d.fehlt.map((g) => g.code), ["LI-0002", "LI-0004"]);
  assert.deepEqual(d.zuViel.map((g) => g.code).sort(), ["LI-0007", "TO-0001"]);
  assert.deepEqual(d.unbekannt.map((g) => g.code), ["XY-9999"]);
  const ab = await leitung("POST", `/api/v1/inventuren/${id}/abschliessen`, {});
  assert.match(ab.json.text, /3 gezählt, 2 als vermisst gemeldet, 2 zu viel, 1 unbekannt/);
  assert.deepEqual([await statusVon("LI-0002"), await statusVon("LI-0004"), await statusVon("LI-0007"), await statusVon("LI-0001"), await statusVon("LI-0006")],
    ["vermisst", "vermisst", "lager", "lager", "gepackt"]);
  const { rows } = await q("SELECT aktion FROM bewegung b JOIN geraet g ON g.id = b.geraet_id WHERE g.code = 'LI-0002'");
  assert.match(rows[0].aktion, /^Inventur \d+: nicht gefunden, als vermisst gemeldet/);
  assert.equal((await q("SELECT count(*)::int AS n FROM bewegung WHERE aktion LIKE 'Inventur%gezählt'")).rows[0].n, 3, "Bewegung „Inventur“ je gezähltem Gerät");
  // eingefrorenes Ergebnis bleibt, auch wenn sich Geräte später ändern
  await q("UPDATE geraet SET status = 'lager' WHERE code = 'LI-0002'");
  assert.equal((await leitung("GET", `/api/v1/inventuren/${id}`)).json.fehlt.length, 2);
  assert.equal((await leitung("POST", `/api/v1/inventuren/${id}/scan`, { code: "LI-0002" })).status, 409, "abgeschlossen");
  const pdf = await fetch(`${s.url}/api/v1/inventuren/${id}/protokoll.pdf`, { headers: { Authorization: "Bearer " + leitung.token } });
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  const liste = (await lager("GET", "/api/v1/inventuren")).json;
  assert.equal(liste[0].fehlt, 2);
});

test("FA-06 Inventur abbrechen bucht nichts; Gesamtbestand ohne Kategorie", async () => {
  const id = (await admin("POST", "/api/v1/inventuren", {})).json.id;
  await admin("POST", `/api/v1/inventuren/${id}/scan`, { code: "LI-0001" });
  const vorher = (await q("SELECT count(*)::int AS n FROM bewegung")).rows[0].n;
  assert.equal((await admin("POST", `/api/v1/inventuren/${id}/abbrechen`, {})).status, 200);
  assert.equal((await q("SELECT count(*)::int AS n FROM bewegung")).rows[0].n, vorher);
  assert.equal((await admin("GET", `/api/v1/inventuren/${id}`)).json.inventur.status, "abgebrochen");
});

test("FA-07 Reparatur: melden mit Foto sperrt das Gerät, Rückgabe in den Bestand erst nach Prüfung, Kosten, Ausmustern", async () => {
  await q("UPDATE artikel SET pruefpflichtig = true WHERE id = $1", [art]);
  await geraet("LI-0008");
  const m = await lager("POST", "/api/v1/reparaturen", { code: "li8", beschreibung: "Lüfter klappert" });
  assert.equal(m.status, 200, m.text);
  assert.equal(await statusVon("LI-0008"), "defekt");
  assert.equal((await lager("POST", "/api/v1/reparaturen", { code: "LI-0008", beschreibung: "nochmal" })).status, 409, "eine offene je Gerät");
  assert.equal((await lager("POST", "/api/v1/reparaturen", { code: "LI-0008", beschreibung: "" })).json.felder.beschreibung.length > 0, true);
  const id = m.json.id;
  // Foto
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  const up = await fetch(`${s.url}/api/v1/reparaturen/${id}/foto`, { method: "POST", headers: { Authorization: "Bearer " + lager.token, "Content-Type": "image/png" }, body: png });
  assert.equal(up.status, 200, await up.text());
  const falsch = await fetch(`${s.url}/api/v1/reparaturen/${id}/foto`, { method: "POST", headers: { Authorization: "Bearer " + lager.token, "Content-Type": "text/html" }, body: "<b>x</b>" });
  assert.equal(falsch.status, 415);
  const bild = await fetch(`${s.url}/api/v1/reparaturen/${id}/foto`, { headers: { Authorization: "Bearer " + leitung.token } });
  assert.equal(bild.headers.get("content-type"), "image/png");
  assert.equal(bild.headers.get("x-content-type-options"), "nosniff");
  // Status: nur Lagerleitung; repariert nur mit Prüfung
  assert.equal((await lager("POST", `/api/v1/reparaturen/${id}/status`, { status: "in_reparatur" })).status, 403);
  const verantwortlich = (await q("SELECT id FROM benutzer WHERE benutzername = 'leitung'")).rows[0].id;
  assert.equal((await leitung("PUT", `/api/v1/reparaturen/${id}`, { verantwortlich_id: verantwortlich, kosten: 4550 })).status, 200);
  assert.equal((await leitung("POST", `/api/v1/reparaturen/${id}/status`, { status: "in_reparatur" })).status, 200);
  assert.equal(await statusVon("LI-0008"), "reparatur");
  const ohne = await leitung("POST", `/api/v1/reparaturen/${id}/status`, { status: "repariert" });
  assert.equal(ohne.status, 409);
  assert.match(ohne.json.text, /erst nach bestandener Prüfung/);
  assert.equal((await leitung("POST", `/api/v1/reparaturen/${id}/status`, { status: "repariert", pruefung_ok: true, notiz: "Lüfter getauscht" })).status, 200);
  const { rows: [g] } = await q("SELECT status, letzte_pruefung::text AS p, (now() AT TIME ZONE 'Europe/Berlin')::date::text AS heute FROM geraet WHERE code = 'LI-0008'");
  assert.deepEqual([g.status, g.p], ["lager", g.heute], "zurück im Lager, als geprüft eingetragen");
  const r = (await leitung("GET", `/api/v1/reparaturen/${id}`)).json;
  assert.deepEqual([r.status, r.kosten, r.verantwortlich, r.pruefung_ok, r.offen], ["repariert", 4550, r.verantwortlich, true, false]);
  assert.equal((await leitung("POST", `/api/v1/reparaturen/${id}/status`, { status: "in_reparatur" })).status, 409);
  // zweite Meldung → ausmustern
  const id2 = (await lager("POST", "/api/v1/reparaturen", { code: "LI-0008", beschreibung: "Gehäuse gebrochen" })).json.id;
  await leitung("POST", `/api/v1/reparaturen/${id2}/status`, { status: "ausgemustert" });
  assert.equal(await statusVon("LI-0008"), "ausgemustert");
  assert.equal((await leitung("GET", "/api/v1/reparaturen?status=alle")).json.filter((x) => x.code === "LI-0008").length, 2);
});

test("FA-07 Wartungsintervall je Artikel: fällige Geräte in der Liste, „Wartung erledigt“ trägt das Datum ein", async () => {
  const a = await admin("POST", "/api/v1/artikel", { name: "Nebelmaschine", kategorie_id: kat, wartung_intervall_monate: 6, wartung_text: "Düse reinigen" });
  assert.equal(a.status, 200, a.text);
  const aid = a.json.artikel?.id ?? a.json.id;
  assert.equal((await admin("POST", "/api/v1/artikel", { name: "X", kategorie_id: kat, wartung_intervall_monate: 0 })).json.felder.wartung_intervall_monate.length > 0, true);
  const g1 = await geraet("LI-0009", aid);
  await q("UPDATE geraet SET letzte_wartung = (now() - interval '7 months')::date WHERE id = $1", [g1]);
  const liste = (await lager("GET", "/api/v1/wartung")).json;
  assert.deepEqual(liste.map((g) => [g.code, g.wartung.status, g.wartung_text]), [["LI-0009", "faellig", "Düse reinigen"]]);
  assert.equal((await lager("POST", `/api/v1/geraete/${g1}/gewartet`, {})).status, 403);
  assert.equal((await leitung("POST", `/api/v1/geraete/${g1}/gewartet`, {})).status, 200);
  assert.equal((await lager("GET", "/api/v1/wartung")).json.length, 0);
  const { rows: [b] } = await q("SELECT aktion FROM bewegung WHERE geraet_id = $1 ORDER BY id DESC LIMIT 1", [g1]);
  assert.equal(b.aktion, "Wartung erledigt: Düse reinigen");
});
