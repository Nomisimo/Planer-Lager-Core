// REMOTE (ZUSATZ.md Phase S): API-Tests gegen den echten Testserver. Laufen in der Claude-VM (npm run e2e:remote) und
// im GitHub-Runner (remote-test.yml, dort mit echter TLS-Prüfung). Tests für „nicht angemeldet → 401“ laufen lokal
// (der Proxy der VM hängt den Test-Token an jede Anfrage).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { WebSocket } from "ws";
import { URL_REMOTE, OHNE, TLS_DIREKT, rufe, admin, alsWeb, zaehler } from "./remote-helfer.js";

const host = URL_REMOTE ? new URL(URL_REMOTE).hostname : "";
const MARKER = path.join(import.meta.dirname, "..", "artefakte", "remote-neustart.json");
const NACH_NEUSTART = process.env.LAGER_REMOTE_NACH_NEUSTART === "1";

test("REMOTE-01 /health mit Commit, gültiges Zertifikat, HSTS und Schutz-Header, HTTP → HTTPS", { skip: OHNE || NACH_NEUSTART }, async () => {
  const h = await rufe("GET", "/health");
  assert.equal(h.status, 200);
  assert.equal(h.json.ok, true);
  assert.equal(h.json.testsystem, true);
  assert.match(String(h.json.commit), /^[0-9a-f]{7}$/);
  if (process.env.LAGER_REMOTE_COMMIT) assert.equal(h.json.commit, process.env.LAGER_REMOTE_COMMIT.slice(0, 7));
  for (const [k, v] of [...(URL_REMOTE.startsWith("https://") ? [["strict-transport-security", /max-age=31536000/]] : []), ["x-content-type-options", /nosniff/], ["x-frame-options", /DENY/],
    ["referrer-policy", /same-origin/], ["content-security-policy", /default-src 'self'/], ["x-robots-tag", /noindex/], ["cross-origin-opener-policy", /same-origin/]])
    assert.match(String(h.headers.get(k)), v, `Header ${k}`);
  if (URL_REMOTE.startsWith("https://")) assert.equal(h.headers.get("server"), null, "Caddy verrät keinen Server-Namen");
  if (URL_REMOTE.startsWith("http://")) return; // nur Probelauf gegen einen lokalen Server
  // Zertifikat: im Runner echt (Let's Encrypt), in der VM bricht der Proxy TLS auf
  const zert = await new Promise((ok, nein) => {
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true }, () => { ok(s.getPeerCertificate()); s.end(); });
    s.on("error", nein);
  });
  assert.ok(new Date(zert.valid_to) > new Date(Date.now() + 7 * 864e5), `Zertifikat läuft bald ab: ${zert.valid_to}`);
  if (TLS_DIREKT) {
    assert.match(`${zert.issuer?.O} ${zert.issuer?.CN}`, /Let's Encrypt|^\S+ (R|E)\d+$/, `Aussteller ${JSON.stringify(zert.issuer)}`);
    assert.ok(String(zert.subjectaltname).includes(host));
  }
  // HTTP → HTTPS
  const http = await fetch(`http://${host}/health`, { redirect: "manual" });
  assert.ok([301, 302, 307, 308].includes(http.status), `HTTP antwortet ${http.status}`);
  assert.equal(http.headers.get("location"), `https://${host}/health`);
});

test("REMOTE-02 Login mit Testbenutzer, wss://…/ws durch Caddy, Live-Event in unter 2 s", { skip: OHNE || NACH_NEUSTART }, async () => {
  const buero = await alsWeb("Büro / Disposition");
  const ich = await buero("GET", "/api/v1/ich");
  assert.equal(ich.json.nutzer.benutzername, buero.benutzer.benutzername, "Cookie geht vor dem Test-Token");
  const lager = await alsWeb("Lagerleitung");
  const ws = new WebSocket(`${URL_REMOTE.replace(/^http/, "ws")}/ws`, { headers: { Cookie: lager.cookie, Origin: URL_REMOTE } });
  const nachrichten = [];
  ws.on("message", (d) => { try { nachrichten.push({ zeit: Date.now(), ...JSON.parse(String(d)) }); } catch { /* egal */ } });
  await new Promise((ok, nein) => { ws.once("open", ok); ws.once("error", nein); });
  try {
    await new Promise((r) => setTimeout(r, 500)); // Anmeldung am Hub
    const start = Date.now();
    const k = await buero("POST", "/api/v1/kunden", { name: `REMOTE-02 ${start}`, trotzdem: true });
    assert.equal(k.status, 200, k.text);
    const id = (k.json.kunde || k.json).id;
    let ev = null;
    while (!ev && Date.now() - start < 2000) { ev = nachrichten.find((n) => n.typ === "kunde.geaendert" && n.id === id); if (!ev) await new Promise((r) => setTimeout(r, 25)); }
    assert.ok(ev, `kein Live-Event in 2 s (erhalten: ${nachrichten.map((n) => n.typ).join(", ")})`);
    assert.ok(ev.zeit - start < 2000);
    await buero("DELETE", `/api/v1/kunden/${id}`);
  } finally { ws.close(); }
});

