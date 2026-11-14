// Komplett verdrahteter Lager-Server: Module + Zugangsprüfung + Grunddaten.
import { aenderungenModul } from "./aenderungen.js";
import { lagerorteModul } from "./lagerorte.js";
import { schaedenModul } from "./schaeden.js";
import { migriere } from "@lager/db";
import { erstelleApp } from "./app.js";
import { authModul, pruefeZugang } from "./auth.js";
import { verwaltungModul } from "./verwaltung.js";
import { sichereGrunddaten } from "./grunddaten.js";
import { Hub } from "./hub.js";
import { statischModul } from "./statisch.js";
import { stammdatenModul } from "./stammdaten.js";
import { kundenModul } from "./kunden.js";
import { etikettenModul } from "./etiketten.js";
import { projekteModul } from "./projekte.js";
import { angeboteModul } from "./angebote.js";
import { scanModul } from "./scannen.js";
import { scannerModul, starteTcpGateway } from "./scanner.js";
import { zonenModul } from "./zonen.js";
import { stationModul } from "./station.js";
import { zeitModul } from "./zeit.js";
import { uebersichtModul } from "./uebersicht.js";
import { systemModul, beimStart } from "./system.js";
import { autoSicherung } from "./sicherung.js";
import { plansymboleModul, beobachteArtikel } from "./plansymbole.js";
import { inventurModul } from "./inventur.js";
import { durchgaengeModul } from "./durchgaenge.js";
import { ressourcenModul } from "./ressourcen.js";

export const MODULE = [authModul, verwaltungModul, stammdatenModul, etikettenModul, kundenModul, projekteModul, angeboteModul, scanModul, scannerModul, zonenModul, stationModul, zeitModul, uebersichtModul, systemModul, plansymboleModul, inventurModul, durchgaengeModul, ressourcenModul, aenderungenModul, lagerorteModul, schaedenModul, statischModul];

/**
 * @param {{pool: import("pg").Pool, config?: object, migrieren?: boolean}} opt
 */
export async function erstelleLagerServer({ pool, config = {}, migrieren = true }) {
  if (migrieren) await migriere(pool);
  await sichereGrunddaten(pool, { adminBenutzer: config.adminBenutzer, adminPasswort: config.adminPasswort });
  await beimStart(pool, config); // FA-50/FA-51
  const hub = new Hub(pool);
  const app = erstelleApp({ pool, config, hub, module: MODULE, pruefeZugang });
  hub.binde(app.server);
  beobachteArtikel(hub, pool, config); // FA-53: Symbolbibliothek bei jeder Artikeländerung
  // Netzwerk-Scanner per TCP startet mit dem HTTP-Server und endet mit ihm.
  const gateway = { server: null, port: null };
  app.server.on("listening", () => {
    // FA-49: automatisch sichern, wenn die letzte Sicherung älter als 20 Stunden ist
    if (config.autoSicherung) autoSicherung(pool, config).then((r) => r && console.log(`Automatische Sicherung: ${r.name} – ${r.pruefung.text}`), (e) => console.error(`Automatische Sicherung fehlgeschlagen: ${e.message}`));
    gateway.server = starteTcpGateway({ pool, hub }, { port: config.scannerTcpPort, host: config.scannerTcpHost });
    gateway.server?.on("listening", () => { gateway.port = gateway.server.address().port; });
    gateway.server?.on("error", (e) => console.error(`Scanner-Gateway (TCP) nicht gestartet: ${e.message}`));
  });
  app.server.on("close", () => { hub.schliesse(); gateway.server?.close(); });
  return { ...app, hub, gateway };
}
