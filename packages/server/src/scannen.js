// Scannen (Spec 5.5, 7.2), Packstatus (FA-19), Funktionstest/Vermisst-API (7.2), Verladen (R-60, R-61).
import { transaktion } from "@lager/db";
import {
  normalisiereCode, normalisiereProjektcode, SCAN_MODI, ZIEL, hoeher, levelUebersprungen, scanText, pruefHinweis, casePruefung,
  packlistenHinweis, packFortschritt, istGesperrt, STATUS, sollInhalt, pruefstatus, PROJEKT_STATUS,
} from "@lager/domain";
import { fehler, nichtGefunden, idParam, wer, bucheBewegung, meldeVermisst } from "./hilfen.js";
import { offeneBestellung } from "./etiketten.js";
import { ladePackliste } from "./angebote.js";
import { nachVerladen } from "./projekte.js";

const P = { bereich: "packen" };

/** Angebot für Packliste/Abgleich eines Projekts: neuestes angenommenes, sonst versendetes, sonst Entwurf (D-63). */
export async function packAngebot(db, projektId) {
  const { rows: [a] } = await db.query(`SELECT id FROM angebot WHERE projekt_id = $1 AND status <> 'abgelehnt'
    ORDER BY CASE status WHEN 'angenommen' THEN 0 WHEN 'versendet' THEN 1 ELSE 2 END, id DESC LIMIT 1`, [projektId]);
  return a?.id || null;
}

const GERAET_SQL = `SELECT g.id, g.code, g.status, g.projekt_id, g.case_id, g.letzte_pruefung, g.artikel_id, a.name AS artikel, a.ist_case,
    a.inhalt_artikel_id, a.verpackungseinheit, a.pruefpflichtig, a.pruef_intervall_monate, i.mengenschritt AS inhalt_mengenschritt, i.name AS inhalt_name,
    p.nummer AS projekt_nummer, p.name AS projekt_name
  FROM geraet g JOIN artikel a ON a.id = g.artikel_id LEFT JOIN artikel i ON i.id = a.inhalt_artikel_id LEFT JOIN projekt p ON p.id = g.projekt_id`;
const soll = (g) => sollInhalt(g, g.inhalt_artikel_id ? { mengenschritt: g.inhalt_mengenschritt } : null);

/** Aktive Tasche (Schritt 7): Code, Name, Anzahl, Soll, offene (noch nicht zurück). */
async function taschenStand(c, taschenId) {
  const { rows: [t] } = await c.query(`${GERAET_SQL} WHERE g.id = $1`, [taschenId]);
  const { rows: inhalt } = await c.query("SELECT g.code, g.status FROM geraet g WHERE g.case_id = $1 ORDER BY g.code", [taschenId]);
  return { code: t.code, name: t.artikel, anzahl: inhalt.length, soll: soll(t), offen: inhalt.filter((x) => x.status !== "lager").map((x) => x.code) };
}

/**
 * Spec 5.5 Kernalgorithmus in einer Transaktion.
 * @param {object} ctx @param {{code:string, modus:string, projekt?:number|null, tasche?:string|null, angebot?:number|null}} e
 */
