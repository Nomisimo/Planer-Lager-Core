import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, admin, buero, lager, kunde, p1, p2;
const q = (sql, w) => s.db.pool.query(sql, w);
before(async () => {
  s = await starteTestServer();
  admin = await s.als("admin6", "Administrator");
  buero = await s.als("buero", "Büro / Disposition");
  lager = await s.als("lager", "Lager / Techniker");
  kunde = (await buero("POST", "/api/v1/kunden", { name: "Anna Müller" })).json.kunde;
  p1 = (await buero("POST", "/api/v1/projekte", { name: "Stadtfest", kunde_id: kunde.id, beginn: "2027-05-01" })).json.projekt;
  p2 = (await buero("POST", "/api/v1/projekte", { name: "Messe", kunde_id: kunde.id, beginn: "2027-05-03" })).json.projekt;
});
after(async () => { await s.ende(); });
const zurueck = (min) => q("UPDATE zeiteintrag SET laeuft_seit = laeuft_seit - make_interval(mins => $1), zuletzt_aktiv = now() WHERE laeuft_seit IS NOT NULL", [min]);

test("T-20 R-63 R-64 Timer: bewusst starten, Herzschlag hält, anderes Projekt/Packseite stoppt, Zeit vorgemerkt; nur einer je Benutzer", async () => {
  assert.equal((await lager("POST", "/api/v1/zeit/start", { projekt: p1.id })).status, 403, "Lager hat keinen Bereich zeiten");
  const st = (await buero("POST", "/api/v1/zeit/start", { projekt: p1.id })).json;
  assert.equal(st.timer.projekt.nummer, p1.nummer);
  await zurueck(30);
  assert.equal((await buero("POST", "/api/v1/zeit/ping", { projekt: p1.id, aktiv: true })).json.timer.projekt.id, p1.id, "gleiches Projekt hält");
  assert.ok((await buero("POST", "/api/v1/zeit/ping", { neutral: true })).json.timer, "neutrale Seite unterbricht nicht");
  // R-64: Start an p2 stoppt p1
  const st2 = (await buero("POST", "/api/v1/zeit/start", { projekt: p2.id })).json;
  assert.match(st2.text, /Vorheriger Timer gestoppt \(0:30 h\)/);
  assert.equal((await q("SELECT count(*)::int AS n FROM zeiteintrag WHERE laeuft_seit IS NOT NULL")).rows[0].n, 1);
  // T-20: Packseite = Nicht-Planung → Stopp, vorgemerkt
  await zurueck(45);
  const pk = (await buero("POST", "/api/v1/zeit/ping", { planung: false })).json;
  assert.equal(pk.gestoppt, true);
  assert.equal(pk.grund, "keine_planung");
  const { rows: [z] } = await q("SELECT minuten, quelle, prozent, satz_basis, betrag, rechnung_id FROM zeiteintrag WHERE projekt_id = $1", [p2.id]);
  assert.deepEqual([z.minuten, z.quelle, z.prozent, z.satz_basis], [45, "timer", 30, 6000]);
  assert.equal(z.betrag, 1350, "0,75 h × 60 € × 30 % = 13,50 €");
  const { rows: [pos] } = await q("SELECT r.status, rp.menge::float AS menge, rp.einzelpreis, rp.betrag FROM rechnung_position rp JOIN rechnung r ON r.id = rp.rechnung_id WHERE r.id = $1", [z.rechnung_id]);
  assert.deepEqual([pos.status, pos.menge, pos.einzelpreis, pos.betrag], ["entwurf", 0.75, 1800, 1350], "R-66 vorgemerkt, nie fertig");
  // anderes Projekt öffnen stoppt
  await buero("POST", "/api/v1/zeit/start", { projekt: p1.id });
  await zurueck(10);
  assert.equal((await buero("POST", "/api/v1/zeit/ping", { projekt: p2.id })).json.grund, "anderes_projekt");
  // unter 1 Minute → nichts gebucht
  await buero("POST", "/api/v1/zeit/start", { projekt: p1.id });
  assert.match((await buero("POST", "/api/v1/zeit/stopp", {})).json.text, /unter einer Minute/);
  assert.equal((await buero("POST", "/api/v1/zeit/stopp", {})).json.text, "Es läuft kein Timer.");
  // zwei Einträge in p1 landen im selben Entwurf
  const { rows: r } = await q("SELECT count(DISTINCT rechnung_id)::int AS n, count(*)::int AS e FROM zeiteintrag WHERE projekt_id = $1", [p1.id]);
  assert.deepEqual([r[0].n, r[0].e], [1, 2]);
});

