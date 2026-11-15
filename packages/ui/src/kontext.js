// Gemeinsamer React-Kontext der Hülle (eigene Datei, damit bausteine.jsx ihn ohne Kreisimport nutzen kann).
import { createContext, useContext } from "react";

export const Ctx = createContext(null);
/** Zugriff auf api, live, nutzer, navigiere, pfad, query, oeffneAndereApp … */
export const useLager = () => useContext(Ctx);
