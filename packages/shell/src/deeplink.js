// Deep-Links zwischen den Apps (ARCHITEKTUR §4.2). Reine Funktionen, ohne Electron.

/** Bekannte Ziele je Protokoll. */
export const PROTOKOLLE = { materialplaner: "materialplaner", productionplaner: "productionplaner" };

/**
 * Zerlegt materialplaner://geraet/LT-0001 → { app, pfad: ["geraet","LT-0001"], query }
 * @param {string} url
 * @returns {{app: string, pfad: string[], query: Record<string,string>} | null}
 */
export function zerlegeDeepLink(url) {
  const m = /^([a-z]+):\/\/([^?#]*)(?:\?([^#]*))?/i.exec(String(url || "").trim());
  if (!m || !PROTOKOLLE[m[1].toLowerCase()]) return null;
  const pfad = m[2].split("/").filter(Boolean).map((t) => decodeURIComponent(t));
  const query = Object.fromEntries(new URLSearchParams(m[3] || ""));
  return { app: m[1].toLowerCase(), pfad, query };
}

/**
 * Baut einen Deep-Link. baueDeepLink("materialplaner", ["geraet","LT-0001"], {handoff:"x"})
 * @param {string} app @param {string[]} pfad @param {Record<string,string>} [query]
 */
export function baueDeepLink(app, pfad, query) {
  if (!PROTOKOLLE[app]) throw new Error(`Unbekannte App: ${app}`);
  const q = query && Object.keys(query).length ? "?" + new URLSearchParams(query).toString() : "";
  return `${app}://${pfad.map((t) => encodeURIComponent(t)).join("/")}${q}`;
}

/** Sucht in argv (Windows/Linux: zweite Instanz) einen Deep-Link für das Protokoll. */
export const linkAusArgv = (argv, protokoll) => (argv || []).find((a) => typeof a === "string" && a.startsWith(protokoll + "://")) || null;
