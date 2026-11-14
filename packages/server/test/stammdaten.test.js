import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, admin, lager, buero;
before(async () => {
  s = await starteTestServer();
  admin = await s.als("admin");
  lager = await s.als("lager", "Lager / Techniker");
  buero = await s.als("buero", "Büro / Disposition");
});
after(async () => { await s.ende(); });

const neueKategorie = async (name, praefix) => (await admin("POST", "/api/v1/kategorien", { name, praefix })).json;
const neuerArtikel = async (w) => (await admin("POST", "/api/v1/artikel", w)).json;
let projektNr = 0;
/** Minimales Projekt direkt in der DB (Geräte verweisen per Fremdschlüssel auf Projekte). */
const testProjekt = async () => {
  const { rows: [k] } = await s.db.pool.query("INSERT INTO kunde (name) VALUES ('Testkunde') RETURNING id");
  const { rows: [p] } = await s.db.pool.query("INSERT INTO projekt (nummer, art, name, kunde_id) VALUES ($1, 'projekt', 'Test', $2) RETURNING id",
    [`P-2000-${String(++projektNr).padStart(3, "0")}`, k.id]);
  return p.id;
};

test("3.6 Kategorie: Präfix-Vorschlag, eindeutig, letzte_nummer nur steigend, Präfix nach Codevergabe fest", async () => {
  assert.equal((await admin("GET", "/api/v1/kategorien/praefix-vorschlag?name=Lautsprecher")).json.praefix, "LA");
  const k = await neueKategorie("Lautsprecher");
  assert.equal(k.praefix, "LA");
  const d = await admin("POST", "/api/v1/kategorien", { name: "Lampen", praefix: "la" });
  assert.equal(d.status, 409);
  assert.equal((await admin("POST", "/api/v1/kategorien", { name: "X", praefix: "ABCDE" })).status, 400);
  await assert.rejects(s.db.pool.query("UPDATE kategorie SET letzte_nummer = 5 WHERE id = $1", [k.id]).then(() => s.db.pool.query("UPDATE kategorie SET letzte_nummer = 4 WHERE id = $1", [k.id])), /nur steigen/);
  assert.equal((await admin("PUT", `/api/v1/kategorien/${k.id}`, { name: "Lautsprecher", praefix: "LS" })).status, 409);
  assert.equal((await admin("POST", "/api/v1/kategorien", { name: "Lautsprecher", praefix: "LT" })).status, 409, "doppelter Name");
  // Live-Update bei Ändern und Löschen; Löschen mit Artikeln verweigert
  const gesendet = [];
  const orig = s.hub.sende.bind(s.hub);
  s.hub.sende = (m) => { gesendet.push(m.typ); return orig(m); };
  try {
    const leer = await neueKategorie("Leer", "LE");
    assert.equal((await admin("PUT", `/api/v1/kategorien/${leer.id}`, { name: "Leer 2", praefix: "LE" })).status, 200);
    assert.equal((await admin("DELETE", `/api/v1/kategorien/${leer.id}`)).status, 200);
    assert.deepEqual(gesendet.filter((t) => t === "kategorie.geaendert").length, 3);
  } finally { s.hub.sende = orig; }
  await neuerArtikel({ name: "Box", kategorie_id: k.id });
  const v = await admin("DELETE", `/api/v1/kategorien/${k.id}`);
  assert.equal(v.status, 409);
  assert.match(v.json.text, /noch Artikel/);
});

