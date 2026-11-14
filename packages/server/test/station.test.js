import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

let s, admin, buero, zone, kunde, projekt;
const q = (sql, w) => s.db.pool.query(sql, w);
before(async () => {
  s = await starteTestServer();
  admin = await s.als("admin5", "Administrator");
  buero = await s.als("buero", "Büro / Disposition");
  zone = (await admin("POST", "/api/v1/verwaltung/zonen", { bezeichnung: "Zone A" })).json;
  kunde = (await buero("POST", "/api/v1/kunden", { name: "Anna Müller" })).json.kunde;
  projekt = (await buero("POST", "/api/v1/projekte", { name: "Stadtfest", kunde_id: kunde.id, beginn: "2027-05-01" })).json.projekt;
  await q("UPDATE projekt SET status = 'bestaetigt', ladezone_id = $1, zone_seit = now() WHERE id = $2", [zone.id, projekt.id]);
});
after(async () => { await s.ende(); });

/** Browser-Arbeitsplatz: Cookie + CSRF wie im echten Browser. */
async function richteEin(code) {
  const r = await s.api("POST", "/api/v1/station/einrichten", { code });
  if (r.status !== 200) return { r };
  const cookie = r.headers.get("set-cookie").split(";")[0];
  let csrf = null;
  const f = async (m, p, b) => { const x = await s.api(m, p, b, { Cookie: cookie, ...(csrf && m !== "GET" ? { "X-CSRF-Token": csrf } : {}) }); return x; };
  const z = await f("GET", "/api/v1/station/zustand");
  csrf = z.json.csrf;
  f.cookie = r.headers.get("set-cookie");
  return { r, f, z: z.json };
}

test("FA-25 Arbeitsplätze und Mitarbeiter verwalten (nur Admin); Einrichtungscode einmalig, Geräte-Sitzung langlebig", async () => {
  assert.equal((await buero("GET", "/api/v1/verwaltung/arbeitsplaetze")).status, 403);
  const f = (await admin("POST", "/api/v1/verwaltung/arbeitsplaetze", { name: "", art: "packen" })).json.felder;
  assert.deepEqual(Object.keys(f).sort(), ["ladezone_id", "name"]);
  const a = (await admin("POST", "/api/v1/verwaltung/arbeitsplaetze", { name: "Packplatz 1", art: "packen", ladezone_id: zone.id })).json;
  assert.match(a.code, /^[A-Z0-9]{10}$/);
  assert.equal((await admin("POST", "/api/v1/verwaltung/arbeitsplaetze", { name: "packplatz 1", art: "rueckgabe" })).status, 409);
  const { rows: [b] } = await q("SELECT b.benutzername, r.name AS rolle FROM arbeitsplatz a JOIN benutzer b ON b.id = a.benutzer_id JOIN rolle r ON r.id = b.rolle_id WHERE a.id = $1", [a.id]);
  assert.equal(b.rolle, "Lager-Arbeitsplatz");
  assert.equal((await richteEin("FALSCH1234")).r.status, 400);
  const e = await richteEin(a.code.toLowerCase().replace(/(.{5})/, "$1-"));
  assert.equal(e.r.status, 200, e.r.text);
  assert.match(e.f.cookie, /HttpOnly/);
  assert.match(e.f.cookie, /Max-Age=34560000/, "400 Tage");
  assert.equal((await richteEin(a.code)).r.status, 400, "Code nur einmal");
  assert.equal(e.z.arbeitsplatz.name, "Packplatz 1");
  assert.equal(e.z.gesperrt, true, "R-11a gesperrt, bis jemand entsperrt");
  assert.equal(e.z.projekt.nummer, projekt.nummer, "R-11e Startseite = Projekt der Zone");
  const l = (await admin("GET", "/api/v1/verwaltung/arbeitsplaetze")).json;
  assert.deepEqual([l[0].eingerichtet, l[0].gesperrt, l[0].ladezone], [true, true, "Zone A"]);
  // Mitarbeiter
  assert.equal((await admin("POST", "/api/v1/verwaltung/mitarbeiter", { name: "Lea", pin: "12" })).status, 400);
  const m = (await admin("POST", "/api/v1/verwaltung/mitarbeiter", { name: "Lea", pin: "4711" })).json;
  await admin("POST", "/api/v1/verwaltung/mitarbeiter", { name: "Tom" });
  const ml = (await admin("GET", "/api/v1/verwaltung/mitarbeiter")).json;
  assert.deepEqual(ml.map((x) => [x.name, x.pin]), [["Lea", true], ["Tom", false]]);
  assert.equal((await admin("PUT", `/api/v1/verwaltung/mitarbeiter/${m.id}`, { name: "Lea" })).json.ok, true);
  assert.equal((await admin("GET", "/api/v1/verwaltung/mitarbeiter")).json[0].pin, true, "PIN bleibt ohne Angabe");
  // Trennen beendet die Sitzung
  const neu = (await admin("POST", `/api/v1/verwaltung/arbeitsplaetze/${a.id}/einrichtung`, {})).json.code;
  const e2 = await richteEin(neu);
  await admin("POST", `/api/v1/verwaltung/arbeitsplaetze/${a.id}/trennen`, {});
  assert.equal((await e2.f("GET", "/api/v1/station/zustand")).status, 401);
});