export async function scanne(ctx, e) {
  const roh = String(e.code ?? "").trim();
  if (!roh) throw fehler(400, "Kein Code erkannt. Scanne erneut oder tippe den Code ein.");
  // R-23: Projektcode → Packansicht dieses Projekts
  const pc = normalisiereProjektcode(roh);
  if (pc) {
    const { rows: [p] } = await ctx.pool.query("SELECT id, nummer, name FROM projekt WHERE nummer = $1", [pc]);
    if (!p) return { level: "error", text: `Kein Projekt mit der Nummer ${pc}. Prüfe die Nummer.`, meldungen: [], tasche: null, code: pc, artikel_id: null, ist_case: false, projekt: null };
    return { level: "ok", text: `Projekt ${p.nummer} ${p.name} geöffnet.`, meldungen: [], tasche: null, code: pc, artikel_id: null, ist_case: false, projekt: p, weiter: `/projekte/${p.id}/packen` };
  }
  const code = normalisiereCode(roh);
  return transaktion(ctx.pool, async (c) => {
    const leer = { meldungen: [], tasche: null, code, artikel_id: null, ist_case: false, projekt: null };
    // 1. Gerät über Code oder alte Prüf-ID (ohne Schreibweise)
    const { rows: [g] } = await c.query(`${GERAET_SQL} WHERE g.code = $1 OR (g.alte_pruef_id <> '' AND lower(g.alte_pruef_id) = lower($2))
      ORDER BY (g.code = $1) DESC LIMIT 1 FOR UPDATE OF g`, [code, roh]);
    // 2. Nicht gefunden
    if (!g) {
      const b = await offeneBestellung(c, code);
      if (b) return { ...leer, level: "error", text: `Code ${code} ist bestellt (${b.nummer}), aber noch nicht geliefert. Buche zuerst die Lieferung der Etiketten.` };
      return { ...leer, level: "error", text: `Code ${code} ist keinem Gerät zugeordnet. Prüfe den Code oder lege das Gerät im Materialplaner an.` };
    }
    // 3. Modus prüfen
    const modus = String(e.modus || "");
    if (!SCAN_MODI[modus]) return { ...leer, level: "error", text: "Unbekannter Modus. Wähle Hinzufügen, Packen oder Rückgabe." };
    let projekt = null;
    if (modus !== "rueckgabe") {
      if (!e.projekt) return { ...leer, level: "error", text: "Bitte zuerst ein Projekt wählen." };
      ({ rows: [projekt] } = await c.query("SELECT id, nummer, name, status FROM projekt WHERE id = $1 FOR UPDATE", [Number(e.projekt)]));
      if (!projekt) return { ...leer, level: "error", text: "Das gewählte Projekt gibt es nicht mehr. Wähle ein anderes Projekt." };
    }
    // 4. Ziele
    let ziele = [g];
    if (modus !== "rueckgabe" && g.ist_case) {
      const { rows: inhalt } = await c.query(`${GERAET_SQL} WHERE g.case_id = $1 ORDER BY g.code FOR UPDATE OF g`, [g.id]);
      ziele = [g, ...inhalt];
    }
    let level = "ok";
    const meldungen = [];
    const melde = (lv, t) => { level = hoeher(level, lv); meldungen.push({ level: lv, text: t }); };
    const w = wer(ctx);
    let gebucht = 0, inhalte = 0;
    // 7. Aktive Tasche (nur Rückgabe)
    let tasche = null;
    if (modus === "rueckgabe" && e.tasche && !g.ist_case) {
      const { rows: [t] } = await c.query(`${GERAET_SQL} WHERE g.code = $1 FOR UPDATE OF g`, [normalisiereCode(e.tasche)]);
      if (t?.ist_case) tasche = t;
    }
    // 5. Je Ziel
    for (const z of ziele) {
      const istG = z.id === g.id;
      if (modus === "rueckgabe" && z.status === "vermisst") {
        await c.query("UPDATE geraet SET status = 'lager', projekt_id = NULL, version = version + 1 WHERE id = $1", [z.id]);
        await bucheBewegung(c, { geraetId: z.id, projektId: z.projekt_id, aktion: "Wieder aufgetaucht", ...w });
        melde("warn", `${z.code} war als vermisst gemeldet – wieder aufgetaucht, jetzt im Lager.`);
        gebucht++;
        continue;
      }
      if (istGesperrt(z.status)) { melde(levelUebersprungen(istG), `${z.code} nicht verfügbar (${STATUS[z.status]}), übersprungen.`); continue; }
      if (modus !== "rueckgabe" && z.projekt_id && z.projekt_id !== projekt.id) {
        melde(levelUebersprungen(istG), `${z.code} ist bereits in Projekt ${z.projekt_nummer} ${z.projekt_name}, übersprungen.`);
        continue;
      }
      const ziel = ZIEL[modus];
      if (modus === "rueckgabe") {
        await c.query("UPDATE geraet SET status = 'lager', projekt_id = NULL, version = version + 1 WHERE id = $1", [z.id]);
        await bucheBewegung(c, { geraetId: z.id, projektId: z.projekt_id, aktion: "Zurück im Lager", ...w });
      } else if (z.status === ziel.status && z.projekt_id === projekt.id) {
        // D-62: doppelter Scan im selben Zustand bucht nichts neu, zählt aber als erledigt
        if (istG) melde("warn", `${z.code} ist schon ${modus === "packen" ? "gepackt" : "diesem Projekt zugeordnet"}.`);
      } else {
        await c.query("UPDATE geraet SET status = $1, projekt_id = $2, version = version + 1 WHERE id = $3", [ziel.status, projekt.id, z.id]);
        await bucheBewegung(c, { geraetId: z.id, projektId: projekt.id, aktion: `${ziel.text}: ${projekt.nummer}${istG ? "" : ` (in ${g.code})`}`, ...w });
      }
      gebucht++;
      if (!istG) inhalte++;
      if (modus !== "rueckgabe") {
        const h = pruefHinweis(z.code, pruefstatus(z, z.letzte_pruefung).status);
        if (h) melde("warn", h);
      }
    }
    // 6. Case-Prüfungen
    if (modus !== "rueckgabe" && g.ist_case && gebucht) {
      for (const t of casePruefung({ code: g.code, soll: soll(g), inhaltArtikelId: g.inhalt_artikel_id }, ziele.slice(1))) melde("warn", t);
    }
    // 7. R-46 Tasche zuordnen bei Rückgabe
    let taschenAntwort = null;
    if (modus === "rueckgabe" && gebucht) {
      if (g.ist_case) taschenAntwort = await taschenStand(c, g.id);
      else if (tasche) {
        if (tasche.inhalt_artikel_id && tasche.inhalt_artikel_id !== g.artikel_id) melde("warn", `${g.code} passt nicht in ${tasche.code} (${tasche.artikel}), nicht zugeordnet.`);
        else if (g.case_id !== tasche.id) {
          if (g.case_id) {
            const { rows: [alt] } = await c.query("SELECT code FROM geraet WHERE id = $1", [g.case_id]);
            await c.query("UPDATE geraet SET case_id = $1 WHERE id = $2", [tasche.id, g.id]);
            const { rows: [{ n }] } = await c.query("SELECT count(*)::int AS n FROM geraet WHERE case_id = $1", [g.case_id]);
            await bucheBewegung(c, { geraetId: g.id, projektId: g.projekt_id, aktion: `Tasche gewechselt: ${alt.code} -> ${tasche.code}`, ...w });
            melde("warn", `${g.code} lag in ${alt.code} und ist jetzt in ${tasche.code}. ${alt.code} hat jetzt ${n} Teile.`);
          } else {
            await c.query("UPDATE geraet SET case_id = $1 WHERE id = $2", [tasche.id, g.id]);
            await bucheBewegung(c, { geraetId: g.id, projektId: g.projekt_id, aktion: `In Tasche ${tasche.code} gelegt`, ...w });
          }
        }
        taschenAntwort = await taschenStand(c, tasche.id);
        if (taschenAntwort.soll && taschenAntwort.anzahl > taschenAntwort.soll) melde("warn", `${tasche.code} hat jetzt ${taschenAntwort.anzahl} Teile, Soll sind ${taschenAntwort.soll}.`);
      }
    }
    // 9. Packlisten-Abgleich
    if (modus !== "rueckgabe" && gebucht) {
      const angebotId = e.angebot ? Number(e.angebot) : await packAngebot(c, projekt.id);
      if (angebotId) {
        const pl = await ladePackliste(c, angebotId);
        const artikelIds = [...new Set(ziele.map((z) => z.artikel_id))];
        for (const aid of artikelIds) {
          const zl = pl.zeilen.find((x) => x.artikel_id === aid);
          const name = ziele.find((z) => z.artikel_id === aid).artikel;
          const h = packlistenHinweis(name, zl, zl ? (modus === "packen" ? zl.gepackt : zl.ist) : 0, modus);
          if (h) melde("warn", h);
        }
      }
    }
    // 8. Text
    const offenInTasche = taschenAntwort && g.ist_case ? taschenAntwort.offen.length : 0;
    const text = scanText({ code: g.code, artikel: g.artikel, modus, gebucht, inhalte, istCase: g.ist_case, inhaltOffen: offenInTasche, inhaltName: g.inhalt_name });
    if (!gebucht) level = "error";
    const projektRef = projekt ? { id: projekt.id, nummer: projekt.nummer, name: projekt.name } : g.projekt_id ? { id: g.projekt_id, nummer: g.projekt_nummer, name: g.projekt_name } : null;
    if (gebucht) {
      ctx.hub?.sende({ typ: "geraet.geaendert", id: g.id, projekt: projektRef?.id, bereich: "geraete" });
      if (projektRef) ctx.hub?.sende({ typ: "packen.geaendert", projekt: projektRef.id, bereich: "packen" });
    }
    return { level, text, meldungen, gebucht, tasche: taschenAntwort, code: g.code, artikel_id: g.artikel_id, ist_case: g.ist_case, projekt: projektRef };
  });
}