test("R-21 Gerätecodes fortlaufend je Präfix, nie wiederverwendet nach Löschen; R-72 Kennzeichnung qr legt Geräte an", async () => {
  const k = await neueKategorie("Mikrofone", "MI");
  const a = await neuerArtikel({ name: "SM58", kategorie_id: k.id, preis_tag: 500, anzahl: 3, kennzeichnung: "qr" });
  assert.deepEqual(a.geraete.codes, ["MI-0001", "MI-0002", "MI-0003"]);
  const g3 = (await admin("GET", "/api/v1/geraete/code/mi3")).json;
  assert.equal((await admin("DELETE", `/api/v1/geraete/${g3.id}`)).status, 200);
  const n = await admin("POST", `/api/v1/artikel/${a.artikel.id}/geraete`, { anzahl: 1 });
  assert.deepEqual(n.json.codes, ["MI-0004"], "MI-0003 wird nicht neu vergeben");
  const ohne = await neuerArtikel({ name: "SM57", kategorie_id: k.id, anzahl: 2, kennzeichnung: "keine" });
  assert.equal(ohne.geraete, null);
});

test("R-22 Code-Suche normalisiert Eingaben und findet alte Prüf-ID", async () => {
  const k = await neueKategorie("Licht Technik", "LT");
  const a = await neuerArtikel({ name: "PAR", kategorie_id: k.id, anzahl: 1, kennzeichnung: "qr" });
  for (const e of ["lt1", "LT 1", "lt-0001"]) assert.equal((await lager("GET", `/api/v1/geraete/code/${encodeURIComponent(e)}`)).json.code, "LT-0001");
  await admin("PUT", `/api/v1/geraete/${a.geraete.ids[0]}`, { alte_pruef_id: "B-778899" });
  assert.equal((await lager("GET", "/api/v1/geraete/code/B-778899")).json.code, "LT-0001");
  const f = await lager("GET", "/api/v1/geraete/code/LT-9999");
  assert.equal(f.status, 404);
  assert.match(f.json.text, /Prüfe den Code/);
});

test("R-18 Statuswechsel erzeugt Bewegung mit Aktion, Person, Zeit; R-30 jede Bewegung gebucht; 3.9 nur anfügen", async () => {
  const k = await neueKategorie("Kabel Strom", "KS");
  const a = await neuerArtikel({ name: "Schuko 5 m", kategorie_id: k.id, anzahl: 1, kennzeichnung: "qr" });
  const id = a.geraete.ids[0];
  assert.equal((await lager("POST", `/api/v1/geraete/${id}/vermisst`, {})).status, 200);
  assert.equal((await lager("POST", `/api/v1/geraete/${id}/gefunden`, {})).status, 200);
  const d = (await lager("GET", `/api/v1/geraete/${id}`)).json;
  assert.equal(d.status, "lager");
  assert.equal(d.bewegungen.length, 2);
  assert.equal(d.bewegungen[0].aktion, "Wieder gefunden, zurück im Lager");
  assert.equal(d.bewegungen[1].aktion, "Als vermisst gemeldet");
  assert.equal(d.bewegungen[0].benutzer, "lager");
  assert.ok(d.bewegungen[0].zeit);
  await assert.rejects(s.db.pool.query("UPDATE bewegung SET aktion = 'x'"), /nur neue Einträge/);
  // verbotener Übergang
  await lager("POST", `/api/v1/geraete/${id}/vermisst`, {});
  const v = await admin("POST", `/api/v1/geraete/${id}/status`, { status: "lager" });
  assert.equal(v.status, 200);
  // 4.3: zugeordnet/gepackt nie manuell (nur Packen)
  const z = await admin("POST", `/api/v1/geraete/${id}/status`, { status: "gepackt" });
  assert.equal(z.status, 400);
  assert.match(z.json.text, /nur das Packen/);
  // defekt, reparatur, ausgemustert werden als Bewegung gebucht; ausgemustert ist endgültig
  for (const st of ["defekt", "reparatur", "ausgemustert"]) assert.equal((await admin("POST", `/api/v1/geraete/${id}/status`, { status: st })).status, 200, st);
  assert.equal((await admin("POST", `/api/v1/geraete/${id}/status`, { status: "lager" })).status, 409);
  // wer = Mitarbeiter (Arbeitsplatz), sonst Benutzer
  await s.db.pool.query("INSERT INTO bewegung (geraet_id, aktion, benutzer, mitarbeiter) VALUES ($1, 'Test', 'station1', 'Max')", [id]);
  const e = (await lager("GET", `/api/v1/geraete/${id}`)).json;
  assert.equal(e.bewegungen[0].wer, "Max");
  assert.equal(e.bewegungen[1].wer, "admin");
  assert.match(e.bewegungen[1].aktion, /In Reparatur → Ausgemustert/);
  assert.equal(e.bewegungen.length, 8);
});

