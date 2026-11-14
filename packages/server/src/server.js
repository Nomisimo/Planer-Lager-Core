// Komplett verdrahteter Lager-Server: Module + Zugangsprüfung + Grunddaten.
import { migriere } from "@lager/db";
import { erstelleApp } from "./app.js";
import { authModul, pruefeZugang } from "./auth.js";
import { verwaltungModul } from "./verwaltung.js";
import { sichereGrunddaten } from "./grunddaten.js";

export const MODULE = [authModul, verwaltungModul];

/**
 * @param {{pool: import("pg").Pool, config?: object, migrieren?: boolean}} opt
 */
export async function erstelleLagerServer({ pool, config = {}, migrieren = true }) {
  if (migrieren) await migriere(pool);
  await sichereGrunddaten(pool, { adminBenutzer: config.adminBenutzer, adminPasswort: config.adminPasswort });
  return erstelleApp({ pool, config, module: MODULE, pruefeZugang });
}
