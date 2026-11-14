// Löschkonzept Kundendaten (NFA-03): Aufbewahrungsfristen beachten, danach anonymisieren statt Daten liegen lassen.
// Fristen nach § 147 AO / § 257 HGB: Rechnungen 10 Jahre (Buchungsbelege, D-84), Angebote/Geschäftsbriefe 6 Jahre.
// Die Frist beginnt mit Ablauf des Kalenderjahres, in dem das Dokument entstanden ist.

export const FRISTEN_JAHRE = Object.freeze({ rechnung: 10, angebot: 6, projekt: 6 });
export const FRIST_TEXT = { rechnung: "Rechnung (10 Jahre, § 147 AO)", angebot: "Angebot (6 Jahre, § 257 HGB)", projekt: "Projekt-Unterlagen (6 Jahre)" };

const jahr = (d) => Number(String(d).slice(0, 4));

/** Frist-Ende eines Dokuments: 1.1. des Jahres (Entstehungsjahr + 1 + Frist). */
export const fristEnde = (art, datum) => `${jahr(datum) + 1 + FRISTEN_JAHRE[art]}-01-01`;

/**
 * Wann dürfen die Kundendaten anonymisiert werden?
 * @param {{art: "rechnung"|"angebot"|"projekt", datum: string, nummer?: string}[]} dokumente
 * @param {string} heute ISO-Datum (Berlin)
 * @returns {{erlaubt: boolean, ab: string|null, sperrt: {art, nummer, bis}[]}}
 */
export function loeschbarkeit(dokumente, heute) {
  const sperrt = dokumente.map((d) => ({ art: d.art, nummer: d.nummer || "", bis: fristEnde(d.art, d.datum) })).filter((d) => d.bis > heute)
    .sort((a, b) => (a.bis < b.bis ? 1 : -1));
  return { erlaubt: !sperrt.length, ab: sperrt[0]?.bis || null, sperrt };
}

/** Felder eines anonymisierten Kunden (keine personenbezogenen Daten mehr, Nummer bleibt für Belege). */
export const anonymisiert = (id) => ({ name: `Kunde gelöscht (Nr. ${id})`, firma: "", email: "", telefon: "", strasse: "", plz: "", ort: "", ust_id: "", notizen: "" });