test("3.8 Gerätecode: nicht änderbar, Format geprüft; Case-Löschung leert „Liegt in Case“", async () => {
  const k = await neueKategorie("Taschen", "TA");
  const inh = await neuerArtikel({ name: "Mikro", kategorie_id: k.id, anzahl: 1, kennzeichnung: "qr" });
  const cs = await neuerArtikel({ name: "Mikrocase", kategorie_id: k.id, ist_case: true, verpackungseinheit: 4, anzahl: 1, kennzeichnung: "qr" });
  await assert.rejects(s.db.pool.query("UPDATE geraet SET code = 'CA-9999' WHERE id = $1", [inh.geraete.ids[0]]));
  await assert.rejects(s.db.pool.query("INSERT INTO geraet (artikel_id, code) VALUES ($1, 'ca-1')", [inh.artikel.id]));
  await assert.rejects(s.db.pool.query("INSERT INTO geraet (artikel_id, code) VALUES ($1, 'ABCDE-0001')", [inh.artikel.id]));
  const code = (await admin("GET", `/api/v1/geraete/${inh.geraete.ids[0]}`)).json.code;
  assert.equal((await admin("POST", `/api/v1/geraete/${cs.geraete.ids[0]}/inhalt`, { code })).status, 200);
  assert.equal((await admin("GET", `/api/v1/geraete/${inh.geraete.ids[0]}`)).json.case_code, "TA-0002");
  assert.equal((await admin("DELETE", `/api/v1/geraete/${cs.geraete.ids[0]}`)).status, 200);
  assert.equal((await admin("GET", `/api/v1/geraete/${inh.geraete.ids[0]}`)).json.case_id, null);
});

test("5.10 Prüfstatus: SQL liefert dasselbe wie pruefstatus() an den Grenzen", async () => {
  const { pruefstatus, plusMonate } = await import("@lager/domain");
  const k = await neueKategorie("Prüfgrenzen", "PG");
  const a = await neuerArtikel({ name: "Prüfling", kategorie_id: k.id, pruef_intervall_monate: 1, anzahl: 6, kennzeichnung: "qr" });
  const { rows: [{ heute }] } = await s.db.pool.query("SELECT ((now() AT TIME ZONE 'Europe/Berlin')::date)::text AS heute");
  const tag = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  const vor1 = plusMonate(heute, -1);
  const daten = [vor1, tag(vor1, -1), tag(vor1, 30), tag(vor1, 31), null, "2026-01-31"];
  for (let i = 0; i < daten.length; i++) await s.db.pool.query("UPDATE geraet SET letzte_pruefung = $1 WHERE id = $2", [daten[i], a.geraete.ids[i]]);
  const d = (await admin("GET", `/api/v1/artikel/${a.artikel.id}`)).json;
  for (let i = 0; i < daten.length; i++) {
    const g = d.geraete.find((x) => x.id === a.geraete.ids[i]);
    assert.equal(g.pruefstatus, pruefstatus({ pruefpflichtig: true, pruef_intervall_monate: 1 }, daten[i], heute).status, `letzte Prüfung ${daten[i]}`);
  }
});