/** FA-19 / FA-17: Packstand eines Projekts (Packliste + Fortschritt + Verladestatus). */
/** FA-18: Rückgabestand je Projekt. offen = noch zugeordnet/gepackt, vermisst = bleibt am Projekt (R-49), zurueck = seit dem Projekt zurückgebucht. */
export async function rueckgabeStand(db, projektId) {
  const { rows: [p] } = await db.query(`SELECT p.id, p.nummer, p.name, p.status, p.beginn, p.ende, p.gepackt_am, k.name AS kunde, k.firma AS kunde_firma
    FROM projekt p JOIN kunde k ON k.id = p.kunde_id WHERE p.id = $1`, [projektId]);
  if (!p) throw nichtGefunden("Dieses Projekt");
  const { rows: amProjekt } = await db.query(`SELECT g.id, g.code, g.status, a.name AS artikel, a.ist_case, t.code AS tasche FROM geraet g
    JOIN artikel a ON a.id = g.artikel_id LEFT JOIN geraet t ON t.id = g.case_id
    WHERE g.projekt_id = $1 AND g.status IN ('zugeordnet','gepackt','vermisst') ORDER BY g.code`, [projektId]);
  const { rows: zurueck } = await db.query(`SELECT DISTINCT ON (g.id) g.id, g.code, g.status, a.name AS artikel, b.aktion, b.zeit FROM bewegung b
    JOIN geraet g ON g.id = b.geraet_id JOIN artikel a ON a.id = g.artikel_id
    WHERE b.projekt_id = $1 AND b.aktion IN ('Zurück im Lager','Wieder aufgetaucht') AND (g.projekt_id IS DISTINCT FROM $1)
    ORDER BY g.id, b.zeit DESC`, [projektId]);
  zurueck.sort((a, b) => String(b.zeit).localeCompare(String(a.zeit)));
  return { projekt: p, offen: amProjekt.filter((g) => g.status !== "vermisst"), vermisst: amProjekt.filter((g) => g.status === "vermisst"), zurueck };
}

