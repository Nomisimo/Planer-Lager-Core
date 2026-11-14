import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { starteTestServer } from "./helfer.js";

let s, buero, lager, kunde, jahr;
before(async () => {
  s = await starteTestServer();
  buero = await s.als("buero", "Büro / Disposition");
  lager = await s.als("lager", "Lager / Techniker");
  kunde = (await buero("POST", "/api/v1/kunden", { name: "Anna Müller", firma: "Stadtwerke" })).json.kunde;
  jahr = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(new Date());
});
after(async () => { await s.ende(); });

const projekt = async (w) => (await buero("POST", "/api/v1/projekte", { name: "Stadtfest", kunde_id: kunde.id, ...w })).json;

test("R-20 Projektnummer P-JJJJ-NNN und J-JJJJ-NNN, getrennte Zähler; 3.2 Projektordner mit Unterordnern", async () => {
  const p1 = (await projekt({ beginn: "2026-06-01", ende: "2026-06-03", ort: "Köln" })).projekt;
  const p2 = (await projekt({ name: "Firmenfeier" })).projekt;
  assert.equal(p1.nummer, `P-${jahr}-001`);
  assert.equal(p2.nummer, `P-${jahr}-002`);
  const j = (await buero("POST", "/api/v1/projekte", { name: "Einzeljob", art: "job", kunde_id: kunde.id })).json.projekt;
  assert.equal(j.nummer, `J-${jahr}-001`);
  for (const u of ["Angebote", "Rechnungen", "Dokumente"]) assert.ok(fs.statSync(path.join(s.dataDir, p1.ordner, u)).isDirectory(), u);
  assert.equal(p1.ordner, path.join("projekte", `P-${jahr}-001 Stadtfest`));
  assert.equal((await lager("POST", "/api/v1/projekte", { name: "X", kunde_id: kunde.id })).status, 403);
  const f = await buero("POST", "/api/v1/projekte", { name: "", beginn: "2026-06-03", ende: "2026-06-01" });
  assert.equal(f.status, 400);
  assert.deepEqual(Object.keys(f.json.felder).sort(), ["ende", "kunde_id", "name"]);
});

test("T-19 FA-30 Job zu Projekt übernimmt Kunde/Termin/Ort, liegt unter Jobs/; Job unter Job abgelehnt; Projekt mit Jobs wird kein Job", async () => {
  const k2 = (await buero("POST", "/api/v1/kunden", { name: "Bernd Beispiel" })).json.kunde;
  const p = (await projekt({ name: "Messe", beginn: "2026-09-10", ende: "2026-09-12", ort: "Halle 3" })).projekt;
  const r = await buero("POST", "/api/v1/projekte", { name: "Messe Ton", uebergeordnet_id: p.id, gewerk: "Ton", kunde_id: k2.id });
  assert.equal(r.status, 200);
  const j = r.json.projekt;
  assert.deepEqual([j.art, j.kunde_id, j.beginn, j.ende, j.ort], ["job", kunde.id, "2026-09-10", "2026-09-12", "Halle 3"], "Kunde immer vom Projekt");
  assert.ok(j.ordner.startsWith(path.join(p.ordner, "Jobs") + path.sep));
  const unter = await buero("POST", "/api/v1/projekte", { name: "Unterjob", uebergeordnet_id: j.id });
  assert.equal(unter.status, 400);
  assert.match(unter.json.text, /keine Unter-Jobs/);
  const zuJob = await buero("PUT", `/api/v1/projekte/${p.id}`, { art: "job" });
  assert.equal(zuJob.status, 409);
  // Job nachträglich unter einen Job hängen → abgelehnt
  const p2 = (await projekt({ name: "Andere Messe" })).projekt;
  const j2 = (await buero("POST", "/api/v1/projekte", { name: "Job B", uebergeordnet_id: p2.id })).json.projekt;
  const umh = await buero("PUT", `/api/v1/projekte/${j2.id}`, { uebergeordnet_id: j.id });
  assert.equal(umh.status, 400);
  assert.match(umh.json.text, /keine Unter-Jobs.*Wähle ein Projekt/);
  // Kundenwechsel am Projekt wandert in die Jobs
  await buero("PUT", `/api/v1/projekte/${p.id}`, { kunde_id: k2.id });
  assert.equal((await buero("GET", `/api/v1/projekte/${j.id}`)).json.kunde_id, k2.id);
  assert.equal((await buero("PUT", `/api/v1/projekte/${j.id}`, { kunde_id: kunde.id })).json.projekt.kunde_id, k2.id, "Job behält Projektkunden");
  // „Jobs anlegen“ nach Gewerk
  const m = await buero("POST", `/api/v1/projekte/${p.id}/jobs`, { gewerke: ["Licht", "Strom"] });
  assert.deepEqual(m.json.jobs.map((x) => [x.name, x.gewerk]), [["Messe – Licht", "Licht"], ["Messe – Strom", "Strom"]]);
  assert.equal((await buero("POST", `/api/v1/projekte/${j.id}/jobs`, { gewerke: ["Licht"] })).status, 400);
  assert.equal((await buero("POST", `/api/v1/projekte/${p.id}/jobs`, { gewerke: ["Catering"] })).status, 400);
  const d = (await buero("GET", `/api/v1/projekte/${p.id}`)).json;
  assert.equal(d.jobs.length, 3);
  // Löschen mit Jobs verweigert
  const del = await buero("DELETE", `/api/v1/projekte/${p.id}`);
  assert.equal(del.status, 409);
  assert.match(del.json.text, /Storniert/);
});