test("R-63 300 s ohne Aktivität: Stopp mit Endzeit = letzte Aktivität; Herzschlag ohne Eingabe verlängert nicht", async () => {
  await buero("POST", "/api/v1/zeit/start", { projekt: p1.id });
  await q("UPDATE zeiteintrag SET laeuft_seit = now() - interval '20 minutes', zuletzt_aktiv = now() - interval '10 minutes' WHERE laeuft_seit IS NOT NULL");
  const r = (await buero("POST", "/api/v1/zeit/ping", { projekt: p1.id, aktiv: true })).json;
  assert.deepEqual([r.gestoppt, r.grund], [true, "leerlauf"]);
  assert.match(r.text, /0:10 h vorgemerkt \(5 Minuten ohne Aktivität\)/);
  await buero("POST", "/api/v1/zeit/start", { projekt: p1.id });
  await q("UPDATE zeiteintrag SET zuletzt_aktiv = now() - interval '2 minutes' WHERE laeuft_seit IS NOT NULL");
  await buero("POST", "/api/v1/zeit/ping", { projekt: p1.id, aktiv: false });
  assert.ok((await q("SELECT now() - zuletzt_aktiv > interval '1 minute' AS alt FROM zeiteintrag WHERE laeuft_seit IS NOT NULL")).rows[0].alt);
  // abgeschlossenes Projekt: kein Timer
  await q("UPDATE projekt SET status = 'abgeschlossen' WHERE id = $1", [p2.id]);
  assert.equal((await buero("POST", "/api/v1/zeit/start", { projekt: p2.id })).status, 409);
  await buero("POST", "/api/v1/zeit/stopp", {});
});

test("R-65 R-66 FA-46 Nachbuchen, Satz aus Posten „Technische Projektleitung“, Auswertung, CSV, Löschen", async () => {
  const kat = (await admin("POST", "/api/v1/kategorien", { name: "Personal", praefix: "PE" })).json;
  const a = (await admin("POST", "/api/v1/artikel", { name: "Technische Projektleitung", kategorie_id: kat.id, art: "personal", zeitmodell: "tag", preis_tag: 64000, kennzeichnung: "keine" })).json.artikel;
  await q(`UPDATE einstellungen SET werte = werte || jsonb_build_object('zeit_artikel', $1::int) WHERE id = 1`, [a.id]);
  const f = await buero("POST", "/api/v1/zeit/eintraege", { projekt_id: p1.id, datum: "2027-04-20", minuten: 0 });
  assert.equal(f.status, 400);
  const n = await buero("POST", "/api/v1/zeit/eintraege", { projekt_id: p1.id, datum: "2027-04-20", minuten: 90, beschreibung: "Lichtplan" });
  assert.equal(n.status, 200, n.text);
  const { rows: [z] } = await q("SELECT quelle, satz_basis, betrag FROM zeiteintrag WHERE id = $1", [n.json.id]);
  assert.deepEqual([z.quelle, z.satz_basis, z.betrag], ["manuell", 8000, 3600], "640 € ÷ 8 h = 80 €/h × 30 % × 1,5 h = 36 €");
  const aw = (await buero("GET", `/api/v1/zeit/eintraege?projekt=${p1.id}`)).json;
  assert.ok(aw.zeilen.some((x) => x.beschreibung === "Lichtplan" && x.datum === "2027-04-20"));
  assert.equal(aw.projekte[0].projekt_id, p1.id);
  assert.equal(aw.satz.posten, "Technische Projektleitung");
  const zr = (await buero("GET", "/api/v1/zeit/eintraege?von=2027-04-20&bis=2027-04-20")).json;
  assert.equal(zr.zeilen.length, 1);
  const c = await buero("GET", `/api/v1/zeit/eintraege.csv?projekt=${p1.id}`);
  assert.match(c.headers.get("content-type"), /text\/csv/);
  assert.match(c.text, /20\.04\.2027;.*;Lichtplan;nachgebucht;80,00;30;36,00/);
  // Löschen nimmt die Position aus dem Entwurf
  assert.equal((await buero("DELETE", `/api/v1/zeit/eintraege/${n.json.id}`)).json.ok, true);
  assert.equal((await q("SELECT count(*)::int AS n FROM rechnung_position WHERE zeiteintrag_id = $1", [n.json.id])).rows[0].n, 0);
  assert.equal((await lager("GET", "/api/v1/zeit/eintraege")).status, 403);
});

test("R-64 D-77 gleichzeitiger Doppelstart ergibt genau einen Timer; Lauf unter 60 s wird verworfen", async () => {
  await buero("POST", "/api/v1/zeit/stopp", {});
  const vorher = (await q("SELECT count(*)::int AS n FROM zeiteintrag")).rows[0].n;
  const r = await Promise.all([buero("POST", "/api/v1/zeit/start", { projekt: p1.id }), buero("POST", "/api/v1/zeit/start", { projekt: p1.id })]);
  assert.deepEqual(r.map((x) => x.status), [200, 200]);
  assert.equal((await q("SELECT count(*)::int AS n FROM zeiteintrag WHERE laeuft_seit IS NOT NULL")).rows[0].n, 1);
  await q("UPDATE zeiteintrag SET laeuft_seit = now() - interval '40 seconds' WHERE laeuft_seit IS NOT NULL");
  assert.match((await buero("POST", "/api/v1/zeit/stopp", {})).json.text, /unter einer Minute/);
  assert.equal((await q("SELECT count(*)::int AS n FROM zeiteintrag")).rows[0].n, vorher, "40 s nicht gebucht");
});
