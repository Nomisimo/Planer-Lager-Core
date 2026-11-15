// Netzwerk-Scanner-Gateway (ARCHITEKTUR §5): TCP (eine Zeile = ein Code) und HTTP-Push mit Token.
// Der Code geht per WebSocket an den zugeordneten Arbeitsplatz bzw. an Clients, die diesen Scanner abonniert haben;
// dort wird er wie ein Handscanner-Scan mit Modus/Projekt des Clients gebucht (D-65).
import net from "node:net";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { fehler, nichtGefunden, idParam, dbFehler } from "./hilfen.js";
import { sichereFassung } from "./fassung.js";
import { protokolliere, clientIp } from "./sicherheit.js";

const V = { bereich: "verwaltung" };
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const MAX_ZEILE = 200;

const oeffentlich = (s) => ({ id: s.id, name: s.name, kennung: s.kennung, ip: s.ip, arbeitsplatz_id: s.arbeitsplatz_id, aktiv: s.aktiv,
  letzter_kontakt: s.letzter_kontakt, letzter_code: s.letzter_code, hat_token: !!s.token_hash });

/** Nimmt einen Code von einem Scanner an und leitet ihn weiter. */
export async function empfange(ctx, scanner, rohCode) {
  const code = String(rohCode || "").replace(/[\r\n\t]/g, "").trim().slice(0, 64);
  if (!code) return null;
  await ctx.pool.query("UPDATE scanner SET letzter_kontakt = now(), letzter_code = $1 WHERE id = $2", [code, scanner.id]);
  ctx.hub?.sende({ typ: "scanner.code", code, scanner: scanner.id, name: scanner.name, arbeitsplatz: scanner.arbeitsplatz_id, bereich: "packen" },
    (ws) => ws.extra?.scanner === scanner.id || (scanner.arbeitsplatz_id != null && ws.extra?.arbeitsplatz === scanner.arbeitsplatz_id));
  return code;
}

/** Zuordnung TCP: zuerst Kennungs-Präfix „KENNUNG:CODE“, sonst Absender-IP. */
export async function findeScanner(pool, { ip, zeile }) {
  const m = /^([A-Za-z0-9_-]{1,20}):(.+)$/.exec(zeile);
  if (m) {
    const { rows: [s] } = await pool.query("SELECT * FROM scanner WHERE aktiv AND kennung <> '' AND lower(kennung) = lower($1)", [m[1]]);
    if (s) return { scanner: s, code: m[2] };
  }
  const reinIp = String(ip || "").replace(/^::ffff:/, "");
  const { rows: [s] } = await pool.query("SELECT * FROM scanner WHERE aktiv AND ip <> '' AND ip = $1", [reinIp]);
  return s ? { scanner: s, code: zeile } : null;
}

/** Startet den TCP-Listener. port 0 = aus, "auto" = freier Port (Tests). */
export function starteTcpGateway(ctx, { port, host = "0.0.0.0" }) {
  if (!port) return null;
  const server = net.createServer((sock) => {
    sock.setEncoding("utf8");
    sock.setTimeout(10 * 60_000, () => sock.destroy());
    let rest = "";
    let kette = Promise.resolve();
    sock.on("data", (d) => {
      rest += d;
      if (rest.length > 4096) { sock.destroy(); return; }
      const zeilen = rest.split(/\r\n|\r|\n/);
      rest = zeilen.pop();
      for (const z of zeilen) {
        const zeile = z.trim().slice(0, MAX_ZEILE);
        if (!zeile) continue;
        kette = kette.then(async () => {
          const f = await findeScanner(ctx.pool, { ip: sock.remoteAddress, zeile });
          if (!f) { sock.write("FEHLER unbekannter Scanner\r\n"); return; }
          await empfange(ctx, f.scanner, f.code);
          sock.write("OK\r\n");
        }).catch(() => { try { sock.write("FEHLER\r\n"); } catch { /* Verbindung weg */ } });
      }
    });
    sock.on("error", () => {});
  });
  server.listen(port === "auto" ? 0 : Number(port), host);
  return server;
}

