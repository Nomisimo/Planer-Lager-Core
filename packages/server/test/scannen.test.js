import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, admin, buero, lager, platz, kunde, kat, akku, lampe, tasche;
const q = (sql, w) => s.db.pool.query(sql, w);
before(async () => {
  s = await starteTestServer();
  admin = await s.als("admin3", "Administrator");
  buero = await s.als("buero", "Büro / Disposition");
  lager = await s.als("lager", "Lager / Techniker");
  platz = await s.als("anzeige", "Anzeige (Bildschirm)");
  kunde = (await buero("POST", "/api/v1/kunden", { name: "Anna Müller" })).json.kunde;
  kat = (await admin("POST", "/api/v1/kategorien", { name: "Licht", praefix: "LI" })).json;
  const art = async (w, anzahl = 0) => (await admin("POST", "/api/v1/artikel", { kategorie_id: kat.id, anzahl, kennzeichnung: anzahl ? "qr" : "keine", ...w })).json.artikel;
  akku = await art({ name: "Akku", preis_tag: 500 }, 6);
  lampe = await art({ name: "Lampe", preis_tag: 300, mengenschritt: 4 }, 8);
  tasche = await art({ name: "Lampen-Tasche", art: "case", ist_case: true, inhalt_artikel_id: lampe.id }, 2);
  await q("UPDATE geraet SET letzte_pruefung = (now() AT TIME ZONE 'Europe/Berlin')::date");
});
after(async () => { await s.ende(); });

const codes = async (artikelId) => (await q("SELECT code FROM geraet WHERE artikel_id = $1 ORDER BY code", [artikelId])).rows.map((r) => r.code);
const projekt = async (name, w = {}) => (await buero("POST", "/api/v1/projekte", { name, kunde_id: kunde.id, beginn: "2027-05-01", ende: "2027-05-02", ...w })).json.projekt;
const scan = (code, modus, projektId, extra = {}) => lager("POST", "/api/v1/scan", { code, modus, projekt: projektId, ...extra });
async function mitAngebot(p, positionen, status = "angenommen") {
  const a = (await buero("POST", "/api/v1/angebote", { projekt_id: p.id })).json.angebot;
  await buero("PUT", `/api/v1/angebote/${a.id}`, { positionen: positionen.map((x) => ({ art: "miete", tage: 1, einzelpreis: 100, ...x })) });
  if (status !== "entwurf") await buero("POST", `/api/v1/angebote/${a.id}/status`, { status: "versendet" });
  if (status === "angenommen") await buero("POST", `/api/v1/angebote/${a.id}/status`, { status: "angenommen" });
  return a;
}

test("R-SCAN 5.5 Schritte 1–3: Code-Normalisierung (R-22), alte Prüf-ID, unbekannt, bestellt (R-70), Modus, Projektpflicht; Rechte", async () => {
  const p = await projekt("Basis");
  const [c1] = await codes(akku.id);
  await q("UPDATE geraet SET alte_pruef_id = 'BEN-4711' WHERE code = $1", [c1]);
  const r = await scan(`li${Number(c1.slice(3))}`, "hinzufuegen", p.id);
  assert.equal(r.status, 200);
  assert.equal(r.json.level, "ok");
  assert.equal(r.json.code, c1);
  assert.equal((await scan("ben-4711", "hinzufuegen", p.id)).json.code, c1, "alte Prüf-ID ohne Schreibweise");
  assert.match((await scan("ZZ-9999", "packen", p.id)).json.text, /keinem Gerät zugeordnet/);
  const b = (await admin("POST", "/api/v1/etiketten/bestellungen", { positionen: [{ artikel_id: akku.id, menge: 1 }] })).json;
  const bestellt = b.bestellung?.codes?.[0]?.code || (await q("SELECT code FROM etikett_code WHERE geliefert_am IS NULL LIMIT 1")).rows[0].code;
  const rb = (await scan(bestellt, "packen", p.id)).json;
  assert.equal(rb.level, "error");
  assert.match(rb.text, /EB-\d{4}-\d{3}/);
  assert.match((await scan(c1, "egal", p.id)).json.text, /Unbekannter Modus/);
  assert.equal((await scan(c1, "packen", null)).json.text, "Bitte zuerst ein Projekt wählen.");
  assert.equal((await platz("POST", "/api/v1/scan", { code: c1, modus: "packen", projekt: p.id })).status, 403);
});

