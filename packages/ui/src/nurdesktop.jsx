// WEB-08: Funktionen, die es nur in der Desktop-App gibt, sind im Browser verborgen und hier gekennzeichnet.
import React from "react";
import { Section, Knopf } from "./bausteine.jsx";
import { plattform, NUR_DESKTOP, RELEASES_URL } from "./plattform.js";

/** Hinweis „Nur in der Desktop-App“ (nur im Browser sichtbar). `funktion`: Schlüssel aus NUR_DESKTOP. */
export function NurDesktop({ funktion, titel }) {
  if (plattform.kann(funktion)) return null;
  const name = NUR_DESKTOP[funktion] || funktion;
  return (
    <Section titel={titel || name} icon="Monitor">
      <p className="lp-hinweis" style={{ marginTop: 0 }} data-testid={`nur-desktop-${funktion}`}>
        <strong>Nur in der Desktop-App:</strong> {name}. Im Browser steht das nicht zur Verfügung. Installiere den Materialplaner oder Productionplaner auf diesem Rechner, um es zu nutzen.
      </p>
      <Knopf icon="Download" onClick={() => plattform.oeffneExtern(RELEASES_URL)}>Desktop-App herunterladen</Knopf>
    </Section>
  );
}
