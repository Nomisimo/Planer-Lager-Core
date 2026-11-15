// Lager-Arbeitsplätze (Spec 2.4, R-11a–g, FA-25) und Anzeige-Bildschirme (R-59):
// Einrichtung per Code (Geräte-Sitzung), Sperre/Entsperren mit Mitarbeiter + PIN, ERLAUBT-Muster, Verwaltung.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { transaktion } from "@lager/db";
import { stationGesperrt, pinWartezeit, nachFehlversuch, stationDarf, pruefeArbeitsplatz, pruefeMitarbeiter, STATION_ROLLE, PIN_WARTE_SEKUNDEN } from "@lager/domain/station.js";
import { fehler, nichtGefunden, idParam, dbFehler } from "./hilfen.js";
import { sichereFassung } from "./fassung.js";
import { protokolliere, clientIp } from "./sicherheit.js";
import { hashePasswort, pruefePasswortHash } from "./passwort-hash.js";
import { erstelleSitzung, setzeCookie, sitzungSekunden } from "./auth.js";

const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const V = { bereich: "verwaltung" };
const S = { bereich: "start", nurAngemeldet: true };
const EINRICHTUNG_STUNDEN = 24;
const CODE_ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const neuerCode = () => Array.from({ length: 10 }, () => CODE_ZEICHEN[randomInt(CODE_ZEICHEN.length)]).join("");
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const AP_SQL = `SELECT a.*, m.name AS mitarbeiter_name, z.bezeichnung AS ladezone FROM arbeitsplatz a
  LEFT JOIN mitarbeiter m ON m.id = a.mitarbeiter_id AND m.aktiv LEFT JOIN ladezone z ON z.id = a.ladezone_id`;

/** Arbeitsplatz entsperrt? (inkl. deaktiviertem Mitarbeiter) */
const gesperrt = (ap) => stationGesperrt(ap) || (ap.art !== "anzeige" && !ap.mitarbeiter_name);

/**
 * Läuft in pruefeZugang für jede Geräte-Sitzung (R-11a–d): ERLAUBT-Muster, Sperre (HTTP 423), Sperrzeit verlängern,
 * Mitarbeiter für Buchungen setzen (R-11f).
 */