test("R-23 Projektcode beim Scannen öffnet die Packansicht (weiter)", async () => {
  const p = await projekt("Sprung");
  const r = (await scan(p.nummer.toLowerCase().replace(/-0*/g, " "), "packen", null)).json;
  assert.equal(r.projekt.id, p.id);
  assert.equal(r.weiter, `/projekte/${p.id}/packen`);
});

test("T-07 R-52 FA-19 Alle Geräte der Packliste packen: alle grün, Packliste vollständig, Status Gepackt", async () => {
  const p = await projekt("Packen");
  await mitAngebot(p, [{ artikel_id: akku.id, menge: 2 }]);
  const [a1, a2] = await codes(akku.id);
  await q("UPDATE geraet SET projekt_id = NULL, status = 'lager' WHERE code = ANY($1)", [[a1, a2]]);
  for (const c of [a1, a2]) {
    const r = (await scan(c, "packen", p.id)).json;
    assert.equal(r.level, "ok", JSON.stringify(r));
    assert.match(r.text, new RegExp(`^${c} Akku – Gepackt$`));
  }
  const st = (await lager("GET", `/api/v1/projekte/${p.id}/packstatus`)).json;
  assert.equal(st.vollstaendig, true);
  assert.equal(st.fortschritt, 100);
  assert.deepEqual(st.zeilen.map((z) => [z.artikel, z.soll, z.gepackt, z.fertig]), [["Akku", 2, 2, true]]);
  const { rows } = await q("SELECT status FROM geraet WHERE code = ANY($1)", [[a1, a2]]);
  assert.ok(rows.every((x) => x.status === "gepackt"));
  const bew = (await q("SELECT aktion FROM bewegung b JOIN geraet g ON g.id = b.geraet_id WHERE g.code = $1 ORDER BY b.id DESC LIMIT 1", [a1])).rows[0];
  assert.equal(bew.aktion, `Gepackt: ${p.nummer}`, "R-18 Bewegung");
  // 9. mehr als im Angebot → gelb, trotzdem gebucht; doppelter Scan (D-62)
  const [, , a3] = await codes(akku.id);
  await q("UPDATE geraet SET projekt_id = NULL, status = 'lager' WHERE code = $1", [a3]);
  const mehr = (await scan(a3, "packen", p.id)).json;
  assert.equal(mehr.level, "warn");
  assert.match(mehr.meldungen.map((m) => m.text).join(" "), /Akku: 3 gepackt, aber nur 2 im Angebot/);
  const doppelt = (await scan(a1, "packen", p.id)).json;
  assert.equal(doppelt.level, "warn");
  assert.match(doppelt.meldungen[0].text, /schon gepackt/);
  // nicht in der Packliste
  const [l9] = (await codes(lampe.id)).slice(-1);
  assert.match((await scan(l9, "hinzufuegen", p.id)).json.meldungen.map((m) => m.text).join(" "), /Lampe steht nicht in der Packliste/);
});

