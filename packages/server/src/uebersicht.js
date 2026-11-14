// Startseite (FA-35) und Suche (FA-36): je Rolle nur, was sie sehen darf.
import { darf } from "@lager/domain/rechte.js";
import { PRUEF_SQL } from "./stammdaten.js";

const START = { bereich: "start" };
const HEUTE = "(now() AT TIME ZONE 'Europe/Berlin')::date";
const sieht = (ctx, b) => darf(ctx.nutzer.rechte, b, "r");

/** Muster für ILIKE (Platzhalter des Nutzers maskiert). */
const muster = (q) => `%${q.replace(/[\\%_]/g, (z) => `\\${z}`)}%`;

export function uebersichtModul(router) {
  // FA-36: Suche über Kunden, Projekte, Angebote, Material, Geräte
  router.get("/api/v1/suche", START, async (ctx) => {
    const q = String(ctx.query.q || "").trim().slice(0, 100);
    if (q.length < 2) return { q, gruppen: [], text: "Gib mindestens 2 Zeichen ein." };
    const m = muster(q);
    const n = Math.min(Number(ctx.query.limit) || 8, 50);
    const db = ctx.pool;
    const gruppen = [];
    const gruppe = async (bereich, titel, app, sql, zuTreffer) => {
      if (!sieht(ctx, bereich)) return;
      const { rows } = await db.query(sql, [m, n + 1]);
      if (rows.length) gruppen.push({ bereich, titel, app, mehr: rows.length > n, treffer: rows.slice(0, n).map(zuTreffer) });
    };
    await gruppe("kunden", "Kunden", "p", `SELECT id, name, firma, ort, email FROM kunde
      WHERE name ILIKE $1 OR firma ILIKE $1 OR email ILIKE $1 OR ort ILIKE $1 OR telefon ILIKE $1 ORDER BY coalesce(nullif(firma, ''), name) LIMIT $2`,
    (k) => ({ id: k.id, titel: k.firma || k.name, unter: [k.firma ? k.name : "", k.ort, k.email].filter(Boolean).join(" · "), pfad: `/kunden/${k.id}` }));
    await gruppe("projekte", "Projekte und Jobs", "p", `SELECT p.id, p.nummer, p.name, p.ort, p.beginn::text AS beginn, coalesce(nullif(k.firma, ''), k.name) AS kunde
      FROM projekt p JOIN kunde k ON k.id = p.kunde_id WHERE p.nummer ILIKE $1 OR p.name ILIKE $1 OR p.ort ILIKE $1 OR k.name ILIKE $1 OR k.firma ILIKE $1
      ORDER BY p.beginn DESC NULLS LAST, p.id DESC LIMIT $2`,
    (p) => ({ id: p.id, titel: `${p.nummer} ${p.name}`, unter: [p.kunde, p.ort].filter(Boolean).join(" · "), pfad: `/projekte/${p.id}` }));
    await gruppe("angebote", "Angebote", "p", `SELECT a.id, a.nummer, a.betreff, p.nummer AS projekt FROM angebot a JOIN projekt p ON p.id = a.projekt_id
      WHERE a.nummer ILIKE $1 OR a.betreff ILIKE $1 OR p.nummer ILIKE $1 OR p.name ILIKE $1 ORDER BY a.id DESC LIMIT $2`,
    (a) => ({ id: a.id, titel: `${a.nummer}${a.betreff ? ` ${a.betreff}` : ""}`, unter: `Projekt ${a.projekt}`, pfad: `/angebote/${a.id}` }));
    await gruppe("material", "Material", "m", `SELECT a.id, a.name, a.hersteller, k.name AS kategorie FROM artikel a JOIN kategorie k ON k.id = a.kategorie_id
      WHERE a.name ILIKE $1 OR a.hersteller ILIKE $1 OR a.beschreibung ILIKE $1 OR k.name ILIKE $1 ORDER BY a.aktiv DESC, a.name LIMIT $2`,
    (a) => ({ id: a.id, titel: a.name, unter: [a.kategorie, a.hersteller].filter(Boolean).join(" · "), pfad: `/material/${a.id}` }));
    await gruppe("geraete", "Geräte", "m", `SELECT g.id, g.code, g.seriennummer, g.status, a.name FROM geraet g JOIN artikel a ON a.id = g.artikel_id
      WHERE g.code ILIKE $1 OR g.seriennummer ILIKE $1 OR g.alte_pruef_id ILIKE $1 OR a.name ILIKE $1 ORDER BY g.code LIMIT $2`,
    (g) => ({ id: g.id, titel: `${g.code} ${g.name}`, unter: [g.seriennummer && `SN ${g.seriennummer}`, g.status].filter(Boolean).join(" · "), pfad: `/geraete/${g.id}` }));
    return { q, gruppen, text: gruppen.length ? null : `Nichts gefunden für „${q}“. Prüfe die Schreibweise oder suche nach einem Teil des Namens.` };
  });

  // FA-35: Kacheln, „Diese Woche“, meine Aufgaben
  router.get("/api/v1/start", START, async (ctx) => {
    const db = ctx.pool;
    const kacheln = [];
    const r = { kacheln, woche: null, aufgaben: null };
    const zahl = async (sql) => (await db.query(sql)).rows[0].n;
    if (sieht(ctx, "projekte")) {
      kacheln.push({ id: "laufend", titel: "Laufende Projekte", wert: await zahl("SELECT count(*)::int AS n FROM projekt WHERE status = 'laeuft'"), app: "p", pfad: "/projekte?status=laeuft", icon: "FolderKanban" });
      kacheln.push({ id: "bestaetigt", titel: "Bestätigt, noch nicht gestartet", wert: await zahl("SELECT count(*)::int AS n FROM projekt WHERE status = 'bestaetigt'"), app: "p", pfad: "/projekte?status=bestaetigt", icon: "CheckCircle2" });
      const wo = `${HEUTE} AND ${HEUTE} + 6`;
      const { rows: starts } = await db.query(`SELECT id, nummer, name, beginn::text AS beginn, status FROM projekt
        WHERE beginn BETWEEN ${wo} AND status NOT IN ('storniert', 'abgeschlossen') ORDER BY beginn, id LIMIT 20`);
      const { rows: rueck } = await db.query(`SELECT p.id, p.nummer, p.name, coalesce(p.ende, p.beginn)::text AS ende,
          (SELECT count(*)::int FROM geraet g WHERE g.projekt_id = p.id AND g.status IN ('gepackt', 'vermisst')) AS draussen
        FROM projekt p WHERE coalesce(p.ende, p.beginn) <= ${HEUTE} + 6 AND p.status NOT IN ('storniert', 'abgeschlossen')
          AND EXISTS (SELECT 1 FROM geraet g WHERE g.projekt_id = p.id AND g.status = 'gepackt') ORDER BY coalesce(p.ende, p.beginn), p.id LIMIT 20`);
      r.woche = { starts, rueckgaben: rueck };
    }
    if (sieht(ctx, "angebote")) kacheln.push({ id: "angebote", titel: "Angebote versendet, offen", wert: await zahl("SELECT count(*)::int AS n FROM angebot WHERE status = 'versendet'"), app: "p", pfad: "/angebote?status=versendet", icon: "FileText" });
    if (sieht(ctx, "geraete")) {
      const { rows: [g] } = await db.query(`SELECT count(*) FILTER (WHERE s IN ('ueberfaellig', 'offen'))::int AS faellig, count(*) FILTER (WHERE s = 'bald')::int AS bald,
          count(*) FILTER (WHERE st = 'vermisst')::int AS vermisst, count(*) FILTER (WHERE st IN ('defekt', 'reparatur'))::int AS defekt,
          count(*) FILTER (WHERE st = 'gepackt')::int AS draussen
        FROM (SELECT ${PRUEF_SQL} AS s, g.status AS st FROM geraet g JOIN artikel a ON a.id = g.artikel_id WHERE g.status NOT IN ('ausgemustert', 'verkauft')) x`);
      kacheln.push({ id: "pruefung", titel: "Prüfung fällig", wert: g.faellig, zusatz: g.bald ? `${g.bald} bald fällig` : null, app: "m", pfad: "/geraete?pruef=ueberfaellig", icon: "ShieldCheck", warn: g.faellig > 0 });
      kacheln.push({ id: "draussen", titel: "Geräte unterwegs", wert: g.draussen, app: "m", pfad: "/geraete?status=gepackt", icon: "Truck" });
      kacheln.push({ id: "vermisst", titel: "Vermisst", wert: g.vermisst, app: "m", pfad: "/geraete?status=vermisst", icon: "AlertTriangle", warn: g.vermisst > 0 });
      kacheln.push({ id: "defekt", titel: "Defekt / in Reparatur", wert: g.defekt, app: "m", pfad: "/geraete?status=defekt", icon: "Wrench" });
    }
    if (sieht(ctx, "projekte")) {
      const { rows } = await db.query(`SELECT a.id, a.text, a.faellig::text AS faellig, a.projekt_id, p.nummer, p.name AS projekt_name,
          (a.faellig < ${HEUTE}) AS ueberfaellig FROM aufgabe a JOIN projekt p ON p.id = a.projekt_id
        WHERE NOT a.erledigt AND a.zugewiesen_id = $1 ORDER BY a.faellig NULLS LAST, a.id LIMIT 20`, [ctx.nutzer.id]);
      r.aufgaben = rows;
    }
    return r;
  });
}