test("R-12 Statuswechsel (auch rückwärts) mit Recht projekte w; R-13 abgeschlossen/storniert gibt Ladezone frei; R-14 Verladen", async () => {
  const p = (await projekt({ name: "Konzert" })).projekt;
  for (const st of ["angebot_gesendet", "bestaetigt", "anfrage"]) assert.equal((await buero("POST", `/api/v1/projekte/${p.id}/status`, { status: st })).status, 200, st);
  assert.equal((await buero("POST", `/api/v1/projekte/${p.id}/status`, { status: "anfrage" })).status, 400, "gleicher Status");
  assert.equal((await lager("POST", `/api/v1/projekte/${p.id}/status`, { status: "laeuft" })).status, 403);
  await s.db.pool.query("INSERT INTO ladezone (bezeichnung) VALUES ('R-13') ON CONFLICT DO NOTHING");
  await s.db.pool.query("UPDATE projekt SET ladezone_id = (SELECT id FROM ladezone WHERE bezeichnung = 'R-13'), zone_seit = now() WHERE id = $1", [p.id]);
  const r = await buero("POST", `/api/v1/projekte/${p.id}/status`, { status: "abgeschlossen" });
  assert.match(r.json.text, /Ladezone freigegeben/);
  const { rows: [z] } = await s.db.pool.query("SELECT ladezone_id, zone_seit FROM projekt WHERE id = $1", [p.id]);
  assert.deepEqual([z.ladezone_id, z.zone_seit], [null, null]);
  await s.db.pool.query("UPDATE projekt SET ladezone_id = (SELECT id FROM ladezone WHERE bezeichnung = 'R-13') WHERE id = $1", [p.id]);
  await buero("PUT", `/api/v1/projekte/${p.id}`, { status: "storniert" });
  assert.equal((await s.db.pool.query("SELECT ladezone_id FROM projekt WHERE id = $1", [p.id])).rows[0].ladezone_id, null);
  // R-14
  const { nachVerladen } = await import("../src/projekte.js");
  await buero("POST", `/api/v1/projekte/${p.id}/status`, { status: "bestaetigt" });
  assert.equal(await nachVerladen(s.db.pool, p.id), "laeuft");
  assert.equal(await nachVerladen(s.db.pool, p.id), "laeuft");
  assert.equal((await buero("GET", `/api/v1/projekte/${p.id}`)).json.status, "laeuft");
});

