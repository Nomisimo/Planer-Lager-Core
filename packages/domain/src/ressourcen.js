// FA-37 Personal und FA-38 Fahrzeuge: Konflikterkennung, Kalender-Export (iCalendar), Zuladung.
import { zeitpunktAnzeige, datumAnzeige } from "./zeit.js";

export const PERSONAL_ARTEN = Object.freeze({ mitarbeiter: "Mitarbeiter", freelancer: "Freelancer" });

/** Überschneiden sich zwei Zeiträume? Ende ist exklusiv (08–12 und 12–16 kollidieren nicht). */
export const ueberschneiden = (a1, a2, b1, b2) => new Date(a1) < new Date(b2) && new Date(b1) < new Date(a2);

/**
 * Konflikte eines geplanten Einsatzes / einer Fahrt.
 * @param {{beginn: string, ende: string}} neu
 * @param {Array<{id?: number, beginn: string, ende: string, projekt?: string}>} belegt bestehende Einsätze/Fahrten derselben Ressource
 * @param {Array<{von: string, bis: string, grund?: string}>} [abwesend] ganztägige Abwesenheiten (ISO-Datum, bis inklusive)
 * @returns {string[]} Texte (leer = kein Konflikt)
 */
export function konflikte(neu, belegt, abwesend = []) {
  const t = [];
  for (const b of belegt) {
    if (b.id != null && b.id === neu.id) continue;
    if (ueberschneiden(neu.beginn, neu.ende, b.beginn, b.ende)) t.push(`Doppelbuchung: schon eingeplant ${zeitpunktAnzeige(b.beginn)} – ${zeitpunktAnzeige(b.ende)}${b.projekt ? ` (${b.projekt})` : ""}.`);
  }
  for (const a of abwesend) {
    // Abwesenheit als Berliner Kalendertage: von 00:00 bis (bis + 1 Tag) 00:00 – Vergleich auf Datumsebene genügt
    const tagVon = berlinDatum(neu.beginn), tagBis = berlinDatum(new Date(new Date(neu.ende).getTime() - 1));
    if (tagVon <= a.bis && a.von <= tagBis) t.push(`Nicht verfügbar ${datumAnzeige(a.von)}${a.bis !== a.von ? ` – ${datumAnzeige(a.bis)}` : ""}${a.grund ? ` (${a.grund})` : ""}.`);
  }
  return t;
}
const berlinDatum = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(d));

const icsText = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsZeit = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** RFC 5545: Zeilen über 75 Oktette falten. */
function falte(z) {
  const teile = [];
  let rest = Buffer.from(z, "utf8");
  while (rest.length > 75) {
    let n = 75;
    while (n > 0 && (rest[n] & 0xc0) === 0x80) n--; // nicht mitten im UTF-8-Zeichen trennen
    teile.push(rest.subarray(0, n).toString("utf8"));
    rest = Buffer.concat([Buffer.from(" "), rest.subarray(n)]);
  }
  teile.push(rest.toString("utf8"));
  return teile.join("\r\n");
}

/**
 * Einsatzplan als iCalendar (in Kalender-Apps abonnierbar/importierbar).
 * @param {Array<{uid: string, beginn: string, ende: string, titel: string, ort?: string, beschreibung?: string}>} termine
 */
export function icsKalender(name, termine, jetzt = new Date()) {
  const z = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Planer-Lager//Einsatzplan//DE", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(name)}`];
  for (const t of termine) {
    z.push("BEGIN:VEVENT", `UID:${t.uid}`, `DTSTAMP:${icsZeit(jetzt)}`, `DTSTART:${icsZeit(t.beginn)}`, `DTEND:${icsZeit(t.ende)}`, `SUMMARY:${icsText(t.titel)}`);
    if (t.ort) z.push(`LOCATION:${icsText(t.ort)}`);
    if (t.beschreibung) z.push(`DESCRIPTION:${icsText(t.beschreibung)}`);
    z.push("END:VEVENT");
  }
  z.push("END:VCALENDAR");
  return z.map(falte).join("\r\n") + "\r\n";
}

/**
 * Gewicht einer Ladeliste und Warnung bei Überladung.
 * @param {Array<{menge: number|string, gewicht_kg: number|string|null}>} ladung
 * @returns {{kg: number, ohneGewicht: number, warnung: string|null}}
 */
export function ladungsGewicht(ladung, zuladungKg) {
  let kg = 0, ohneGewicht = 0;
  for (const l of ladung) {
    if (l.gewicht_kg == null || l.gewicht_kg === "") { ohneGewicht++; continue; }
    kg += Number(l.menge) * Number(l.gewicht_kg);
  }
  kg = Math.round(kg * 100) / 100;
  const warnung = zuladungKg && kg > zuladungKg ? `Überladen: ${String(kg).replace(".", ",")} kg bei ${zuladungKg} kg Zuladung. Verteile die Ladung auf ein weiteres Fahrzeug.` : null;
  return { kg, ohneGewicht, warnung };
}
