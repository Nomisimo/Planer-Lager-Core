// Komplett verdrahteter Lager-Server: Module + Zugangsprüfung + Grunddaten.
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

export const MODULE = [authModul, verwaltungModul, stammdatenModul, etikettenModul, kundenModul, projekteModul, angeboteModul, scanModul, scannerModul, zonenModul, stationModul, zeitModul, statischModul];

/**
 * @param {{pool: import("pg").Pool, config?: object, migrieren?: boolean}} opt
 */
export async function erstelleLagerServer({ pool, config = {}, migrieren = true }) {
  if (migrieren) await migriere(pool);
  await sichereGrunddaten(pool, { adminBenutzer: config.adminBenutzer, adminPasswort: config.adminPasswort });
  const hub = new Hub(pool);
  const app = erstelleApp({ pool, config, hub, module: MODULE, pruefeZugang });
  hub.binde(app.server);
  // Netzwerk-Scanner per TCP startet mit dem HTTP-Server und endet mit ihm.
  const gateway = { server: null, port: null };
  app.server.on("listening", () => {
    gateway.server = starteTcpGateway({ pool, hub }, { port: config.scannerTcpPort, host: config.scannerTcpHost });
    gateway.server?.on("listening", () => { gateway.port = gateway.server.address().port; });
    gateway.server?.on("error", (e) => console.error(`Scanner-Gateway (TCP) nicht gestartet: ${e.message}`));
  });
  app.server.on("close", () => { hub.schliesse(); gateway.server?.close(); });
  return { ...app, hub, gateway };
}
