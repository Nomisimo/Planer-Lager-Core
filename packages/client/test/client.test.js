import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { erstelleApi, ApiFehler, qs } from "../src/api.js";
import { Live } from "../src/live.js";
import { starteTestServer } from "../../server/test/helfer.js";

test("Client: API mit Token, Fehler als ApiFehler mit UI-5-Text, Live-Ereignis kommt an", async () => {
  const s = await starteTestServer();
  try {
    const admin = await s.als("admin");
    let abgemeldet = false;
    const api = erstelleApi({ basis: s.url, token: () => admin.token, beiAbmeldung: () => { abgemeldet = true; } });
    assert.equal((await api.get("/api/v1/ich")).nutzer.benutzername, "admin");
    await assert.rejects(api.put("/api/v1/verwaltung/einstellungen", { angebot_gueltig_tage: -1 }), (e) => e instanceof ApiFehler && e.status === 400 && !!e.felder);
    const ohne = erstelleApi({ basis: s.url, beiAbmeldung: () => { abgemeldet = true; } });
    await assert.rejects(ohne.get("/api/v1/ich"));
    assert.equal(abgemeldet, true);
    const live = new Live({ basis: s.url, token: () => admin.token, WebSocketImpl: WebSocket }).start();
    const ereignisse = [];
    live.on("einstellungen", (e) => ereignisse.push(e.typ));
    await new Promise((r) => { const u = live.onStatus((st) => { if (st === "verbunden") { r(); setTimeout(() => u()); } }); });
    await api.put("/api/v1/verwaltung/einstellungen", { angebot_gueltig_tage: 15 });
    for (let i = 0; i < 50 && !ereignisse.length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(ereignisse, ["einstellungen.geaendert"]);
    live.stopp();
    assert.equal(qs({ a: 1, b: "", c: null, d: "x y" }), "?a=1&d=x+y");
  } finally { await s.ende(); }
});
