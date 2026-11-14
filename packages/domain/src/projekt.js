// Projekt/Job (Spec 3.2, 4.1), Dateien (3.3), Aufgaben (3.4).

export const PROJEKT_STATUS = Object.freeze({
  anfrage: "Anfrage", angebot_gesendet: "Angebot gesendet", bestaetigt: "Bestätigt",
  laeuft: "Läuft", abgeschlossen: "Abgeschlossen", storniert: "Storniert",
});
/** Kalender-/Chipfarben je Status (FA-34). */
export const STATUS_FARBE = Object.freeze({
  anfrage: "#8a8f96", angebot_gesendet: "#d08a1e", bestaetigt: "#1e66d0", laeuft: "#2e9d47", abgeschlossen: "#5b6470", storniert: "#b3483f",
});
export const GEWERKE = Object.freeze(["Ton", "Licht", "Video", "Rigging/Traversen", "Strom", "Bühne/Aufbau", "Transport/Logistik", "Sonstiges"]);

/** R-12: jeder Wechsel erlaubt (auch rückwärts zur Korrektur), nur nicht auf denselben Status. */
export const statusWechselErlaubt = (von, nach) => !!PROJEKT_STATUS[nach] && von !== nach;
/** R-13: abgeschlossen/storniert gibt die Ladezone frei. */
export const gibtZoneFrei = (status) => status === "abgeschlossen" || status === "storniert";
/** R-14: beim Verladen bestätigt → läuft. */
export const statusNachVerladen = (status) => (status === "bestaetigt" ? "laeuft" : status);
/** Projekt gilt als beendet (keine Reservierung mehr, R-15/R-24). */
export const istBeendet = gibtZoneFrei;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Prüft Projekt-/Job-Werte. @returns Fehler je Feld */
export function pruefeProjekt(w) {
  const f = {};
  if (!String(w.name || "").trim()) f.name = "Name fehlt. Bitte ausfüllen.";
  if (!["projekt", "job"].includes(w.art)) f.art = "Wähle Projekt oder Job.";
  if (w.art === "job" && w.gewerk && !GEWERKE.includes(w.gewerk)) f.gewerk = "Wähle ein Gewerk aus der Liste.";
  if (!w.uebergeordnet_id && !Number.isInteger(w.kunde_id)) f.kunde_id = "Wähle einen Kunden.";
  if (w.status && !PROJEKT_STATUS[w.status]) f.status = "Wähle einen Status aus der Liste.";
  for (const k of ["beginn", "ende"]) if (w[k] && !ISO.test(w[k])) f[k] = "Datum ungültig. Wähle ein Datum im Kalender.";
  if (w.beginn && w.ende && ISO.test(w.beginn) && ISO.test(w.ende) && w.ende < w.beginn) f.ende = "Das Ende liegt vor dem Beginn. Prüfe die Daten.";
  return f;
}

/** Ordnername „<Nummer> <Name>“ ohne Zeichen, die in Dateisystemen Probleme machen. */
export function ordnerName(nummer, name) {
  const sauber = String(name || "").normalize("NFC").replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 80);
  return sauber ? `${nummer} ${sauber}` : nummer;
}
export const UNTERORDNER = Object.freeze(["Angebote", "Rechnungen", "Dokumente"]);

/** FA-31: Name der Kopie. */
export const kopieName = (name) => `${String(name).trim()} (Kopie)`;

/** 3.4: überfällig = nicht erledigt und fällig vor heute. */
export const aufgabeUeberfaellig = (a, heute) => !a.erledigt && !!a.faellig && a.faellig < heute;

/* ── Dateien (3.3, FA-33) ── */
export const DATEI_KATEGORIEN = Object.freeze({ plan: "Plan/Zeichnung", technik: "Technik/Rider", vertrag: "Vertrag", foto: "Foto", sonstiges: "Sonstiges" });
export const DATEI_ENDUNGEN = Object.freeze(["pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "txt", "csv", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "odt", "ods", "zip", "dwg", "dxf", "graphml", "vwx", "skp", "rtf"]);
export const MAX_DATEI = 50 * 1024 * 1024;
export const endung = (name) => { const m = /\.([a-z0-9]+)$/i.exec(String(name || "")); return m ? m[1].toLowerCase() : ""; };

/** 3.3: Fehlertext oder null. */
export function pruefeDatei(name, groesse) {
  const e = endung(name);
  if (!e || !DATEI_ENDUNGEN.includes(e)) return `Dateityp „.${e || "?"}“ ist nicht erlaubt. Erlaubt sind: ${DATEI_ENDUNGEN.join(", ")}.`;
  if (!(groesse > 0)) return "Die Datei ist leer. Wähle eine andere Datei.";
  if (groesse > MAX_DATEI) return "Die Datei ist größer als 50 MB. Verkleinere sie oder teile sie auf.";
  return null;
}
/** FA-33: PDF und Bilder (außer SVG) im Browser, alles andere als Download. */
const INLINE = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
export const inlineErlaubt = (name) => !!INLINE[endung(name)];
export const inhaltsTyp = (name) => INLINE[endung(name)] || "application/octet-stream";
/** Sicherer Dateiname für die Ablage (ohne Pfadanteile). */
export const sichererDateiname = (name) => String(name || "").split(/[\\/]/).pop().normalize("NFC").replace(/[:*?"<>|\x00-\x1f]/g, "_").replace(/^\.+/, "").slice(-150) || "datei";
