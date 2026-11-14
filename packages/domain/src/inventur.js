// FA-06 Inventur: Abgleich Soll-Bestand eines Lagerbereichs gegen gescannte Codes.

/** Status, mit denen ein Gerät physisch im Lager stehen muss (nicht unterwegs, nicht verkauft/ausgemustert). */
export const IM_LAGER_STATUS = Object.freeze(["lager", "zugeordnet", "defekt", "reparatur"]);

export const INVENTUR_STATUS = Object.freeze({ offen: "Offen", abgeschlossen: "Abgeschlossen", abgebrochen: "Abgebrochen" });

/**
 * Teilt einen Inventurlauf in vier Gruppen.
 * - ok: im Soll und gescannt
 * - fehlt: im Soll, nicht gescannt (wird beim Abschluss „vermisst“)
 * - zuViel: gescannt, bekanntes Gerät, aber nicht im Soll (z. B. als vermisst geführt, unterwegs gebucht, anderer Bereich)
 * - unbekannt: gescannter Code ohne Gerät
 * @param {Array<{id: number, code: string}>} soll
 * @param {Array<{code: string, geraet_id: number|null}>} scans
 */
export function inventurAbgleich(soll, scans) {
  const gescannt = new Set(scans.filter((s) => s.geraet_id != null).map((s) => s.geraet_id));
  const sollIds = new Set(soll.map((g) => g.id));
  return {
    ok: soll.filter((g) => gescannt.has(g.id)),
    fehlt: soll.filter((g) => !gescannt.has(g.id)),
    zuViel: scans.filter((s) => s.geraet_id != null && !sollIds.has(s.geraet_id)),
    unbekannt: scans.filter((s) => s.geraet_id == null),
  };
}
