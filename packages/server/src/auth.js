// Anmeldung (R-04, R-08–R-10), Sitzungen, Zwei-Faktor (FA-54), Handoff zwischen den Apps (ARCHITEKTUR §4.1),
// zentrale Zugangsprüfung je Route (R-01–R-05).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { darf, noetigeStufe, istAdminRechte, pruefeTotp, neuesTotpGeheimnis, totpUri } from "@lager/domain";
import QRCode from "qrcode";
import { HttpFehler } from "./router.js";
import { protokolliere, clientIp } from "./sicherheit.js";
import { pruefePasswortHash, DUMMY_HASH } from "./passwort-hash.js";
import { verteileBeimAnmelden } from "./zonen.js";
import { pruefeStation } from "./station.js";

export const SITZUNG_STUNDEN = 12;              // R-10
export const GERAET_TAGE = 400;                 // Arbeitsplatz/Anzeige: bleibt wochenlang angemeldet (R-59), gleitend
export const sitzungSekunden = (art) => (art === "geraet" ? GERAET_TAGE * 86400 : SITZUNG_STUNDEN * 3600);
export const SPERRE_MINUTEN = 15;               // R-08
export const MAX_FEHL_BENUTZER = 5, MAX_FEHL_IP = 20;
export const HANDOFF_SEKUNDEN = 60;
export const COOKIE = "lager_sitzung";

export const TEXT = {
  anmelden: "Bitte melde dich an.",
  abgelaufen: "Deine Sitzung ist abgelaufen. Melde dich neu an.",
  falsch: "Benutzername oder Passwort ist falsch. Prüfe die Eingabe und versuche es erneut.",
  gesperrt: "Zu viele Fehlversuche. Die Anmeldung ist für 15 Minuten gesperrt. Warte und versuche es dann erneut.",
  verweigert: "Dafür fehlt dir die Berechtigung.",
  csrf: "Die Sitzung ist nicht mehr gültig. Lade die Seite neu und versuche es erneut.",
  totpFalsch: "Der Code stimmt nicht. Gib den aktuellen 6-stelligen Code aus deiner Authenticator-App ein.",
  zweiFaktorPflicht: "Für Administratoren ist die Zwei-Faktor-Anmeldung Pflicht. Richte sie jetzt ein.",
};

const sha = (s) => createHash("sha256").update(s).digest("hex");
const neuerToken = () => randomBytes(32).toString("base64url");
const gleich = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function leseCookies(req) {
  const out = {};
  for (const teil of String(req.headers.cookie || "").split(";")) {
    const i = teil.indexOf("=");
    if (i > 0) out[teil.slice(0, i).trim()] = decodeURIComponent(teil.slice(i + 1).trim());
  }
  return out;
}

function tokenAus(ctx) {
  const h = String(ctx.req.headers.authorization || "");
  if (h.startsWith("Bearer ")) return { token: h.slice(7).trim(), quelle: "bearer" };
  const c = leseCookies(ctx.req)[COOKIE];
  return c ? { token: c, quelle: "cookie" } : null;
}

const NUTZER_SQL = `SELECT s.token_hash, s.art, s.csrf, s.letzte_aktivitaet, b.id, b.benutzername, b.name, b.aktiv, b.totp_aktiv,
  b.design, r.name AS rolle, r.rechte FROM sitzung s JOIN benutzer b ON b.id = s.benutzer_id JOIN rolle r ON r.id = b.rolle_id
  WHERE s.token_hash = $1`;

const nutzerAus = (z) => ({ id: z.id, benutzername: z.benutzername, name: z.name, rolle: z.rolle, rechte: z.rechte,
  admin: istAdminRechte(z.rechte), totpAktiv: z.totp_aktiv, design: z.design, sitzungArt: z.art });

