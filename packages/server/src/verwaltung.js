// Verwaltung (Bereich verwaltung, nur Admin – R-03): Einstellungen (FA-48), Rollen (R-06, R-07), Benutzer (FA-47 Grundteil).
import { mitStandard, pruefeEinstellungen, normalisiereRechte, istAdminRechte, bleibtAdmin, pruefePasswort } from "@lager/domain";
import { transaktion } from "@lager/db";
import { HttpFehler } from "./router.js";
import { sichereFassung } from "./fassung.js";
import { protokolliere, clientIp } from "./sicherheit.js";
import { randomBytes } from "node:crypto";
import { hashePasswort } from "./passwort-hash.js";

const V = { bereich: "verwaltung" };
const fehler = (status, text, extra) => new HttpFehler(status, text, { ok: false, level: "error", text, ...extra });

export async function ladeEinstellungen(db) {
  const { rows } = await db.query("SELECT werte FROM einstellungen WHERE id = 1");
  return mitStandard(rows[0]?.werte);
}

/** R-07 im laufenden Bestand prüfen (in Transaktion mit Sperre). */
async function adminBleibt(c, aenderung) {
  const { rows } = await c.query(`SELECT b.id, b.aktiv, r.rechte FROM benutzer b JOIN rolle r ON r.id = b.rolle_id FOR UPDATE OF b`);
  const liste = rows.map((r) => ({ id: r.id, aktiv: r.aktiv, admin: istAdminRechte(r.rechte) }));
  if (!bleibtAdmin(liste, aenderung)) throw fehler(409, "Es muss immer mindestens ein aktiver Administrator bleiben. Ernenne zuerst einen anderen Administrator.");
}