export function scannerModul(router) {
  // HTTP-Push: Authorization: Scanner <token>  oder  {token, code}
  router.post("/api/v1/scanner/eingang", { oeffentlich: true }, async (ctx) => {
    const kopf = String(ctx.req.headers.authorization || "");
    const token = kopf.startsWith("Scanner ") ? kopf.slice(8).trim() : String(ctx.body?.token || "");
    if (!token || token.length < 20) throw fehler(401, "Scanner-Token fehlt. Trage den Token aus der Verwaltung im Scanner ein.");
    const h = sha(token);
    const { rows: [s] } = await ctx.pool.query("SELECT * FROM scanner WHERE token_hash = $1 AND aktiv", [h]);
    if (!s || !timingSafeEqual(Buffer.from(s.token_hash), Buffer.from(h))) {
      await protokolliere(ctx.pool, "verweigert", { benutzer: "", ip: clientIp(ctx), text: "Scanner-Eingang mit ungültigem Token" });
      throw fehler(401, "Scanner-Token ungültig. Erzeuge in der Verwaltung einen neuen Token.");
    }
    const codes = Array.isArray(ctx.body?.codes) ? ctx.body.codes.slice(0, 50) : [ctx.body?.code];
    const angenommen = [];
    for (const c of codes) { const x = await empfange(ctx, s, c); if (x) angenommen.push(x); }
    if (!angenommen.length) throw fehler(400, "Kein Code erhalten. Sende {\"code\": \"…\"}.");
    return { ok: true, angenommen };
  });

  router.get("/api/v1/verwaltung/scanner", V, async (ctx) => (await ctx.pool.query("SELECT * FROM scanner ORDER BY lower(name)")).rows.map(oeffentlich));
  // Auswahl für Scan-Seiten (Bereich packen): nur Name/ID
  router.get("/api/v1/scanner/auswahl", { bereich: "packen", stufe: "r" }, async (ctx) =>
    (await ctx.pool.query("SELECT id, name, letzter_kontakt FROM scanner WHERE aktiv ORDER BY lower(name)")).rows);

  const werte = (b, alt = {}) => {
    const w = { name: String(b?.name ?? alt.name ?? "").trim(), kennung: String(b?.kennung ?? alt.kennung ?? "").trim(), ip: String(b?.ip ?? alt.ip ?? "").trim(),
      arbeitsplatz_id: b && "arbeitsplatz_id" in b ? (b.arbeitsplatz_id === "" || b.arbeitsplatz_id == null ? null : Number(b.arbeitsplatz_id)) : alt.arbeitsplatz_id ?? null,
      aktiv: b && "aktiv" in b ? b.aktiv !== false : alt.aktiv ?? true };
    const f = {};
    if (!w.name) f.name = "Gib dem Scanner einen Namen.";
    if (!/^[A-Za-z0-9_-]{0,20}$/.test(w.kennung)) f.kennung = "Kennung nur aus Buchstaben, Ziffern, - und _ (höchstens 20).";
    if (w.ip && net.isIP(w.ip) === 0) f.ip = "Gib eine gültige IP-Adresse an, z. B. 192.168.1.50.";
    if (w.arbeitsplatz_id != null && !Number.isInteger(w.arbeitsplatz_id)) f.arbeitsplatz_id = "Wähle einen Arbeitsplatz aus der Liste.";
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    return w;
  };
  const doppelt = "Name, Kennung oder IP gibt es schon bei einem anderen Scanner. Wähle andere Werte.";
  router.post("/api/v1/verwaltung/scanner", V, async (ctx) => {
    const w = werte(ctx.body);
    const token = randomBytes(24).toString("base64url");
    try {
      const { rows: [s] } = await ctx.pool.query(`INSERT INTO scanner (name, kennung, ip, arbeitsplatz_id, aktiv, token_hash) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [w.name, w.kennung, w.ip, w.arbeitsplatz_id, w.aktiv, sha(token)]);
      await protokolliere(ctx.pool, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Scanner „${s.name}“ angelegt` });
      return { ok: true, level: "success", text: `Scanner „${s.name}“ angelegt. Notiere den Token, er wird nur jetzt angezeigt.`, scanner: oeffentlich(s), token };
    } catch (e) { throw dbFehler(e, { doppelt }); }
  });
  router.put("/api/v1/verwaltung/scanner/:id", V, async (ctx) => {
    await sichereFassung(ctx, ctx.pool, "scanner", Number(ctx.params.id), { was: "Der Scanner" });
    const id = idParam(ctx.params.id, "Dieser Scanner");
    const { rows: [alt] } = await ctx.pool.query("SELECT * FROM scanner WHERE id = $1", [id]);
    if (!alt) throw nichtGefunden("Dieser Scanner");
    const w = werte(ctx.body, alt);
    try {
      const { rows: [s] } = await ctx.pool.query("UPDATE scanner SET name = $1, kennung = $2, ip = $3, arbeitsplatz_id = $4, aktiv = $5 WHERE id = $6 RETURNING *",
        [w.name, w.kennung, w.ip, w.arbeitsplatz_id, w.aktiv, id]);
      return { ok: true, level: "success", text: "Gespeichert.", scanner: oeffentlich(s) };
    } catch (e) { throw dbFehler(e, { doppelt }); }
  });
  router.post("/api/v1/verwaltung/scanner/:id/token", V, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Scanner");
    const token = randomBytes(24).toString("base64url");
    const { rows: [s] } = await ctx.pool.query("UPDATE scanner SET token_hash = $1 WHERE id = $2 RETURNING name", [sha(token), id]);
    if (!s) throw nichtGefunden("Dieser Scanner");
    await protokolliere(ctx.pool, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Neuer Token für Scanner „${s.name}“` });
    return { ok: true, level: "success", text: "Neuer Token erzeugt. Der alte gilt nicht mehr. Trage den neuen im Scanner ein.", token };
  });
  router.delete("/api/v1/verwaltung/scanner/:id", V, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Scanner");
    const { rows: [s] } = await ctx.pool.query("DELETE FROM scanner WHERE id = $1 RETURNING name", [id]);
    if (!s) throw nichtGefunden("Dieser Scanner");
    return { ok: true, level: "success", text: `Scanner „${s.name}“ gelöscht.` };
  });
}