test("T-08 Case voll → grün inkl. Inhalte; zu wenig/falsch → Gelb", async () => {
  const p = await projekt("Case2");
  const [t1, t2] = await codes(tasche.id);
  const lampen = await codes(lampe.id);
  const [a6] = (await codes(akku.id)).slice(-1);
  const id = async (c) => (await q("SELECT id FROM geraet WHERE code = $1", [c])).rows[0].id;
  await q("UPDATE geraet SET case_id = NULL, projekt_id = NULL, status = 'lager'");
  await q("UPDATE geraet SET case_id = $1 WHERE code = ANY($2)", [await id(t1), lampen.slice(0, 4)]);
  const voll = (await scan(t1, "packen", p.id)).json;
  assert.equal(voll.level, "ok", JSON.stringify(voll.meldungen));
  assert.match(voll.text, /Gepackt \(inkl\. 4 Inhalte\)/);
  const { rows } = await q("SELECT count(*)::int AS n FROM geraet WHERE projekt_id = $1 AND status = 'gepackt'", [p.id]);
  assert.equal(rows[0].n, 5);
  await q("UPDATE geraet SET case_id = $1 WHERE code = ANY($2)", [await id(t2), [...lampen.slice(4, 6), a6]]);
  const p2 = await projekt("Case3");
  const halb = (await scan(t2, "hinzufuegen", p2.id)).json;
  assert.equal(halb.level, "warn");
  const t = halb.meldungen.map((m) => m.text).join(" ");
  assert.match(t, /Case unvollständig: 3 von 4 Teilen eingetragen/);
  assert.match(t, new RegExp(`Falscher Inhalt in ${t2}: ${a6} \\(Akku\\)`));
  // Inhalt gesperrt oder in anderem Projekt → nur Gelb, Rest wird gebucht
  await q("UPDATE geraet SET projekt_id = NULL, status = 'lager' WHERE case_id = $1 OR id = $1", [await id(t1)]);
  await q("UPDATE geraet SET status = 'defekt' WHERE code = $1", [lampen[0]]);
  await q("UPDATE geraet SET projekt_id = $1, status = 'zugeordnet' WHERE code = $2", [p2.id, lampen[1]]);
  const p3 = await projekt("Case4");
  const teil = (await scan(t1, "packen", p3.id)).json;
  assert.equal(teil.level, "warn");
  const tt = teil.meldungen.map((m) => m.text).join(" ");
  assert.match(tt, new RegExp(`${lampen[0]} nicht verfügbar \\(Defekt\\), übersprungen`));
  assert.match(tt, new RegExp(`${lampen[1]} ist bereits in Projekt ${p2.nummer}`));
  assert.match(teil.text, /inkl\. 2 Inhalte/);
  await q("UPDATE geraet SET status = 'lager' WHERE code = $1", [lampen[0]]);
});

test("T-09 Gerät aus anderem Projekt scannen: Rot, nicht gebucht, Meldung nennt das andere Projekt", async () => {
  const p1 = await projekt("Erstes");
  const p2 = await projekt("Zweites");
  const [c] = await codes(akku.id);
  await q("UPDATE geraet SET case_id = NULL, projekt_id = NULL, status = 'lager' WHERE code = $1", [c]);
  assert.equal((await scan(c, "packen", p1.id)).json.level, "ok");
  const r = (await scan(c, "packen", p2.id)).json;
  assert.equal(r.level, "error");
  assert.match(r.text, /nicht gebucht/);
  assert.match(r.meldungen[0].text, new RegExp(`bereits in Projekt ${p1.nummer} Erstes`));
  assert.equal((await q("SELECT projekt_id FROM geraet WHERE code = $1", [c])).rows[0].projekt_id, p1.id);
  // gesperrt (defekt) → rot
  const [d] = (await codes(akku.id)).slice(1);
  await q("UPDATE geraet SET status = 'defekt', projekt_id = NULL WHERE code = $1", [d]);
  const rd = (await scan(d, "packen", p2.id)).json;
  assert.equal(rd.level, "error");
  assert.match(rd.meldungen[0].text, /nicht verfügbar \(Defekt\)/);
  await q("UPDATE geraet SET status = 'lager' WHERE code = $1", [d]);
});

