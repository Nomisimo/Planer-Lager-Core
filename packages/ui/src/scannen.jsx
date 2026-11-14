// Scan-Bedienung (FA-15, UI-3): Eingabefeld mit Fokus, Enter bucht, Farbrückmeldung, Verlauf, Ton optional,
// Handscanner global (useScanZiel) und Netzwerk-Scanner per WebSocket-Abo. Gemeinsam für Apps und Arbeitsplatz.
import React, { useEffect, useRef, useState } from "react";
import { Knopf, Auswahl, Icon } from "./bausteine.jsx";
import { useLager, useLive, useScanZiel } from "./huelle.jsx";
import { fehlerText } from "./texte.js";
import { istOffline, merkeScan, wartend, beiAenderung, sendeWartende } from "./offline.js";

const FARBE = { ok: "var(--lp-ok, #2e9d47)", warn: "var(--lp-warn, #b26a00)", error: "var(--lp-err, #c0392b)" };
const LEVEL_TEXT = { ok: "Gebucht", warn: "Gebucht mit Hinweis", error: "Nicht gebucht" };
const TON_KEY = "lager-scan-ton";

function piep(level) {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(); const g = ac.createGain();
    o.frequency.value = level === "ok" ? 880 : level === "warn" ? 520 : 220;
    o.connect(g); g.connect(ac.destination); g.gain.value = 0.08;
    o.start(); o.stop(ac.currentTime + (level === "error" ? 0.45 : 0.15));
    o.onended = () => ac.close();
  } catch { /* ohne Ton */ }
}

/**
 * @param {{modus: string, projektId?: number|null, angebotId?: number|null, tasche?: string|null,
 *   onErgebnis?: (r: any) => void, gross?: boolean, deaktiviert?: string|null, arbeitsplatzId?: number|null}} props
 * arbeitsplatzId: Netzwerk-Scanner, die diesem Arbeitsplatz zugeordnet sind, buchen hier (ARCHITEKTUR §5).
 */
