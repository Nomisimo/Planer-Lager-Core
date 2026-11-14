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
