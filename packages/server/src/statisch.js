// Auslieferung von station-web (UI-8): index.html ohne Cache, Assets mit Hash im Namen dauerhaft cachebar.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpFehler } from "./router.js";

export const STATION_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "station-web", "dist");
const TYPEN = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".mp3": "audio/mpeg" };
const SEITEN_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; media-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

export function statischModul(router, { config }) {
  const dist = config?.stationDist || STATION_DIST;
  const seite = (ctx) => {
    const datei = path.join(dist, "index.html");
    if (!fs.existsSync(datei)) throw new HttpFehler(503, "Die Arbeitsplatz-Oberfläche ist noch nicht gebaut. Der Admin muss den Server neu bauen.");
    ctx.res.writeHead(200, { "Content-Type": TYPEN[".html"], "Cache-Control": "no-store", "Content-Security-Policy": SEITEN_CSP });
    ctx.res.end(fs.readFileSync(datei));
  };
  router.get("/", { oeffentlich: true }, seite);
  router.get("/station", { oeffentlich: true }, seite);
  router.get("/anzeige", { oeffentlich: true }, seite);
  router.get("/login", { oeffentlich: true }, seite);
  // R-11 (D-18): /admin… leitet auf die Anmeldeseite.
  router.get("/admin", { oeffentlich: true }, (ctx) => { ctx.res.writeHead(302, { Location: "/login" }); ctx.res.end(); });
  router.get("/admin/login", { oeffentlich: true }, (ctx) => { ctx.res.writeHead(302, { Location: "/login" }); ctx.res.end(); });
  router.get("/assets/:datei", { oeffentlich: true }, (ctx) => {
    const name = ctx.params.datei;
    if (!/^[\w.-]+\.[0-9a-f]{12}\.(js|css)$|^[\w.-]+\.(svg|png|mp3)$/.test(name)) throw new HttpFehler(404, "Datei nicht gefunden. Lade die Seite neu.");
    const p = path.join(dist, name);
    if (!fs.existsSync(p)) throw new HttpFehler(404, "Datei nicht gefunden. Lade die Seite neu.");
    ctx.res.writeHead(200, { "Content-Type": TYPEN[path.extname(name)] || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" });
    ctx.res.end(fs.readFileSync(p));
  });
}
