// WebSocket-Hub (/ws): Live-Events nach jeder Buchung (ARCHITEKTUR §3), nur an Nutzer mit Leserecht auf den Bereich.
// Anmeldung: Cookie beim Verbindungsaufbau (Web) oder erste Nachricht {typ:"anmelden", token} (Apps).
import { WebSocketServer } from "ws";
import { darf } from "@lager/domain";
import { ladeSitzung, leseCookies, COOKIE } from "./auth.js";

const ANMELDE_FRIST_MS = 5000;

export class Hub {
  /** @param {import("pg").Pool} pool */
  constructor(pool) {
    this.pool = pool;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    /** @type {Set<import("ws").WebSocket & {nutzer?: any, extra?: any}>} */
    this.clients = new Set();
    this.zaehler = 0;
    this.ping = setInterval(() => {
      for (const ws of this.clients) { if (ws.lebt === false) { ws.terminate(); continue; } ws.lebt = false; ws.ping(); }
    }, 30_000);
    this.ping.unref();
  }

  /** Hängt den Hub an den HTTP-Server. */
  binde(server) {
    server.on("upgrade", (req, socket, head) => {
      const pfad = new URL(req.url || "/", "http://x").pathname;
      if (pfad !== "/ws") { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.verbinde(ws, req));
    });
  }

  async verbinde(ws, req) {
    ws.lebt = true;
    ws.on("pong", () => { ws.lebt = true; });
    const anmelden = async (token) => {
      const s = await ladeSitzung(this.pool, token);
      if (!s?.nutzer || s.nutzer.sitzungArt === "zwischen") { ws.close(4401, "Bitte melde dich an."); return; }
      ws.nutzer = s.nutzer;
      this.clients.add(ws);
      ws.send(JSON.stringify({ typ: "hallo", nutzer: s.nutzer.benutzername }));
    };
    const cookie = leseCookies(req)[COOKIE];
    if (cookie) await anmelden(cookie);
    const frist = setTimeout(() => { if (!ws.nutzer) ws.close(4401, "Bitte melde dich an."); }, ANMELDE_FRIST_MS);
    // Nachrichten der Reihe nach verarbeiten: „abo“ direkt nach „anmelden“ darf nicht verloren gehen.
    let kette = Promise.resolve();
    ws.on("message", (roh) => {
      let m; try { m = JSON.parse(String(roh)); } catch { return; }
      kette = kette.then(async () => {
        if (m.typ === "anmelden" && !ws.nutzer) await anmelden(m.token);
        else if (m.typ === "abo" && ws.nutzer && m.daten && typeof m.daten === "object") ws.extra = { ...(ws.extra || {}), ...m.daten }; // z. B. {arbeitsplatz: 3}
      }).catch(() => {});
    });
    ws.on("close", () => { clearTimeout(frist); this.clients.delete(ws); });
  }

  /**
   * Sendet ein Ereignis {typ, id?, version?, bereich, ...} an alle mit Leserecht auf `bereich`.
   * @param {{typ: string, bereich: string, auchFuer?: string[], id?: any, version?: any}} ev
   * @param {(ws: any) => boolean} [filter] zusätzliche Auswahl (z. B. nur ein Arbeitsplatz)
   */
  sende(ev, filter) {
    for (const fn of this.beobachter || []) { try { fn(ev); } catch (e) { console.error(`Hub-Beobachter: ${e.message}`); } }
    const text = JSON.stringify({ ...ev, nr: ++this.zaehler });
    for (const ws of this.clients) {
      if (!ws.nutzer || ws.readyState !== 1) continue;
      if (![ev.bereich, ...(ev.auchFuer || [])].some((b) => darf(ws.nutzer.rechte, b, "r"))) continue; // auchFuer: weitere Bereiche (z. B. Anzeige)
      if (filter && !filter(ws)) continue;
      ws.send(text);
    }
  }

  /** Server-interne Reaktion auf Ereignisse (z. B. Symbolbibliothek neu erzeugen, FA-53). */
  beobachte(fn) { (this.beobachter ||= []).push(fn); }

  /** Meldet Benutzer ab (z. B. nach Deaktivierung). */
  trenneBenutzer(benutzerId) {
    for (const ws of this.clients) if (ws.nutzer?.id === benutzerId) ws.close(4401, "Abgemeldet");
  }

  schliesse() { clearInterval(this.ping); for (const ws of this.clients) ws.terminate(); this.wss.close(); }
}