test("R-19 T-23 Gerät in einem Projekt löschen verweigert; SOLL: mit Verlauf nur ausmustern", async () => {
  const k = await neueKategorie("Traversen", "TR");
  const a = await neuerArtikel({ name: "Traverse 2 m", kategorie_id: k.id, anzahl: 2, kennzeichnung: "qr" });
  const [g1, g2] = a.geraete.ids;
  await s.db.pool.query("UPDATE geraet SET projekt_id = $2, status = 'zugeordnet' WHERE id = $1", [g1, await testProjekt()]);
  const r = await admin("DELETE", `/api/v1/geraete/${g1}`);
  assert.equal(r.status, 409);
  assert.match(r.json.text, /Projekt zugeordnet/);
  assert.equal(r.json.empfehlung, "ausmustern");
  await admin("POST", `/api/v1/geraete/${g2}/status`, { status: "defekt" });
  const h = await admin("DELETE", `/api/v1/geraete/${g2}`);
  assert.equal(h.status, 409);
  assert.match(h.json.text, /Verlauf/);
  assert.equal((await admin("POST", `/api/v1/geraete/${g2}/status`, { status: "ausgemustert" })).status, 200);
});

test("FA-02 Artikel löschen nur ohne belegte Geräte (vermisste zählen nicht), sonst verständliche Meldung", async () => {
  const k = await neueKategorie("Stative", "ST");
  const a = await neuerArtikel({ name: "Stativ", kategorie_id: k.id, anzahl: 1, kennzeichnung: "qr" });
  await s.db.pool.query("UPDATE geraet SET projekt_id = $2, status = 'zugeordnet' WHERE id = $1", [a.geraete.ids[0], await testProjekt()]);
  const r = await admin("DELETE", `/api/v1/artikel/${a.artikel.id}`);
  assert.equal(r.status, 409);
  assert.match(r.json.text, /ST-0001/);
  // vermisst im Projekt zählt nicht als belegt → dieser Artikel ist löschbar (ohne Verlauf)
  await s.db.pool.query("UPDATE geraet SET status = 'vermisst' WHERE id = $1", [a.geraete.ids[0]]);
  assert.equal((await admin("DELETE", `/api/v1/artikel/${a.artikel.id}`)).status, 200);
  // D-37: Gerät mit Verlauf → nicht löschbar, Hinweis auf inaktiv/ausmustern
  const b = await neuerArtikel({ name: "Stativ groß", kategorie_id: k.id, anzahl: 1, kennzeichnung: "qr" });
  await admin("POST", `/api/v1/geraete/${b.geraete.ids[0]}/status`, { status: "defekt" });
  const h = await admin("DELETE", `/api/v1/artikel/${b.artikel.id}`);
  assert.equal(h.status, 409);
  assert.match(h.json.text, /Verlauf/);
});

test("FA-01 Materialliste mit Suche, Filter Kategorie/Typ, Geräteanzahl, Warnzeichen bei Bestand ≤ Mindestbestand", async () => {
  const k = await neueKategorie("Verbrauch", "VB");
  await neuerArtikel({ name: "Gaffa schwarz", kategorie_id: k.id, verbrauch: true, pruefpflichtig: false, bestand: 3, mindestbestand: 5, einheit: "Rolle" });
  await neuerArtikel({ name: "Kabelbinder", kategorie_id: k.id, verbrauch: true, pruefpflichtig: false, bestand: 100, mindestbestand: 10 });
  const l = (await buero("GET", `/api/v1/artikel?kategorie=${k.id}&typ=verbrauch`)).json;
  assert.equal(l.gesamt, 2);
  assert.equal(l.zeilen.find((z) => z.name === "Gaffa schwarz").niedrig, true);
  assert.equal(l.zeilen.find((z) => z.name === "Kabelbinder").niedrig, false);
  assert.equal((await buero("GET", "/api/v1/artikel?q=gaffa")).json.zeilen.length, 1);
  const m = (await buero("GET", "/api/v1/artikel?q=SM58")).json.zeilen[0];
  assert.equal(m.geraete, 3);
  assert.equal(m.typ, "Artikel");
  assert.equal((await buero("POST", "/api/v1/artikel", { name: "X", kategorie_id: k.id })).status, 403, "Büro hat material nur r");
});

