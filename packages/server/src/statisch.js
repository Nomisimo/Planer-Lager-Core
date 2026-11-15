// Auslieferung von station-web (UI-8) und der Browser-Versionen beider Apps (ARCHITEKTUR §10, WEB-14/15):
// index.html ohne Cache, Assets mit Hash im Namen dauerhaft cachebar, strenge CSP. Portal unter / (WEB-10).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpFehler } from "./router.js";
import { darf } from "@lager/domain/rechte.js";
import { TEST_BAND } from "./testmodus.js";

const HIER = path.dirname(fileURLToPath(import.meta.url));
export const STATION_DIST = path.join(HIER, "..", "..", "station-web", "dist");
/** Standardort der Web-Bundles (Docker: /app/web/<app>), sonst WEB_APPS_DIR. */
export const WEB_APPS_STANDARD = path.join(HIER, "..", "..", "..", "web");
const TYPEN = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".mp3": "audio/mpeg", ".webmanifest": "application/manifest+json; charset=utf-8", ".json": "application/json; charset=utf-8" };
const SEITEN_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; media-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

/** Die beiden Web-Apps. `bereiche`: wer mindestens einen davon lesen darf, sieht die Kachel im Portal (WEB-10). */
export const WEB_APPS = Object.freeze([
  { id: "materialplaner", titel: "Materialplaner", text: "Material, Geräte, Etiketten, Packen, Rückgabe, Ladezonen",
    bereiche: ["material", "geraete", "packen", "zonen", "verwaltung"] },
  { id: "productionplaner", titel: "Productionplaner", text: "Kunden, Projekte, Angebote, Aufgaben, Kalender, Planungszeit",
    bereiche: ["kunden", "projekte", "angebote", "zeiten", "zeitrechner", "verwaltung"] },
]);
export const appsFuer = (nutzer) => WEB_APPS.filter((a) => nutzer?.admin || a.bereiche.some((b) => darf(nutzer?.rechte, b, "r")));

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Portal: reines HTML ohne Script (CSP), Kacheln nach Rechten. */
function portalHtml(nutzer, testsystem = false) {
  const kachel = (href, titel, text, testid) => `<a class="k" href="${href}" data-testid="${testid}"><strong>${esc(titel)}</strong><span>${esc(text)}</span></a>`;
  const apps = nutzer ? appsFuer(nutzer) : WEB_APPS;
  const kacheln = apps.map((a) => kachel(`/${a.id}/`, a.titel, a.text, `kachel-${a.id}`));
  if (!nutzer || nutzer.admin) kacheln.push(kachel("/station", "Arbeitsplatz", "Lager-Arbeitsplatz oder Anzeige-Bildschirm einrichten", "kachel-station"));
  const kopf = nutzer ? `Angemeldet als ${esc(nutzer.name || nutzer.benutzername)} (${esc(nutzer.rolle)}).` : "Wähle eine App. Du meldest dich dort einmal an, danach gilt die Anmeldung für beide Apps.";
  const leer = nutzer && !kacheln.length ? `<p class="h">Deine Rolle hat keinen Zugriff auf eine der Apps. Bitte einen Administrator, dir Rechte zu geben.</p>` : "";
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Planer-Lager</title>
<style>:root{color-scheme:light dark}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#15191e;color:#e7ebef}main{max-width:880px;margin:0 auto;padding:48px 20px}
h1{margin:0 0 4px;font-size:26px}.h{color:#a9b3bd;margin:0 0 24px}.r{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.k{display:flex;flex-direction:column;gap:6px;padding:18px;border-radius:10px;background:#1f252c;border:1px solid #2e3741;color:inherit;text-decoration:none}
.k:hover,.k:focus{border-color:#d1665c;outline:none}.k strong{font-size:17px}.k span{color:#a9b3bd;font-size:13px}
.t{background:#b7791f;color:#111;text-align:center;font-weight:600;padding:6px 12px;letter-spacing:.04em}
@media (prefers-color-scheme:light){body{background:#f4f6f8;color:#1c2127}.k{background:#fff;border-color:#d5dbe1}.h,.k span{color:#57616b}}</style></head>
<body>${testsystem ? `<div class="t" role="status" data-testid="testsystem-band">${esc(TEST_BAND)}</div>` : ""}<main><h1>Planer-Lager</h1><p class="h" data-testid="portal-kopf">${kopf}</p>${leer}<nav class="r" aria-label="Apps">${kacheln.join("")}</nav></main></body></html>`;
}

export function statischModul(router, { config }) {
  const dist = config?.stationDist || STATION_DIST;
  const webDir = config?.webAppsDir || WEB_APPS_STANDARD;
  const html = (ctx, inhalt) => { ctx.res.writeHead(200, { "Content-Type": TYPEN[".html"], "Cache-Control": "no-store", "Content-Security-Policy": SEITEN_CSP }); ctx.res.end(inhalt); };
  const datei = (ctx, p, cache) => {
    if (!fs.existsSync(p)) throw new HttpFehler(404, "Datei nicht gefunden. Lade die Seite neu.");
    ctx.res.writeHead(200, { "Content-Type": TYPEN[path.extname(p)] || "application/octet-stream", "Cache-Control": cache });
    ctx.res.end(fs.readFileSync(p));
  };
  const seite = (ctx) => {
    const datei = path.join(dist, "index.html");
    if (!fs.existsSync(datei)) throw new HttpFehler(503, "Die Arbeitsplatz-Oberfläche ist noch nicht gebaut. Der Admin muss den Server neu bauen.");
    ctx.res.writeHead(200, { "Content-Type": TYPEN[".html"], "Cache-Control": "no-store", "Content-Security-Policy": SEITEN_CSP });
    ctx.res.end(fs.readFileSync(datei));
  };
  router.get("/", { oeffentlich: true }, (ctx) => html(ctx, portalHtml(ctx.nutzer, !!config?.testModus)));
  router.get("/station", { oeffentlich: true }, seite);
  router.get("/anzeige", { oeffentlich: true }, seite);
  router.get("/login", { oeffentlich: true }, seite);
  // R-11 (D-18): /admin… leitet auf die Anmeldeseite.
  router.get("/admin", { oeffentlich: true }, (ctx) => { ctx.res.writeHead(302, { Location: "/login" }); ctx.res.end(); });
  router.get("/admin/login", { oeffentlich: true }, (ctx) => { ctx.res.writeHead(302, { Location: "/login" }); ctx.res.end(); });
  router.get("/assets/:datei", { oeffentlich: true }, (ctx) => {
    const name = ctx.params.datei;
    if (!/^[\w.-]+\.[0-9a-f]{12}\.(js|css)$|^[\w.-]+\.(svg|png|mp3)$/.test(name)) throw new HttpFehler(404, "Datei nicht gefunden. Lade die Seite neu.");
    datei(ctx, path.join(dist, name), "public, max-age=31536000, immutable");
  });
  // Browser-Versionen (WEB-14/15): /<app>/ = index.html, /<app>/assets/<name>.<hash>.<ext> dauerhaft cachebar
  for (const app of WEB_APPS) {
    const ordner = path.join(webDir, app.id);
    const fehlt = () => new HttpFehler(503, `Die Browser-Version des ${app.titel}s ist auf diesem Server nicht installiert. Der Admin muss das Server-Image neu bauen (siehe BETRIEB.md, Abschnitt Browser-Version).`);
    router.get(`/${app.id}`, { oeffentlich: true }, (ctx) => {
      if (!ctx.url.pathname.endsWith("/")) { ctx.res.writeHead(301, { Location: `/${app.id}/${ctx.url.search}` }); ctx.res.end(); return; }
      const p = path.join(ordner, "index.html");
      if (!fs.existsSync(p)) {
        // Als Seite, nicht als JSON: wer die Adresse im Browser öffnet, soll den Text lesen können.
        ctx.res.writeHead(503, { "Content-Type": TYPEN[".html"], "Cache-Control": "no-store", "Content-Security-Policy": SEITEN_CSP });
        ctx.res.end(`<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${esc(app.titel)}</title></head><body><main><h1>${esc(app.titel)}</h1><p>${esc(fehlt().message)}</p><p><a href="/">Zur Übersicht</a></p></main></body></html>`);
        return;
      }
      html(ctx, fs.readFileSync(p));
    });
    router.get(`/${app.id}/manifest.webmanifest`, { oeffentlich: true }, (ctx) => {
      if (!fs.existsSync(ordner)) throw fehlt();
      datei(ctx, path.join(ordner, "manifest.webmanifest"), "no-cache");
    });
    router.get(`/${app.id}/assets/:datei`, { oeffentlich: true }, (ctx) => {
      const name = ctx.params.datei;
      if (!/^[\w-]+\.[0-9a-f]{12}\.(js|css|svg)$/.test(name)) throw new HttpFehler(404, "Datei nicht gefunden. Lade die Seite neu.");
      datei(ctx, path.join(ordner, "assets", name), "public, max-age=31536000, immutable");
    });
  }
}
