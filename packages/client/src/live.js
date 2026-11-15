// Live-Verbindung zum Hub (/ws) mit automatischem Wiederverbinden und Abonnenten je Ereignistyp.

export class Live {
  /** @param {{basis: string, token?: () => string|null, WebSocketImpl?: any}} opt */
  constructor(opt) {
    this.opt = opt;
    this.abos = new Map(); // typ-Präfix → Set<fn>
    this.statusAbos = new Set();
    this.status = "getrennt";
    this.versuch = 0;
    this.aus = false;
  }
  start() { this.aus = false; this.verbinde(); return this; }
  stopp() { this.aus = true; clearTimeout(this.timer); clearInterval(this.praesenzTimer); this.ws?.close(); }
  setzeStatus(s) { this.status = s; for (const f of this.statusAbos) f(s); }
  verbinde() {
    const W = this.opt.WebSocketImpl || globalThis.WebSocket;
    const url = this.opt.basis.replace(/^http/, "ws").replace(/\/+$/, "") + "/ws";
    let ws;
    try { ws = new W(url); } catch { return this.spaeter(); }
    this.ws = ws;
    this.setzeStatus("verbinde");
    ws.onopen = () => {
      const t = this.opt.token?.(); if (t) ws.send(JSON.stringify({ typ: "anmelden", token: t }));
      if (this.extra) ws.send(JSON.stringify({ typ: "abo", daten: this.extra }));
      if (this.ort) ws.send(JSON.stringify({ typ: "praesenz", ...this.ort }));
    };
    ws.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch { return; }
      if (ev.typ === "hallo") { this.versuch = 0; this.setzeStatus("verbunden"); }
      for (const [praefix, fns] of this.abos) if (praefix === "*" || ev.typ === praefix || ev.typ.startsWith(praefix + ".")) for (const f of fns) f(ev);
    };
    ws.onclose = () => { this.setzeStatus("getrennt"); this.spaeter(); };
    ws.onerror = () => {};
  }
  spaeter() {
    if (this.aus) return;
    const ms = Math.min(15000, 500 * 2 ** this.versuch++);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.verbinde(), ms);
  }
  /** Abo, z. B. on("geraet", fn) für geraet.* oder on("*", fn). Liefert Abmelde-Funktion. */
  on(typ, fn) {
    if (!this.abos.has(typ)) this.abos.set(typ, new Set());
    this.abos.get(typ).add(fn);
    return () => this.abos.get(typ)?.delete(fn);
  }
  onStatus(fn) { this.statusAbos.add(fn); fn(this.status); return () => this.statusAbos.delete(fn); }
  /**
   * GLEICH-06: meldet, wo der Nutzer gerade ist (z. B. {ort: "projekt:5", app: "p"}), null = nirgends.
   * Wird alle 20 s erneuert; der Server vergisst Einträge nach 30 s ohne Erneuerung.
   */
  praesenz(ort) {
    this.ort = ort || null;
    clearInterval(this.praesenzTimer);
    const sende = () => { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ typ: "praesenz", ...(this.ort || { ort: null }) })); };
    sende();
    if (this.ort) { this.praesenzTimer = setInterval(sende, 20_000); this.praesenzTimer.unref?.(); }
  }
  /** Zusatzdaten (z. B. Arbeitsplatz) für gezielte Ereignisse. */
  abonniere(extra) { this.extra = { ...(this.extra || {}), ...extra }; if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ typ: "abo", daten: this.extra })); }
}