test("FA-04 Bestand Verbrauchsmaterial ändern mit Bereich packen w (Lager darf)", async () => {
  const k = (await admin("GET", "/api/v1/kategorien")).json.find((x) => x.praefix === "VB");
  const a = (await buero("GET", `/api/v1/artikel?kategorie=${k.id}&q=Gaffa`)).json.zeilen[0];
  const r = await lager("POST", `/api/v1/artikel/${a.id}/bestand`, { aenderung: 10 });
  assert.equal(r.status, 200);
  assert.equal(r.json.bestand, 13);
  assert.equal((await lager("POST", `/api/v1/artikel/${a.id}/bestand`, { neu: -1 })).status, 400);
  assert.equal((await buero("POST", `/api/v1/artikel/${a.id}/bestand`, { neu: 1 })).json.bestand, 1, "Büro hat packen w");
});

test("FA-03 Geräteliste mit Status-, Prüf- und Projektfilter; Detail mit Prüfstatus, Case-Inhalt ein/austragen, Heute geprüft", async () => {
  const k = await neueKategorie("Cases", "CA");
  const kInhalt = await neueKategorie("Funk", "FU");
  const funk = await neuerArtikel({ name: "Funkstrecke", kategorie_id: kInhalt.id, anzahl: 2, kennzeichnung: "qr" });
  const cs = await neuerArtikel({ name: "Funk-Case", kategorie_id: k.id, ist_case: true, inhalt_artikel_id: funk.artikel.id, verpackungseinheit: 2, anzahl: 1, kennzeichnung: "qr" });
  const caseId = cs.geraete.ids[0];
  assert.equal((await admin("POST", `/api/v1/geraete/${caseId}/inhalt`, { code: "fu1" })).status, 200);
  assert.equal((await admin("POST", `/api/v1/geraete/${caseId}/inhalt`, { code: "FU-0002" })).status, 200);
  let d = (await admin("GET", `/api/v1/geraete/${caseId}`)).json;
  assert.deepEqual(d.inhalt.map((i) => i.code), ["FU-0001", "FU-0002"]);
  assert.equal(d.pruefstatus, "offen");
  assert.equal((await admin("POST", `/api/v1/geraete/${caseId}/inhalt`, { code: "FU-0002", austragen: true })).status, 200);
  assert.equal((await admin("POST", `/api/v1/geraete/${funk.geraete.ids[0]}/inhalt`, { code: "FU-0002" })).status, 400, "kein Case");
  assert.equal((await lager("POST", `/api/v1/geraete/${caseId}/geprueft`, {})).status, 200);
  d = (await admin("GET", `/api/v1/geraete/${caseId}`)).json;
  assert.equal(d.pruefstatus, "ok");
  assert.ok(d.naechste_pruefung);
  await s.db.pool.query("UPDATE geraet SET letzte_pruefung = '2020-01-31' WHERE id = $1", [funk.geraete.ids[1]]);
  const ue = (await admin("GET", "/api/v1/geraete?pruef=ueberfaellig")).json.zeilen.filter((z) => z.code.startsWith("FU-"));
  assert.deepEqual(ue.map((z) => z.code), ["FU-0002"]);
  assert.equal(ue[0].naechste_pruefung, "2021-01-31");
  assert.ok((await admin("GET", "/api/v1/geraete?status=vermisst")).json.zeilen.every((z) => z.status === "vermisst"));
  assert.ok((await admin("GET", "/api/v1/geraete?projekt=mit")).json.zeilen.every((z) => z.projekt_id));
});