test("T-10 Gerät mit überfälliger/fehlender Prüfung packen: Gelb mit Prüfungshinweis, trotzdem gebucht", async () => {
  const p = await projekt("Prüfung");
  const [, , , c, c2] = await codes(akku.id);
  await q("UPDATE geraet SET projekt_id = NULL, status = 'lager', letzte_pruefung = '2020-01-01' WHERE code = $1", [c]);
  await q("UPDATE geraet SET projekt_id = NULL, status = 'lager', letzte_pruefung = NULL WHERE code = $1", [c2]);
  const r = (await scan(c, "packen", p.id)).json;
  assert.equal(r.level, "warn");
  assert.match(r.meldungen.map((m) => m.text).join(" "), new RegExp(`${c}: Prüfung überfällig!`));
  assert.equal((await q("SELECT status FROM geraet WHERE code = $1", [c])).rows[0].status, "gepackt");
  assert.match((await scan(c2, "packen", p.id)).json.meldungen.map((m) => m.text).join(" "), /Prüfung fehlt!/);
});

test("T-11 R-60 R-14 R-57 Packen abgeschlossen & verladen; R-61 wieder öffnen", async () => {
  const p = await projekt("Verladen");
  await mitAngebot(p, [{ artikel_id: akku.id, menge: 1 }]);
  assert.equal((await buero("GET", `/api/v1/projekte/${p.id}`)).json.status, "bestaetigt");
  await q("UPDATE projekt SET ladezone_id = 7, zone_seit = now() WHERE id = $1", [p.id]);
  const r = await lager("POST", `/api/v1/projekte/${p.id}/verladen`, {});
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.text, /Ladezone frei.*Läuft/);
  const { rows: [x] } = await q("SELECT status, gepackt_am, gepackt_von_name, ladezone_id, zone_seit FROM projekt WHERE id = $1", [p.id]);
  assert.equal(x.status, "laeuft");
  assert.ok(x.gepackt_am);
  assert.equal(x.gepackt_von_name, "lager");
  assert.equal(x.ladezone_id, null);
  assert.equal(x.zone_seit, null);
  const o = await lager("POST", `/api/v1/projekte/${p.id}/packen-oeffnen`, {});
  assert.equal(o.status, 200);
  const { rows: [y] } = await q("SELECT status, gepackt_am, gepackt_von_name FROM projekt WHERE id = $1", [p.id]);
  assert.deepEqual([y.status, y.gepackt_am, y.gepackt_von_name], ["laeuft", null, ""], "R-61 Status bleibt");
});

