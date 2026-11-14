// Hash-Router der Apps: #/projekte/12?tab=jobs. Muster mit :param.
export function passeMuster(muster, pfad) {
  const namen = [];
  const re = new RegExp("^" + muster.replace(/\/:(\w+)/g, (_m, n) => { namen.push(n); return "/([^/]+)"; }) + "/?$");
  const m = re.exec(pfad);
  if (!m) return null;
  return Object.fromEntries(namen.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
}
export function zerlegeHash(hash) {
  const h = String(hash || "").replace(/^#/, "") || "/";
  const [pfad, q = ""] = h.split("?");
  return { pfad: pfad.startsWith("/") ? pfad : "/" + pfad, query: Object.fromEntries(new URLSearchParams(q)) };
}
/** Deep-Link-Pfad (materialplaner://geraet/LT-0001) → App-Pfad. Einzahl-Aliasse wie in ARCHITEKTUR §4.2. */
const ALIAS = { geraet: "geraete", projekt: "projekte", angebot: "angebote", kunde: "kunden" };
export function deepLinkZuPfad(teile) {
  if (!teile?.length) return "/";
  const [kopf, ...rest] = teile;
  if (kopf === "geraet" && rest.length === 1) return `/geraete/code/${encodeURIComponent(rest[0])}`;
  if (kopf === "projekt" && rest.length >= 1 && /^P-/.test(rest[0])) return `/projekte/nummer/${encodeURIComponent(rest[0])}${rest.length > 1 ? "/" + rest.slice(1).join("/") : ""}`;
  return "/" + [ALIAS[kopf] || kopf, ...rest.map(encodeURIComponent)].join("/");
}