test("FA-29 Liste mit Filtern Status/Zeitraum/Kunde/Art; Detail mit Kopfkennzahlen; Suche nach Nummer", async () => {
  const k3 = (await buero("POST", "/api/v1/kunden", { name: "Clara Filter" })).json.kunde;
  const p = (await projekt({ name: "Sommerfest", kunde_id: k3.id, beginn: "2026-07-01", ende: "2026-07-02" })).projekt;
  await projekt({ name: "Winterfest", kunde_id: k3.id, beginn: "2026-12-20" });
  const l = async (q) => (await lager("GET", `/api/v1/projekte?${q}`)).json;
  assert.deepEqual((await l(`kunde=${k3.id}`)).zeilen.map((z) => z.name).sort(), ["Sommerfest", "Winterfest"]);
  assert.deepEqual((await l(`kunde=${k3.id}&von=2026-06-30&bis=2026-07-01`)).zeilen.map((z) => z.name), ["Sommerfest"]);
  assert.deepEqual((await l(`kunde=${k3.id}&status=anfrage,bestaetigt&art=projekt`)).gesamt, 2);
  await buero("POST", `/api/v1/projekte/${p.id}/status`, { status: "storniert" });
  assert.deepEqual((await l(`kunde=${k3.id}&status=anfrage,bestaetigt`)).zeilen.map((z) => z.name), ["Winterfest"], "Gegenprobe: storniert ausgeschlossen");
  assert.equal((await l(`kunde=${k3.id}&status=storniert,anfrage`)).gesamt, 2, "Mehrfachauswahl");
  assert.equal((await l(`q=${p.nummer}`)).zeilen[0].id, p.id);
  assert.equal((await l("art=job&q=Einzeljob")).gesamt, 1);
  assert.equal((await l("von=1.1.2026")).zeilen, undefined);
  // Kopfkennzahlen
  const { rows: [a] } = await s.db.pool.query("INSERT INTO kategorie (name, praefix) VALUES ('Licht', 'LI') RETURNING id");
  const { rows: [art] } = await s.db.pool.query("INSERT INTO artikel (name, kategorie_id) VALUES ('PAR', $1) RETURNING id", [a.id]);
  await s.db.pool.query("INSERT INTO geraet (code, artikel_id, projekt_id, status) VALUES ('LI-0001', $1, $2, 'gepackt'), ('LI-0002', $1, $2, 'zugeordnet')", [art.id, p.id]);
  await buero("POST", `/api/v1/projekte/${p.id}/aufgaben`, { text: "Strom klären", faellig: "2020-01-01" });
  const d = (await buero("GET", `/api/v1/projekte/nummer/${p.nummer.toLowerCase()}`)).json;
  assert.deepEqual([d.kennzahlen.geraete, d.kennzahlen.gepackt, d.kennzahlen.aufgaben_offen, d.kennzahlen.aufgaben_ueberfaellig], [2, 1, 1, 1]);
  assert.equal(d.kennzahlen.beginn, "2026-07-01");
  assert.equal((await buero("GET", "/api/v1/projekte/nummer/P-1999-999")).status, 404);
});

test("FA-31 Duplizieren: Stammdaten, Jobs, offene Aufgaben; neue Nummer, Anfrage, (Kopie); ohne Termin und Material", async () => {
  const p = (await projekt({ name: "Weinfest", beginn: "2026-08-01", ort: "Marktplatz", notizen: "Jährlich" })).projekt;
  await buero("POST", `/api/v1/projekte/${p.id}/status`, { status: "bestaetigt" });
  await buero("POST", `/api/v1/projekte/${p.id}/jobs`, { gewerke: ["Ton"] });
  await buero("POST", `/api/v1/projekte/${p.id}/aufgaben`, { text: "Genehmigung" });
  const erl = (await buero("POST", `/api/v1/projekte/${p.id}/aufgaben`, { text: "Alt" })).json.aufgabe;
  await buero("PUT", `/api/v1/aufgaben/${erl.id}`, { erledigt: true });
  const k = (await buero("POST", `/api/v1/projekte/${p.id}/duplizieren`, {})).json.projekt;
  const d = (await buero("GET", `/api/v1/projekte/${k.id}`)).json;
  assert.notEqual(d.nummer, p.nummer);
  assert.deepEqual([d.name, d.status, d.beginn, d.ort, d.notizen, d.kunde_id], ["Weinfest (Kopie)", "anfrage", null, "Marktplatz", "Jährlich", kunde.id]);
  assert.deepEqual(d.jobs.map((j) => j.name), ["Weinfest – Ton"]);
  assert.deepEqual(d.aufgaben.map((a) => [a.text, a.erledigt]), [["Genehmigung", false]]);
  assert.equal(d.kennzahlen.geraete, 0);
});