/** Lädt die Sitzung zum Token (oder null, wenn ungültig/abgelaufen). Abgelaufene werden gelöscht. */
export async function ladeSitzung(pool, token) {
  if (!token) return null;
  const { rows } = await pool.query(NUTZER_SQL, [sha(token)]);
  const z = rows[0];
  if (!z) return null;
  const alter = Date.now() - new Date(z.letzte_aktivitaet).getTime();
  if (!z.aktiv || alter > sitzungSekunden(z.art) * 1000) {
    await pool.query("DELETE FROM sitzung WHERE token_hash = $1", [z.token_hash]);
    return { abgelaufen: true };
  }
  const erneuert = alter > 60_000;
  if (erneuert) await pool.query("UPDATE sitzung SET letzte_aktivitaet = now() WHERE token_hash = $1", [z.token_hash]);
  return { zeile: z, nutzer: nutzerAus(z), erneuert };
}

const verweigert = (rolle) => new HttpFehler(403, TEXT.verweigert, { ok: false, level: "error", text: TEXT.verweigert, rolle });

/**
 * Zentrale Zugangsprüfung, läuft vor jedem Handler.
 * Route-Flags: oeffentlich, zwischen (erlaubt mit Passwort-ok-aber-2FA-fehlt), zweiFaktorEinrichtung.
 */
export async function pruefeZugang(ctx) {
  const { route } = ctx;
  const t = tokenAus(ctx);
  if (route.oeffentlich) {
    if (t) { const s = await ladeSitzung(ctx.pool, t.token); if (s?.nutzer) ctx.nutzer = s.nutzer; }
    return;
  }
  const s = t ? await ladeSitzung(ctx.pool, t.token) : null;
  if (!s || s.abgelaufen) {
    const text = s?.abgelaufen ? TEXT.abgelaufen : TEXT.anmelden;
    throw new HttpFehler(401, text, { ok: false, level: "error", text, anmelden: true }); // R-04
  }
  const n = s.nutzer;
  ctx.nutzer = n;
  // R-10 gleitend: Cookie-Laufzeit bei Aktivität erneuern (höchstens 1× pro Minute, wie die Sitzung).
  if (t.quelle === "cookie" && s.erneuert) setzeCookie(ctx, t.token, sitzungSekunden(n.sitzungArt));
  ctx.sitzung = { tokenHash: s.zeile.token_hash, quelle: t.quelle };
  if (n.sitzungArt === "zwischen" && !route.zwischen) throw new HttpFehler(401, TEXT.anmelden, { ok: false, level: "error", text: TEXT.anmelden, zweiterFaktor: true });
  if (ctx.config?.imNetz && n.admin && !n.totpAktiv && !route.zweiFaktorEinrichtung && n.sitzungArt !== "zwischen")
    throw new HttpFehler(403, TEXT.zweiFaktorPflicht, { ok: false, level: "error", text: TEXT.zweiFaktorPflicht, zweiFaktorEinrichten: true });
  // CSRF nur für Cookie-Sitzungen (ARCHITEKTUR §7)
  const methode = ctx.req.method || "GET";
  if (t.quelle === "cookie" && !["GET", "HEAD", "OPTIONS"].includes(methode)) {
    const h = ctx.req.headers["x-csrf-token"];
    if (!h || !s.zeile.csrf || !gleich(h, s.zeile.csrf)) throw new HttpFehler(403, TEXT.csrf, { ok: false, level: "error", text: TEXT.csrf });
  }
  // FA-51 Wartung: nur Administratoren arbeiten weiter
  const w = ctx.config?.wartung;
  if (w?.aktiv && !n.admin && !route.nurAngemeldet) {
    const text = w.text || "Das System wird gerade gewartet. Versuche es in ein paar Minuten noch einmal.";
    throw new HttpFehler(503, text, { ok: false, level: "warning", text, wartung: true });
  }
  if (n.sitzungArt === "geraet") await pruefeStation(ctx); // R-11a–d
  if (ctx.arbeitsplatz && route.auchArbeitsplatz) return; // R-11d: im ERLAUBT-Muster, unabhängig von den Rollenrechten
  if (route.nurAngemeldet) return;
  const stufe = route.stufe || noetigeStufe(methode, ctx.url.pathname);
  if (!darf(n.rechte, route.bereich, stufe)) {
    await protokolliere(ctx.pool, "verweigert", { benutzer: n.benutzername, ip: clientIp(ctx),
      text: `${methode} ${ctx.url.pathname} (Bereich ${route.bereich || "–"}, Stufe ${stufe}, Rolle ${n.rolle})` });
    throw verweigert(n.rolle); // R-05
  }
}