export async function pruefeStation(ctx) {
  const { rows: [ap] } = await ctx.pool.query(`${AP_SQL} WHERE a.benutzer_id = $1`, [ctx.nutzer.id]);
  if (!ap) return; // Geräte-Sitzung ohne Arbeitsplatz (gelöscht) → normale Rechte der Rolle
  if (!ap.aktiv) throw fehler(403, "Dieser Arbeitsplatz ist abgeschaltet. Ein Administrator kann ihn in der Verwaltung wieder aktivieren.", { weiter: "/station" });
  ctx.arbeitsplatz = ap;
  const methode = ctx.req.method || "GET";
  const r = stationDarf(ap.art, methode, ctx.url.pathname);
  if (!r.erlaubt) {
    await protokolliere(ctx.pool, "verweigert", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Arbeitsplatz ${ap.name}: ${methode} ${ctx.url.pathname} (R-11d)` });
    throw fehler(403, "Das geht am Arbeitsplatz nicht. Hier gibt es nur Packen, Rückgabe und Scannen – zurück zur Startseite.", { weiter: "/station" });
  }
  if (r.sperrfrei) return;
  if (gesperrt(ap)) {
    if (ap.mitarbeiter_id) await ctx.pool.query("UPDATE arbeitsplatz SET mitarbeiter_id = NULL WHERE id = $1", [ap.id]); // R-11b
    throw fehler(423, "Der Arbeitsplatz ist gesperrt. Tippe deinen Namen an, um weiterzumachen.", { gesperrt: true });
  }
  await ctx.pool.query("UPDATE arbeitsplatz SET letzte_aktivitaet = now(), letzter_kontakt = now() WHERE id = $1", [ap.id]);
  ctx.mitarbeiter = { id: ap.mitarbeiter_id, name: ap.mitarbeiter_name };
}

/** Startprojekt eines Packplatzes (R-11e): ältestes offenes Projekt seiner Ladezone. */
async function zonenProjekt(db, zoneId) {
  if (!zoneId) return null;
  const { rows: [p] } = await db.query(`SELECT id, nummer, name FROM projekt WHERE ladezone_id = $1 AND status NOT IN ('abgeschlossen','storniert')
    ORDER BY zone_seit NULLS LAST, id LIMIT 1`, [zoneId]);
  return p || null;
}

async function zustand(ctx, apId) {
  const { rows: [ap] } = await ctx.pool.query(`${AP_SQL} WHERE a.id = $1`, [apId]);
  const g = gesperrt(ap);
  const { rows: [s] } = await ctx.pool.query("SELECT csrf FROM sitzung WHERE token_hash = $1", [ctx.sitzung.tokenHash]);
  const liste = g ? (await ctx.pool.query("SELECT id, name, pin_hash <> '' AS pin FROM mitarbeiter WHERE aktiv ORDER BY lower(name)")).rows : [];
  return { ok: true, eingerichtet: true, csrf: s?.csrf || undefined,
    arbeitsplatz: { id: ap.id, name: ap.name, art: ap.art, ladezone_id: ap.ladezone_id, ladezone: ap.ladezone, funktionstest: ap.funktionstest, sperrzeit_minuten: ap.sperrzeit_minuten },
    gesperrt: g, wartezeit: pinWartezeit(ap), mitarbeiter: g ? null : { id: ap.mitarbeiter_id, name: ap.mitarbeiter_name }, mitarbeiterListe: liste,
    projekt: ap.art === "packen" ? await zonenProjekt(ctx.pool, ap.ladezone_id) : null };
}

const apOeffentlich = (a) => ({ id: a.id, name: a.name, art: a.art, ladezone_id: a.ladezone_id, ladezone: a.ladezone, sperrzeit_minuten: a.sperrzeit_minuten,
  funktionstest: a.funktionstest, aktiv: a.aktiv, mitarbeiter: a.mitarbeiter_name || null, gesperrt: a.art !== "anzeige" && gesperrt(a),
  letzter_kontakt: a.letzter_kontakt, eingerichtet: !!a.eingerichtet, code_offen: !!a.einrichtung_hash && a.einrichtung_bis > new Date() });

export function stationModul(router) {
  // Einrichtung: Code aus der Verwaltung → dauerhafte Geräte-Sitzung (Cookie)
  router.post("/api/v1/station/einrichten", { oeffentlich: true }, async (ctx) => {
    const code = normCode(ctx.body?.code);
    const ip = clientIp(ctx);
    const { rows: [ap] } = code.length === 10 ? await ctx.pool.query(`UPDATE arbeitsplatz SET einrichtung_hash = '', einrichtung_bis = NULL
      WHERE einrichtung_hash = $1 AND einrichtung_bis > now() AND aktiv RETURNING id, name, benutzer_id`, [sha(code)]) : { rows: [] };
    if (!ap?.benutzer_id) {
      await protokolliere(ctx.pool, "fehlversuch", { ip, text: "Arbeitsplatz-Einrichtung mit falschem Code" });
      throw fehler(400, "Dieser Einrichtungscode ist falsch oder abgelaufen. Lass dir in der Verwaltung einen neuen erzeugen.", { felder: { code: "Code prüfen" } });
    }
    const { token } = await erstelleSitzung(ctx.pool, ap.benutzer_id, "geraet", ip, ctx.req.headers["user-agent"]);
    setzeCookie(ctx, token, sitzungSekunden("geraet"));
    await protokolliere(ctx.pool, "login", { benutzer: `Arbeitsplatz ${ap.name}`, ip, text: "Arbeitsplatz eingerichtet" });
    return { ok: true, level: "success", text: `Eingerichtet als „${ap.name}“.` };
  });

  router.get("/api/v1/station/zustand", S, async (ctx) => {
    if (!ctx.arbeitsplatz) return { ok: true, eingerichtet: false };
    const ap = ctx.arbeitsplatz;
    if (ap.mitarbeiter_id && gesperrt(ap)) await ctx.pool.query("UPDATE arbeitsplatz SET mitarbeiter_id = NULL WHERE id = $1", [ap.id]);
    await ctx.pool.query("UPDATE arbeitsplatz SET letzter_kontakt = now() WHERE id = $1", [ap.id]);
    return zustand(ctx, ap.id);
  });

  // R-11a / R-11c Entsperren
  router.post("/api/v1/station/entsperren", S, async (ctx) => {
    if (!ctx.arbeitsplatz) throw fehler(400, "Dieses Gerät ist kein Arbeitsplatz.");
    const mid = idParam(ctx.body?.mitarbeiter, "Dieser Mitarbeiter");
    const pin = String(ctx.body?.pin ?? "");
    const r = await transaktion(ctx.pool, async (c) => {
      const { rows: [ap] } = await c.query("SELECT * FROM arbeitsplatz WHERE id = $1 FOR UPDATE", [ctx.arbeitsplatz.id]);
      const warte = pinWartezeit(ap);
      if (warte > 0) return { warte };
      const { rows: [m] } = await c.query("SELECT id, name, pin_hash FROM mitarbeiter WHERE id = $1 AND aktiv", [mid]);
      if (!m) throw nichtGefunden("Dieser Mitarbeiter");
      if (m.pin_hash && !(await pruefePasswortHash(pin, m.pin_hash))) {
        const f = nachFehlversuch(ap.fehlversuche);
        await c.query("UPDATE arbeitsplatz SET fehlversuche = $1, gesperrt_bis = $2 WHERE id = $3", [f.fehlversuche, f.gesperrtBis, ap.id]);
        return { falsch: f, name: m.name };
      }
      await c.query("UPDATE arbeitsplatz SET mitarbeiter_id = $1, letzte_aktivitaet = now(), letzter_kontakt = now(), fehlversuche = 0, gesperrt_bis = NULL WHERE id = $2", [m.id, ap.id]);
      return { ok: m };
    });
    if (r.warte) throw fehler(429, `Zu viele falsche PINs. Warte noch ${r.warte} Sekunden und versuche es dann erneut.`, { wartezeit: r.warte });
    if (r.falsch) {
      await protokolliere(ctx.pool, "fehlversuch", { benutzer: `Arbeitsplatz ${ctx.arbeitsplatz.name}`, ip: clientIp(ctx), text: `Falsche PIN für ${r.name} (R-11c)` });
      const text = r.falsch.gesperrtBis ? `5 falsche PINs in Folge. Warte ${PIN_WARTE_SEKUNDEN} Sekunden und versuche es dann erneut.` : `Falsche PIN. Noch ${r.falsch.rest} Versuch(e), dann musst du kurz warten.`;
      throw fehler(r.falsch.gesperrtBis ? 429 : 400, text, { wartezeit: r.falsch.gesperrtBis ? PIN_WARTE_SEKUNDEN : 0, felder: { pin: "PIN prüfen" } });
    }
    return { ...(await zustand(ctx, ctx.arbeitsplatz.id)), level: "success", text: `Hallo ${r.ok.name}!` };
  });

  router.post("/api/v1/station/sperren", S, async (ctx) => {
    if (!ctx.arbeitsplatz) throw fehler(400, "Dieses Gerät ist kein Arbeitsplatz.");
    await ctx.pool.query("UPDATE arbeitsplatz SET mitarbeiter_id = NULL WHERE id = $1", [ctx.arbeitsplatz.id]);
    return { ...(await zustand(ctx, ctx.arbeitsplatz.id)), level: "info", text: "Gesperrt." };
  });

  // ── FA-25 Verwaltung: Arbeitsplätze ──
  const ladeListe = async (db) => (await db.query(`${AP_SQL.replace("SELECT a.*,", "SELECT a.*, EXISTS (SELECT 1 FROM sitzung s WHERE s.benutzer_id = a.benutzer_id AND s.art = 'geraet') AS eingerichtet,")} ORDER BY lower(a.name)`)).rows.map(apOeffentlich);
  router.get("/api/v1/verwaltung/arbeitsplaetze", V, async (ctx) => ladeListe(ctx.pool));
  const speichereAp = async (ctx, id) => {
    const { werte: w, fehler: f } = pruefeArbeitsplatz(ctx.body || {});
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    const doppelt = `Einen Arbeitsplatz „${w.name}“ gibt es schon. Wähle einen anderen Namen.`;
    try {
      return await transaktion(ctx.pool, async (c) => {
        if (id) {
          const { rows: [a] } = await c.query(`UPDATE arbeitsplatz SET name = $1, art = $2, ladezone_id = $3, sperrzeit_minuten = $4, funktionstest = $5, aktiv = $6,
            mitarbeiter_id = CASE WHEN $6 THEN mitarbeiter_id END WHERE id = $7 RETURNING benutzer_id`, [w.name, w.art, w.ladezone_id, w.sperrzeit_minuten, w.funktionstest, w.aktiv, id]);
          if (!a) throw nichtGefunden("Dieser Arbeitsplatz");
          // Konto bleibt aktiv: „abgeschaltet“ prüft pruefeStation und meldet es verständlich; die Sitzung bleibt fürs Wiedereinschalten.
          await c.query("UPDATE benutzer SET name = $1, rolle_id = (SELECT id FROM rolle WHERE name = $2) WHERE id = $3", [w.name, STATION_ROLLE[w.art], a.benutzer_id]);
          return { ok: true, level: "success", text: "Arbeitsplatz gespeichert." };
        }
        // Eigenes Konto der Rolle „Lager-Arbeitsplatz“ bzw. „Anzeige (Bildschirm)“; Passwort zufällig, Anmeldung nur per Einrichtungscode.
        const { rows: [b] } = await c.query(`INSERT INTO benutzer (benutzername, name, passwort_hash, rolle_id)
          VALUES ($1, $2, $3, (SELECT id FROM rolle WHERE name = $4)) RETURNING id`, [`arbeitsplatz-${randomBytes(4).toString("hex")}`, w.name, await hashePasswort(randomBytes(24).toString("base64url")), STATION_ROLLE[w.art]]);
        const code = neuerCode();
        const { rows: [a] } = await c.query(`INSERT INTO arbeitsplatz (name, art, ladezone_id, sperrzeit_minuten, funktionstest, aktiv, benutzer_id, einrichtung_hash, einrichtung_bis)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(hours => $9)) RETURNING id`, [w.name, w.art, w.ladezone_id, w.sperrzeit_minuten, w.funktionstest, w.aktiv, b.id, sha(code), EINRICHTUNG_STUNDEN]);
        return { ok: true, level: "success", id: a.id, code, text: `Arbeitsplatz ${w.name} angelegt.` };
      });
    } catch (e) { throw dbFehler(e, { doppelt }); }
  };
  router.post("/api/v1/verwaltung/arbeitsplaetze", V, async (ctx) => speichereAp(ctx, null));
  router.put("/api/v1/verwaltung/arbeitsplaetze/:id", V, async (ctx) => { const id = idParam(ctx.params.id, "Dieser Arbeitsplatz"); await sichereFassung(ctx, ctx.pool, "arbeitsplatz", id, { was: "Der Arbeitsplatz" }); return speichereAp(ctx, id); });
  router.post("/api/v1/verwaltung/arbeitsplaetze/:id/einrichtung", V, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Arbeitsplatz");
    const code = neuerCode();
    const { rows: [a] } = await ctx.pool.query(`UPDATE arbeitsplatz SET einrichtung_hash = $1, einrichtung_bis = now() + make_interval(hours => $2) WHERE id = $3 RETURNING name`, [sha(code), EINRICHTUNG_STUNDEN, id]);
    if (!a) throw nichtGefunden("Dieser Arbeitsplatz");
    return { ok: true, code, text: `Neuer Einrichtungscode für ${a.name}, gültig ${EINRICHTUNG_STUNDEN} Stunden.` };
  });
  router.post("/api/v1/verwaltung/arbeitsplaetze/:id/trennen", V, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Arbeitsplatz");
    const { rows: [a] } = await ctx.pool.query("UPDATE arbeitsplatz SET mitarbeiter_id = NULL WHERE id = $1 RETURNING name, benutzer_id", [id]);
    if (!a) throw nichtGefunden("Dieser Arbeitsplatz");
    await ctx.pool.query("DELETE FROM sitzung WHERE benutzer_id = $1", [a.benutzer_id]);
    return { ok: true, level: "success", text: `${a.name} ist abgemeldet. Zum Wiederverbinden einen neuen Einrichtungscode erzeugen.` };
  });
  router.delete("/api/v1/verwaltung/arbeitsplaetze/:id", V, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Dieser Arbeitsplatz");
    const { rows: [a] } = await c.query("DELETE FROM arbeitsplatz WHERE id = $1 RETURNING name, benutzer_id", [id]);
    if (!a) throw nichtGefunden("Dieser Arbeitsplatz");
    if (a.benutzer_id) await c.query("DELETE FROM benutzer WHERE id = $1", [a.benutzer_id]);
    return { ok: true, level: "success", text: `Arbeitsplatz ${a.name} gelöscht.` };
  }));

  // ── FA-25 Verwaltung: Mitarbeiter (ohne Benutzerkonto, R-11a) ──
  router.get("/api/v1/verwaltung/mitarbeiter", V, async (ctx) => (await ctx.pool.query("SELECT id, name, aktiv, version, pin_hash <> '' AS pin FROM mitarbeiter ORDER BY lower(name)")).rows);
  const speichereM = async (ctx, id) => {
    const { werte: w, fehler: f } = pruefeMitarbeiter(ctx.body || {});
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    const hash = w.pin === undefined ? null : w.pin ? await hashePasswort(w.pin) : "";
    try {
      const { rows: [m] } = id
        ? await ctx.pool.query("UPDATE mitarbeiter SET name = $1, aktiv = $2, pin_hash = coalesce($3, pin_hash) WHERE id = $4 RETURNING id", [w.name, w.aktiv, hash, id])
        : await ctx.pool.query("INSERT INTO mitarbeiter (name, aktiv, pin_hash) VALUES ($1, $2, $3) RETURNING id", [w.name, w.aktiv, hash || ""]);
      if (!m) throw nichtGefunden("Dieser Mitarbeiter");
      return { ok: true, level: "success", id: m.id, text: id ? "Mitarbeiter gespeichert." : `${w.name} angelegt.` };
    } catch (e) { throw dbFehler(e, { doppelt: `Einen Mitarbeiter „${w.name}“ gibt es schon. Ergänze z. B. den Nachnamen.` }); }
  };
  router.post("/api/v1/verwaltung/mitarbeiter", V, async (ctx) => speichereM(ctx, null));
  router.put("/api/v1/verwaltung/mitarbeiter/:id", V, async (ctx) => { const id = idParam(ctx.params.id, "Dieser Mitarbeiter"); await sichereFassung(ctx, ctx.pool, "mitarbeiter", id, { was: "Der Mitarbeiter" }); return speichereM(ctx, id); });
  router.delete("/api/v1/verwaltung/mitarbeiter/:id", V, async (ctx) => {
    const { rows: [m] } = await ctx.pool.query("DELETE FROM mitarbeiter WHERE id = $1 RETURNING name", [idParam(ctx.params.id, "Dieser Mitarbeiter")]);
    if (!m) throw nichtGefunden("Dieser Mitarbeiter");
    return { ok: true, level: "success", text: `${m.name} gelöscht. Bisherige Buchungen behalten den Namen.` };
  });
}
