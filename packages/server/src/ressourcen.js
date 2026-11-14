// FA-37 Ressourcenplanung Personal und FA-38 Transport/Fahrzeuge (Productionplaner).
import { transaktion } from "@lager/db";
import { konflikte, icsKalender, ladungsGewicht, PERSONAL_ARTEN } from "@lager/domain";
import { datumAnzeige, zeitpunktAnzeige } from "@lager/domain/zeit.js";
import { fehler, nichtGefunden, idParam, dbFehler } from "./hilfen.js";
import { ladeEinstellungen } from "./verwaltung.js";
import { listenPdf, sendePdf } from "./pdf-liste.js";
import { ladePackliste } from "./angebote.js";
import { packAngebot } from "./scannen.js";

const P = { bereich: "projekte" };
const R = { ...P, stufe: "r" };
const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;
const text = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const zeitpunkt = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };
const mengeText = (m) => String(Math.round(Number(m) * 100) / 100).replace(".", ",");

/** Prüft Zeitraum + Konflikte; wirft 409 mit Konfliktliste, außer der Nutzer bestätigt („trotzdem“). */
async function pruefeKonflikte(c, { neu, belegtSql, belegtWerte, abwesend = [], trotzdem }) {
  const { rows: belegt } = await c.query(belegtSql, belegtWerte);
  const k = konflikte(neu, belegt, abwesend);
  if (k.length && !trotzdem) throw fehler(409, `Konflikt: ${k.join(" ")} Wähle eine andere Zeit oder bestätige „Trotzdem eintragen“.`, { konflikte: k });
  return k;
}
function zeitraumFehler(beginn, ende, f, [kb, ke] = ["beginn", "ende"]) {
  if (!beginn) f[kb] = "Beginn fehlt oder ist ungültig.";
  if (!ende) f[ke] = "Ende fehlt oder ist ungültig.";
  if (beginn && ende && new Date(ende) <= new Date(beginn)) f[ke] = "Ende muss nach dem Beginn liegen.";
}

const EINSATZ_SQL = `SELECT e.*, pe.name AS person, pe.art AS person_art, p.nummer AS projekt_nummer, p.name AS projekt_name, p.ort AS projekt_ort,
    ap.bezeichnung AS position FROM einsatz e JOIN personal pe ON pe.id = e.personal_id JOIN projekt p ON p.id = e.projekt_id
    LEFT JOIN angebot_position ap ON ap.id = e.angebot_position_id`;
const FAHRT_SQL = `SELECT f.*, fz.name AS fahrzeug, fz.kennzeichen, fz.zuladung_kg, p.nummer AS projekt_nummer, p.name AS projekt_name, pe.name AS fahrer
    FROM fahrt f JOIN fahrzeug fz ON fz.id = f.fahrzeug_id JOIN projekt p ON p.id = f.projekt_id LEFT JOIN personal pe ON pe.id = f.fahrer_id`;

async function ladeFahrt(db, id) {
  const { rows: [f] } = await db.query(`${FAHRT_SQL} WHERE f.id = $1`, [id]);
  if (!f) throw nichtGefunden("Diese Fahrt");
  const { rows: ladung } = await db.query(`SELECT l.artikel_id, l.menge, a.name AS artikel, a.einheit, a.gewicht_kg, k.name AS kategorie FROM fahrt_ladung l
    JOIN artikel a ON a.id = l.artikel_id JOIN kategorie k ON k.id = a.kategorie_id WHERE l.fahrt_id = $1 ORDER BY k.name, a.name`, [id]);
  return { ...f, ladung, gewicht: ladungsGewicht(ladung, f.zuladung_kg) };
}

