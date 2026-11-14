import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { starteTestServer } from "./helfer.js";
import { hintergrundLauf, regelnAusfuehren, isoWoche } from "../src/benachrichtigungen.js";
import { sendeMail } from "../src/mail.js";
import { heuteIso } from "@lager/domain";

let s, buero, lager, leitung, kunde, art, tech;
const q = (sql, w) => s.db.pool.query(sql, w);
const plus = (n) => { const d = new Date(`${heuteIso()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Mini-SMTP-Server für Tests: nimmt Mails an und merkt sie. */
function fakeSmtp() {
  const mails = [];
  const server = net.createServer((sock) => {
    let daten = false, puffer = "", mail = { an: "", text: "" };
    sock.write("220 test ESMTP\r\n");
    sock.on("data", (d) => {
      puffer += d.toString();
      let i;
      while ((i = puffer.indexOf("\r\n")) >= 0) {
        const z = puffer.slice(0, i); puffer = puffer.slice(i + 2);
        if (daten) { if (z === ".") { daten = false; mails.push(mail); mail = { an: "", text: "" }; sock.write("250 OK\r\n"); } else mail.text += z + "\n"; continue; }
        if (/^EHLO/i.test(z)) sock.write("250-test\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH/i.test(z)) sock.write("235 ok\r\n");
        else if (/^MAIL/i.test(z)) sock.write("250 ok\r\n");
        else if (/^RCPT/i.test(z)) { mail.an = z.match(/<(.*)>/)[1]; sock.write("250 ok\r\n"); }
        else if (/^DATA/i.test(z)) { daten = true; sock.write("354 go\r\n"); }
        else if (/^QUIT/i.test(z)) { sock.write("221 bye\r\n"); sock.end(); }
        else sock.write("500 ?\r\n");
      }
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, mails, port: server.address().port })));
}

before(async () => {
  s = await starteTestServer();
  buero = await s.als("buero", "Büro / Disposition");
  lager = await s.als("lager", "Lager / Techniker");
  leitung = await s.als("leitung", "Lagerleitung");
  kunde = (await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id")).rows[0].id;
  const kat = (await q("INSERT INTO kategorie (name, praefix) VALUES ('Licht', 'LI') RETURNING id")).rows[0].id;
  art = (await q("INSERT INTO artikel (name, kategorie_id, preis_tag) VALUES ('Spot', $1, 1500) RETURNING id", [kat])).rows[0].id;
  tech = (await q("INSERT INTO artikel (name, kategorie_id, preis_tag, aktiv) VALUES ('Alt', $1, 100, false) RETURNING id", [kat])).rows[0].id;
});
after(() => s?.ende());

test("FA-39 Projektvorlage anlegen, beim Projekt anwenden: Aufgaben mit Termin vor Beginn, Angebot mit Positionen und Preisen", async () => {
  const leer = await buero("POST", "/api/v1/projektvorlagen", { name: "" });
  assert.equal(leer.status, 400);
  const v = await buero("POST", "/api/v1/projektvorlagen", { name: "Hochzeit klein", veranstaltung: "Hochzeit",
    aufgaben: [{ text: "Location besichtigen", tage_vorher: 14 }, { text: "Abbau prüfen", tage_vorher: -1 }, { text: "Rechnung schreiben" }],
    positionen: [{ artikel_id: art, menge: 8 }, { artikel_id: tech, menge: 1 }] });
  assert.equal(v.status, 200, v.text);
  assert.equal((await buero("POST", "/api/v1/projektvorlagen", { name: "hochzeit KLEIN" })).status, 409);
  const r = await buero("POST", "/api/v1/projekte", { name: "Hochzeit Meier", kunde_id: kunde, beginn: "2027-06-20", ende: "2027-06-21", vorlage_id: v.json.id });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.text, /Vorlage „Hochzeit klein“ angewendet: 3 Aufgabe\(n\), Angebot A-\d{4}-\d{3} mit 2 Position\(en\)\./);
  const pid = r.json.projekt.id;
  const { rows: auf } = await q("SELECT text, faellig FROM aufgabe WHERE projekt_id = $1 ORDER BY faellig NULLS LAST", [pid]);
  assert.deepEqual(auf.map((a) => [a.text, a.faellig]), [["Location besichtigen", "2027-06-06"], ["Abbau prüfen", "2027-06-21"], ["Rechnung schreiben", null]]);
  const { rows: pos } = await q("SELECT ap.menge::float8 AS menge, ap.einzelpreis, ap.art FROM angebot_position ap JOIN angebot a ON a.id = ap.angebot_id WHERE a.projekt_id = $1", [pid]);
  assert.deepEqual(pos, [{ menge: 8, einzelpreis: 1500, art: "miete" }], "inaktiver Artikel fällt weg, Preis aus Artikel");
  const { rows: [an] } = await q("SELECT summe_netto FROM angebot WHERE projekt_id = $1", [pid]);
  assert.ok(an.summe_netto > 0, "Summe gerechnet");
  // Vorlage aus bestehendem Projekt speichern
  const aus = await buero("POST", "/api/v1/projektvorlagen", { name: "Wie Meier", aus_projekt_id: pid });
  const d = (await buero("GET", `/api/v1/projektvorlagen/${aus.json.id}`)).json;
  assert.deepEqual(d.aufgaben.map((a) => a.tage_vorher), [14, -1, null]);
  assert.deepEqual(d.positionen.map((p) => [p.artikel, p.menge]), [["Spot", 8]]);
  // Lager darf keine Vorlagen
  assert.equal((await lager("POST", "/api/v1/projektvorlagen", { name: "X" })).status, 403);
});

test("FA-40 Wiederkehrende Aufgabe: legt Aufgaben im Rhythmus an, ohne Doppelte; allgemeine Aufgabe ohne Projekt", async () => {
  const lagerId = (await q("SELECT id FROM benutzer WHERE benutzername = 'lager'")).rows[0].id;
  const r = await buero("POST", "/api/v1/aufgaben-regeln", { text: "Akkus laden", rhythmus: "woechentlich", naechste: heuteIso(), zugewiesen_id: lagerId });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.text, /wöchentlich\)\. Die erste Aufgabe steht schon in der Liste\./);
  assert.equal(await regelnAusfuehren(s.db.pool), 0, "nicht doppelt");
  assert.equal(await regelnAusfuehren(s.db.pool, plus(7)), 1, "nächste Woche die nächste");
  const meine = (await lager("GET", "/api/v1/aufgaben?filter=meine")).json.zeilen.filter((a) => a.text === "Akkus laden");
  assert.equal(meine.length, 2);
  assert.ok(meine.every((a) => a.regel_id && a.projekt_id === null));
  const regeln = (await buero("GET", "/api/v1/aufgaben-regeln")).json.zeilen;
  assert.equal(regeln[0].naechste, plus(14));
  assert.equal(regeln[0].rhythmus_text, "wöchentlich");
  assert.equal((await buero("POST", "/api/v1/aufgaben-regeln", { text: "x", rhythmus: "stündlich", naechste: heuteIso() })).status, 400);
  const allg = await buero("POST", "/api/v1/aufgaben", { text: "Werkstatt aufräumen", faellig: heuteIso() });
  assert.equal(allg.status, 200);
  assert.equal(allg.json.aufgabe.projekt_id, null);
});

test("FA-40 Benachrichtigungen: Frist, Prüfung, Überbuchung in der App, per E-Mail, ohne Doppelte; gelesen markieren", async () => {
  const smtp = await fakeSmtp();
  try {
    const config = { smtp: { host: "127.0.0.1", port: smtp.port, tls: "aus", von: "lager@test.de" } };
    await q("UPDATE benutzer SET email = 'lars@test.de' WHERE benutzername = 'lager'");
    await q("UPDATE benutzer SET email = 'lea@test.de', mail_benachrichtigung = false WHERE benutzername = 'leitung'");
    const g = (await q("INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ('LI-0001', $1, (now() - interval '13 months')::date) RETURNING id", [art])).rows[0];
    assert.ok(g.id);
    const r1 = await hintergrundLauf(s.db.pool, config, null);
    assert.ok(r1.meldungen >= 2, JSON.stringify(r1));
    const l = (await lager("GET", "/api/v1/benachrichtigungen")).json;
    const titel = l.zeilen.map((n) => n.titel);
    assert.ok(titel.includes("Fällig heute: Akkus laden"), titel.join(" | "));
    assert.ok(l.zeilen.every((n) => n.art === "frist"), "Lager hat kein Recht Geräte ändern → keine Prüfmeldung");
    const le = (await leitung("GET", "/api/v1/benachrichtigungen")).json;
    assert.equal(le.zeilen.find((n) => n.art === "pruefung").titel, "1 Gerät(e) zur Prüfung");
    assert.equal(smtp.mails.length, l.zeilen.length, "nur Lars will E-Mails");
    assert.equal(smtp.mails[0].an, "lars@test.de");
    assert.match(Buffer.from(smtp.mails[0].text.split("\n\n").slice(1).join("").replace(/\n/g, ""), "base64").toString(), /Akkus laden/);
    // zweiter Lauf: nichts doppelt
    const r2 = await hintergrundLauf(s.db.pool, config, null);
    assert.equal(r2.meldungen, 0);
    assert.equal(smtp.mails.length, l.zeilen.length);
    // gelesen
    assert.ok(l.ungelesen >= 1);
    await lager("POST", "/api/v1/benachrichtigungen/gelesen", {});
    assert.equal((await lager("GET", "/api/v1/benachrichtigungen")).json.ungelesen, 0);
    assert.equal((await lager("PUT", "/api/v1/benachrichtigungen/mail", { an: false })).status, 200);
    assert.equal((await q("SELECT mail_benachrichtigung FROM benutzer WHERE benutzername = 'lager'")).rows[0].mail_benachrichtigung, false);
    // Überbuchung: Angebot über Bestand → alle anderen mit Recht „Angebote ändern“
    const p = (await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-050', 'projekt', 'Messe', $1, 'bestaetigt', '2027-08-01') RETURNING id", [kunde])).rows[0].id;
    const admin = await s.als("chefin", "Administrator");
    const a = (await buero("POST", "/api/v1/angebote", { projekt_id: p })).json.angebot;
    const put = await buero("PUT", `/api/v1/angebote/${a.id}`, { positionen: [{ art: "miete", artikel_id: art, menge: 5, einzelpreis: 1500 }] });
    assert.equal(put.json.level, "warning", put.text);
    const an = (await admin("GET", "/api/v1/benachrichtigungen")).json.zeilen.find((n) => n.art === "ueberbuchung");
    assert.equal(an.titel, `Überbuchung in ${a.nummer}`);
    assert.equal(an.pfad, `/angebote/${a.id}`);
    assert.equal((await buero("GET", "/api/v1/benachrichtigungen")).json.zeilen.filter((n) => n.art === "ueberbuchung").length, 0, "nicht an sich selbst");
  } finally { smtp.server.close(); }
});

test("FA-40 SMTP-Fehler bleibt sichtbar, ISO-Woche", async () => {
  await assert.rejects(sendeMail({ host: "127.0.0.1", port: 1, tls: "aus", von: "a@b.de", timeoutMs: 2000 }, { an: "x@y.de", betreff: "t", text: "t" }));
  await assert.rejects(sendeMail({ host: "127.0.0.1", port: 1, tls: "aus", von: "a@b.de" }, { an: "kaputt", betreff: "t", text: "t" }), /Ungültige E-Mail-Adresse/);
  assert.equal(isoWoche("2026-11-14"), "2026-W46");
  assert.equal(isoWoche("2027-01-01"), "2026-W53");
});