export async function packStatus(db, projektId) {
  const { rows: [p] } = await db.query(`SELECT p.id, p.nummer, p.name, p.status, p.beginn, p.ende, p.gepackt_am, p.gepackt_von_name, p.ladezone_id,
      k.name AS kunde, k.firma AS kunde_firma FROM projekt p JOIN kunde k ON k.id = p.kunde_id WHERE p.id = $1`, [projektId]);
  if (!p) throw nichtGefunden("Dieses Projekt");
  const angebotId = await packAngebot(db, projektId);
  const pl = angebotId ? await ladePackliste(db, angebotId) : { angebot: null, zeilen: [] };
  const { rows: geraete } = await db.query(`SELECT g.id, g.code, g.status, a.name AS artikel, a.id AS artikel_id FROM geraet g JOIN artikel a ON a.id = g.artikel_id
    WHERE g.projekt_id = $1 ORDER BY a.name, g.code`, [projektId]);
  const ausserhalb = geraete.filter((g) => !pl.zeilen.some((z) => z.artikel_id === g.artikel_id));
  return {
    projekt: { ...p, status_text: PROJEKT_STATUS[p.status] }, angebot: pl.angebot ? { id: pl.angebot.id, nummer: pl.angebot.nummer, status: pl.angebot.status } : null,
    zeilen: pl.zeilen, fortschritt: packFortschritt(pl.zeilen), vollstaendig: pl.zeilen.length > 0 && pl.zeilen.every((z) => z.fertig !== false),
    geraete, ausserhalb, gepackt: geraete.filter((g) => g.status === "gepackt").length,
  };
}

