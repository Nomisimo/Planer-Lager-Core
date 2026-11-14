// FA-55 Änderungsprotokoll: Gesamtliste in der Verwaltung und Verlauf je Datensatz (Artikel, Kunde, Projekt).
import React, { useState } from "react";
import { Seite, Section, Knopf, Tabelle, Eingabe, Auswahl, Meldung, useDaten } from "./bausteine.jsx";
import { useLager } from "./huelle.jsx";
import { zeitpunktAnzeige } from "@lager/domain/zeit.js";
import { euro } from "@lager/domain/geld.js";

export const TABELLEN = { artikel: "Artikel", kunde: "Kunde", projekt: "Projekt", rolle: "Rolle", benutzer: "Benutzer" };
const AKTION = { angelegt: "angelegt", geaendert: "geändert", geloescht: "gelöscht", anonymisiert: "anonymisiert" };
const FELD = {
  name: "Name", kategorie_id: "Kategorie", hersteller: "Hersteller", beschreibung: "Beschreibung", aktiv: "aktiv", preis_tag: "Tagespreis",
  folgetag_prozent: "Folgetag %", verkaeuflich: "verkäuflich", verkaufspreis: "Verkaufspreis", bestand: "Bestand", mindestbestand: "Mindestbestand",
  pruefpflichtig: "prüfpflichtig", pruef_intervall_monate: "Prüfintervall", wartung_intervall_monate: "Wartungsintervall", gewicht_kg: "Gewicht (kg)",
  firma: "Firma", email: "E-Mail", telefon: "Telefon", strasse: "Straße", plz: "PLZ", ort: "Ort", ust_id: "USt-ID", notizen: "Notizen",
  nummer: "Nummer", art: "Art", status: "Status", beginn: "Beginn", ende: "Ende", kunde_id: "Kunde", uebergeordnet_id: "Projekt", gewerk: "Gewerk",
  rechte: "Rechte", benutzername: "Benutzername", rolle_id: "Rolle", passwort_hash: "Passwort", totp_aktiv: "2-Faktor", totp_geheimnis: "2-Faktor-Schlüssel",
};
const GELD = new Set(["preis_tag", "verkaufspreis", "tagessatz"]);

/** Wert lesbar machen: Geld in Euro, ja/nein, Objekte (Rechte) als „bereich: stufe“. */
export function wertText(feld, v) {
  if (v == null || v === "") return "–";
  if (GELD.has(feld) && typeof v === "number") return euro(v);
  if (typeof v === "boolean") return v ? "ja" : "nein";
  if (typeof v === "object") return Object.entries(v).filter(([, s]) => s).map(([k, s]) => `${k}: ${s}`).join(", ") || "–";
  return String(v);
}

/** Bei Rechten nur die geänderten Bereiche zeigen. */
function felderText(z) {
  return z.felder.map((f) => {
    let { alt, neu } = f;
    if (alt && neu && typeof alt === "object" && typeof neu === "object") {
      const k = [...new Set([...Object.keys(alt), ...Object.keys(neu)])].filter((x) => (alt[x] || "") !== (neu[x] || ""));
      alt = Object.fromEntries(k.map((x) => [x, alt[x] || "kein"])); neu = Object.fromEntries(k.map((x) => [x, neu[x] || "kein"]));
    }
    return z.aktion === "angelegt" ? `${FELD[f.feld] || f.feld}: ${wertText(f.feld, neu)}`
      : z.aktion === "geloescht" ? `${FELD[f.feld] || f.feld}: ${wertText(f.feld, alt)}`
        : `${FELD[f.feld] || f.feld}: ${wertText(f.feld, alt)} → ${wertText(f.feld, neu)}`;
  });
}

const Felder = ({ z }) => {
  const t = felderText(z);
  return t.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{t.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="lp-meta">–</span>;
};

export function AenderungsSeite() {
  const { api } = useLager();
  const [f, setF] = useState({ tabelle: "", q: "", von: "", bis: "" });
  const l = useDaten(() => api.get(`/api/v1/verwaltung/aenderungen?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`), [f.tabelle, f.q, f.von, f.bis]);
  return (
    <Seite titel="Änderungsprotokoll" untertitel="Wer hat wann was an Artikeln, Kunden, Projekten und Rechten geändert (alt → neu).">
      {l.fehler && <Meldung level="error" text={l.fehler} />}
      <Section titel="Änderungen" icon="History">
        <div className="lp-zeile" style={{ marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ width: 180 }}><Auswahl aria-label="Bereich" leer="Alle Bereiche" value={f.tabelle} onChange={(e) => setF({ ...f, tabelle: e.target.value })}
            optionen={Object.entries(TABELLEN).map(([wert, titel]) => ({ wert, titel }))} /></div>
          <div style={{ width: 220 }}><Eingabe aria-label="Suchen" placeholder="Name oder Person …" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
          <Eingabe type="date" aria-label="Von" value={f.von} onChange={(e) => setF({ ...f, von: e.target.value })} style={{ width: 160 }} />
          <Eingabe type="date" aria-label="Bis" value={f.bis} onChange={(e) => setF({ ...f, bis: e.target.value })} style={{ width: 160 }} />
        </div>
        <Tabelle zeilen={l.daten?.zeilen || []} leer="Keine Änderungen im gewählten Zeitraum." spalten={[
          { titel: "Zeit", wert: (z) => zeitpunktAnzeige(z.zeit) },
          { titel: "Wer", feld: "von" },
          { titel: "Was", wert: (z) => <div><strong>{z.bezeichnung || `#${z.datensatz_id}`}</strong><div className="lp-meta">{TABELLEN[z.tabelle]} {AKTION[z.aktion]}</div></div> },
          { titel: "Änderungen", wert: (z) => <Felder z={z} /> },
        ]} />
      </Section>
    </Seite>
  );
}

/** Verlauf eines Datensatzes, erst auf Klick geladen. */
export function AenderungsVerlauf({ tabelle, id }) {
  const { api } = useLager();
  const [offen, setOffen] = useState(false);
  const l = useDaten(() => (offen ? api.get(`/api/v1/aenderungen/${tabelle}/${id}`) : Promise.resolve(null)), [offen, tabelle, id]);
  return (
    <Section titel="Änderungsverlauf" icon="History" aktionen={<Knopf klein icon={offen ? "ChevronDown" : "ChevronRight"} onClick={() => setOffen(!offen)}>{offen ? "Ausblenden" : "Anzeigen"}</Knopf>}>
      {offen && l.fehler && <Meldung level="error" text={l.fehler} />}
      {offen && <Tabelle zeilen={l.daten?.zeilen || []} leer="Noch keine Änderungen protokolliert." spalten={[
        { titel: "Zeit", wert: (z) => zeitpunktAnzeige(z.zeit) },
        { titel: "Wer", feld: "von" },
        { titel: "Aktion", wert: (z) => AKTION[z.aktion] },
        { titel: "Änderungen", wert: (z) => <Felder z={z} /> },
      ]} />}
    </Section>
  );
}