test("REMOTE-03 Portal, beide Web-Apps, Arbeitsplatz und Anzeige werden ausgeliefert, Assets cachebar, CSP gesetzt", { skip: OHNE || NACH_NEUSTART }, async () => {
  for (const p of ["/", "/materialplaner/", "/productionplaner/", "/station", "/anzeige"]) {
    const r = await rufe("GET", p);
    assert.equal(r.status, 200, `${p} → ${r.status}`);
    assert.match(String(r.headers.get("content-type")), /text\/html/);
    assert.match(String(r.headers.get("cache-control")), /no-store/, `${p} ohne no-store`);
    assert.match(String(r.headers.get("content-security-policy")), /script-src 'self'/, `${p} ohne CSP`);
    assert.doesNotMatch(r.text, /<script>(?!<\/script>)/, `${p} mit Inline-Script`);
    const assets = [...r.text.matchAll(/(?:src|href)="([^"]+\.[0-9a-f]{12}\.(?:js|css))"/g)].map((m) => new URL(m[1], URL_REMOTE + p).pathname);
    if (p !== "/") assert.ok(assets.length, `${p}: keine gehashten Assets`);
    for (const a of assets) {
      const x = await rufe("GET", a);
      assert.equal(x.status, 200, a);
      assert.match(String(x.headers.get("cache-control")), /max-age=31536000.*immutable|immutable.*max-age=31536000/, `${a} nicht dauerhaft cachebar`);
    }
  }
  const robots = await rufe("GET", "/robots.txt");
  assert.match(robots.text, /Disallow: \//);
});

test("REMOTE-07 Nach dem Zurücksetzen nur Demo-Daten, Band TESTSYSTEM", { skip: OHNE || NACH_NEUSTART, timeout: 180000 }, async () => {
  await admin("POST", "/api/v1/kunden", { name: "REMOTE-07 eigener Kunde", trotzdem: true });
  const r = await admin("POST", "/api/v1/test/zuruecksetzen", {});
  assert.equal(r.ok, true);
  const kunden = (await admin("GET", "/api/v1/kunden?limit=500")).zeilen.map((k) => k.name);
  assert.ok(!kunden.includes("REMOTE-07 eigener Kunde"));
  assert.ok(kunden.includes("Jana Becker"), "Demo-Kunde fehlt");
  const projekte = (await admin("GET", "/api/v1/projekte?limit=500")).zeilen.map((p) => p.name);
  assert.ok(projekte.includes("Stadtfest Neustadt"));
  const sys = await admin("GET", "/api/v1/verwaltung/system");
  assert.ok(sys.beispiel > 0, "Beispieldaten markiert");
  assert.match((await rufe("GET", "/")).text, /TESTSYSTEM – nur Beispieldaten/);
  assert.equal((await rufe("GET", "/health")).json.testsystem, true);
});

test("REMOTE-06 Last: 20 parallele Scans auf verschiedene Geräte unter 1 s, keine Doppelbuchung", { skip: OHNE || NACH_NEUSTART, timeout: 120000 }, async () => {
  const lager = await alsWeb("Lager / Techniker");
  const projekt = (await admin("GET", "/api/v1/projekte?limit=500")).zeilen.find((p) => p.name === "Hochzeit Schneider");
  const geraete = (await admin("GET", "/api/v1/geraete?status=lager&limit=500")).zeilen.filter((g) => !g.case_id).slice(0, 21);
  assert.ok(geraete.length >= 21, `nur ${geraete.length} Geräte im Lager`);
  const scan = async (code) => { const t = Date.now(); const r = await lager("POST", "/api/v1/scan", { code, modus: "packen", projekt: projekt.id }); return { ...r, ms: Date.now() - t, code }; };
  const ergebnisse = await Promise.all(geraete.slice(0, 20).map((g) => scan(g.code)));
  for (const e of ergebnisse) {
    assert.equal(e.status, 200, `${e.code}: ${e.text}`);
    assert.notEqual(e.json.level, "error", `${e.code}: ${e.json.text}`);
    assert.ok(e.ms < 1000, `${e.code} brauchte ${e.ms} ms`);
  }
  // Derselbe Code zweimal gleichzeitig: genau einmal gepackt
  const doppelt = await Promise.all([scan(geraete[20].code), scan(geraete[20].code)]);
  const schon = (e) => (e.json?.meldungen || []).some((m) => /ist schon gepackt/.test(m.text));
  assert.equal(doppelt.filter((e) => e.status === 200 && !schon(e)).length, 1, JSON.stringify(doppelt.map((e) => e.json)));
  assert.equal(doppelt.filter(schon).length, 1, "der zweite Scan meldet „ist schon gepackt“");
  const stand = await admin("GET", `/api/v1/projekte/${projekt.id}/packstatus`);
  const codes = stand.geraete.map((g) => g.code);
  assert.equal(new Set(codes).size, codes.length, "kein Gerät doppelt im Projekt");
  for (const g of geraete) assert.ok(codes.includes(g.code), `${g.code} fehlt im Projekt`);
});

test("REMOTE-05 Sicherung prüfen; Wiederherstellung nach dem Zurücksetzen ergibt dieselben Zähler", { skip: OHNE || NACH_NEUSTART, timeout: 300000 }, async () => {
  await admin("POST", "/api/v1/kunden", { name: "REMOTE-05 Kunde vor der Sicherung", trotzdem: true });
  const vorher = await zaehler();
  const s = await admin("POST", "/api/v1/verwaltung/sicherungen", {});
  assert.equal(s.ok, true, s.text);
  assert.equal((await admin("POST", `/api/v1/verwaltung/sicherungen/${s.name}/pruefen`, {})).ok, true);
  await admin("POST", "/api/v1/test/zuruecksetzen", {});
  assert.notDeepEqual(await zaehler(), vorher, "Zurücksetzen hat etwas geändert");
  const w = await admin("POST", `/api/v1/verwaltung/sicherungen/${s.name}/wiederherstellen`, { bestaetigung: "WIEDERHERSTELLEN" });
  assert.equal(w.ok, true, w.text);
  assert.deepEqual(await zaehler(), vorher);
  assert.ok((await admin("GET", "/api/v1/kunden?limit=500&q=REMOTE-05")).zeilen.some((k) => k.name === "REMOTE-05 Kunde vor der Sicherung"));
});

test("REMOTE-08 Neustart (wartung-test.yml neustart): Daten bleiben erhalten", { skip: OHNE }, async () => {
  if (!NACH_NEUSTART) {
    // Schritt 1: Merker anlegen. Danach: Actions › Wartung Testserver › neustart, dann mit LAGER_REMOTE_NACH_NEUSTART=1 erneut.
    const name = `REMOTE-08 Merker ${Date.now()}`;
    const k = await admin("POST", "/api/v1/kunden", { name, trotzdem: true });
    const sys = await admin("GET", "/api/v1/verwaltung/system");
    fs.mkdirSync(path.dirname(MARKER), { recursive: true });
    fs.writeFileSync(MARKER, JSON.stringify({ name, id: (k.kunde || k).id, laeuftSeit: sys.laeuft_seit, zaehler: await zaehler() }));
    return;
  }
  const m = JSON.parse(fs.readFileSync(MARKER, "utf8"));
  const sys = await admin("GET", "/api/v1/verwaltung/system");
  assert.ok(new Date(sys.laeuft_seit) > new Date(m.laeuftSeit), `Server lief seit ${sys.laeuft_seit}, vorher ${m.laeuftSeit}: kein Neustart`);
  assert.ok((await admin("GET", "/api/v1/kunden?limit=500&q=REMOTE-08")).zeilen.some((k) => k.name === m.name), "Merker nach dem Neustart weg");
  assert.deepEqual(await zaehler(), m.zaehler);
});
