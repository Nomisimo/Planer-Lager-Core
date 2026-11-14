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

test("3.6 Kategorie: Präfix-Vorschlag, eindeutig, letzte_nummer nur steigend, Präfix nach Codevergabe fest", async () => {
  assert.equal((await admin("GET", "/api/v1/kategorien/praefix-vorschlag?name=Lautsprecher")).json.praefix, "LA");
  const k = await neueKategorie("Lautsprecher");
  assert.equal(k.praefix, "LA");
  const d = await admin("POST", "/api/v1/kategorien", { name: "Lampen", praefix: "la" });
  assert.equal(d.status, 409);
  assert.equal((await admin("POST", "/api/v1/kategorien", { name: "X", praefix: "ABCDE" })).status, 400);
  await assert.rejects(s.db.pool.query("UPDATE kategorie SET letzte_nummer = 5 WHERE id = $1", [k.id]).then(() => s.db.pool.query("UPDATE kategorie SET letzte_nummer = 4 WHERE id = $1", [k.id])), /nur steigen/);
  assert.equal((await admin("PUT", `/api/v1/kategorien/${k.id}`, { name: "Lautsprecher", praefix: "LS" })).status, 409);
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
  assert.match(d.bewegungen[0].aktion, /Vermisst → Im Lager/);
  assert.equal(d.bewegungen[0].benutzer, "lager");
  assert.ok(d.bewegungen[0].zeit);
  await assert.rejects(s.db.pool.query("UPDATE bewegung SET aktion = 'x'"), /nur neue Einträge/);
  // verbotener Übergang
  await lager("POST", `/api/v1/geraete/${id}/vermisst`, {});
  const v = await admin("POST", `/api/v1/geraete/${id}/status`, { status: "gepackt" });
  assert.equal(v.status, 409);
});

test("R-19 T-23 Gerät in einem Projekt löschen verweigert; SOLL: mit Verlauf nur ausmustern", async () => {
  const k = await neueKategorie("Traversen", "TR");
  const a = await neuerArtikel({ name: "Traverse 2 m", kategorie_id: k.id, anzahl: 2, kennzeichnung: "qr" });
  const [g1, g2] = a.geraete.ids;
  await s.db.pool.query("UPDATE geraet SET projekt_id = 99, status = 'zugeordnet' WHERE id = $1", [g1]);
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
  await s.db.pool.query("UPDATE geraet SET projekt_id = 77, status = 'zugeordnet' WHERE id = $1", [a.geraete.ids[0]]);
  const r = await admin("DELETE", `/api/v1/artikel/${a.artikel.id}`);
  assert.equal(r.status, 409);
  assert.match(r.json.text, /ST-0001/);
  await s.db.pool.query("UPDATE geraet SET status = 'vermisst' WHERE id = $1", [a.geraete.ids[0]]);
  const leer = await neuerArtikel({ name: "Stativ klein", kategorie_id: k.id, anzahl: 1, kennzeichnung: "qr" });
  assert.equal((await admin("DELETE", `/api/v1/artikel/${leer.artikel.id}`)).status, 200);
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
  const ue = (await admin("GET", "/api/v1/geraete?pruef=ueberfaellig")).json.zeilen;
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
});
