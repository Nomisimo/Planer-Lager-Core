// Testdaten für Entwicklung und Leistungsprüfung (NFA-05).
// Klein: wenige Datensätze zum Ausprobieren. Groß: 5.000 Geräte, 500 Projekte mit Angeboten.
// Alles per Mengen-SQL (generate_series), damit auch der große Bestand in wenigen Sekunden steht.

const KATEGORIEN = [
  ["Licht", "LI"], ["Ton", "TO"], ["Kabel", "KA"], ["Rigging", "RI"], ["Video", "VI"],
  ["Strom", "ST"], ["Bühne", "BU"], ["Netzwerk", "NW"], ["Effekte", "FX"], ["Cases", "CA"],
];

/**
 * Legt Testdaten an. Bricht ab, wenn schon Geräte vorhanden sind (keine echten Daten überschreiben).
 * @param {import("pg").Pool} pool
 * @param {{geraete?: number, projekte?: number, artikel?: number, kunden?: number, positionen?: number}} [mengen]
 */
export async function seed(pool, { geraete = 200, projekte = 20, artikel = 40, kunden = 15, positionen = 6 } = {}) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const { rows: [{ n }] } = await c.query("SELECT count(*)::int AS n FROM geraet");
    if (n > 0) throw new Error("Es gibt schon Geräte. Testdaten nur in eine leere Datenbank laden.");
    for (const [name, praefix] of KATEGORIEN) {
      await c.query("INSERT INTO kategorie (name, praefix) VALUES ($1, $2) ON CONFLICT DO NOTHING", [name, praefix]);
    }
    const { rows: kat } = await c.query("SELECT id, name FROM kategorie ORDER BY id");
    const katIds = kat.map((k) => k.id);
    // Artikel reihum auf die Kategorien verteilt, Preise in Cent
    await c.query(`INSERT INTO artikel (name, kategorie_id, hersteller, preis_tag)
      SELECT k.name || ' Modell ' || g, ($1::int[])[1 + (g % cardinality($1::int[]))], 'Hersteller ' || (g % 7), 500 + (g * 137) % 9500
      FROM generate_series(1, $2::int) g JOIN kategorie k ON k.id = ($1::int[])[1 + (g % cardinality($1::int[]))]`, [katIds, artikel]);
    // Geräte: je Kategorie fortlaufend nummeriert, Code wie R-22 (PRÄFIX-0001)
    await c.query(`INSERT INTO geraet (code, artikel_id, seriennummer, letzte_pruefung)
      SELECT k.praefix || '-' || lpad((row_number() OVER (PARTITION BY k.id ORDER BY g))::text, 4, '0'), a.id, 'SN' || g,
             (now() - (g % 400) * interval '1 day')::date
      FROM generate_series(1, $1::int) g
      JOIN LATERAL (SELECT id, kategorie_id FROM artikel ORDER BY id OFFSET (g % $2::int) LIMIT 1) a ON true
      JOIN kategorie k ON k.id = a.kategorie_id`, [geraete, artikel]);
    await c.query(`UPDATE kategorie k SET letzte_nummer = x.n FROM
      (SELECT a.kategorie_id, count(*)::int AS n FROM geraet g JOIN artikel a ON a.id = g.artikel_id GROUP BY 1) x WHERE x.kategorie_id = k.id`);
    await c.query(`INSERT INTO kunde (name, firma, email, ort)
      SELECT 'Kontakt ' || g, 'Firma ' || g || ' GmbH', 'kontakt' || g || '@beispiel.de', (ARRAY['Berlin','Hamburg','München','Köln','Leipzig'])[1 + g % 5]
      FROM generate_series(1, $1::int) g`, [kunden]);
    // Projekte über ein Jahr verteilt (ab 60 Tagen zurück), Status gemischt
    await c.query(`INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn, ende, ort)
      SELECT 'P-' || to_char(d, 'YYYY') || '-' || lpad(g::text, 3, '0'), 'projekt', 'Veranstaltung ' || g,
             (SELECT id FROM kunde ORDER BY id OFFSET (g % $2::int) LIMIT 1),
             (ARRAY['anfrage','angebot_gesendet','bestaetigt','bestaetigt','abgeschlossen'])[1 + g % 5], d, d + (g % 4), 'Halle ' || (g % 9)
      FROM generate_series(1, $1::int) g, LATERAL (SELECT (current_date - 60 + (g * 365 / $1::int))::date AS d) t`, [projekte, kunden]);
    await c.query(`INSERT INTO angebot (nummer, projekt_id, status, betreff, tage)
      SELECT 'A-' || substr(p.nummer, 3, 4) || '-' || lpad(row_number() OVER (ORDER BY p.id)::text, 3, '0'), p.id,
             CASE WHEN p.status IN ('bestaetigt','abgeschlossen') THEN 'angenommen' WHEN p.status = 'angebot_gesendet' THEN 'versendet' ELSE 'entwurf' END,
             'Technik ' || p.name, 1 + (p.id % 3)
      FROM projekt p`);
    await c.query(`INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, bezeichnung, menge, tage, einzelpreis)
      SELECT an.id, i, 'miete', a.id, a.name, 1 + (an.id + i) % 8, an.tage, a.preis_tag
      FROM angebot an, generate_series(1, $1::int) i,
           LATERAL (SELECT id, name, preis_tag FROM artikel ORDER BY id OFFSET ((an.id * 7 + i * 13) % $2::int) LIMIT 1) a`, [positionen, artikel]);
    await c.query(`UPDATE angebot an SET summe_netto = s.summe FROM
      (SELECT angebot_id, sum(round(menge * einzelpreis * tage))::int AS summe FROM angebot_position GROUP BY 1) s WHERE s.angebot_id = an.id`);
    // Ein Teil der Geräte ist laufenden/bestätigten Projekten zugeordnet
    await c.query(`UPDATE geraet g SET status = 'zugeordnet', projekt_id = p.id
      FROM (SELECT id, row_number() OVER (ORDER BY id) AS r FROM projekt WHERE status = 'bestaetigt') p
      WHERE g.id % 10 = 0 AND p.r = 1 + (g.id / 10) % GREATEST(1, (SELECT count(*) FROM projekt WHERE status = 'bestaetigt'))`);
    await c.query("COMMIT");
    const zaehle = async (t) => (await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
    return { geraete: await zaehle("geraet"), projekte: await zaehle("projekt"), angebote: await zaehle("angebot"), positionen: await zaehle("angebot_position") };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { c.release(); }
}

export const GROSS = { geraete: 5000, projekte: 500, artikel: 400, kunden: 300, positionen: 12 };
