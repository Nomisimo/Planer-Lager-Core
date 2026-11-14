// Ladezonen (Spec 3.10, 5.8 R-55–R-59): reine Regeln. Datenbank und Sperren macht der Server.

/** 3.10: frei = plaetze - belegt (nie negativ). */
export const zoneFrei = (z) => Math.max(0, Number(z.plaetze) - Number(z.belegt || 0));

/** R-55: packbar = Bestätigt oder Läuft und noch nicht als gepackt abgeschlossen. */
export const packbar = (p) => ["bestaetigt", "laeuft"].includes(p.status) && !p.gepackt_am;

const zeitwert = (v) => (v == null || v === "" ? null : new Date(v).getTime());

/** R-55: Priorität „Als Nächstes zu packen“: beginn (ohne zuletzt), dann Anlegedatum, dann Nummer. */
export function prioritaet(projekte) {
  return (projekte || []).filter(packbar).sort((a, b) => {
    const ba = zeitwert(a.beginn), bb = zeitwert(b.beginn);
    if (ba !== bb) { if (ba == null) return 1; if (bb == null) return -1; return ba - bb; }
    const ea = zeitwert(a.erstellt) ?? 0, eb = zeitwert(b.erstellt) ?? 0;
    if (ea !== eb) return ea - eb;
    return String(a.nummer).localeCompare(String(b.nummer), "de", { numeric: true });
  });
}

/** Zonen in Anzeigereihenfolge (reihenfolge, dann Bezeichnung). */
export const zonenSortiert = (zonen) => [...(zonen || [])].sort((a, b) => (Number(a.reihenfolge) || 0) - (Number(b.reihenfolge) || 0)
  || String(a.bezeichnung).localeCompare(String(b.bezeichnung), "de", { numeric: true }));

/**
 * R-56: Warum ein Projekt nicht in die Zone darf (oder null). Projekt schon in der Zone → { nichts: true }.
 * @param {{status:string, ladezone_id?:number|null}} p @param {{id:number, bezeichnung:string, aktiv:boolean, plaetze:number, belegt:number}} z
 */
export function zuweisenPruefen(p, z) {
  if (p.ladezone_id === z.id) return { nichts: true };
  if (["abgeschlossen", "storniert"].includes(p.status)) return { text: "Abgeschlossene oder stornierte Projekte bekommen keine Ladezone." };
  if (!z.aktiv) return { text: `Die Ladezone ${z.bezeichnung} ist nicht aktiv. Aktiviere sie oder wähle eine andere.` };
  if (zoneFrei(z) <= 0) return { text: `Die Ladezone ${z.bezeichnung} ist voll (${z.belegt} von ${z.plaetze} Plätzen belegt).` };
  return null;
}

/**
 * R-58: Automatische Verteilung. Projekte ohne Zone in Prioritätsreihenfolge auf die nächste freie aktive Zone,
 * bis keine mehr frei ist. Liefert Zuweisungen [{ projektId, zoneId }]; verändert die Eingaben nicht.
 */
export function verteilung(projekte, zonen) {
  const frei = zonenSortiert(zonen).filter((z) => z.aktiv).map((z) => ({ id: z.id, frei: zoneFrei(z) }));
  const ergebnis = [];
  for (const p of prioritaet(projekte).filter((x) => !x.ladezone_id)) {
    const z = frei.find((x) => x.frei > 0);
    if (!z) break;
    z.frei--;
    ergebnis.push({ projektId: p.id, zoneId: z.id });
  }
  return ergebnis;
}

/** 3.10 Eingaben prüfen. Liefert { werte, fehler }. */
export function pruefeZone(w) {
  const fehler = {};
  const bezeichnung = String(w?.bezeichnung ?? "").trim();
  if (!bezeichnung) fehler.bezeichnung = "Gib der Ladezone einen Namen, z. B. „Zone A“.";
  else if (bezeichnung.length > 60) fehler.bezeichnung = "Der Name ist zu lang (höchstens 60 Zeichen).";
  const plaetze = Number(w?.plaetze ?? 1);
  if (!Number.isInteger(plaetze) || plaetze < 1 || plaetze > 99) fehler.plaetze = "Plätze ist eine ganze Zahl von 1 bis 99.";
  const roh = w?.flaeche_m2;
  const flaeche = roh === "" || roh == null ? null : Number(String(roh).replace(",", "."));
  if (flaeche != null && (!Number.isFinite(flaeche) || flaeche < 0 || flaeche > 100000)) fehler.flaeche_m2 = "Fläche in m² als Zahl ab 0 eingeben oder leer lassen.";
  const reihenfolge = Number(w?.reihenfolge ?? 0);
  if (!Number.isInteger(reihenfolge) || reihenfolge < 0 || reihenfolge > 9999) fehler.reihenfolge = "Reihenfolge ist eine ganze Zahl ab 0.";
  return { fehler, werte: { bezeichnung, plaetze, flaeche_m2: flaeche == null ? null : Math.round(flaeche * 100) / 100,
    beschreibung: String(w?.beschreibung ?? "").trim().slice(0, 500), aktiv: w?.aktiv !== false, reihenfolge } };
}
