// Gerätezustände (Spec 4.3, R-16–R-19).

export const STATUS = Object.freeze({
  lager: "Im Lager", zugeordnet: "Projekt zugeordnet", gepackt: "Gepackt", vermisst: "Vermisst",
  defekt: "Defekt", reparatur: "In Reparatur", ausgemustert: "Ausgemustert", verkauft: "Verkauft",
});
/** R-16 */
export const GESPERRT = new Set(["vermisst", "defekt", "ausgemustert", "verkauft"]);
export const istGesperrt = (s) => GESPERRT.has(s) || s === "reparatur";
/** R-17 */
export const EINSATZFAEHIG = new Set(["lager", "zugeordnet", "gepackt"]);
export const istEinsatzfaehig = (s) => EINSATZFAEHIG.has(s);
export const ENDGUELTIG = new Set(["ausgemustert", "verkauft"]);

/** Erlaubte Übergänge (4.3). */
export function uebergangErlaubt(von, nach) {
  if (von === nach) return false;
  if (ENDGUELTIG.has(von)) return false;
  if (ENDGUELTIG.has(nach)) return true;                 // beliebig → ausgemustert | verkauft
  if (nach === "defekt" || nach === "reparatur") return true; // beliebig → defekt / in Reparatur
  const t = {
    lager: ["zugeordnet", "gepackt", "vermisst"],
    zugeordnet: ["lager", "gepackt", "vermisst"],
    gepackt: ["zugeordnet", "lager", "vermisst"],
    vermisst: ["lager"],
    defekt: ["lager", "reparatur"],
    reparatur: ["lager"],
  };
  return (t[von] || []).includes(nach);
}

/** Text für die Bewegung (R-18). */
export const aktionText = (von, nach, zusatz = "") => `Status: ${STATUS[von] || von} → ${STATUS[nach] || nach}${zusatz ? ` (${zusatz})` : ""}`;

/**
 * R-19: Löschen erlaubt? [IST] nicht, solange einem Projekt zugeordnet (außer vermisst/ausgemustert).
 * [SOLL P2] mit Bewegungsverlauf nie (nur ausmustern).
 * @returns {string|null} Sperrtext oder null
 */
export function loeschSperre(g, anzahlBewegungen) {
  if (g.projekt_id && !["vermisst", "ausgemustert"].includes(g.status))
    return `Das Gerät ${g.code} ist einem Projekt zugeordnet und kann nicht gelöscht werden. Gib es zuerst zurück oder mustere es aus.`;
  if (anzahlBewegungen > 0)
    return `Das Gerät ${g.code} hat einen Verlauf und darf nicht gelöscht werden (Nachweis). Mustere es stattdessen aus.`;
  return null;
}

/** Status, die man von Hand setzen darf. „Projekt zugeordnet“/„Gepackt“ nur über Packen. */
export const MANUELLER_STATUS = Object.freeze(["lager", "vermisst", "defekt", "reparatur", "ausgemustert", "verkauft"]);