export function verwaltungModul(router) {
  // Öffentlicher Teil der Einstellungen für alle Angemeldeten (Firmenname, Design-Standard).
  router.get("/api/v1/einstellungen/basis", { bereich: "start" }, async (ctx) => {
    const e = await ladeEinstellungen(ctx.pool);
    return { firma: { name: e.firma.name }, design_standard: e.design_standard, folgetag_prozent: e.folgetag_prozent,
      tag_stunden_standard: e.tag_stunden_standard, tag_stunden_erweitert: e.tag_stunden_erweitert, kleinunternehmer: e.kleinunternehmer, ust_satz: e.ust_satz };
  });
  router.get("/api/v1/verwaltung/einstellungen", V, async (ctx) => ({ ...(await ladeEinstellungen(ctx.pool)), version: (await ctx.pool.query("SELECT version FROM einstellungen WHERE id = 1")).rows[0]?.version ?? 1 }));
  router.put("/api/v1/verwaltung/einstellungen", V, async (ctx) => transaktion(ctx.pool, async (c) => {
    await sichereFassung(ctx, c, "einstellungen", 1, { was: "Die Einstellungen" });
    const { rows } = await c.query("SELECT werte FROM einstellungen WHERE id = 1 FOR UPDATE");
    const { version: _v, ...neu } = ctx.body || {};
    const r = pruefeEinstellungen(neu, mitStandard(rows[0]?.werte));
    if (!r.ok) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: r.fehler });
    const { rows: [v] } = await c.query("UPDATE einstellungen SET werte = $1, geaendert = now() WHERE id = 1 RETURNING version", [JSON.stringify(r.werte)]);
    await protokolliere(c, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Einstellungen geändert: ${Object.keys(neu).join(", ")}` });
    ctx.hub?.sende({ typ: "einstellungen.geaendert", bereich: "start" });
    return { ok: true, level: "success", text: "Einstellungen gespeichert.", werte: r.werte, version: v.version };
  }));

  // Rollen (R-06)
  router.get("/api/v1/verwaltung/rollen", V, async (ctx) =>
    (await ctx.pool.query("SELECT id, name, rechte, eingebaut, version, (SELECT count(*) FROM benutzer b WHERE b.rolle_id = rolle.id) AS benutzer FROM rolle ORDER BY eingebaut DESC, name")).rows);
  router.post("/api/v1/verwaltung/rollen", V, async (ctx) => {
    const name = String(ctx.body?.name || "").trim();
    if (!name) throw fehler(400, "Gib der Rolle einen Namen.", { felder: { name: "Pflichtfeld" } });
    try {
      const { rows } = await ctx.pool.query("INSERT INTO rolle (name, rechte) VALUES ($1, $2) RETURNING id, name, rechte, eingebaut",
        [name, JSON.stringify(normalisiereRechte(ctx.body?.rechte))]);
      await protokolliere(ctx.pool, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Rolle angelegt: ${name}` });
      return rows[0];
    } catch (e) {
      if (e.code === "23505") throw fehler(409, `Die Rolle „${name}“ gibt es schon. Wähle einen anderen Namen.`);
      throw e;
    }
  });
  router.put("/api/v1/verwaltung/rollen/:id", V, async (ctx) => transaktion(ctx.pool, async (c) => {
    await sichereFassung(ctx, c, "rolle", Number(ctx.params.id), { was: "Die Rolle" });
    const { rows } = await c.query("SELECT * FROM rolle WHERE id = $1 FOR UPDATE", [ctx.params.id]);
    const r = rows[0];
    if (!r) throw fehler(404, "Diese Rolle gibt es nicht mehr. Lade die Liste neu.");
    const rechte = ctx.body?.rechte ? normalisiereRechte(ctx.body.rechte) : r.rechte;
    const name = r.eingebaut ? r.name : String(ctx.body?.name || r.name).trim();
    if (istAdminRechte(r.rechte) && !istAdminRechte(rechte)) {
      // Rolle verliert Admin-Rechte: alle Benutzer dieser Rolle verlieren Admin (R-07).
      const { rows: bs } = await c.query(`SELECT b.id, b.aktiv, r.rechte, b.rolle_id FROM benutzer b JOIN rolle r ON r.id = b.rolle_id FOR UPDATE OF b`);
      const nach = bs.map((b) => ({ id: b.id, aktiv: b.aktiv, admin: b.rolle_id === r.id ? false : istAdminRechte(b.rechte) }));
      if (!nach.some((b) => b.aktiv && b.admin)) throw fehler(409, "Es muss immer mindestens ein aktiver Administrator bleiben. Ernenne zuerst einen anderen Administrator.");
    }
    await c.query("UPDATE rolle SET name = $1, rechte = $2 WHERE id = $3", [name, JSON.stringify(rechte), r.id]);
    await protokolliere(c, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Rolle geändert: ${name}` });
    return { id: r.id, name, rechte, eingebaut: r.eingebaut };
  }));
  router.delete("/api/v1/verwaltung/rollen/:id", V, async (ctx) => {
    const { rows } = await ctx.pool.query("SELECT name, eingebaut, (SELECT count(*) FROM benutzer WHERE rolle_id = rolle.id) AS n FROM rolle WHERE id = $1", [ctx.params.id]);
    const r = rows[0];
    if (!r) throw fehler(404, "Diese Rolle gibt es nicht mehr. Lade die Liste neu.");
    if (r.eingebaut) throw fehler(409, `„${r.name}“ ist eine eingebaute Rolle und kann nicht gelöscht werden.`);
    if (r.n > 0) throw fehler(409, `Der Rolle „${r.name}“ sind noch ${r.n} Benutzer zugeordnet. Weise ihnen zuerst eine andere Rolle zu.`);
    await ctx.pool.query("DELETE FROM rolle WHERE id = $1", [ctx.params.id]);
    await protokolliere(ctx.pool, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Rolle gelöscht: ${r.name}` });
    return { ok: true };
  });

  // Benutzer (FA-47 Grundteil; R-07, R-09)
  router.get("/api/v1/verwaltung/benutzer", V, async (ctx) =>
    (await ctx.pool.query(`SELECT b.id, b.version, b.benutzername, b.name, b.email, b.aktiv, b.totp_aktiv, b.letzter_login, b.passwort_wechsel, b.rolle_id, r.name AS rolle
      FROM benutzer b JOIN rolle r ON r.id = b.rolle_id ORDER BY lower(b.benutzername)`)).rows);
  router.post("/api/v1/verwaltung/benutzer", V, async (ctx) => {
    const { benutzername = "", name = "", email = "", passwort = "", rolle_id } = ctx.body || {};
    const felder = {};
    if (!/^[\w.@+-]{2,60}$/.test(benutzername)) felder.benutzername = "Benutzername: 2–60 Zeichen, nur Buchstaben, Ziffern und . @ + - _";
    const pf = pruefePasswort(passwort, benutzername);
    if (pf.length) felder.passwort = pf.join(" ");
    if (!Number.isInteger(rolle_id)) felder.rolle_id = "Wähle eine Rolle.";
    if (Object.keys(felder).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder });
    try {
      // D-133: Das vom Admin vergebene Passwort ist ein Startpasswort – beim ersten Login muss der Benutzer ein eigenes setzen.
      const { rows } = await ctx.pool.query(`INSERT INTO benutzer (benutzername, name, email, passwort_hash, rolle_id, passwort_wechsel)
        VALUES ($1, $2, $3, $4, $5, true) RETURNING id`, [benutzername, name || benutzername, email, await hashePasswort(passwort), rolle_id]);
      await protokolliere(ctx.pool, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Benutzer angelegt: ${benutzername}` });
      return { id: rows[0].id };
    } catch (e) {
      if (e.code === "23505") throw fehler(409, `Den Benutzernamen „${benutzername}“ gibt es schon. Wähle einen anderen.`, { felder: { benutzername: "schon vergeben" } });
      if (e.code === "23503") throw fehler(400, "Diese Rolle gibt es nicht. Wähle eine Rolle aus der Liste.", { felder: { rolle_id: "unbekannt" } });
      throw e;
    }
  });
  router.put("/api/v1/verwaltung/benutzer/:id", V, async (ctx) => transaktion(ctx.pool, async (c) => {
    await sichereFassung(ctx, c, "benutzer", Number(ctx.params.id), { was: "Der Benutzer" });
    const id = Number(ctx.params.id);
    const { rows } = await c.query("SELECT * FROM benutzer WHERE id = $1 FOR UPDATE", [id]);
    const b = rows[0];
    if (!b) throw fehler(404, "Diesen Benutzer gibt es nicht mehr. Lade die Liste neu.");
    const neu = { name: b.name, email: b.email, aktiv: b.aktiv, rolle_id: b.rolle_id, ...pick(ctx.body, ["name", "email", "aktiv", "rolle_id"]) };
    const zielRolle = (await c.query("SELECT rechte FROM rolle WHERE id = $1", [neu.rolle_id])).rows[0];
    if (!zielRolle) throw fehler(400, "Diese Rolle gibt es nicht. Wähle eine Rolle aus der Liste.", { felder: { rolle_id: "unbekannt" } });
    await adminBleibt(c, { id, aktiv: !!neu.aktiv, admin: istAdminRechte(zielRolle.rechte) });
    let hash = b.passwort_hash;
    if (ctx.body?.passwort) {
      const pf = pruefePasswort(ctx.body.passwort, b.benutzername);
      if (pf.length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: { passwort: pf.join(" ") } });
      hash = await hashePasswort(ctx.body.passwort);
    }
    // D-133: Setzt ein Admin das Passwort eines anderen, muss der Benutzer es beim nächsten Login ändern.
    const wechsel = hash !== b.passwort_hash ? id !== ctx.nutzer.id : b.passwort_wechsel;
    await c.query("UPDATE benutzer SET name = $1, email = $2, aktiv = $3, rolle_id = $4, passwort_hash = $5, passwort_wechsel = $6 WHERE id = $7",
      [neu.name, neu.email, !!neu.aktiv, neu.rolle_id, hash, wechsel, id]);
    if (hash !== b.passwort_hash) await c.query("DELETE FROM anmelde_versuch WHERE lower(benutzername) = lower($1)", [b.benutzername]);
    if (!neu.aktiv || hash !== b.passwort_hash) await c.query("DELETE FROM sitzung WHERE benutzer_id = $1", [id]);
    await protokolliere(c, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Benutzer geändert: ${b.benutzername}` });
    return { ok: true };
  }));
  // D-133: Passwort zurücksetzen – Zufalls-Startpasswort (nur einmal in der Antwort), Wechsel beim nächsten Login,
  // alle Sitzungen beendet, Sperre nach Fehlversuchen aufgehoben. Die Zwei-Faktor-Anmeldung bleibt bestehen.
  router.post("/api/v1/verwaltung/benutzer/:id/passwort-zuruecksetzen", V, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = Number(ctx.params.id);
    if (id === ctx.nutzer.id) throw fehler(400, "Dein eigenes Passwort änderst du über dein Profil (Passwort ändern), nicht hier.");
    const { rows: [b] } = await c.query("SELECT benutzername FROM benutzer WHERE id = $1 FOR UPDATE", [id]);
    if (!b) throw fehler(404, "Diesen Benutzer gibt es nicht mehr. Lade die Liste neu.");
    const passwort = `Start-${randomBytes(9).toString("base64url")}7`;
    await c.query("UPDATE benutzer SET passwort_hash = $1, passwort_wechsel = true WHERE id = $2", [await hashePasswort(passwort), id]);
    await c.query("DELETE FROM sitzung WHERE benutzer_id = $1", [id]);
    await c.query("DELETE FROM anmelde_versuch WHERE lower(benutzername) = lower($1)", [b.benutzername]);
    await protokolliere(c, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Passwort zurückgesetzt: ${b.benutzername}` });
    return { ok: true, passwort, text: `Neues Startpasswort für ${b.benutzername}. Gib es persönlich weiter; beim nächsten Login muss ${b.benutzername} ein eigenes Passwort wählen.` };
  }));
  router.delete("/api/v1/verwaltung/benutzer/:id", V, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = Number(ctx.params.id);
    await adminBleibt(c, { loeschen: id });
    const { rows } = await c.query("DELETE FROM benutzer WHERE id = $1 RETURNING benutzername", [id]);
    if (!rows[0]) throw fehler(404, "Diesen Benutzer gibt es nicht mehr. Lade die Liste neu.");
    await protokolliere(c, "aktion", { benutzer: ctx.nutzer.benutzername, ip: clientIp(ctx), text: `Benutzer gelöscht: ${rows[0].benutzername}` });
    return { ok: true };
  }));

  // Sicherheitsprotokoll (FA-50 Teil): letzte 30 Tage, filterbar nach Art/Benutzer.
  router.get("/api/v1/verwaltung/sicherheit/protokoll", V, async (ctx) => {
    const { art, benutzer } = ctx.query;
    const { rows } = await ctx.pool.query(`SELECT id, zeit, art, benutzer, ip, text FROM sicherheit_ereignis
      WHERE zeit > now() - interval '30 days' AND ($1::text IS NULL OR art = $1) AND ($2::text IS NULL OR benutzer ILIKE '%' || $2 || '%')
      ORDER BY zeit DESC, id DESC LIMIT 500`, [art || null, benutzer || null]);
    return rows;
  });
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o[k]]));
