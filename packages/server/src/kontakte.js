// FA-28 Ansprechpartner je Kunde und Kundenhistorie (Kommunikation, Notizen mit Zeit/Person).
import { transaktion } from "@lager/db";
import { fehler, nichtGefunden, idParam } from "./hilfen.js";

const K = { bereich: "kunden" };
export const HISTORIE_ARTEN = Object.freeze({ notiz: "Notiz", telefon: "Telefonat", email: "E-Mail", treffen: "Treffen" });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pruefeKontakt(b) {
  const w = Object.fromEntries(["name", "funktion", "telefon", "email", "notiz"].map((k) => [k, String(b?.[k] ?? "").trim()]));
  w.haupt = !!b?.haupt;
  const f = {};
  if (!w.name) f.name = "Gib den Namen des Ansprechpartners ein.";
  if (w.email && !EMAIL_RE.test(w.email)) f.email = "Die E-Mail-Adresse sieht nicht richtig aus.";
  if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
  return w;
}

async function kundeDa(c, id) {
  const { rows: [k] } = await c.query("SELECT id, anonymisiert FROM kunde WHERE id = $1 FOR UPDATE", [id]);
  if (!k) throw nichtGefunden("Diesen Kunden");
  if (k.anonymisiert) throw fehler(409, "Dieser Kunde ist anonymisiert. Neue Personendaten sind hier nicht mehr möglich.");
}

const sende = (ctx, id) => ctx.hub?.sende({ typ: "kunde.geaendert", id, bereich: "kunden" });

export function kontakteModul(router) {
  router.post("/api/v1/kunden/:id/kontakte", K, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Kunde");
    const w = pruefeKontakt(ctx.body);
    const r = await transaktion(ctx.pool, async (c) => {
      await kundeDa(c, id);
      if (w.haupt) await c.query("UPDATE kunde_kontakt SET haupt = false WHERE kunde_id = $1 AND haupt", [id]);
      return (await c.query("INSERT INTO kunde_kontakt (kunde_id, name, funktion, telefon, email, notiz, haupt) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [id, w.name, w.funktion, w.telefon, w.email, w.notiz, w.haupt])).rows[0];
    });
    sende(ctx, id);
    return { ok: true, level: "success", id: r.id, text: `Ansprechpartner ${w.name} angelegt.` };
  });
  router.put("/api/v1/kontakte/:id", K, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Ansprechpartner");
    const w = pruefeKontakt(ctx.body);
    const kundeId = await transaktion(ctx.pool, async (c) => {
      const { rows: [a] } = await c.query("SELECT kunde_id FROM kunde_kontakt WHERE id = $1", [id]);
      if (!a) throw nichtGefunden("Diesen Ansprechpartner");
      await kundeDa(c, a.kunde_id);
      if (w.haupt) await c.query("UPDATE kunde_kontakt SET haupt = false WHERE kunde_id = $1 AND haupt AND id <> $2", [a.kunde_id, id]);
      await c.query("UPDATE kunde_kontakt SET name = $1, funktion = $2, telefon = $3, email = $4, notiz = $5, haupt = $6 WHERE id = $7",
        [w.name, w.funktion, w.telefon, w.email, w.notiz, w.haupt, id]);
      return a.kunde_id;
    });
    sende(ctx, kundeId);
    return { ok: true, level: "success", text: `Ansprechpartner ${w.name} gespeichert.` };
  });
  router.delete("/api/v1/kontakte/:id", K, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Ansprechpartner");
    const { rows: [a] } = await ctx.pool.query("DELETE FROM kunde_kontakt WHERE id = $1 RETURNING kunde_id, name", [id]);
    if (!a) throw nichtGefunden("Diesen Ansprechpartner");
    sende(ctx, a.kunde_id);
    return { ok: true, level: "success", text: `Ansprechpartner ${a.name} entfernt.` };
  });

  router.post("/api/v1/kunden/:id/historie", K, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Kunde");
    const b = ctx.body || {};
    const text = String(b.text ?? "").trim();
    const art = String(b.art || "notiz");
    const f = {};
    if (!text) f.text = "Schreib kurz, worum es ging.";
    if (!HISTORIE_ARTEN[art]) f.art = "Wähle Notiz, Telefonat, E-Mail oder Treffen.";
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    const kontakt = b.kontakt_id ? Number(b.kontakt_id) : null;
    await transaktion(ctx.pool, async (c) => {
      await kundeDa(c, id);
      if (kontakt) {
        const { rows: [kk] } = await c.query("SELECT 1 FROM kunde_kontakt WHERE id = $1 AND kunde_id = $2", [kontakt, id]);
        if (!kk) throw fehler(400, "Dieser Ansprechpartner gehört nicht zum Kunden. Wähle ihn aus der Liste.", { felder: { kontakt_id: "Unbekannt" } });
      }
      await c.query("INSERT INTO kunde_historie (kunde_id, art, text, kontakt_id, von, von_id) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, art, text, kontakt, ctx.nutzer.name || ctx.nutzer.benutzername, ctx.nutzer.id]);
    });
    sende(ctx, id);
    return { ok: true, level: "success", text: `${HISTORIE_ARTEN[art]} eingetragen.` };
  });
  // Nur wer den Eintrag geschrieben hat oder ein Admin darf ihn löschen (Historie bleibt nachvollziehbar).
  router.delete("/api/v1/historie/:id", K, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieser Eintrag");
    const { rows: [h] } = await ctx.pool.query("SELECT kunde_id, von_id FROM kunde_historie WHERE id = $1", [id]);
    if (!h) throw nichtGefunden("Diesen Eintrag");
    if (!ctx.nutzer.admin && h.von_id !== ctx.nutzer.id) throw fehler(403, "Nur wer den Eintrag geschrieben hat, kann ihn löschen. Frag einen Admin.");
    await ctx.pool.query("DELETE FROM kunde_historie WHERE id = $1", [id]);
    sende(ctx, h.kunde_id);
    return { ok: true, level: "success", text: "Eintrag gelöscht." };
  });
}