test("R-71 Art Kabel/Verbrauch: Prüfung der Felder; R-72 Verbrauch legt keine Geräte an", async () => {
  const k = await neueKategorie("Kabel DMX", "DX");
  const kab = await neuerArtikel({ name: "DMX 10 m", kategorie_id: k.id, laenge_m: 10, anzahl: 1, kennzeichnung: "qr" });
  assert.equal(kab.artikel.laenge_m, 10);
  const vb = await admin("POST", "/api/v1/artikel", { name: "Batterie AA", kategorie_id: k.id, verbrauch: true, bestand: 10, anzahl: 5, kennzeichnung: "qr" });
  assert.equal(vb.json.geraete, null);
  const f = await admin("POST", "/api/v1/artikel", { name: "", kategorie_id: k.id, preis_tag: 2.5 });
  assert.equal(f.status, 400);
  assert.ok(f.json.felder.name && f.json.felder.preis_tag);
  // R-71 serverseitig: Verbrauch/Leistung leeren laenge_m, Kennzeichen exklusiv; Default prüfpflichtig 12 Monate
  const x = (await admin("POST", "/api/v1/artikel", { name: "Klebeband", kategorie_id: k.id, verbrauch: true, ist_case: true, laenge_m: 50 })).json.artikel;
  assert.deepEqual([x.verbrauch, x.ist_case, x.laenge_m], [true, false, null]);
  const l = (await admin("POST", "/api/v1/artikel", { name: "Aufbau", kategorie_id: k.id, ist_leistung: true, laenge_m: 3 })).json.artikel;
  assert.deepEqual([l.ist_leistung, l.laenge_m, l.pruefpflichtig], [true, null, false]);
  const p = (await admin("PUT", `/api/v1/artikel/${kab.artikel.id}`, { verbrauch: true })).json.artikel;
  assert.equal(p.laenge_m, null);
  const g = (await admin("POST", "/api/v1/artikel", { name: "Mischpult", kategorie_id: k.id })).json.artikel;
  assert.deepEqual([g.pruefpflichtig, g.pruef_intervall_monate], [true, 12]);
});

test("R-49 R-50 Gerät vermisst melden: Projekt bleibt, Case leer, doppelt ändert nichts; gefunden nur bei Vermisst", async () => {
  const k = await neueKategorie("Kabel Daten", "KD");
  const a = await neuerArtikel({ name: "DMX 10 m", kategorie_id: k.id, anzahl: 2, kennzeichnung: "qr" });
  const [id, cs] = a.geraete.ids;
  const p = { id: await testProjekt() };
  const { rows: [{ nummer }] } = await s.db.pool.query("SELECT nummer FROM projekt WHERE id = $1", [p.id]);
  await s.db.pool.query("UPDATE geraet SET status = 'gepackt', projekt_id = $1, case_id = $2 WHERE id = $3", [p.id, cs, id]);
  assert.equal((await lager("POST", `/api/v1/geraete/${id}/gefunden`, {})).status, 409, "gefunden nur bei Vermisst");
  const r = await lager("POST", `/api/v1/geraete/${id}/vermisst`, {});
  assert.equal(r.status, 200);
  const { rows: [g] } = await s.db.pool.query("SELECT status, projekt_id, case_id FROM geraet WHERE id = $1", [id]);
  assert.deepEqual([g.status, g.projekt_id, g.case_id], ["vermisst", p.id, null]);
  const d1 = (await lager("GET", `/api/v1/geraete/${id}`)).json;
  assert.match(d1.bewegungen[0].aktion, new RegExp(`^Als vermisst gemeldet, Projekt ${nummer}, zuletzt in KD-`));
  assert.match((await lager("POST", `/api/v1/geraete/${id}/vermisst`, {})).json.text, /bereits als vermisst/);
  assert.equal((await lager("GET", `/api/v1/geraete/${id}`)).json.bewegungen.length, d1.bewegungen.length, "doppelt ändert nichts");
  await lager("POST", `/api/v1/geraete/${id}/gefunden`, {});
  const { rows: [h] } = await s.db.pool.query("SELECT status, projekt_id FROM geraet WHERE id = $1", [id]);
  assert.deepEqual([h.status, h.projekt_id], ["lager", null]);
});
