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

test("NFA-01 Schutz-Header auf jeder Antwort (CSP frame-ancestors none, nosniff, Referrer-, Permissions-Policy, no-store)", async () => {
  const s = await starteTestServer({ config: { hsts: true } });
  try {
    for (const p of ["/health", "/api/v1/ich", "/gibtsnicht"]) {
      const r = await s.api("GET", p);
      assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
      assert.equal(r.headers.get("referrer-policy"), "same-origin");
      assert.match(r.headers.get("permissions-policy"), /camera=\(self\)/);
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.match(r.headers.get("strict-transport-security"), /max-age=/);
    }
  } finally { await s.ende(); }
});