test("FA-32 Aufgaben: anlegen, abhaken, löschen, Fälligkeit, Zuständiger; globale Liste meine/alle, überfällige zuerst", async () => {
  const p = (await projekt({ name: "Aufgabenprojekt" })).projekt;
  const ich = (await buero("GET", "/api/v1/ich")).json;
  const benutzer = (await buero("GET", "/api/v1/benutzer/auswahl")).json.zeilen;
  assert.ok(benutzer.some((b) => b.benutzername === "lager"));
  const lagerId = benutzer.find((b) => b.benutzername === "lager").id;
  const a1 = (await buero("POST", `/api/v1/projekte/${p.id}/aufgaben`, { text: "Später", faellig: "2099-01-01", zugewiesen_id: ich.id ?? ich.nutzer?.id })).json.aufgabe;
  const a2 = (await buero("POST", `/api/v1/projekte/${p.id}/aufgaben`, { text: "Überfällig", faellig: "2020-05-05", zugewiesen_id: a1.zugewiesen_id })).json.aufgabe;
  await buero("POST", `/api/v1/projekte/${p.id}/aufgaben`, { text: "Für Lager", zugewiesen_id: lagerId });
  assert.equal((await buero("POST", `/api/v1/projekte/${p.id}/aufgaben`, { text: " " })).json.felder.text, "Text fehlt. Bitte ausfüllen.");
  const meine = (await buero("GET", "/api/v1/aufgaben")).json.zeilen;
  assert.deepEqual(meine.map((a) => a.text), ["Überfällig", "Später"]);
  assert.equal(meine[0].ueberfaellig, true);
  assert.ok((await buero("GET", "/api/v1/aufgaben?filter=alle")).json.zeilen.some((a) => a.text === "Für Lager"));
  const e = await buero("PUT", `/api/v1/aufgaben/${a2.id}`, { erledigt: true });
  assert.ok(e.json.aufgabe.erledigt_am);
  assert.deepEqual((await buero("GET", "/api/v1/aufgaben")).json.zeilen.map((a) => a.text), ["Später"]);
  assert.equal((await buero("PUT", `/api/v1/aufgaben/${a2.id}`, { erledigt: false })).json.aufgabe.erledigt_am, null);
  assert.equal((await buero("DELETE", `/api/v1/aufgaben/${a1.id}`)).status, 200);
  assert.equal((await lager("POST", `/api/v1/projekte/${p.id}/aufgaben`, { text: "x" })).status, 403);
});

