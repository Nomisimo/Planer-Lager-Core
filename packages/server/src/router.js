// Route-Registry (ARCHITEKTUR §3, R-01): jede Route deklariert Bereich + Stufe.
// Nicht registrierte Pfade unter /api → 404; Rechteprüfung erfolgt zentral in app.js.

export class HttpFehler extends Error {
  /** @param {number} status @param {string} text @param {object} [extra] */
  constructor(status, text, extra) { super(text); this.status = status; this.extra = extra; }
}

/**
 * @typedef {{methode: string, pfad: string, bereich: string|null, stufe: "r"|"w"|null, oeffentlich?: boolean,
 *   arbeitsplatz?: boolean, handler: Function, re: RegExp, namen: string[]}} Route
 */
export class Router {
  constructor() { /** @type {Route[]} */ this.routen = []; }

  /**
   * @param {string} methode GET/POST/PUT/PATCH/DELETE
   * @param {string} pfad z. B. /api/v1/geraete/:id
   * @param {{bereich?: string|null, stufe?: "r"|"w"|null, oeffentlich?: boolean, arbeitsplatz?: boolean}} recht
   * @param {(ctx: any) => any} handler
   */
  add(methode, pfad, recht, handler) {
    const namen = [];
    const re = new RegExp("^" + pfad.replace(/\/:(\w+)/g, (_m, n) => { namen.push(n); return "/([^/]+)"; }) + "/?$");
    this.routen.push({ ...recht, methode, pfad, bereich: recht.bereich ?? null, stufe: recht.stufe ?? null,
      oeffentlich: !!recht.oeffentlich, arbeitsplatz: !!recht.arbeitsplatz, handler, re, namen });
  }
  get(p, r, h) { this.add("GET", p, r, h); }
  post(p, r, h) { this.add("POST", p, r, h); }
  put(p, r, h) { this.add("PUT", p, r, h); }
  patch(p, r, h) { this.add("PATCH", p, r, h); }
  delete(p, r, h) { this.add("DELETE", p, r, h); }

  /** @returns {{route: Route, params: Record<string,string>} | {pfadBekannt: boolean} } */
  finde(methode, pfad) {
    let pfadBekannt = false;
    for (const r of this.routen) {
      const m = r.re.exec(pfad);
      if (!m) continue;
      pfadBekannt = true;
      if (r.methode !== methode && !(methode === "HEAD" && r.methode === "GET")) continue;
      const params = {};
      r.namen.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return { pfadBekannt };
  }
}