export function scanModul(router) {
  router.post("/api/v1/scan", P, async (ctx) => scanne(ctx, ctx.body || {}));
  // FA-18 Rückgabeansicht: was ist noch draußen, was ist vermisst, was ist zurück
  router.get("/api/v1/projekte/:id/rueckgabe", { ...P, stufe: "r" }, async (ctx) => rueckgabeStand(ctx.pool, idParam(ctx.params.id, "Dieses Projekt")));
  router.get("/api/v1/projekte/:id/packstatus", { ...P, stufe: "r" }, async (ctx) => packStatus(ctx.pool, idParam(ctx.params.id, "Dieses Projekt")));

  // 7.2 /api/pruefung: Funktionstest (R-47)
  router.post("/api/v1/pruefung", P, async (ctx) => transaktion(ctx.pool, async (c) => {
    const code = normalisiereCode(ctx.body?.code);
    const ergebnis = String(ctx.body?.ergebnis || "");
    if (!["ok", "mangel"].includes(ergebnis)) throw fehler(400, "Wähle „bestanden“ oder „Mangel“.");
    const notiz = String(ctx.body?.notiz || "").trim().slice(0, 500);
    if (ergebnis === "mangel" && !notiz) throw fehler(400, "Beschreibe den Mangel kurz, damit die Werkstatt weiß, was zu tun ist.", { felder: { notiz: "Pflicht bei Mangel" } });
    const { rows: [g] } = await c.query("SELECT id, code, status, projekt_id, notizen FROM geraet WHERE code = $1 FOR UPDATE", [code]);
    if (!g) throw fehler(404, `Kein Gerät mit dem Code ${code} gefunden. Prüfe den Code oder scanne erneut.`);
    if (ergebnis === "ok") {
      await bucheBewegung(c, { geraetId: g.id, projektId: g.projekt_id, aktion: "Funktionstest bestanden", ...wer(ctx) });
      ctx.hub?.sende({ typ: "geraet.geaendert", id: g.id, bereich: "geraete" });
      return { ok: true, status: g.status, text: `${g.code}: Funktionstest bestanden.` };
    }
    const { rows: [{ heute }] } = await c.query("SELECT to_char((now() AT TIME ZONE 'Europe/Berlin')::date, 'DD.MM.YYYY') AS heute");
    const notizen = `${g.notizen ? `${g.notizen}\n` : ""}${heute}: Mangel bei Rückgabe: ${notiz}`;
    await c.query("UPDATE geraet SET status = 'defekt', notizen = $1, version = version + 1 WHERE id = $2", [notizen, g.id]);
    await bucheBewegung(c, { geraetId: g.id, projektId: g.projekt_id, aktion: `Mangel bei Rückgabe: ${notiz}`, ...wer(ctx) });
    ctx.hub?.sende({ typ: "geraet.geaendert", id: g.id, bereich: "geraete" });
    return { ok: true, status: "defekt", text: `${g.code} ist jetzt „Defekt“ und kann nicht gepackt werden, bis es repariert ist.` };
  }));

  // 7.2 /api/vermisst (R-48, R-49): offene Teile gesammelt als vermisst melden
  router.post("/api/v1/vermisst", P, async (ctx) => transaktion(ctx.pool, async (c) => {
    const codes = [...new Set((Array.isArray(ctx.body?.codes) ? ctx.body.codes : []).map(normalisiereCode))].slice(0, 500);
    const gemeldet = [];
    for (const code of codes) {
      const g = await meldeVermisst(c, ctx, "g.code = $1", code);
      if (g && !g.unveraendert) gemeldet.push(g.code);
    }
    let tasche = null;
    if (ctx.body?.tasche) {
      const { rows: [t] } = await c.query("SELECT g.id FROM geraet g JOIN artikel a ON a.id = g.artikel_id WHERE g.code = $1 AND a.ist_case", [normalisiereCode(ctx.body.tasche)]);
      if (t) tasche = await taschenStand(c, t.id);
    }
    return { gemeldet, tasche, text: gemeldet.length ? `${gemeldet.length} Gerät(e) als vermisst gemeldet.` : "Nichts zu melden." };
  }));

  // R-60 Packen abgeschlossen & verladen; R-61 wieder öffnen
  router.post("/api/v1/projekte/:id/verladen", P, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const r = await transaktion(ctx.pool, async (c) => {
      const { rows: [p] } = await c.query("SELECT id, nummer, status, gepackt_am, ladezone_id FROM projekt WHERE id = $1 FOR UPDATE", [id]);
      if (!p) throw nichtGefunden("Dieses Projekt");
      if (["abgeschlossen", "storniert"].includes(p.status)) throw fehler(409, `${p.nummer} ist „${PROJEKT_STATUS[p.status]}“ und kann nicht verladen werden.`);
      await c.query(`UPDATE projekt SET gepackt_am = now(), gepackt_von_id = $1, gepackt_von_name = $2, ladezone_id = NULL, zone_seit = NULL,
        version = version + 1, geaendert = now() WHERE id = $3`, [ctx.nutzer?.id || null, ctx.mitarbeiter?.name || ctx.nutzer?.name || ctx.nutzer?.benutzername || "", id]);
      const status = await nachVerladen(c, id); // R-14
      return { p, status };
    });
    ctx.hub?.sende({ typ: "projekt.geaendert", id, bereich: "projekte" });
    ctx.hub?.sende({ typ: "packen.geaendert", projekt: id, bereich: "packen" });
    if (r.p.ladezone_id) ctx.hub?.sende({ typ: "zone.geaendert", id: r.p.ladezone_id, bereich: "zonen" });
    return { ok: true, level: "success", status: r.status,
      text: `${r.p.nummer} verladen${r.p.ladezone_id ? ", Ladezone frei" : ""}${r.status === "laeuft" ? ", Status „Läuft“" : ""}.` };
  });
  router.post("/api/v1/projekte/:id/packen-oeffnen", P, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const { rows: [p] } = await ctx.pool.query(`UPDATE projekt SET gepackt_am = NULL, gepackt_von_id = NULL, gepackt_von_name = '', version = version + 1, geaendert = now()
      WHERE id = $1 RETURNING nummer`, [id]);
    if (!p) throw nichtGefunden("Dieses Projekt");
    ctx.hub?.sende({ typ: "projekt.geaendert", id, bereich: "projekte" });
    ctx.hub?.sende({ typ: "packen.geaendert", projekt: id, bereich: "packen" });
    return { ok: true, level: "success", text: `${p.nummer}: Packen wieder geöffnet. Zone und Status bleiben.` };
  });
}