test("FA-33 T-24 Dateien: Typ- und Größenprüfung, Ablage im Projektordner, PDF inline, SVG nur Download, nosniff + Sandbox", async () => {
  const p = (await projekt({ name: "Dateiprojekt" })).projekt;
  const hoch = (name, inhalt, kat = "plan") => fetch(`${s.url}/api/v1/projekte/${p.id}/dateien?name=${encodeURIComponent(name)}&kategorie=${kat}&beschreibung=Test`,
    { method: "POST", headers: { Authorization: "Bearer " + buero.token, "Content-Type": "application/octet-stream" }, body: inhalt }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const pdf = await hoch("Bühnenplan.pdf", Buffer.from("%PDF-1.4 test"));
  assert.equal(pdf.status, 200, pdf.json.text);
  assert.ok(fs.existsSync(path.join(s.dataDir, p.ordner, "Dokumente", "Dateien", "Bühnenplan.pdf")));
  const zweit = await hoch("Bühnenplan.pdf", Buffer.from("%PDF-1.4 zwei"));
  assert.equal(zweit.json.datei.name, "Bühnenplan (2).pdf");
  const svg = await hoch("logo.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "foto");
  assert.equal((await hoch("tool.exe", Buffer.from("MZ"))).status, 400);
  assert.equal((await hoch("../../boese.pdf", Buffer.from("%PDF"))).json.datei.name, "boese.pdf");
  assert.equal((await hoch("leer.pdf", Buffer.alloc(0))).status, 400);
  const gross = await hoch("gross.zip", Buffer.alloc(50 * 1024 * 1024 + 1));
  assert.equal(gross.status, 413);
  const lade = (id, kopf = {}) => fetch(`${s.url}/api/v1/dateien/${id}`, { headers: { Authorization: "Bearer " + lager.token, ...kopf } });
  const r1 = await lade(pdf.json.datei.id);
  assert.equal(r1.headers.get("content-type"), "application/pdf");
  assert.match(r1.headers.get("content-disposition"), /^inline/);
  assert.equal(r1.headers.get("x-content-type-options"), "nosniff");
  assert.match(r1.headers.get("content-security-policy"), /sandbox/);
  assert.equal(await r1.text(), "%PDF-1.4 test");
  const r2 = await lade(svg.json.datei.id);
  assert.equal(r2.headers.get("content-type"), "application/octet-stream", "T-24: SVG nie inline");
  // ?download=1 erzwingt Download auch bei PDF; PNG inline; Lager (nur lesen) darf nicht hochladen
  assert.match((await lade(pdf.json.datei.id + "?download=1")).headers.get("content-disposition"), /^attachment/);
  const png = await hoch("foto.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "foto");
  const r3 = await lade(png.json.datei.id);
  assert.deepEqual([r3.headers.get("content-type"), r3.headers.get("content-disposition").split(";")[0]], ["image/png", "inline"]);
  const verboten = await fetch(`${s.url}/api/v1/projekte/${p.id}/dateien?name=x.pdf`, { method: "POST", headers: { Authorization: "Bearer " + lager.token }, body: Buffer.from("%PDF") });
  assert.equal(verboten.status, 403);
  // parallele Uploads mit gleichem Namen: beide bleiben erhalten
  const par = await Promise.all([1, 2, 3].map((i) => hoch("Rider.pdf", Buffer.from(`%PDF ${i}`))));
  assert.deepEqual(par.map((x) => x.json.datei.name).sort(), ["Rider (2).pdf", "Rider (3).pdf", "Rider.pdf"]);
  for (const x of par) assert.equal((await lade(x.json.datei.id)).status, 200);
  // Upload ohne Content-Length (chunked) über 50 MB wird beim Lesen abgebrochen
  const strom = new ReadableStream({ start(c) { for (let i = 0; i < 51; i++) c.enqueue(new Uint8Array(1024 * 1024)); c.close(); } });
  const chunk = await fetch(`${s.url}/api/v1/projekte/${p.id}/dateien?name=riesig.zip`, { method: "POST", headers: { Authorization: "Bearer " + buero.token }, body: strom, duplex: "half" });
  assert.equal(chunk.status, 413);
  assert.match(r2.headers.get("content-disposition"), /^attachment/);
  assert.match(r2.headers.get("content-security-policy"), /sandbox/);
  // nur aus dem Projektbereich ausliefern
  await s.db.pool.query("UPDATE projekt_datei SET pfad = '../../etc/passwd' WHERE id = $1", [svg.json.datei.id]);
  assert.ok([400, 403].includes((await lade(svg.json.datei.id)).status));
  const { rows: [log] } = await s.db.pool.query("SELECT count(*)::int AS n FROM sicherheit_ereignis WHERE art = 'download' AND text LIKE 'Projektdatei%'");
  assert.ok(log.n >= 2);
  assert.equal((await buero("DELETE", `/api/v1/dateien/${pdf.json.datei.id}`)).status, 200);
  assert.ok(!fs.existsSync(path.join(s.dataDir, p.ordner, "Dokumente", "Dateien", "Bühnenplan.pdf")));
  assert.equal((await buero("GET", `/api/v1/projekte/${p.id}`)).json.dateien.filter((d) => d.kategorie === "foto").length, 2);
});

test("FA-34 Kalender: Projekte im Zeitraum mit Status", async () => {
  const p = (await projekt({ name: "Kalenderfest", beginn: "2027-03-30", ende: "2027-04-02" })).projekt;
  const april = (await lager("GET", "/api/v1/kalender?von=2027-04-01&bis=2027-04-30")).json.zeilen;
  assert.ok(april.some((z) => z.id === p.id && z.status === "anfrage" && z.status_text === "Anfrage"));
  assert.ok(!(await lager("GET", "/api/v1/kalender?von=2027-05-01&bis=2027-05-31")).json.zeilen.some((z) => z.id === p.id));
  assert.equal((await lager("GET", "/api/v1/kalender?von=x&bis=y")).status, 400);
});