export async function erstelleSitzung(pool, benutzerId, art, ip, geraet) {
  const token = neuerToken();
  const csrf = art === "web" || art === "geraet" ? neuerToken() : null;
  await pool.query("INSERT INTO sitzung (token_hash, benutzer_id, art, csrf, ip, geraet) VALUES ($1, $2, $3, $4, $5, $6)",
    [sha(token), benutzerId, art, csrf, ip, String(geraet || "").slice(0, 200)]);
  return { token, csrf };
}

export function setzeCookie(ctx, token, maxAgeS) {
  const secure = ctx.config?.secureCookies ? "; Secure" : "";
  ctx.res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure}`); // R-10
}

/** R-08: gesperrt? Zählt Fehlversuche seit dem letzten Erfolg (Benutzer) bzw. im Fenster (Adresse). */
async function istGesperrt(pool, benutzername, ip) {
  const { rows } = await pool.query(`SELECT
    (SELECT count(*) FROM anmelde_versuch v WHERE lower(v.benutzername) = lower($1) AND NOT v.erfolg
       AND v.zeit > now() - make_interval(mins => $3)
       AND v.zeit > coalesce((SELECT max(zeit) FROM anmelde_versuch e WHERE lower(e.benutzername) = lower($1) AND e.erfolg), '-infinity')) AS fb,
    (SELECT count(*) FROM anmelde_versuch WHERE ip = $2 AND NOT erfolg AND zeit > now() - make_interval(mins => $3)) AS fi`,
  [benutzername, ip, SPERRE_MINUTEN]);
  return rows[0].fb >= MAX_FEHL_BENUTZER || rows[0].fi >= MAX_FEHL_IP;
}

/** Abschluss einer erfolgreichen Anmeldung (nach Passwort bzw. 2. Faktor). */
async function anmeldungFertig(ctx, b, art) {
  const ip = clientIp(ctx);
  const { token, csrf } = await erstelleSitzung(ctx.pool, b.id, art, ip, ctx.req.headers["user-agent"]);
  await ctx.pool.query("UPDATE benutzer SET letzter_login = now() WHERE id = $1", [b.id]);
  await protokolliere(ctx.pool, "login", { benutzer: b.benutzername, ip, text: `Anmeldung (${art})` });
  if (art === "web") setzeCookie(ctx, token, SITZUNG_STUNDEN * 3600);
  const s = await ladeSitzung(ctx.pool, token);
  await verteileBeimAnmelden(ctx, s.nutzer); // R-58, fängt eigene Fehler
  return { ok: true, token: art === "app" ? token : undefined, csrf: csrf || undefined, nutzer: s.nutzer,
    zweiFaktorEinrichten: !!(ctx.config?.imNetz && s.nutzer.admin && !s.nutzer.totpAktiv) };
}

export function authModul(router) {
  // Anmeldung: { benutzername, passwort, art: "app"|"web" }
  router.post("/api/v1/anmelden", { oeffentlich: true }, async (ctx) => {
    const { benutzername = "", passwort = "", art = "app" } = ctx.body || {};
    const ip = clientIp(ctx);
    const name = String(benutzername).trim();
    if (await istGesperrt(ctx.pool, name, ip)) {
      await protokolliere(ctx.pool, "sperre", { benutzer: name, ip, text: "Anmeldung gesperrt (R-08)" });
      throw new HttpFehler(429, TEXT.gesperrt, { ok: false, level: "error", text: TEXT.gesperrt });
    }
    const { rows } = await ctx.pool.query("SELECT id, benutzername, passwort_hash, aktiv, totp_aktiv FROM benutzer WHERE lower(benutzername) = lower($1)", [name]);
    const b = rows[0];
    const pwOk = await pruefePasswortHash(passwort, b?.passwort_hash || DUMMY_HASH);
    if (!b || !b.aktiv || !pwOk) {
      await ctx.pool.query("INSERT INTO anmelde_versuch (benutzername, ip, erfolg) VALUES ($1, $2, false)", [name, ip]);
      await protokolliere(ctx.pool, "fehlversuch", { benutzer: name, ip, text: "Falsches Passwort oder unbekannter Benutzer" });
      throw new HttpFehler(401, TEXT.falsch, { ok: false, level: "error", text: TEXT.falsch });
    }
    await ctx.pool.query("INSERT INTO anmelde_versuch (benutzername, ip, erfolg) VALUES ($1, $2, true)", [name, ip]);
    if (b.totp_aktiv) {
      const { token } = await erstelleSitzung(ctx.pool, b.id, "zwischen", ip, art);
      return { ok: true, zweiterFaktor: true, zwischenToken: token };
    }
    return anmeldungFertig(ctx, b, art === "web" ? "web" : "app");
  });

  // Zweiter Faktor: { zwischenToken, code, art }
  router.post("/api/v1/anmelden/totp", { oeffentlich: true }, async (ctx) => {
    const { zwischenToken, code, art = "app" } = ctx.body || {};
    const s = await ladeSitzung(ctx.pool, zwischenToken);
    if (!s?.zeile || s.zeile.art !== "zwischen") throw new HttpFehler(401, TEXT.abgelaufen, { ok: false, level: "error", text: TEXT.abgelaufen });
    const ip = clientIp(ctx);
    if (await istGesperrt(ctx.pool, s.nutzer.benutzername, ip)) throw new HttpFehler(429, TEXT.gesperrt, { ok: false, level: "error", text: TEXT.gesperrt });
    const { rows } = await ctx.pool.query("SELECT id, benutzername, totp_geheimnis FROM benutzer WHERE id = $1", [s.nutzer.id]);
    if (!pruefeTotp(rows[0].totp_geheimnis, code)) {
      await ctx.pool.query("INSERT INTO anmelde_versuch (benutzername, ip, erfolg) VALUES ($1, $2, false)", [rows[0].benutzername, ip]);
      await protokolliere(ctx.pool, "fehlversuch", { benutzer: rows[0].benutzername, ip, text: "Falscher 2FA-Code" });
      throw new HttpFehler(401, TEXT.totpFalsch, { ok: false, level: "error", text: TEXT.totpFalsch });
    }
    await ctx.pool.query("DELETE FROM sitzung WHERE token_hash = $1", [s.zeile.token_hash]);
    return anmeldungFertig(ctx, rows[0], art === "web" ? "web" : "app");
  });

  router.post("/api/v1/abmelden", { bereich: "start", nurAngemeldet: true, zweiFaktorEinrichtung: true }, async (ctx) => {
    await ctx.pool.query("DELETE FROM sitzung WHERE token_hash = $1", [ctx.sitzung.tokenHash]);
    await protokolliere(ctx.pool, "logout", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx) });
    if (ctx.sitzung.quelle === "cookie") setzeCookie(ctx, "", 0);
    return { ok: true };
  });

  router.get("/api/v1/ich", { bereich: "start", nurAngemeldet: true, zweiFaktorEinrichtung: true }, async (ctx) => {
    const { rows } = await ctx.pool.query("SELECT csrf FROM sitzung WHERE token_hash = $1", [ctx.sitzung.tokenHash]);
    return { ok: true, nutzer: ctx.nutzer, csrf: rows[0]?.csrf || undefined,
      zweiFaktorEinrichten: !!(ctx.config?.imNetz && ctx.nutzer.admin && !ctx.nutzer.totpAktiv) };
  });

  // FA-52: persönliche Darstellung (Thema, Dichte, Hell/Dunkel)
  router.put("/api/v1/ich/design", { bereich: "start", nurAngemeldet: true, ohneVersion: "eigene Darstellung, nur der Nutzer selbst" }, async (ctx) => {
    const { thema, dichte, modus } = ctx.body || {};
    const d = { thema: String(thema || "planer").slice(0, 20), dichte: String(dichte || "normal").slice(0, 20), modus: String(modus || "system").slice(0, 20) };
    await ctx.pool.query("UPDATE benutzer SET design = $1 WHERE id = $2", [JSON.stringify(d), ctx.nutzer.id]);
    return { ok: true, design: d };
  });

  // FA-54: Einrichtung. Schritt 1 liefert Geheimnis + otpauth-URI, Schritt 2 bestätigt mit Code.
  router.post("/api/v1/ich/totp/einrichten", { bereich: "start", nurAngemeldet: true, zweiFaktorEinrichtung: true }, async (ctx) => {
    const geheimnis = neuesTotpGeheimnis();
    await ctx.pool.query("UPDATE benutzer SET totp_geheimnis = $1, totp_aktiv = false WHERE id = $2", [geheimnis, ctx.nutzer.id]);
    const uri = totpUri(geheimnis, ctx.nutzer.benutzername);
    const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 180 });
    return { ok: true, geheimnis, uri, qrSvg };
  });
  router.post("/api/v1/ich/totp/bestaetigen", { bereich: "start", nurAngemeldet: true, zweiFaktorEinrichtung: true }, async (ctx) => {
    const { rows } = await ctx.pool.query("SELECT totp_geheimnis FROM benutzer WHERE id = $1", [ctx.nutzer.id]);
    if (!rows[0]?.totp_geheimnis || !pruefeTotp(rows[0].totp_geheimnis, ctx.body?.code))
      throw new HttpFehler(400, TEXT.totpFalsch, { ok: false, level: "error", text: TEXT.totpFalsch });
    await ctx.pool.query("UPDATE benutzer SET totp_aktiv = true WHERE id = $1", [ctx.nutzer.id]);
    await protokolliere(ctx.pool, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: "Zwei-Faktor-Anmeldung eingerichtet" });
    return { ok: true, level: "success", text: "Die Zwei-Faktor-Anmeldung ist jetzt aktiv." };
  });

  // Handoff (ARCHITEKTUR §4.1): Einmal-Code, 60 s gültig, einmal einlösbar.
  router.post("/api/v1/handoff", { bereich: "start", nurAngemeldet: true }, async (ctx) => {
    const code = neuerToken();
    await ctx.pool.query("INSERT INTO handoff (code_hash, benutzer_id, ablauf) VALUES ($1, $2, now() + make_interval(secs => $3))",
      [sha(code), ctx.nutzer.id, HANDOFF_SEKUNDEN]);
    return { ok: true, code, gueltigSekunden: HANDOFF_SEKUNDEN };
  });
  // BUG-2: Browser fragt beim Start, ob eine Cookie-Sitzung besteht – ohne 401 (sonst Konsolenfehler vor dem Login)
  router.get("/api/v1/sitzung", { oeffentlich: true }, (ctx) => ({ angemeldet: !!ctx.nutzer }));
  router.post("/api/v1/handoff/einloesen", { oeffentlich: true }, async (ctx) => {
    const code = String(ctx.body?.code || "");
    const art = ctx.body?.art === "web" ? "web" : "app"; // web: Cookie-Sitzung für die Browser-Version (WEB-13)
    const { rows } = await ctx.pool.query(`UPDATE handoff SET eingeloest = now()
      WHERE code_hash = $1 AND eingeloest IS NULL AND ablauf > now() RETURNING benutzer_id`, [sha(code)]);
    const text = "Der Anmelde-Link ist abgelaufen oder wurde schon benutzt. Melde dich bitte an.";
    if (!rows[0]) throw new HttpFehler(401, text, { ok: false, level: "error", text });
    const b = (await ctx.pool.query("SELECT id, benutzername, aktiv FROM benutzer WHERE id = $1", [rows[0].benutzer_id])).rows[0];
    if (!b?.aktiv) throw new HttpFehler(401, text, { ok: false, level: "error", text });
    return anmeldungFertig(ctx, b, art);
  });
}
