import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
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

test("NFA-02 FA-56 Netzbetrieb: nur erlaubte Hostnamen, HSTS + Secure-Cookie bei https, Rate-Limit je echter Adresse hinter dem Proxy", async () => {
  const { configAusEnv } = await import("../src/config.js");
  const c = configAusEnv({ PUBLIC_URL: "https://lager.example.de", LAGER_HINTER_PROXY: "1" });
  assert.deepEqual(c.erlaubteHosts, ["lager.example.de"]);
  assert.equal(c.hsts && c.secureCookies && c.imNetz, true);
  assert.deepEqual(configAusEnv({}).erlaubteHosts, [], "lokal ohne Prüfung");
  const s = await starteTestServer({ config: { erlaubteHosts: ["lager.example.de"], hsts: true, vertraueProxy: true, rateLimit: 3 } });
  try {
    const mit = (host, ip) => new Promise((ok, fehl) => { // fetch erlaubt keinen eigenen Host-Header
      const u = new URL(`${s.url}/health`);
      const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, headers: { Host: host, "X-Forwarded-For": ip } }, (res) => {
        res.resume(); res.on("end", () => ok({ status: res.statusCode, headers: { get: (k) => res.headers[k] } }));
      });
      r.on("error", fehl); r.end();
    });
    const ok = await mit("lager.example.de", "1.1.1.1");
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("strict-transport-security"), /max-age=31536000/);
    assert.equal((await mit("boese.example", "1.1.1.2")).status, 400, "fremder Host abgewiesen");
    for (let i = 0; i < 2; i++) await mit("lager.example.de", "1.1.1.1");
    assert.equal((await mit("lager.example.de", "1.1.1.1")).status, 429, "4. Anfrage derselben Adresse");
    assert.equal((await mit("lager.example.de", "2.2.2.2")).status, 200, "andere Adresse hinter demselben Proxy nicht betroffen");
  } finally { await s.ende(); }
});
