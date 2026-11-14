// API-Client für Apps und station-web: JSON, Bearer-Token oder Cookie+CSRF, Fehler als {status, text, level, felder}.

export class ApiFehler extends Error {
  constructor(status, daten) {
    super(daten?.text || daten?.fehler || `Fehler ${status}`);
    this.status = status;
    this.text = daten?.text || daten?.fehler || "Das hat nicht geklappt. Versuche es noch einmal.";
    this.level = daten?.level || "error";
    this.felder = daten?.felder || null;
    this.daten = daten || {};
  }
}

/**
 * @param {{basis: string, token?: () => string|null, csrf?: () => string|null, credentials?: RequestCredentials, beiAbmeldung?: (d: any) => void}} opt
 */
export function erstelleApi(opt) {
  const basis = opt.basis.replace(/\/+$/, "");
  async function anfrage(methode, pfad, body, extra = {}) {
    const kopf = { Accept: "application/json", ...(extra.headers || {}) };
    const t = opt.token?.();
    if (t) kopf.Authorization = "Bearer " + t;
    const c = opt.csrf?.();
    if (c && methode !== "GET" && methode !== "HEAD") kopf["X-CSRF-Token"] = c;
    let daten = body;
    if (body !== undefined && !(body instanceof FormData) && !(body instanceof Blob)) { kopf["Content-Type"] = "application/json"; daten = JSON.stringify(body); }
    const r = await fetch(basis + pfad, { method: methode, headers: kopf, body: daten, credentials: opt.credentials || "include", signal: extra.signal });
    if (extra.roh) { if (!r.ok) throw new ApiFehler(r.status, await r.json().catch(() => null)); return r; }
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!r.ok) {
      if (r.status === 401 && json?.anmelden) opt.beiAbmeldung?.(json);
      throw new ApiFehler(r.status, json);
    }
    return json;
  }
  return {
    basis,
    get: (p, e) => anfrage("GET", p, undefined, e),
    post: (p, b = {}, e) => anfrage("POST", p, b, e),
    put: (p, b = {}, e) => anfrage("PUT", p, b, e),
    patch: (p, b = {}, e) => anfrage("PATCH", p, b, e),
    del: (p, e) => anfrage("DELETE", p, undefined, e),
    anfrage,
  };
}

/** Query-String aus Objekt (leere Werte entfallen). */
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== "") p.set(k, v); const s = p.toString(); return s ? "?" + s : ""; };
