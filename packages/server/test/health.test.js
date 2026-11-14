import { test } from "node:test";
import assert from "node:assert/strict";
import { starteTestServer } from "./helfer.js";

test("Gerüst: GET /health meldet Protokollversion, unbekannter Pfad 404 mit Ursache + nächstem Schritt", async () => {
  const s = await starteTestServer();
  try {
    const h = await s.api("GET", "/health");
    assert.equal(h.status, 200);
    assert.equal(h.json.ok, true);
    assert.equal(typeof h.json.protokoll, "number");
    const n = await s.api("GET", "/api/v1/gibtesnicht");
    assert.equal(n.status, 404);
    assert.match(n.json.fehler, /Prüfe/);
  } finally { await s.ende(); }
});
