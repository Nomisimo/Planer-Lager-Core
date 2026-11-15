// HTTP-Server (node:http, kein Framework). Baut Router, Kontext und Fehlerbehandlung zusammen.
import http from "node:http";
import { Router, HttpFehler } from "./router.js";
import { mitWer, werText } from "./aenderungen.js";
import { TEXT_FASSUNG_FEHLT } from "./fassung.js";

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
/** Schutz-Header (NFA-01, NFA-02) für jede Antwort. Seiten-CSP setzt station-web selbst strenger/lockerer. */
export function setzeSchutzHeader(res, config = {}) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (config.hsts) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (config.testModus) res.setHeader("X-Robots-Tag", "noindex, nofollow"); // Phase S: Testsystem nicht in Suchmaschinen
}

/** Einfaches Rate-Limit je Adresse (gleitendes Minutenfenster). */
export function erstelleRateLimit(maxProMinute = 600) {
  const fenster = new Map();
  return (ip) => {
    const jetzt = Date.now();
    let e = fenster.get(ip);
    if (!e || jetzt - e.start > 60_000) { e = { start: jetzt, n: 0 }; fenster.set(ip, e); }
    e.n++;
    if (fenster.size > 10_000) for (const [k, v] of fenster) if (jetzt - v.start > 60_000) fenster.delete(k);
    return e.n <= maxProMinute;
  };
}

export function erstelleApp(deps) {
  const router = new Router();
  const kontext = { ...deps, router };
  router.get("/health", { oeffentlich: true }, () => ({ ok: true, protokoll: PROTOKOLL_VERSION, zeit: new Date().toISOString(),
    version: process.env.LAGER_VERSION || undefined, commit: process.env.LAGER_COMMIT || undefined, ...(deps.config?.testModus ? { testsystem: true } : {}) }));
  for (const m of deps.module || []) m(router, kontext);

  const limit = erstelleRateLimit(deps.config?.rateLimit || 600);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://x");
    setzeSchutzHeader(res, deps.config);
    try {
      // NFA-02 ALLOWED_HOSTS: nur bekannte Hostnamen (Schutz vor Host-Header-Tricks); localhost für Healthcheck
      const hosts = deps.config?.erlaubteHosts;
      if (hosts?.length) {
        const h = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
        if (!["localhost", "127.0.0.1", ...hosts].includes(h)) throw new HttpFehler(400, "Unbekannter Hostname. Rufe den Server über seine eingetragene Adresse auf.");
      }
      // Rate-Limit je echter Absender-Adresse (hinter Caddy aus X-Forwarded-For)
      const absender = (deps.config?.vertraueProxy && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "";
      if (!limit(absender)) throw new HttpFehler(429, "Zu viele Anfragen in kurzer Zeit. Warte eine Minute und versuche es erneut.");
      const fund = router.finde(req.method || "GET", url.pathname);
      if (!("route" in fund)) {
        throw new HttpFehler(fund.pfadBekannt ? 405 : 404, fund.pfadBekannt
          ? "Diese Aktion ist hier nicht möglich."
          : "Diese Seite gibt es nicht. Prüfe die Adresse.");
      }
      const { route, params } = fund;
      let body = null;
      if (req.method !== "GET" && req.method !== "HEAD" && !route.stream) { // stream: Handler liest selbst (Uploads)
        const roh = await leseBody(req);
        const typ = String(req.headers["content-type"] || "");
        if (typ.includes("application/json") && roh.length) {
          try { body = JSON.parse(roh.toString("utf8")); } catch { throw new HttpFehler(400, "Die Anfrage ist fehlerhaft. Lade die Seite neu."); }
        } else body = roh;
      }
      const ctx = { ...kontext, req, res, url, params, query: Object.fromEntries(url.searchParams), body, route, nutzer: null };
      if (deps.pruefeZugang) await deps.pruefeZugang(ctx);
      // GLEICH-07: jedes Speichern (PUT/PATCH) schickt die Fassung mit, sonst 428 – außer bei Routen mit ohneVersion (Begründung).
      if ((req.method === "PUT" || req.method === "PATCH") && !route.ohneVersion && (body?.version === undefined || body?.version === null))
        throw new HttpFehler(428, TEXT_FASSUNG_FEHLT, { ok: false, level: "error", text: TEXT_FASSUNG_FEHLT });
      if (ctx.nutzer) ctx.pool = mitWer(deps.pool, () => werText(ctx)); // FA-55: wer im Änderungsprotokoll
      // GLEICH: Live-Ereignisse tragen, wer geändert hat (Änderungsband „<Name> hat das gerade geändert“).
      if (ctx.nutzer && kontext.hub) { const h = kontext.hub; ctx.hub = Object.assign(Object.create(h), { sende: (ev, f) => h.sende({ von: werText(ctx), ...ev }, f) }); }
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