test("T-16 R-11a R-11b R-11c R-11d R-11f Arbeitsplatz: gesperrt (423), Entsperren mit PIN, 5× falsch → 30 s, ERLAUBT-Muster, Sperrzeit, Mitarbeiter an Buchungen", async () => {
  const a = (await admin("POST", "/api/v1/verwaltung/arbeitsplaetze", { name: "Rückgabe", art: "rueckgabe", funktionstest: true, sperrzeit_minuten: 5 })).json;
  const { f } = await richteEin(a.code);
  const { rows: [lea] } = await q("SELECT id FROM mitarbeiter WHERE name = 'Lea'");
  const { rows: [tom] } = await q("SELECT id FROM mitarbeiter WHERE name = 'Tom'");
  // gesperrt: Scannen → 423, Sperrbildschirm-Seiten gehen
  const g = await f("POST", "/api/v1/scan", { code: "LI-0001", modus: "rueckgabe" });
  assert.equal(g.status, 423);
  assert.equal(g.json.gesperrt, true);
  const z = (await f("GET", "/api/v1/station/zustand")).json;
  assert.deepEqual(z.mitarbeiterListe.map((m) => [m.name, m.pin]), [["Lea", true], ["Tom", false]]);
  assert.equal(z.arbeitsplatz.funktionstest, true);
  // R-11c: 5 falsche PINs → 30 s Wartezeit, auch die richtige PIN geht dann nicht
  for (let i = 1; i <= 4; i++) {
    const r = await f("POST", "/api/v1/station/entsperren", { mitarbeiter: lea.id, pin: "0000" });
    assert.equal(r.status, 400);
    assert.match(r.json.text, new RegExp(`Noch ${5 - i} Versuch`));
  }
  const fuenf = await f("POST", "/api/v1/station/entsperren", { mitarbeiter: lea.id, pin: "0000" });
  assert.equal(fuenf.status, 429);
  assert.equal(fuenf.json.wartezeit, 30);
  const warte = await f("POST", "/api/v1/station/entsperren", { mitarbeiter: lea.id, pin: "4711" });
  assert.equal(warte.status, 429);
  assert.match(warte.json.text, /Warte noch \d+ Sekunden/);
  assert.equal((await q("SELECT count(*)::int AS n FROM sicherheit_ereignis WHERE text LIKE 'Falsche PIN%'")).rows[0].n, 5);
  await q("UPDATE arbeitsplatz SET gesperrt_bis = now() - interval '1 second' WHERE id = $1", [a.id]);
  const ok = await f("POST", "/api/v1/station/entsperren", { mitarbeiter: lea.id, pin: "4711" });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([ok.json.gesperrt, ok.json.mitarbeiter.name], [false, "Lea"]);
  // R-11d: Fremdseiten verweigert, erlaubte gehen
  const fremd = await f("GET", "/api/v1/kunden");
  assert.equal(fremd.status, 403);
  assert.equal(fremd.json.weiter, "/station");
  assert.equal((await f("GET", "/api/v1/verwaltung/arbeitsplaetze")).status, 403);
  assert.equal((await f("GET", `/api/v1/projekte/${projekt.id}/packstatus`)).status, 200);
  // R-11f: Buchung trägt den Mitarbeiter
  const kat = (await admin("POST", "/api/v1/kategorien", { name: "Licht", praefix: "LI" })).json;
  await admin("POST", "/api/v1/artikel", { name: "Spot", kategorie_id: kat.id, anzahl: 1, kennzeichnung: "qr" });
  await q("UPDATE geraet SET status = 'gepackt', projekt_id = $1, letzte_pruefung = (now() AT TIME ZONE 'Europe/Berlin')::date", [projekt.id]);
  const sc = await f("POST", "/api/v1/scan", { code: "LI-0001", modus: "rueckgabe" });
  assert.equal(sc.json.level, "ok", sc.text);
  const { rows: [bw] } = await q("SELECT benutzer, mitarbeiter FROM bewegung ORDER BY id DESC LIMIT 1");
  assert.equal(bw.mitarbeiter, "Lea");
  assert.match(bw.benutzer, /^arbeitsplatz-/);
  // R-11b: erlaubte Anfrage verlängert, Sperrbildschirm-Seiten nicht
  await q("UPDATE arbeitsplatz SET letzte_aktivitaet = now() - interval '4 minutes' WHERE id = $1", [a.id]);
  await f("GET", "/api/v1/station/zustand");
  assert.ok((await q("SELECT now() - letzte_aktivitaet > interval '3 minutes' AS alt FROM arbeitsplatz WHERE id = $1", [a.id])).rows[0].alt, "Zustand verlängert nicht");
  assert.equal((await f("GET", `/api/v1/projekte/${projekt.id}/rueckgabe`)).status, 200);
  assert.ok((await q("SELECT now() - letzte_aktivitaet < interval '5 seconds' AS neu FROM arbeitsplatz WHERE id = $1", [a.id])).rows[0].neu, "erlaubte Anfrage verlängert");
  // R-11d Zonen-Anzeige am Lagerplatz trotz Rolle ohne Bereich anzeige
  assert.equal((await f("GET", "/api/v1/anzeige/zonen")).status, 200);
  // abgeschalteter Platz: verständliche Meldung statt Abmeldung
  await admin("PUT", `/api/v1/verwaltung/arbeitsplaetze/${a.id}`, { name: "Rückgabe", art: "rueckgabe", funktionstest: true, sperrzeit_minuten: 5, aktiv: false });
  const aus = await f("GET", "/api/v1/station/zustand");
  assert.equal(aus.status, 403);
  assert.match(aus.json.text, /abgeschaltet/);
  await admin("PUT", `/api/v1/verwaltung/arbeitsplaetze/${a.id}`, { name: "Rückgabe", art: "rueckgabe", funktionstest: true, sperrzeit_minuten: 5, aktiv: true });
  await f("POST", "/api/v1/station/entsperren", { mitarbeiter: lea.id, pin: "4711" });
  // R-11b: nach Sperrzeit ohne Eingabe gesperrt
  await q("UPDATE arbeitsplatz SET letzte_aktivitaet = now() - interval '6 minutes' WHERE id = $1", [a.id]);
  assert.equal((await f("POST", "/api/v1/scan", { code: "LI-0001", modus: "rueckgabe" })).status, 423);
  assert.equal((await q("SELECT mitarbeiter_id FROM arbeitsplatz WHERE id = $1", [a.id])).rows[0].mitarbeiter_id, null);
  // Mitarbeiter ohne PIN; Sperren per Knopf
  assert.equal((await f("POST", "/api/v1/station/entsperren", { mitarbeiter: tom.id })).json.mitarbeiter.name, "Tom");
  assert.equal((await f("POST", "/api/v1/station/sperren", {})).json.gesperrt, true);
  // CSRF für Cookie-Sitzung Pflicht
  const ohne = await s.api("POST", "/api/v1/station/sperren", {}, { Cookie: f.cookie.split(";")[0] });
  assert.equal(ohne.status, 403);
});

test("R-59 Anzeige-Bildschirm als Arbeitsplatz der Art „anzeige“: nie gesperrt, sieht nur die Anzeige", async () => {
  const a = (await admin("POST", "/api/v1/verwaltung/arbeitsplaetze", { name: "TV Halle", art: "anzeige" })).json;
  const { f, z } = await richteEin(a.code);
  assert.equal(z.gesperrt, false);
  const r = await f("GET", "/api/v1/anzeige/zonen");
  assert.equal(r.status, 200);
  assert.equal(r.json.zonen[0].projekte[0].nummer, projekt.nummer);
  assert.equal((await f("POST", "/api/v1/scan", { code: "LI-0001", modus: "rueckgabe" })).status, 403);
  // Arbeitsplatz löschen entfernt das Konto
  assert.equal((await admin("DELETE", `/api/v1/verwaltung/arbeitsplaetze/${a.id}`)).json.ok, true);
  assert.equal((await f("GET", "/api/v1/anzeige/zonen")).status, 401);
});
