import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { starteTestServer } from "./helfer.js";

const verbinde = (url, token) => new Promise((ok, nein) => {
  const ws = new WebSocket(url.replace("http", "ws") + "/ws");
  const nachrichten = [];
  ws.on("message", (m) => nachrichten.push(JSON.parse(String(m))));
  ws.on("open", () => { ws.send(JSON.stringify({ typ: "anmelden", token })); });
  ws.on("error", nein);
  const warte = setInterval(() => { if (nachrichten.some((n) => n.typ === "hallo")) { clearInterval(warte); ok({ ws, nachrichten }); } }, 10);
  ws.on("close", (code) => { clearInterval(warte); ok({ ws, nachrichten, code }); });
});

test("Live-Events: WebSocket nur angemeldet, Ereignis nur an Nutzer mit Leserecht auf den Bereich", async () => {
  const s = await starteTestServer();
  try {
    const admin = await s.als("admin");
    const lager = await s.als("lager", "Lager / Techniker");
    const anzeige = await s.als("tv", "Anzeige (Bildschirm)");
    const falsch = await verbinde(s.url, "ungueltig");
    assert.equal(falsch.code, 4401);
    const a = await verbinde(s.url, admin.token);
    const l = await verbinde(s.url, lager.token);
    const t = await verbinde(s.url, anzeige.token);
    s.hub.sende({ typ: "geraet.geaendert", id: 7, version: 2, bereich: "geraete" });
    s.hub.sende({ typ: "zone.geaendert", id: 1, bereich: "anzeige" });
    await new Promise((r) => setTimeout(r, 150));
    const typen = (c) => c.nachrichten.filter((n) => n.typ !== "hallo").map((n) => n.typ);
    assert.deepEqual(typen(a), ["geraet.geaendert", "zone.geaendert"]);
    assert.deepEqual(typen(l), ["geraet.geaendert"]);
    assert.deepEqual(typen(t), ["zone.geaendert"]);
    // Einstellungen speichern sendet Event an alle (Bereich start)
    await admin("PUT", "/api/v1/verwaltung/einstellungen", { angebot_gueltig_tage: 20 });
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(typen(t).includes("einstellungen.geaendert"));
    for (const c of [a, l, t]) c.ws.close();
  } finally { await s.ende(); }
});
