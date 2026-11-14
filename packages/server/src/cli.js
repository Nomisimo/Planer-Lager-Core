#!/usr/bin/env node
// Verwaltungsbefehle auf dem Server (FA-49, FA-50). Aufruf: npm run lager -- <befehl>
//   sicherung                         Sicherung jetzt erstellen und prüfen
//   restore <Datei>                   Sicherung wiederherstellen (vorher automatische Vorab-Sicherung)
//   pruefen <Datei>                   Sicherung prüfen (ZIP lesbar, Datenbank vollständig)
//   sicherheitscheck [--absichern]    Sicherheits-Check, mit --absichern Dateirechte des Datenordners setzen
import path from "node:path";
import { erstellePool } from "@lager/db";
import { configAusEnv } from "./config.js";
import { erstelleSicherung, stelleWiederHer, pruefeSicherung, sicherungsOrdner, gueltigerName } from "./sicherung.js";
import { sicherheitsCheck, sichereDateirechte } from "./system.js";

const [befehl, arg] = process.argv.slice(2);
const config = configAusEnv();
const datei = (a) => (a && gueltigerName(path.basename(a)) && !a.includes("/") ? path.join(sicherungsOrdner(config), a) : path.resolve(a || ""));
const pool = () => erstellePool({ url: process.env.DATABASE_URL_DEV || process.env.DATABASE_URL, schema: process.env.LAGER_DB_SCHEMA || undefined });

async function main() {
  if (befehl === "sicherung") {
    const p = pool();
    try { const r = await erstelleSicherung(p, config); console.log(`${r.name}: ${r.pruefung.text}${r.zweitkopie ? ` ${r.zweitkopie.text}` : ""}`); return r.pruefung.ok ? 0 : 1; } finally { await p.end(); }
  }
  if (befehl === "restore") {
    if (!arg) { console.error("Gib die Sicherungsdatei an: npm run lager -- restore lager-JJJJ-MM-TT_HHMMSS.zip"); return 2; }
    const p = pool();
    try { const r = await stelleWiederHer(p, config, datei(arg)); console.log(`Wiederhergestellt. Vorab-Sicherung: ${r.vorab}. ${r.pruefung.text}`); return 0; }
    catch (e) { console.error(e.message); return 1; } finally { await p.end(); }
  }
  if (befehl === "pruefen") { const r = pruefeSicherung(datei(arg), config); console.log(r.text); return r.ok ? 0 : 1; }
  if (befehl === "sicherheitscheck") {
    if (process.argv.includes("--absichern")) console.log(`Dateirechte abgesichert: ${sichereDateirechte(config)} geändert.`);
    const p = pool();
    try { for (const z of await sicherheitsCheck(p, config)) console.log(`${z.level === "ok" ? "OK  " : z.level === "error" ? "FEHL" : "WARN"} ${z.titel}: ${z.text}`); return 0; } finally { await p.end(); }
  }
  console.error("Befehle: sicherung | restore <Datei> | pruefen <Datei> | sicherheitscheck [--absichern]");
  return 2;
}
process.exitCode = await main();
