// Verwaltung: Datensicherung (FA-49), Sicherheits-Check + Absichern (FA-50), System: Ping, Wartung, Neustart (FA-51).
import fs from "node:fs";
import path from "node:path";
import { fehler } from "./hilfen.js";
import { protokolliere, clientIp } from "./sicherheit.js";
import { ladeEinstellungen } from "./verwaltung.js";
import { erstelleSicherung, listeSicherungen, pruefeSicherung, stelleWiederHer, gueltigerName, sicherungsOrdner, datenOrdner, AUTO_STUNDEN } from "./sicherung.js";

const V = { bereich: "verwaltung" };
export const BESTAETIGUNG = "WIEDERHERSTELLEN";

/** FA-50 --absichern: Datenordner nur für den Server-Benutzer (Ordner 700, Dateien 600). Liefert Anzahl geänderter Einträge. */
export function sichereDateirechte(config) {
  const basis = datenOrdner(config);
  if (!fs.existsSync(basis)) return 0;
  let n = 0;
  const geh = (p, ordner) => {
    const soll = ordner ? 0o700 : 0o600;
    if ((fs.statSync(p).mode & 0o777) !== soll) { fs.chmodSync(p, soll); n++; }
    if (ordner) for (const e of fs.readdirSync(p, { withFileTypes: true })) if (e.isDirectory() || e.isFile()) geh(path.join(p, e.name), e.isDirectory());
  };
  geh(basis, true);
  return n;
}

/** Findet Dateien/Ordner mit zu weiten Rechten (Gruppe/Andere). */
function zuOffen(basis, max = 20) {
  const out = [];
  const geh = (p) => {
    if (out.length >= max) return;
    const st = fs.statSync(p);
    if (st.mode & 0o077) out.push(path.relative(basis, p) || ".");
    if (st.isDirectory()) for (const e of fs.readdirSync(p, { withFileTypes: true })) if (e.isDirectory() || e.isFile()) geh(path.join(p, e.name));
  };
  if (fs.existsSync(basis)) geh(basis);
  return out;
}

/** FA-50 Check-Seite: jede Zeile {id, titel, level: ok|warning|error, text}. */
export async function sicherheitsCheck(pool, config) {
  const z = [];
  const add = (id, titel, ok, text, level = ok ? "ok" : "warning") => z.push({ id, titel, level, text });
  const https = String(config.publicUrl || "").startsWith("https://");
  add("https", "HTTPS", https || !config.imNetz, https ? `Erreichbar über ${config.publicUrl}.` : config.imNetz ? "Der Server ist aus dem Netz erreichbar, aber ohne HTTPS. Setze PUBLIC_URL auf eine https-Adresse (Caddy)." : "Nur im lokalen Netz, ohne HTTPS.", https ? "ok" : config.imNetz ? "error" : "warning");
  add("cookies", "Sichere Cookies", !!config.secureCookies, config.secureCookies ? "Cookies nur über HTTPS." : "Cookies auch ohne HTTPS. Wird mit HTTPS automatisch aktiv.");
  add("betrieb", "Betriebsmodus", process.env.NODE_ENV === "production", process.env.NODE_ENV === "production" ? "Produktivbetrieb (NODE_ENV=production)." : "Der Server läuft im Testbetrieb, nicht im Produktivbetrieb. Gib das an den Betreiber des Servers weiter: Er muss NODE_ENV=production setzen (das offizielle Server-Image macht das schon, siehe BETRIEB.md).");
  const { rows: admins } = await pool.query(`SELECT b.benutzername, b.totp_aktiv FROM benutzer b JOIN rolle r ON r.id = b.rolle_id
    WHERE b.aktiv AND r.rechte->>'verwaltung' = 'w'`);
  const ohne = admins.filter((a) => !a.totp_aktiv).map((a) => a.benutzername);
  add("2fa", "Zwei-Faktor für Administratoren", !ohne.length, ohne.length ? `Ohne Zwei-Faktor: ${ohne.join(", ")}. Richte sie unter „Mein Konto“ ein.` : `Alle ${admins.length} Administratoren nutzen Zwei-Faktor.`, ohne.length && config.imNetz ? "error" : ohne.length ? "warning" : "ok");
  const offen = zuOffen(datenOrdner(config));
  add("dateirechte", "Dateirechte Datenordner", !offen.length, offen.length ? `Zu weit geöffnet: ${offen.slice(0, 5).join(", ")}${offen.length > 5 ? " …" : ""}. Klicke „Dateirechte absichern“.` : "Nur der Server-Benutzer hat Zugriff.");
  const letzte = listeSicherungen(config).find((s) => !s.vorab);
  const alt = letzte ? (Date.now() - new Date(letzte.erstellt).getTime()) / 3600_000 : Infinity;
  add("sicherung", "Letzte Sicherung", alt <= AUTO_STUNDEN + 4, letzte ? `${letzte.name} (vor ${Math.round(alt)} Stunden).` : "Noch keine Sicherung. Klicke unter „Datensicherung“ auf „Jetzt sichern“.", alt <= AUTO_STUNDEN + 4 ? "ok" : letzte ? "warning" : "error");
  const e = await ladeEinstellungen(pool);
  add("zweitort", "Zweitort für Sicherungen", !!e.backup_zweitordner, e.backup_zweitordner ? `Kopie nach ${e.backup_zweitordner}.` : "Kein Zweitort. Trage in den Einstellungen einen Zweitordner ein (z. B. ein eingebundenes Netzlaufwerk).");
  const { rows: [f] } = await pool.query("SELECT count(*)::int AS n FROM sicherheit_ereignis WHERE art = 'fehlversuch' AND zeit > now() - interval '24 hours'");
  add("logins", "Fehlgeschlagene Anmeldungen (24 h)", f.n < 20, `${f.n} fehlgeschlagene Anmeldungen.${f.n >= 20 ? " Prüfe das Sicherheitsprotokoll." : ""}`);
  return z;
}

