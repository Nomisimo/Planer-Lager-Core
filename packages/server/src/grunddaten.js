// Grunddaten nach jeder Migration: eingebaute Rollen (R-06), optional erster Administrator aus der Umgebung.
import { EINGEBAUTE_ROLLEN, normalisiereRechte, ROLLE_ADMIN, pruefePasswort, STANDARD_VORLAGE, KABEL_VORLAGE } from "@lager/domain";
import { hashePasswort } from "./passwort-hash.js";

export async function sichereGrunddaten(pool, { adminBenutzer, adminPasswort } = {}) {
  for (const r of EINGEBAUTE_ROLLEN) {
    await pool.query(`INSERT INTO rolle (name, rechte, eingebaut) VALUES ($1, $2, true)
      ON CONFLICT (name) DO UPDATE SET eingebaut = true`, [r.name, JSON.stringify(normalisiereRechte(r.rechte))]);
  }
  // Etiketten-Vorlagen (3.13): Standard allgemein + Kabel, nur wenn noch keine Vorlage existiert.
  const { rows: v } = await pool.query("SELECT 1 FROM etikett_vorlage LIMIT 1");
  if (!v.length) {
    for (const [t, art] of [[STANDARD_VORLAGE, "allgemein"], [KABEL_VORLAGE, "kabel"]]) {
      await pool.query(`INSERT INTO etikett_vorlage (name, art, breite_mm, hoehe_mm, farbe, standard, elemente)
        VALUES ($1, $2, $3, $4, $5, true, $6) ON CONFLICT DO NOTHING`, [t.name, art, t.breite_mm, t.hoehe_mm, t.farbe, JSON.stringify(t.elemente)]);
    }
  }
  if (adminBenutzer && adminPasswort) {
    const { rows } = await pool.query("SELECT 1 FROM benutzer LIMIT 1");
    if (!rows.length) {
      const f = pruefePasswort(adminPasswort, adminBenutzer);
      if (f.length) throw new Error("Erster Admin: " + f.join(" "));
      await pool.query(`INSERT INTO benutzer (benutzername, name, passwort_hash, rolle_id)
        VALUES ($1, $1, $2, (SELECT id FROM rolle WHERE name = $3))`, [adminBenutzer, await hashePasswort(adminPasswort), ROLLE_ADMIN]);
    }
  }
}

/** Testhilfe/Seed: Benutzer mit Rolle anlegen. */
export async function legeBenutzerAn(pool, { benutzername, passwort, rolle, name = "" }) {
  const { rows } = await pool.query(`INSERT INTO benutzer (benutzername, name, passwort_hash, rolle_id)
    VALUES ($1, $2, $3, (SELECT id FROM rolle WHERE name = $4)) RETURNING id`, [benutzername, name || benutzername, await hashePasswort(passwort), rolle]);
  return rows[0].id;
}

/**
 * Phase S: Einmal-Zugang (z. B. „sam“ auf dem Testserver). Legt den Benutzer an oder setzt ihn zurück:
 * neues Zufallspasswort, das beim ersten Login geändert werden muss, 2FA neu einzurichten, alte Sitzungen beendet.
 * @returns {Promise<string>} das Einmal-Passwort (nur einmal ausgeben)
 */
export async function einmalZugang(pool, { benutzername, rolle = ROLLE_ADMIN, name = "" }) {
  const { randomBytes } = await import("node:crypto");
  const passwort = `Einmal-${randomBytes(12).toString("base64url")}7`;
  const hash = await hashePasswort(passwort);
  const { rows: [b] } = await pool.query(`INSERT INTO benutzer (benutzername, name, passwort_hash, rolle_id, passwort_wechsel)
    VALUES ($1, $2, $3, (SELECT id FROM rolle WHERE name = $4), true)
    ON CONFLICT ((lower(benutzername))) DO UPDATE SET passwort_hash = EXCLUDED.passwort_hash, passwort_wechsel = true,
      totp_aktiv = false, totp_geheimnis = NULL, aktiv = true RETURNING id`, [benutzername, name || benutzername, hash, rolle]);
  if (!b) throw new Error(`Rolle „${rolle}“ gibt es nicht.`);
  await pool.query("DELETE FROM sitzung WHERE benutzer_id = $1", [b.id]);
  await pool.query("DELETE FROM anmelde_versuch WHERE lower(benutzername) = lower($1)", [benutzername]);
  return passwort;
}
