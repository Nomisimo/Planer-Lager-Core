import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { WebSocket } from "ws";
import { starteTestServer } from "./helfer.js";

const verbinde = (url, token, abo) => new Promise((ok, nein) => {
  const ws = new WebSocket(url.replace("http", "ws") + "/ws");
  const nachrichten = [];
  ws.on("message", (m) => {
    const n = JSON.parse(String(m));
    nachrichten.push(n);
    if (n.typ === "hallo") { if (abo) ws.send(JSON.stringify({ typ: "abo", daten: abo })); setTimeout(() => ok({ ws, nachrichten }), 50); }
  });
  ws.on("open", () => ws.send(JSON.stringify({ typ: "anmelden", token })));
  ws.on("error", nein);
});
const warte = async (fn, ms = 3000) => { const ende = Date.now() + ms; while (Date.now() < ende) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };
const tcpSende = (port, text) => new Promise((ok, nein) => {
  const sock = net.connect(port, "127.0.0.1", () => sock.write(text));
  let antwort = "";
  sock.on("data", (d) => { antwort += d; if (antwort.split("\r\n").length > text.split(/\r?\n/).filter(Boolean).length) { sock.end(); ok(antwort); } });
  sock.on("error", nein);
});

test("ARCHITEKTUR §5 Netzwerk-Scanner: Verwaltung, HTTP-Push mit Token, TCP per Kennung und IP, Weiterleitung nur an Abonnenten", async () => {
  const s = await starteTestServer({ config: { scannerTcpPort: "auto", scannerTcpHost: "127.0.0.1" } });
  try {
    const admin = await s.als("admin4", "Administrator");
    const lager = await s.als("lager", "Lager / Techniker");
    const buero = await s.als("buero", "Büro / Disposition");
    // Verwaltung: nur Admin, Token nur einmal sichtbar
    assert.equal((await lager("GET", "/api/v1/verwaltung/scanner")).status, 403);
    const a = (await admin("POST", "/api/v1/verwaltung/scanner", { name: "Halle 1", kennung: "H1" })).json;
    assert.ok(a.token.length >= 30);
    const b = (await admin("POST", "/api/v1/verwaltung/scanner", { name: "Rampe", ip: "127.0.0.1" })).json;
    assert.equal((await admin("POST", "/api/v1/verwaltung/scanner", { name: "halle 1" })).status, 409);
    assert.equal((await admin("POST", "/api/v1/verwaltung/scanner", { name: "X", ip: "999.1.1.1" })).status, 400);
    const liste = (await admin("GET", "/api/v1/verwaltung/scanner")).json;
    assert.ok(liste.every((x) => !("token_hash" in x) && x.hat_token));
    assert.deepEqual((await lager("GET", "/api/v1/scanner/auswahl")).json.map((x) => x.name), ["Halle 1", "Rampe"]);

    const ws1 = await verbinde(s.url, lager.token, { scanner: a.scanner.id });
    const ws2 = await verbinde(s.url, buero.token, { scanner: b.scanner.id });
    // HTTP-Push
    assert.equal((await s.api("POST", "/api/v1/scanner/eingang", { code: "LI-0001" }, { Authorization: "Scanner falsch-falsch-falsch-falsch" })).status, 401);
    const h = await s.api("POST", "/api/v1/scanner/eingang", { code: "li1\r\n" }, { Authorization: `Scanner ${a.token}` });
    assert.equal(h.status, 200, h.text);
    assert.ok(await warte(() => ws1.nachrichten.some((n) => n.typ === "scanner.code" && n.code === "li1")));
    assert.ok(!ws2.nachrichten.some((n) => n.typ === "scanner.code"), "nur an Abonnenten dieses Scanners");
    // TCP: Kennungs-Präfix und Absender-IP
    await warte(() => s.gateway.port);
    const antw = await tcpSende(s.gateway.port, "H1:LI-0002\r\nLI-0003\n");
    assert.equal(antw, "OK\r\nOK\r\n");
    assert.ok(await warte(() => ws1.nachrichten.some((n) => n.code === "LI-0002")));
    assert.ok(await warte(() => ws2.nachrichten.some((n) => n.code === "LI-0003")), "per IP zugeordnet");
    const { rows: [x] } = await s.db.pool.query("SELECT letzter_code, letzter_kontakt FROM scanner WHERE id = $1", [b.scanner.id]);
    assert.equal(x.letzter_code, "LI-0003");
    assert.ok(x.letzter_kontakt);
    // Arbeitsplatz-Zuordnung: Abo per arbeitsplatz
    await admin("PUT", `/api/v1/verwaltung/scanner/${a.scanner.id}`, { arbeitsplatz_id: 5 });
    const ws3 = await verbinde(s.url, lager.token, { arbeitsplatz: 5 });
    await s.api("POST", "/api/v1/scanner/eingang", { token: a.token, code: "LI-0004" });
    assert.ok(await warte(() => ws3.nachrichten.some((n) => n.code === "LI-0004")));
    // neuer Token macht den alten ungültig; unbekannter TCP-Absender
    const t2 = (await admin("POST", `/api/v1/verwaltung/scanner/${a.scanner.id}/token`, {})).json.token;
    assert.equal((await s.api("POST", "/api/v1/scanner/eingang", { token: a.token, code: "X" })).status, 401);
    assert.equal((await s.api("POST", "/api/v1/scanner/eingang", { token: t2, code: "LI-0005" })).status, 200);
    await admin("PUT", `/api/v1/verwaltung/scanner/${b.scanner.id}`, { aktiv: false });
    assert.equal(await tcpSende(s.gateway.port, "LI-0006\n"), "FEHLER unbekannter Scanner\r\n");
    for (const w of [ws1, ws2, ws3]) w.ws.close();
  } finally { await s.ende(); }
});