export function systemModul(router) {
  router.get("/api/v1/ping", { oeffentlich: true }, () => ({ ok: true, zeit: new Date().toISOString() }));

  // FA-49 Datensicherung
  router.get("/api/v1/verwaltung/sicherungen", V, async (ctx) => {
    const e = await ladeEinstellungen(ctx.pool);
    return { liste: listeSicherungen(ctx.config), behalten: e.backup_behalten, zweitordner: e.backup_zweitordner, auto_stunden: AUTO_STUNDEN };
  });
  router.post("/api/v1/verwaltung/sicherungen", V, async (ctx) => {
    const r = await erstelleSicherung(ctx.pool, ctx.config);
    await protokolliere(ctx.pool, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Sicherung erstellt: ${r.name}` });
    const level = !r.pruefung.ok ? "error" : r.zweitkopie && !r.zweitkopie.ok ? "warning" : "success";
    return { ok: r.pruefung.ok, level, name: r.name, pruefung: r.pruefung, zweitkopie: r.zweitkopie, geloescht: r.geloescht,
      text: `Sicherung ${r.name} erstellt. Prüfung: ${r.pruefung.text}${r.zweitkopie ? ` ${r.zweitkopie.text}` : ""}` };
  });
  const datei = (ctx) => {
    const n = ctx.params.name;
    if (!gueltigerName(n)) throw fehler(400, "Ungültiger Name einer Sicherung. Wähle sie aus der Liste.");
    const d = path.join(sicherungsOrdner(ctx.config), n);
    if (!fs.existsSync(d)) throw fehler(404, "Diese Sicherung gibt es nicht (mehr). Lade die Liste neu.");
    return d;
  };
  router.get("/api/v1/verwaltung/sicherungen/:name", V, async (ctx) => {
    const d = datei(ctx);
    const st = fs.statSync(d);
    ctx.res.writeHead(200, { "Content-Type": ctx.params.name.endsWith(".enc") ? "application/octet-stream" : "application/zip", "Content-Length": st.size, "Content-Disposition": `attachment; filename="${ctx.params.name}"`, "Cache-Control": "no-store" });
    fs.createReadStream(d).pipe(ctx.res);
    await new Promise((r) => ctx.res.on("close", r));
  });
  router.post("/api/v1/verwaltung/sicherungen/:name/pruefen", V, async (ctx) => {
    const p = pruefeSicherung(datei(ctx), ctx.config);
    return { ok: p.ok, level: p.ok ? "success" : "error", text: p.text };
  });
  // SOLL P2: Wiederherstellung über die Oberfläche, mit Sicherheitsabfrage
  router.post("/api/v1/verwaltung/sicherungen/:name/wiederherstellen", V, async (ctx) => {
    const d = datei(ctx);
    if (ctx.body?.bestaetigung !== BESTAETIGUNG) throw fehler(400, `Tippe zur Bestätigung ${BESTAETIGUNG} ein.`, { felder: { bestaetigung: "Bestätigung fehlt" } });
    const wer = ctx.nutzer.benutzername, ip = clientIp(ctx);
    let r;
    try { r = await stelleWiederHer(ctx.pool, ctx.config, d); } catch (e) { if (e.status) throw fehler(e.status, e.message); throw e; }
    await protokolliere(ctx.pool, "aktion", { benutzer: wer, ip, text: `Sicherung wiederhergestellt: ${ctx.params.name} (vorher gesichert: ${r.vorab})` });
    ctx.hub?.sende({ typ: "system.wiederhergestellt", bereich: "start" });
    return { ok: true, level: "success", vorab: r.vorab, abgemeldet: true,
      text: `${ctx.params.name} wiederhergestellt. Der vorherige Stand liegt in ${r.vorab}. Alle müssen sich neu anmelden.` };
  });

  // FA-50 Sicherheit
  router.get("/api/v1/verwaltung/sicherheit/check", V, async (ctx) => sicherheitsCheck(ctx.pool, ctx.config));
  router.post("/api/v1/verwaltung/sicherheit/absichern", V, async (ctx) => {
    const n = sichereDateirechte(ctx.config);
    await protokolliere(ctx.pool, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Dateirechte abgesichert (${n} geändert)` });
    return { ok: true, level: "success", text: n ? `Dateirechte abgesichert: ${n} Einträge geändert.` : "Dateirechte waren schon in Ordnung." };
  });

  // FA-51 System
  router.get("/api/v1/verwaltung/system", V, async (ctx) => ({
    wartung: ctx.config.wartung || { aktiv: false, text: "" }, neustart: !!ctx.config.neustartErlaubt,
    laeuft_seit: new Date(Date.now() - process.uptime() * 1000).toISOString(), node: process.version,
    clients: ctx.hub?.clients?.size ?? null,
  }));
  router.put("/api/v1/verwaltung/system/wartung", V, async (ctx) => {
    const aktiv = !!ctx.body?.aktiv;
    const text = String(ctx.body?.text || "").trim().slice(0, 300);
    ctx.config.wartung = { aktiv, text };
    await ctx.pool.query("INSERT INTO system_zustand (schluessel, wert) VALUES ('wartung', $1) ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert", [JSON.stringify(ctx.config.wartung)]);
    await protokolliere(ctx.pool, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Wartung ${aktiv ? "an" : "aus"}` });
    ctx.hub?.sende({ typ: "system.wartung", bereich: "start" });
    return { ok: true, level: "success", wartung: ctx.config.wartung, text: aktiv ? "Wartung ist an: Nur Administratoren können arbeiten." : "Wartung ist aus." };
  });
  router.post("/api/v1/verwaltung/system/neustart", V, async (ctx) => {
    if (!ctx.config.neustartErlaubt) throw fehler(409, "Neustart aus der Oberfläche ist hier nicht eingerichtet. Starte den Server-Container neu (docker compose restart).");
    await protokolliere(ctx.pool, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: "Neustart angefordert" });
    ctx.hub?.sende({ typ: "system.neustart", bereich: "start" });
    // Docker startet den Prozess neu (restart: unless-stopped); erst antworten, dann beenden
    setTimeout(() => (ctx.config.beiNeustart || (() => process.exit(0)))(), 500).unref?.();
    return { ok: true, level: "info", text: "Der Server startet neu. Die Apps verbinden sich in wenigen Sekunden wieder." };
  });
}

/** Beim Start: Wartungszustand laden, Dateirechte absichern, ggf. automatisch sichern (FA-49/FA-50). */
export async function beimStart(pool, config) {
  const { rows: [w] } = await pool.query("SELECT wert FROM system_zustand WHERE schluessel = 'wartung'");
  config.wartung = w?.wert || { aktiv: false, text: "" };
  if (config.absichernBeimStart) sichereDateirechte(config);
}
