// FA-22 Offline-Puffer: Scans ohne Verbindung lokal speichern (mit Zeitstempel) und beim Wiederverbinden in Reihenfolge buchen.
// localStorage statt IndexedDB: wenige kleine Einträge, synchron lesbar, übersteht Neuladen und Neustart.

const KEY = "lager-offline-scans";
const abos = new Set();

/** Netzwerkfehler (kein HTTP-Status) = offline; HTTP-Fehler bucht der Server selbst als Rot. */
export const istOffline = (e) => !e?.status && (e instanceof TypeError || /fetch|network|netz/i.test(String(e?.message || "")));

function lies() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
function schreib(l) { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* voll/privat: bleibt im Speicher */ } speicher = l; for (const f of abos) f(l.length); }
let speicher = null;
const liste = () => speicher ?? (speicher = lies());

const neueId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** Scan vormerken. Liefert die Anzahl wartender Scans. */
export function merkeScan(body) {
  const l = [...liste(), { ...body, offline: { id: neueId(), zeit: new Date().toISOString() } }];
  schreib(l);
  return l.length;
}

export const wartend = () => liste().length;

/** Abo auf die Anzahl wartender Scans. */
export function beiAenderung(fn) { abos.add(fn); return () => abos.delete(fn); }

let laeuft = null;
/**
 * Sendet alle wartenden Scans der Reihe nach. Bricht beim ersten Netzwerkfehler ab (bleibt gespeichert).
 * @param {{post: Function}} api @param {(r: object) => void} [jeErgebnis]
 */
export function sendeWartende(api, jeErgebnis) {
  if (laeuft) return laeuft;
  laeuft = (async () => {
    let n = 0;
    while (liste().length) {
      const [s] = liste();
      let r;
      try { r = await api.post("/api/v1/scan", s); }
      catch (e) {
        if (istOffline(e)) break;
        r = { level: "error", text: `Nachbuchen von ${s.code} fehlgeschlagen: ${e.message}`, meldungen: [], code: s.code };
      }
      schreib(liste().filter((x) => x.offline.id !== s.offline.id));
      n++;
      jeErgebnis?.(r);
    }
    return n;
  })().finally(() => { laeuft = null; });
  return laeuft;
}