export function ressourcenModul(router) {
  /* ── Personal ── */
  const personWerte = (b, f) => {
    const w = { name: text(b.name, 120), art: PERSONAL_ARTEN[b.art] ? b.art : "mitarbeiter", telefon: text(b.telefon, 60), email: text(b.email, 120),
      notizen: text(b.notizen, 2000), aktiv: b.aktiv !== false,
      qualifikationen: [...new Set((Array.isArray(b.qualifikationen) ? b.qualifikationen : String(b.qualifikationen || "").split(",")).map((q) => text(q, 60)).filter(Boolean))],
      tagessatz: b.tagessatz === "" || b.tagessatz == null ? null : b.tagessatz };
    if (!w.name) f.name = "Name fehlt. Bitte ausfüllen.";
    if (w.tagessatz != null && (!Number.isInteger(w.tagessatz) || w.tagessatz < 0)) f.tagessatz = "Tagessatz als Betrag ab 0 € oder leer.";
    if (w.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(w.email)) f.email = "E-Mail-Adresse prüfen.";
    return w;
  };
  router.get("/api/v1/personal", R, async (ctx) => {
    const { rows } = await ctx.pool.query(`SELECT pe.*, (SELECT count(*)::int FROM einsatz e WHERE e.personal_id = pe.id AND e.ende >= now()) AS kommende_einsaetze
      FROM personal pe WHERE ($1::text IS NULL OR pe.name ILIKE '%' || $1 || '%' OR array_to_string(pe.qualifikationen, ',') ILIKE '%' || $1 || '%')
        AND ($2 OR pe.aktiv) ORDER BY lower(pe.name) LIMIT 500`, [ctx.query.q || null, ctx.query.alle === "1"]);
    return { zeilen: rows };
  });
  const speicherePerson = async (ctx, id) => {
    const f = {};
    const w = personWerte(ctx.body || {}, f);
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    try {
      const { rows: [r] } = id
        ? await ctx.pool.query(`UPDATE personal SET name = $1, art = $2, qualifikationen = $3, telefon = $4, email = $5, tagessatz = $6, aktiv = $7, notizen = $8, version = version + 1 WHERE id = $9 RETURNING id`,
          [w.name, w.art, w.qualifikationen, w.telefon, w.email, w.tagessatz, w.aktiv, w.notizen, id])
        : await ctx.pool.query(`INSERT INTO personal (name, art, qualifikationen, telefon, email, tagessatz, aktiv, notizen) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [w.name, w.art, w.qualifikationen, w.telefon, w.email, w.tagessatz, w.aktiv, w.notizen]);
      if (!r) throw nichtGefunden("Diese Person");
      ctx.hub?.sende({ typ: "personal.geaendert", id: r.id, bereich: "projekte" });
      return { ok: true, level: "success", id: r.id, text: `${w.name} gespeichert.` };
    } catch (e) { throw dbFehler(e, { doppelt: `${w.name} gibt es schon in der Personalliste.` }); }
  };
  router.post("/api/v1/personal", P, (ctx) => speicherePerson(ctx, null));
  router.put("/api/v1/personal/:id", P, (ctx) => speicherePerson(ctx, idParam(ctx.params.id, "Diese Person")));
  router.get("/api/v1/personal/:id", R, async (ctx) => {
    const id = idParam(ctx.params.id, "Diese Person");
    const { rows: [pe] } = await ctx.pool.query("SELECT * FROM personal WHERE id = $1", [id]);
    if (!pe) throw nichtGefunden("Diese Person");
    const [ab, ei, fa] = await Promise.all([
      ctx.pool.query("SELECT id, von::text, bis::text, grund FROM personal_abwesenheit WHERE personal_id = $1 AND bis >= (now() AT TIME ZONE 'Europe/Berlin')::date - 90 ORDER BY von", [id]),
      ctx.pool.query(`${EINSATZ_SQL} WHERE e.personal_id = $1 AND e.ende >= now() - interval '90 days' ORDER BY e.beginn`, [id]),
      ctx.pool.query(`${FAHRT_SQL} WHERE f.fahrer_id = $1 AND f.rueckkehr >= now() - interval '90 days' ORDER BY f.abholung`, [id]),
    ]);
    return { ...pe, abwesenheiten: ab.rows, einsaetze: ei.rows, fahrten: fa.rows };
  });
  router.post("/api/v1/personal/:id/abwesenheiten", P, async (ctx) => {
    const id = idParam(ctx.params.id, "Diese Person");
    const { von, bis = von, grund } = ctx.body || {};
    if (!ISO_DATUM.test(von || "") || !ISO_DATUM.test(bis || "") || bis < von) throw fehler(400, "Zeitraum ungültig: „bis“ muss am oder nach „von“ liegen.", { felder: { bis: "Zeitraum prüfen" } });
    const { rows: [a] } = await ctx.pool.query("INSERT INTO personal_abwesenheit (personal_id, von, bis, grund) SELECT id, $2, $3, $4 FROM personal WHERE id = $1 RETURNING id", [id, von, bis, text(grund, 120)]);
    if (!a) throw nichtGefunden("Diese Person");
    const { rows: betroffen } = await ctx.pool.query(`SELECT count(*)::int AS n FROM einsatz WHERE personal_id = $1
      AND (beginn AT TIME ZONE 'Europe/Berlin')::date <= $3 AND ((ende - interval '1 second') AT TIME ZONE 'Europe/Berlin')::date >= $2`, [id, von, bis]);
    ctx.hub?.sende({ typ: "personal.geaendert", id, bereich: "projekte" });
    return { ok: true, level: betroffen[0].n ? "warning" : "success", id: a.id,
      text: `Abwesenheit eingetragen.${betroffen[0].n ? ` Achtung: ${betroffen[0].n} Einsatz/Einsätze liegen in diesem Zeitraum.` : ""}` };
  });
  router.delete("/api/v1/abwesenheiten/:id", P, async (ctx) => {
    const { rows: [a] } = await ctx.pool.query("DELETE FROM personal_abwesenheit WHERE id = $1 RETURNING personal_id", [idParam(ctx.params.id, "Diese Abwesenheit")]);
    if (!a) throw nichtGefunden("Diese Abwesenheit");
    ctx.hub?.sende({ typ: "personal.geaendert", id: a.personal_id, bereich: "projekte" });
    return { ok: true, level: "success", text: "Abwesenheit gelöscht." };
  });

  /* ── Einsätze ── */
  const speichereEinsatz = async (ctx, id) => transaktion(ctx.pool, async (c) => {
    const b = ctx.body || {};
    const f = {};
    const w = { personal_id: Number(b.personal_id), projekt_id: Number(b.projekt_id), beginn: zeitpunkt(b.beginn), ende: zeitpunkt(b.ende), rolle: text(b.rolle, 120),
      angebot_position_id: b.angebot_position_id ? Number(b.angebot_position_id) : null, notiz: text(b.notiz, 1000) };
    zeitraumFehler(w.beginn, w.ende, f);
    const { rows: [pe] } = await c.query("SELECT id, name, aktiv FROM personal WHERE id = $1 FOR UPDATE", [w.personal_id || 0]); // Sperre: parallele Buchung derselben Person
    if (!pe) f.personal_id = "Wähle eine Person.";
    const { rows: [pr] } = await c.query("SELECT id, nummer, status FROM projekt WHERE id = $1", [w.projekt_id || 0]);
    if (!pr) f.projekt_id = "Wähle ein Projekt.";
    if (w.angebot_position_id) {
      const { rows } = await c.query("SELECT 1 FROM angebot_position ap JOIN angebot a ON a.id = ap.angebot_id WHERE ap.id = $1 AND a.projekt_id = $2", [w.angebot_position_id, w.projekt_id]);
      if (!rows.length) f.angebot_position_id = "Die Personalposition gehört nicht zum Angebot dieses Projekts.";
    }
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    if (!pe.aktiv) throw fehler(409, `${pe.name} ist inaktiv. Aktiviere die Person zuerst.`);
    const { rows: abwesend } = await c.query("SELECT von::text, bis::text, grund FROM personal_abwesenheit WHERE personal_id = $1", [pe.id]);
    const k = await pruefeKonflikte(c, { neu: { ...w, id }, abwesend, trotzdem: b.trotzdem === true,
      belegtSql: `SELECT e.id, e.beginn, e.ende, p.nummer || ' ' || p.name AS projekt FROM einsatz e JOIN projekt p ON p.id = e.projekt_id
        WHERE e.personal_id = $1 AND e.beginn < $3 AND e.ende > $2`, belegtWerte: [pe.id, w.beginn, w.ende] });
    const werte = [w.personal_id, w.projekt_id, w.beginn, w.ende, w.rolle, w.angebot_position_id, w.notiz, k.length > 0];
    const { rows: [e] } = id
      ? await c.query(`UPDATE einsatz SET personal_id = $1, projekt_id = $2, beginn = $3, ende = $4, rolle = $5, angebot_position_id = $6, notiz = $7, konflikt_bestaetigt = $8 WHERE id = $9 RETURNING id`, [...werte, id])
      : await c.query(`INSERT INTO einsatz (personal_id, projekt_id, beginn, ende, rolle, angebot_position_id, notiz, konflikt_bestaetigt, erstellt_von) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [...werte, ctx.nutzer.name || ctx.nutzer.benutzername]);
    if (!e) throw nichtGefunden("Dieser Einsatz");
    ctx.hub?.sende({ typ: "einsatz.geaendert", id: e.id, projekt: w.projekt_id, bereich: "projekte" });
    return { ok: true, level: k.length ? "warning" : "success", id: e.id, konflikte: k, text: `${pe.name} für ${pr.nummer} eingeplant.${k.length ? " Trotz Konflikt eingetragen." : ""}` };
  });
  router.post("/api/v1/einsaetze", P, (ctx) => speichereEinsatz(ctx, null));
  router.put("/api/v1/einsaetze/:id", P, (ctx) => speichereEinsatz(ctx, idParam(ctx.params.id, "Dieser Einsatz")));
  router.delete("/api/v1/einsaetze/:id", P, async (ctx) => {
    const { rows: [e] } = await ctx.pool.query("DELETE FROM einsatz WHERE id = $1 RETURNING projekt_id", [idParam(ctx.params.id, "Dieser Einsatz")]);
    if (!e) throw nichtGefunden("Dieser Einsatz");
    ctx.hub?.sende({ typ: "einsatz.geaendert", projekt: e.projekt_id, bereich: "projekte" });
    return { ok: true, level: "success", text: "Einsatz gelöscht." };
  });
  // Einsatzplan über alle Personen (Zeitraum, Standard: 14 Tage ab heute)
  const planZeitraum = (q) => {
    const von = ISO_DATUM.test(q.von || "") ? q.von : null, bis = ISO_DATUM.test(q.bis || "") ? q.bis : null;
    return { von, bis };
  };
  const ladePlan = async (db, q) => {
    const { von, bis } = planZeitraum(q);
    const { rows } = await db.query(`${EINSATZ_SQL} WHERE e.ende >= coalesce($1::date, (now() AT TIME ZONE 'Europe/Berlin')::date)::timestamp AT TIME ZONE 'Europe/Berlin'
        AND e.beginn < (coalesce($2::date, (now() AT TIME ZONE 'Europe/Berlin')::date + 13) + 1)::timestamp AT TIME ZONE 'Europe/Berlin'
        AND ($3::int IS NULL OR e.personal_id = $3) ORDER BY e.beginn, pe.name LIMIT 2000`, [von, bis, q.personal ? Number(q.personal) : null]);
    return rows;
  };
  router.get("/api/v1/einsatzplan", R, async (ctx) => ({ zeilen: await ladePlan(ctx.pool, ctx.query) }));
  router.get("/api/v1/einsatzplan.pdf", R, async (ctx) => {
    const zeilen = await ladePlan(ctx.pool, ctx.query);
    const e = await ladeEinstellungen(ctx.pool);
    const { von, bis } = planZeitraum(ctx.query);
    const proPerson = new Map();
    for (const z of zeilen) proPerson.set(z.person, [...(proPerson.get(z.person) || []), z]);
    const pdf = await listenPdf({ titel: "Einsatzplan", firma: e.firma, fuss: "Einsatzplan",
      kopf: [["Zeitraum", `${von ? datumAnzeige(von) : "heute"} – ${bis ? datumAnzeige(bis) : "14 Tage"}`], ["Einsätze", String(zeilen.length)]],
      abschnitte: [...proPerson].map(([person, l]) => ({ titel: person, spalten: [{ t: "Beginn", w: 32 }, { t: "Ende", w: 32 }, { t: "Projekt", w: 66 }, { t: "Rolle", w: 40 }],
        zeilen: l.map((z) => [zeitpunktAnzeige(z.beginn), zeitpunktAnzeige(z.ende), `${z.projekt_nummer} ${z.projekt_name}`, z.rolle || z.position || ""]) })),
    });
    sendePdf(ctx, pdf, "Einsatzplan.pdf", ctx.query.download !== "1");
  });
  router.get("/api/v1/personal/:id/einsatzplan.ics", R, async (ctx) => {
    const id = idParam(ctx.params.id, "Diese Person");
    const { rows: [pe] } = await ctx.pool.query("SELECT name FROM personal WHERE id = $1", [id]);
    if (!pe) throw nichtGefunden("Diese Person");
    const { rows } = await ctx.pool.query(`${EINSATZ_SQL} WHERE e.personal_id = $1 AND e.ende >= now() - interval '30 days' ORDER BY e.beginn`, [id]);
    const ics = icsKalender(`Einsätze ${pe.name}`, rows.map((z) => ({ uid: `einsatz-${z.id}@planer-lager`, beginn: z.beginn, ende: z.ende,
      titel: `${z.projekt_nummer} ${z.projekt_name}${z.rolle ? ` – ${z.rolle}` : ""}`, ort: z.projekt_ort, beschreibung: z.notiz })));
    ctx.res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="Einsaetze-${id}.ics"`, "Cache-Control": "no-store" });
    ctx.res.end(ics);
  });

  /* ── Projekt: Personal und Fahrten auf einen Blick, Anbindung an Personalpositionen ── */
  router.get("/api/v1/projekte/:id/ressourcen", R, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Projekt");
    const { rows: [p] } = await ctx.pool.query("SELECT id, nummer, name, beginn, ende FROM projekt WHERE id = $1", [id]);
    if (!p) throw nichtGefunden("Dieses Projekt");
    const angebotId = await packAngebot(ctx.pool, id);
    const [ei, fa, pos] = await Promise.all([
      ctx.pool.query(`${EINSATZ_SQL} WHERE e.projekt_id = $1 ORDER BY e.beginn, pe.name`, [id]),
      ctx.pool.query(`${FAHRT_SQL} WHERE f.projekt_id = $1 ORDER BY f.abholung`, [id]),
      angebotId ? ctx.pool.query(`SELECT ap.id, ap.bezeichnung, ap.menge, ap.tage, ap.stunden,
          (SELECT count(*)::int FROM einsatz e WHERE e.angebot_position_id = ap.id) AS besetzt
        FROM angebot_position ap JOIN artikel a ON a.id = ap.artikel_id WHERE ap.angebot_id = $1 AND (ap.stunden IS NOT NULL OR a.ist_leistung) ORDER BY ap.pos`, [angebotId]) : { rows: [] },
    ]);
    return { projekt: p, einsaetze: ei.rows, fahrten: fa.rows, personalpositionen: pos.rows.map((x) => ({ ...x, benoetigt: Math.ceil(Number(x.menge)) })) };
  });

  /* ── Fahrzeuge ── */
  const fahrzeugWerte = (b, f) => {
    const w = { name: text(b.name, 120), kennzeichen: text(b.kennzeichen, 20).toUpperCase(), notizen: text(b.notizen, 2000), aktiv: b.aktiv !== false,
      zuladung_kg: b.zuladung_kg === "" || b.zuladung_kg == null ? null : Number(b.zuladung_kg),
      ladevolumen_m3: b.ladevolumen_m3 === "" || b.ladevolumen_m3 == null ? null : Number(String(b.ladevolumen_m3).replace(",", ".")) };
    if (!w.name) f.name = "Name fehlt. Bitte ausfüllen.";
    if (w.zuladung_kg != null && !(Number.isInteger(w.zuladung_kg) && w.zuladung_kg > 0)) f.zuladung_kg = "Zuladung in ganzen kg (größer 0) oder leer.";
    if (w.ladevolumen_m3 != null && !(w.ladevolumen_m3 > 0)) f.ladevolumen_m3 = "Ladevolumen größer 0 m³ oder leer.";
    return w;
  };
  router.get("/api/v1/fahrzeuge", R, async (ctx) => ({ zeilen: (await ctx.pool.query(`SELECT fz.*, (SELECT count(*)::int FROM fahrt f WHERE f.fahrzeug_id = fz.id AND f.rueckkehr >= now()) AS kommende_fahrten
    FROM fahrzeug fz WHERE $1 OR fz.aktiv ORDER BY lower(fz.name)`, [ctx.query.alle === "1"])).rows }));
  const speichereFahrzeug = async (ctx, id) => {
    const f = {};
    const w = fahrzeugWerte(ctx.body || {}, f);
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    try {
      const { rows: [r] } = id
        ? await ctx.pool.query("UPDATE fahrzeug SET name = $1, kennzeichen = $2, zuladung_kg = $3, ladevolumen_m3 = $4, aktiv = $5, notizen = $6, version = version + 1 WHERE id = $7 RETURNING id",
          [w.name, w.kennzeichen, w.zuladung_kg, w.ladevolumen_m3, w.aktiv, w.notizen, id])
        : await ctx.pool.query("INSERT INTO fahrzeug (name, kennzeichen, zuladung_kg, ladevolumen_m3, aktiv, notizen) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
          [w.name, w.kennzeichen, w.zuladung_kg, w.ladevolumen_m3, w.aktiv, w.notizen]);
      if (!r) throw nichtGefunden("Dieses Fahrzeug");
      ctx.hub?.sende({ typ: "fahrzeug.geaendert", id: r.id, bereich: "projekte" });
      return { ok: true, level: "success", id: r.id, text: `${w.name} gespeichert.` };
    } catch (e) { throw dbFehler(e, { doppelt: `Ein Fahrzeug „${w.name}“ gibt es schon.` }); }
  };
  router.post("/api/v1/fahrzeuge", P, (ctx) => speichereFahrzeug(ctx, null));
  router.put("/api/v1/fahrzeuge/:id", P, (ctx) => speichereFahrzeug(ctx, idParam(ctx.params.id, "Dieses Fahrzeug")));
  router.get("/api/v1/fahrzeuge/:id", R, async (ctx) => {
    const id = idParam(ctx.params.id, "Dieses Fahrzeug");
    const { rows: [fz] } = await ctx.pool.query("SELECT * FROM fahrzeug WHERE id = $1", [id]);
    if (!fz) throw nichtGefunden("Dieses Fahrzeug");
    const { rows } = await ctx.pool.query(`${FAHRT_SQL} WHERE f.fahrzeug_id = $1 AND f.rueckkehr >= now() - interval '90 days' ORDER BY f.abholung`, [id]);
    return { ...fz, fahrten: rows };
  });

  /* ── Fahrten ── */
  const speichereFahrt = async (ctx, id) => transaktion(ctx.pool, async (c) => {
    const b = ctx.body || {};
    const f = {};
    const w = { fahrzeug_id: Number(b.fahrzeug_id), projekt_id: Number(b.projekt_id), abholung: zeitpunkt(b.abholung), rueckkehr: zeitpunkt(b.rueckkehr),
      ziel: text(b.ziel, 200), fahrer_id: b.fahrer_id ? Number(b.fahrer_id) : null, notiz: text(b.notiz, 1000) };
    zeitraumFehler(w.abholung, w.rueckkehr, f, ["abholung", "rueckkehr"]);
    const { rows: [fz] } = await c.query("SELECT id, name, aktiv FROM fahrzeug WHERE id = $1 FOR UPDATE", [w.fahrzeug_id || 0]);
    if (!fz) f.fahrzeug_id = "Wähle ein Fahrzeug.";
    const { rows: [pr] } = await c.query("SELECT id, nummer, ort FROM projekt WHERE id = $1", [w.projekt_id || 0]);
    if (!pr) f.projekt_id = "Wähle ein Projekt.";
    if (Object.keys(f).length) throw fehler(400, "Bitte prüfe die markierten Felder.", { felder: f });
    if (!fz.aktiv) throw fehler(409, `${fz.name} ist außer Betrieb. Wähle ein anderes Fahrzeug.`);
    if (!w.ziel) w.ziel = pr.ort || "";
    const neu = { id, beginn: w.abholung, ende: w.rueckkehr };
    const k = await pruefeKonflikte(c, { neu, trotzdem: b.trotzdem === true,
      belegtSql: `SELECT f.id, f.abholung AS beginn, f.rueckkehr AS ende, p.nummer || ' ' || p.name AS projekt FROM fahrt f JOIN projekt p ON p.id = f.projekt_id
        WHERE f.fahrzeug_id = $1 AND f.abholung < $3 AND f.rueckkehr > $2`, belegtWerte: [fz.id, w.abholung, w.rueckkehr] });
    // Fahrer: Doppelbuchung als Fahrer zählt auch
    if (w.fahrer_id && !b.trotzdem) {
      const { rows: belegt } = await c.query(`SELECT f.id, f.abholung AS beginn, f.rueckkehr AS ende, 'Fahrt ' || p.nummer AS projekt FROM fahrt f JOIN projekt p ON p.id = f.projekt_id
        WHERE f.fahrer_id = $1 AND f.abholung < $3 AND f.rueckkehr > $2`, [w.fahrer_id, w.abholung, w.rueckkehr]);
      const kf = konflikte(neu, belegt);
      if (kf.length) throw fehler(409, `Konflikt beim Fahrer: ${kf.join(" ")} Wähle einen anderen Fahrer oder bestätige „Trotzdem eintragen“.`, { konflikte: kf });
    }
    const werte = [w.fahrzeug_id, w.projekt_id, w.abholung, w.rueckkehr, w.ziel, w.fahrer_id, w.notiz, k.length > 0];
    const { rows: [r] } = id
      ? await c.query("UPDATE fahrt SET fahrzeug_id = $1, projekt_id = $2, abholung = $3, rueckkehr = $4, ziel = $5, fahrer_id = $6, notiz = $7, konflikt_bestaetigt = $8 WHERE id = $9 RETURNING id", [...werte, id])
      : await c.query("INSERT INTO fahrt (fahrzeug_id, projekt_id, abholung, rueckkehr, ziel, fahrer_id, notiz, konflikt_bestaetigt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id", werte);
    if (!r) throw nichtGefunden("Diese Fahrt");
    ctx.hub?.sende({ typ: "fahrt.geaendert", id: r.id, projekt: w.projekt_id, bereich: "projekte" });
    return { ok: true, level: k.length ? "warning" : "success", id: r.id, konflikte: k, text: `Fahrt mit ${fz.name} für ${pr.nummer} eingetragen.${k.length ? " Trotz Konflikt eingetragen." : ""}` };
  });
  router.post("/api/v1/fahrten", P, (ctx) => speichereFahrt(ctx, null));
  router.put("/api/v1/fahrten/:id", P, (ctx) => speichereFahrt(ctx, idParam(ctx.params.id, "Diese Fahrt")));
  router.delete("/api/v1/fahrten/:id", P, async (ctx) => {
    const { rows: [f] } = await ctx.pool.query("DELETE FROM fahrt WHERE id = $1 RETURNING projekt_id", [idParam(ctx.params.id, "Diese Fahrt")]);
    if (!f) throw nichtGefunden("Diese Fahrt");
    ctx.hub?.sende({ typ: "fahrt.geaendert", projekt: f.projekt_id, bereich: "projekte" });
    return { ok: true, level: "success", text: "Fahrt gelöscht." };
  });
  router.get("/api/v1/fahrten/:id", R, async (ctx) => {
    const fa = await ladeFahrt(ctx.pool, idParam(ctx.params.id, "Diese Fahrt"));
    // Was aus der Packliste noch keinem Fahrzeug zugeteilt ist
    const angebotId = await packAngebot(ctx.pool, fa.projekt_id);
    const pl = angebotId ? await ladePackliste(ctx.pool, angebotId) : { zeilen: [] };
    const { rows: verteilt } = await ctx.pool.query("SELECT l.artikel_id, sum(l.menge) AS menge FROM fahrt_ladung l JOIN fahrt f ON f.id = l.fahrt_id WHERE f.projekt_id = $1 GROUP BY 1", [fa.projekt_id]);
    const vm = new Map(verteilt.map((v) => [v.artikel_id, Number(v.menge)]));
    const offen = pl.zeilen.map((z) => ({ artikel_id: z.artikel_id, artikel: z.artikel, einheit: z.einheit, soll: Number(z.soll), offen: Math.max(0, Number(z.soll) - (vm.get(z.artikel_id) || 0)) })).filter((z) => z.offen > 0);
    return { ...fa, offen };
  });
  // Ladeliste setzen (vollständig ersetzen) oder den noch offenen Rest der Packliste übernehmen
  router.put("/api/v1/fahrten/:id/ladung", P, async (ctx) => transaktion(ctx.pool, async (c) => {
    const id = idParam(ctx.params.id, "Diese Fahrt");
    const { rows: [fa] } = await c.query("SELECT id, projekt_id FROM fahrt WHERE id = $1 FOR UPDATE", [id]);
    if (!fa) throw nichtGefunden("Diese Fahrt");
    let zeilen = Array.isArray(ctx.body?.zeilen) ? ctx.body.zeilen : [];
    if (ctx.body?.packliste) {
      // Projektfahrten sperren, damit zwei gleichzeitige Übernahmen nichts doppelt verteilen
      await c.query("SELECT id FROM fahrt WHERE projekt_id = $1 FOR UPDATE", [fa.projekt_id]);
      const angebotId = await packAngebot(c, fa.projekt_id);
      if (!angebotId) throw fehler(409, "Für dieses Projekt gibt es noch kein Angebot, also keine Packliste.");
      const pl = await ladePackliste(c, angebotId);
      const { rows: verteilt } = await c.query("SELECT l.artikel_id, sum(l.menge) AS menge FROM fahrt_ladung l JOIN fahrt f ON f.id = l.fahrt_id WHERE f.projekt_id = $1 AND f.id <> $2 GROUP BY 1", [fa.projekt_id, id]);
      const vm = new Map(verteilt.map((v) => [v.artikel_id, Number(v.menge)]));
      zeilen = pl.zeilen.map((z) => ({ artikel_id: z.artikel_id, menge: Math.max(0, Number(z.soll) - (vm.get(z.artikel_id) || 0)) }));
    }
    zeilen = zeilen.map((z) => ({ artikel_id: Number(z.artikel_id), menge: Number(String(z.menge).replace(",", ".")) })).filter((z) => z.artikel_id > 0 && z.menge > 0);
    if (zeilen.some((z) => !Number.isFinite(z.menge))) throw fehler(400, "Menge als Zahl eingeben.");
    await c.query("DELETE FROM fahrt_ladung WHERE fahrt_id = $1", [id]);
    if (zeilen.length) await c.query("INSERT INTO fahrt_ladung (fahrt_id, artikel_id, menge) SELECT $1, unnest($2::int[]), unnest($3::numeric[])", [id, zeilen.map((z) => z.artikel_id), zeilen.map((z) => z.menge)]);
    const neu = await ladeFahrt(c, id);
    ctx.hub?.sende({ typ: "fahrt.geaendert", id, projekt: fa.projekt_id, bereich: "projekte" });
    return { ok: true, level: neu.gewicht.warnung ? "warning" : "success", gewicht: neu.gewicht,
      text: `Ladeliste gespeichert: ${zeilen.length} Position(en), ${mengeText(neu.gewicht.kg)} kg${neu.gewicht.ohneGewicht ? ` (${neu.gewicht.ohneGewicht} ohne Gewichtsangabe)` : ""}.${neu.gewicht.warnung ? ` ${neu.gewicht.warnung}` : ""}` };
  }));
  router.get("/api/v1/fahrten/:id/ladeliste.pdf", R, async (ctx) => {
    const fa = await ladeFahrt(ctx.pool, idParam(ctx.params.id, "Diese Fahrt"));
    const e = await ladeEinstellungen(ctx.pool);
    const pdf = await listenPdf({ titel: `Ladeliste ${fa.fahrzeug}${fa.kennzeichen ? ` (${fa.kennzeichen})` : ""}`, firma: e.firma, fuss: `Ladeliste ${fa.projekt_nummer}`,
      kopf: [["Projekt", `${fa.projekt_nummer} ${fa.projekt_name}`], ["Abholung", zeitpunktAnzeige(fa.abholung)], ["Rückkehr", zeitpunktAnzeige(fa.rueckkehr)],
        ["Ziel", fa.ziel], ["Fahrer", fa.fahrer || "–"],
        ["Gewicht", `${mengeText(fa.gewicht.kg)} kg${fa.zuladung_kg ? ` von ${fa.zuladung_kg} kg Zuladung` : ""}${fa.gewicht.ohneGewicht ? ` · ${fa.gewicht.ohneGewicht} Position(en) ohne Gewicht` : ""}`]],
      abschnitte: [{ titel: `Ladung (${fa.ladung.length})`, leer: "Noch nichts zugeteilt.", hinweis: fa.gewicht.warnung || "",
        spalten: [{ t: "", w: 8 }, { t: "Artikel", w: 80 }, { t: "Kategorie", w: 40 }, { t: "Menge", w: 22, r: true }, { t: "kg", w: 20, r: true }],
        zeilen: fa.ladung.map((l) => ["[ ]", l.artikel, l.kategorie, `${mengeText(l.menge)} ${l.einheit}`, l.gewicht_kg == null ? "–" : mengeText(Number(l.menge) * Number(l.gewicht_kg))]) }],
      unterschriften: ["Beladen", "Fahrer"] });
    sendePdf(ctx, pdf, `Ladeliste ${fa.projekt_nummer} ${fa.fahrzeug}.pdf`, ctx.query.download !== "1");
  });
}
