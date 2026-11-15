// Versionen (REL-02, REL-03): SemVer-Vergleich mit Vorabversionen, CHANGELOG-Abschnitt, neueste Version aus GitHub-Releases.

const teile = (v) => {
  const t = String(v || "").replace(/^v/, "").split("+")[0];
  const i = t.indexOf("-");
  const kern = i < 0 ? t : t.slice(0, i), vor = i < 0 ? "" : t.slice(i + 1);
  return { kern: kern.split(".").map((x) => Number(x) || 0), vor: vor ? vor.split(".") : [] };
};

/** < 0, wenn a älter als b ist; 0 bei Gleichheit; > 0, wenn a neuer ist. 1.0.0-beta.2 < 1.0.0-beta.10 < 1.0.0. */
export function vergleicheVersion(a, b) {
  const x = teile(a), y = teile(b);
  for (let i = 0; i < 3; i++) if ((x.kern[i] || 0) !== (y.kern[i] || 0)) return (x.kern[i] || 0) - (y.kern[i] || 0);
  if (!x.vor.length || !y.vor.length) return (x.vor.length ? -1 : 0) - (y.vor.length ? -1 : 0);
  for (let i = 0; i < Math.max(x.vor.length, y.vor.length); i++) {
    const p = x.vor[i], q = y.vor[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const np = /^\d+$/.test(p), nq = /^\d+$/.test(q);
    if (np && nq && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (np !== nq) return np ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Abschnitt „## [<version>] …“ aus CHANGELOG.md, ohne Überschrift; "" wenn nicht vorhanden. */
export function changelogAbschnitt(md, version) {
  const zeilen = String(md || "").split(/\r?\n/);
  const start = zeilen.findIndex((z) => new RegExp(`^##\\s*\\[?v?${String(version).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]?(\\s|$)`).test(z));
  if (start < 0) return "";
  const rest = zeilen.slice(start + 1);
  const ende = rest.findIndex((z) => /^##\s/.test(z));
  return (ende < 0 ? rest : rest.slice(0, ende)).join("\n").trim();
}

/** Neueste veröffentlichte Version aus der GitHub-Releases-Liste, wenn sie neuer als `aktuell` ist. */
export function neuereVersion(releases, aktuell) {
  let best = null;
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft || !r.tag_name) continue;
    const v = String(r.tag_name).replace(/^v/, "");
    if (!best || vergleicheVersion(v, best.version) > 0) best = { version: v, url: r.html_url || "" };
  }
  return best && vergleicheVersion(best.version, aktuell) > 0 ? best : null;
}

/* global __APP_NEU__ */
/** CHANGELOG-Abschnitt, der beim Bauen eingebettet wurde (REL-02). */
export const wasIstNeu = () => { try { return __APP_NEU__; } catch { return ""; } };
