// Hilfe-Seite (Phase 18): Touren-Liste, Tastenkürzel, Kurzanleitung. In beiden Apps unter System › Hilfe.
import React from "react";
import { Seite, Section, Knopf, Tabelle, Badge } from "../bausteine.jsx";
import { useLager } from "../kontext.js";
import { WasIstNeu } from "../huelle.jsx";

const TASTEN = [
  { taste: "Enter im Codefeld", was: "Code, Projekt- oder Angebotsnummer öffnen" },
  { taste: "Handscanner", was: "tippt den Code ein und drückt Enter – auch ohne Klick ins Feld" },
  { taste: "1 / 2 nach einem Rückgabe-Scan", was: "Funktionstest: in Ordnung / Mangel" },
  { taste: "Esc", was: "Dialog oder Tour schließen" },
  { taste: "→ / Enter, ←", was: "Tour: weiter, zurück" },
];

export function HilfeSeite() {
  const { tour, nutzer, info } = useLager();
  const erledigt = nutzer?.tour?.erledigt || [];
  return (
    <Seite titel="Hilfe" untertitel="Touren, Tastenkürzel und eine Kurzanleitung">
      <Section titel="Touren" icon="Compass" tour="hilfe-touren">
        <Tabelle zeilen={tour?.touren || []} leer="Keine Touren für diese App." spalten={[
          { titel: "Tour", wert: (t) => <><strong>{t.titel}</strong><div className="lp-meta">{t.text}</div></> },
          { titel: "Stand", wert: (t) => (erledigt.includes(t.id) ? <Badge farbe="var(--lp-ok)">erledigt</Badge> : <Badge>offen</Badge>) },
          { titel: "", wert: (t) => <Knopf klein icon="Play" aria-label={`Tour „${t.titel}“ starten`} onClick={() => tour.starte(t.id)}>Tour starten</Knopf> },
        ]} />
      </Section>
      <Section titel={`Was ist neu in Version ${info?.version || ""}?`} icon="Star">
        <WasIstNeu />
      </Section>
      <Section titel="Tastenkürzel" icon="Keyboard">
        <Tabelle zeilen={TASTEN} spalten={[{ titel: "Taste", feld: "taste" }, { titel: "Wirkung", feld: "was" }]} />
      </Section>
      <Section titel="Kurzanleitung" icon="BookOpen">
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Material aufnehmen (Materialplaner › Material) – mit Anzahl entstehen Geräte und Etiketten.</li>
          <li>Kunde und Projekt anlegen (Productionplaner › Kunden, Projekte), Angebot schreiben und versenden.</li>
          <li>Angebot angenommen → das Lager packt im Materialplaner (Code scannen), verlädt und gibt die Ladezone frei.</li>
          <li>Nach der Veranstaltung: Rückgabe scannen, Mängel melden, offene Geräte als vermisst melden.</li>
          <li>Beide Apps zeigen Änderungen sofort; mit dem Wechsel-Knopf oben springst du an die passende Stelle.</li>
        </ol>
      </Section>
    </Seite>
  );
}
