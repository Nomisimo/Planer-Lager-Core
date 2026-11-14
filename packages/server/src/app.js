// HTTP-Server (node:http, kein Framework). Baut Router, Kontext und Fehlerbehandlung zusammen.
import http from "node:http";
import { Router, HttpFehler } from "./router.js";

export const PROTOKOLL_VERSION = 1;
const MAX_BODY = 25 * 1024 * 1024;

/** JSON-Antwort mit Sicherheits-Grundheadern. */
export function sendeJson(res, status, daten, kopf = {}) {
  const body = JSON.stringify(daten);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...kopf });
  res.end(body);
}

async function leseBody(req) {
  const teile = [];
  let laenge = 0;
  for await (const t of req) {
    laenge += t.length;
    if (laenge > MAX_BODY) throw new HttpFehler(413, "Die Daten sind zu groß. Verkleinere die Datei und versuche es erneut.");
    teile.push(t);
  }
  return Buffer.concat(teile);
}

/**
 * @param {{pool: import("pg").Pool, config?: object, module?: ((r: Router, d: object) => void)[]}} deps
 */
export function erstelleApp(deps) {
  const router = new Router();
  const kontext = { ...deps, router };
  router.get("/health", { oeffentlich: true }, () => ({ ok: true, protokoll: PROTOKOLL_VERSION, zeit: new Date().toISOString() }));
  for (const m of deps.module || []) m(router, kontext);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://x");
    try {
      const fund = router.finde(req.method || "GET", url.pathname);
      if (!("route" in fund)) {
        throw new HttpFehler(fund.pfadBekannt ? 405 : 404, fund.pfadBekannt
          ? "Diese Aktion ist hier nicht möglich."
          : "Diese Seite gibt es nicht. Prüfe die Adresse.");
      }
      const { route, params } = fund;
      let body = null;
      if (req.method !== "GET" && req.method !== "HEAD") {
        const roh = await leseBody(req);
        const typ = String(req.headers["content-type"] || "");
        if (typ.includes("application/json") && roh.length) {
          try { body = JSON.parse(roh.toString("utf8")); } catch { throw new HttpFehler(400, "Die Anfrage ist fehlerhaft. Lade die Seite neu."); }
        } else body = roh;
      }
      const ctx = { ...kontext, req, res, url, params, query: Object.fromEntries(url.searchParams), body, route, nutzer: null };
      if (deps.pruefeZugang) await deps.pruefeZugang(ctx);
      const erg = await route.handler(ctx);
      if (res.writableEnded || res.headersSent) return;
      if (erg === undefined) { res.writeHead(204); res.end(); return; }
      sendeJson(res, 200, erg);
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof HttpFehler) return sendeJson(res, e.status, { fehler: e.message, ...(e.extra || {}) });
      console.error("[server]", e);
      sendeJson(res, 500, { fehler: "Interner Fehler auf dem Server. Versuche es gleich noch einmal oder melde es dem Admin." });
    }
  });
  return { server, router, kontext };
}
