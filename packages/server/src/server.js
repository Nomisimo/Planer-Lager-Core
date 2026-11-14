// Komplett verdrahteter Lager-Server: Module + Zugangsprüfung + Grunddaten.
import { migriere } from "@lager/db";
import { erstelleApp } from "./app.js";
import { authModul, pruefeZugang } from "./auth.js";
import { verwaltungModul } from "./verwaltung.js";
import { sichereGrunddaten } from "./grunddaten.js";
import { Hub } from "./hub.js";
import { statischModul } from "./statisch.js";
import { stammdatenModul } from "./stammdaten.js";

export const MODULE = [authModul, verwaltungModul, stammdatenModul, statischModul];

/**
 * @param {{pool: import("pg").Pool, config?: object, migrieren?: boolean}} opt
 */
export async function erstelleLagerServer({ pool, config = {}, migrieren = true }) {
  if (migrieren) await migriere(pool);
  await sichereGrunddaten(pool, { adminBenutzer: config.adminBenutzer, adminPasswort: config.adminPasswort });
  const hub = new Hub(pool);
  const app = erstelleApp({ pool, config, hub, module: MODULE, pruefeZugang });
  hub.binde(app.server);
  app.server.on("close", () => hub.schliesse());
  return { ...app, hub };
}