test("5.5 Rückgabe: zurück im Lager, vermisst → wieder aufgetaucht (T-14); Tasche zuerst, dann Inhalt mit Wechsel (R-46, T-12)", async () => {
  const p = await projekt("Rückgabe");
  await q("UPDATE geraet SET case_id = NULL, projekt_id = NULL, status = 'lager'");
  const [t1, t2] = await codes(tasche.id);
  const lampen = await codes(lampe.id);
  const id = async (c) => (await q("SELECT id FROM geraet WHERE code = $1", [c])).rows[0].id;
  await q("UPDATE geraet SET case_id = $1 WHERE code = ANY($2)", [await id(t1), lampen.slice(0, 4)]);
  await q("UPDATE geraet SET case_id = $1 WHERE code = ANY($2)", [await id(t2), [lampen[4]]]);
  await scan(t1, "packen", p.id);
  await scan(lampen[4], "packen", p.id);
  const rt = (await scan(t1, "rueckgabe", null)).json;
  assert.match(rt.text, new RegExp(`${t1} Lampen-Tasche – Zurück im Lager – jetzt die 4 Teile \\(Lampe\\) darin scannen`));
  assert.deepEqual([rt.tasche.code, rt.tasche.anzahl, rt.tasche.soll, rt.tasche.offen.length], [t1, 4, 4, 4]);
  const r1 = (await scan(lampen[0], "rueckgabe", null, { tasche: t1 })).json;
  assert.equal(r1.level, "ok");
  assert.equal(r1.tasche.offen.length, 3);
  // Wechsel aus anderer Tasche → Gelb + Bewegung
  const w = (await scan(lampen[4], "rueckgabe", null, { tasche: t1 })).json;
  assert.equal(w.level, "warn");
  assert.match(w.meldungen.map((m) => m.text).join(" "), new RegExp(`lag in ${t2} und ist jetzt in ${t1}\\. ${t2} hat jetzt 0 Teile.*${t1} hat jetzt 5 Teile, Soll sind 4`));
  const bew = (await q("SELECT aktion FROM bewegung WHERE geraet_id = $1 ORDER BY id DESC LIMIT 1", [await id(lampen[4])])).rows[0].aktion;
  assert.equal(bew, `Tasche gewechselt: ${t2} -> ${t1}`);
  // passt nicht
  const [ak] = await codes(akku.id);
  await scan(ak, "packen", p.id);
  assert.match((await scan(ak, "rueckgabe", null, { tasche: t1 })).json.meldungen[0].text, /passt nicht in/);
  // T-13/R-48/R-49: Offene als vermisst
  const v = (await lager("POST", "/api/v1/vermisst", { codes: rt.tasche.offen.slice(1), tasche: t1 })).json;
  assert.equal(v.gemeldet.length, 3);
  const { rows: vm } = await q("SELECT status, projekt_id, case_id FROM geraet WHERE code = ANY($1)", [v.gemeldet]);
  assert.ok(vm.every((g) => g.status === "vermisst" && g.projekt_id === p.id && g.case_id === null), "bleibt am Projekt, aus der Tasche");
  const vb = (await q("SELECT aktion FROM bewegung WHERE geraet_id = $1 ORDER BY id DESC LIMIT 1", [await id(v.gemeldet[0])])).rows[0].aktion;
  assert.equal(vb, `Als vermisst gemeldet, Projekt ${p.nummer}, zuletzt in ${t1}`);
  assert.deepEqual((await lager("POST", "/api/v1/vermisst", { codes: v.gemeldet })).json.gemeldet, [], "doppelt ändert nichts");
  // T-14: vermisst zurückgescannt
  const wa = (await scan(v.gemeldet[0], "rueckgabe", null)).json;
  assert.equal(wa.level, "warn");
  assert.match(wa.meldungen[0].text, /wieder aufgetaucht/);
  assert.equal((await q("SELECT status FROM geraet WHERE code = $1", [v.gemeldet[0]])).rows[0].status, "lager");
});

test("T-15 R-47 Funktionstest: bestanden → Bewegung; Mangel → Defekt, Notiz mit Datum, nicht mehr packbar; 404", async () => {
  const [c] = await codes(akku.id);
  await q("UPDATE geraet SET status = 'lager', projekt_id = NULL WHERE code = $1", [c]);
  const ok = await lager("POST", "/api/v1/pruefung", { code: c, ergebnis: "ok" });
  assert.deepEqual([ok.json.ok, ok.json.status], [true, "lager"]);
  assert.equal((await lager("POST", "/api/v1/pruefung", { code: c, ergebnis: "mangel" })).status, 400, "Notiz Pflicht");
  const m = (await lager("POST", "/api/v1/pruefung", { code: c, ergebnis: "mangel", notiz: "Kabel lose" })).json;
  assert.equal(m.status, "defekt");
  const { rows: [g] } = await q("SELECT status, notizen FROM geraet WHERE code = $1", [c]);
  assert.match(g.notizen, /^\d{2}\.\d{2}\.\d{4}: Mangel bei Rückgabe: Kabel lose$/m);
  const p = await projekt("Defekt");
  assert.equal((await scan(c, "packen", p.id)).json.level, "error");
  assert.equal((await lager("POST", "/api/v1/pruefung", { code: "XX-0001", ergebnis: "ok" })).status, 404);
  await q("UPDATE geraet SET status = 'lager', notizen = '' WHERE code = $1", [c]);
});