/** kamera: optionale Komponente ({onCode}) für Kamera-Scan – nur das Arbeitsplatz-Web liefert sie (html5-qrcode). */
export function ScanPanel({ modus, projektId = null, angebotId = null, tasche = null, onErgebnis, gross = false, deaktiviert = null, arbeitsplatzId = null, kamera: Kamera = null }) {
  const { api, live } = useLager();
  const [code, setCode] = useState("");
  const [verlauf, setVerlauf] = useState([]);
  const [laeuft, setLaeuft] = useState(false);
  const [ton, setTon] = useState(() => { try { return localStorage.getItem(TON_KEY) === "1"; } catch { return false; } });
  const [netzScanner, setNetzScanner] = useState("");
  const [scannerListe, setScannerListe] = useState([]);
  const feld = useRef(null);
  const warteschlange = useRef(Promise.resolve());
  const zustand = useRef({});
  const [warten, setWarten] = useState(wartend); // FA-22
  useEffect(() => beiAenderung(setWarten), []);
  const nachgebucht = (r) => { r.zeit = new Date(); setVerlauf((v) => [r, ...v].slice(0, 50)); zustand.current.onErgebnis?.(r); };
  const sendeNach = () => sendeWartende(api, nachgebucht).catch(() => {});
  const offen = warten > 0;
  useEffect(() => {
    if (!offen) return;
    const t = setInterval(sendeNach, 5000);
    window.addEventListener("online", sendeNach);
    return () => { clearInterval(t); window.removeEventListener("online", sendeNach); };
  }, [offen, api]);
  zustand.current = { modus, projektId, angebotId, tasche, ton, onErgebnis };

  useEffect(() => { api.get("/api/v1/scanner/auswahl").then(setScannerListe, () => setScannerListe([])); }, [api]);
  useEffect(() => { if (live && netzScanner) live.abonniere({ scanner: Number(netzScanner) }); else if (live) live.abonniere({ scanner: null }); }, [live, netzScanner]);
  useEffect(() => { if (live && arbeitsplatzId) live.abonniere({ arbeitsplatz: arbeitsplatzId }); }, [live, arbeitsplatzId]);

  const buche = (roh) => {
    const c = String(roh || "").trim();
    if (!c) return;
    // Scans der Reihe nach buchen (schnelles Scannen überholt sich nicht)
    warteschlange.current = warteschlange.current.then(async () => {
      const z = zustand.current;
      setLaeuft(true);
      const start = performance.now();
      let r;
      const body = { code: c, modus: z.modus, projekt: z.projektId, angebot: z.angebotId, tasche: z.tasche };
      if (wartend()) await sendeWartende(api, nachgebucht).catch(() => {}); // Reihenfolge: ältere Offline-Scans zuerst
      const offlineText = (n) => `Offline: ${c} gespeichert. Wird gebucht, sobald die Verbindung wieder da ist (${n} ${n === 1 ? "wartet" : "warten"}).`;
      if (wartend()) r = { level: "warn", text: offlineText(merkeScan(body)), meldungen: [], code: c, offline: true };
      else {
        try { r = await api.post("/api/v1/scan", body); }
        catch (e) { r = istOffline(e) ? { level: "warn", text: offlineText(merkeScan(body)), meldungen: [], code: c, offline: true } : { level: "error", text: fehlerText(e), meldungen: [], code: c }; }
      }
      r.dauer = Math.round(performance.now() - start);
      r.zeit = new Date();
      setVerlauf((v) => [r, ...v].slice(0, 50));
      if (z.ton) { piep(r.level); try { navigator.vibrate?.(r.level === "ok" ? 60 : r.level === "warn" ? [60, 60, 60] : 400); } catch { /* ohne Vibration */ } }
      setLaeuft(false);
      z.onErgebnis?.(r);
    });
  };
  useScanZiel(buche);
  useLive(["scanner"], (ev) => { if (ev.typ === "scanner.code" && (Number(netzScanner) === ev.scanner || (arbeitsplatzId && ev.arbeitsplatz === arbeitsplatzId))) buche(ev.code); });
  useEffect(() => { feld.current?.focus(); }, [modus, projektId]);

  const letzte = verlauf[0];
  return (
    <div className={"lp-scan" + (gross ? " lp-scan-gross" : "")}>
      <label className="lp-label" htmlFor="lp-scanfeld">Code</label>
      <form className="lp-zeile" style={{ alignItems: "stretch" }} onSubmit={(e) => { e.preventDefault(); buche(code); setCode(""); feld.current?.focus(); }}>
        <input ref={feld} id="lp-scanfeld" className="lp-input lp-scanfeld" data-scanfeld="1" data-testid="scanfeld" aria-label="Code scannen oder eingeben" placeholder={deaktiviert || "Code scannen oder eintippen, Enter bucht"}
          value={code} disabled={!!deaktiviert} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoFocus
          onBlur={() => { if (!deaktiviert) setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) feld.current?.focus(); }, 0); }} />
        <Knopf art="primaer" type="submit" icon="ScanLine" disabled={!!deaktiviert || !code.trim()}>Buchen</Knopf>
        {Kamera && !deaktiviert && <Kamera onCode={buche} />}
      </form>
      <div className="lp-zeile" style={{ marginTop: 8, alignItems: "center" }}>
        <label className="lp-scan-ton">
          <input type="checkbox" checked={ton} onChange={(e) => { setTon(e.target.checked); try { localStorage.setItem(TON_KEY, e.target.checked ? "1" : "0"); } catch { /* privat */ } }} /> Ton &amp; Vibration
        </label>
        {scannerListe.length > 0 && <div style={{ width: 230 }}><Auswahl aria-label="Netzwerk-Scanner" leer="Kein Netzwerk-Scanner" value={netzScanner} onChange={(e) => setNetzScanner(e.target.value)}
          optionen={scannerListe.map((s) => ({ wert: String(s.id), titel: s.name }))} /></div>}
        {laeuft && <span className="lp-meta"><Icon name="Loader2" size={14} /> bucht …</span>}
      </div>
      {warten > 0 && (
        <div className="lp-meldung" data-testid="offline-warten" role="status" style={{ borderColor: FARBE.warn, marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <Icon name="AlertTriangle" size={16} /> <span style={{ flex: 1 }}>Offline – {warten} {warten === 1 ? "Scan wartet" : "Scans warten"} auf die Verbindung.</span>
          <Knopf klein onClick={sendeNach}>Jetzt senden</Knopf>
        </div>
      )}
      {letzte && (
        <div className="lp-scan-ergebnis" data-testid="scan-ergebnis" data-level={letzte.level} data-dauer={letzte.dauer} role="status" aria-live="assertive" style={{ borderColor: FARBE[letzte.level] }}>
          <div className="lp-scan-balken" style={{ background: FARBE[letzte.level] }}>
            <Icon name={letzte.level === "ok" ? "CheckCircle2" : letzte.level === "warn" ? "AlertTriangle" : "XCircle"} size={gross ? 28 : 20} />
            <span>{LEVEL_TEXT[letzte.level]}</span>
          </div>
          <div className="lp-scan-text">
            <strong className="lp-scan-haupt">{letzte.text}</strong>
            <span className="lp-meta lp-scan-zeit">{letzte.zeit.toLocaleTimeString("de-DE")}</span>
            {letzte.meldungen?.length > 0 && <ul>{letzte.meldungen.map((m, i) => <li key={i} data-level={m.level}>{m.text}</li>)}</ul>}
          </div>
        </div>
      )}
      {!letzte && <p className="lp-hinweis" data-testid="scan-leer">Noch nichts gescannt. Scanne einen Code oder tippe ihn ein und drücke Enter.</p>}
      {verlauf.length > 1 && (
        <ol className="lp-scan-verlauf" aria-label="Verlauf">
          {verlauf.slice(1).map((r, i) => (
            <li key={i}><Icon name={r.level === "ok" ? "CheckCircle2" : r.level === "warn" ? "AlertTriangle" : "XCircle"} size={16} style={{ color: FARBE[r.level], flex: "none" }} aria-hidden={false} role="img" aria-label={LEVEL_TEXT[r.level]} />
              <span className="lp-meta">{r.zeit.toLocaleTimeString("de-DE")}</span> {r.text}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
