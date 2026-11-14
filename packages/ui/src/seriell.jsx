// ARCHITEKTUR §5 BT-SPP: Bluetooth-Scanner im seriellen Modus (SPP) bzw. USB-Seriell, über die Web-Serial-Schnittstelle von Electron.
// Kein Zusatzpaket: Chromium liest den Port, der Hauptprozess zeigt nur die Portauswahl (shell main.js, select-serial-port).
import React, { useEffect, useRef, useState } from "react";
import { zeilenLeser, pruefeSeriell, SERIELL_BAUDRATEN } from "@lager/domain/scannen.js";
import { Section, Feld, Auswahl, Toggle, Knopf, Meldung, Modal } from "./bausteine.jsx";
import { hidEinstellungen } from "./huelle.jsx";
import { plattform } from "./plattform.js";
import { NurDesktop } from "./nurdesktop.jsx";

export const SERIELL_KEY = "lager-seriell";
const PORT_KEY = "lager-seriell-port";
const NEUVERSUCH_MS = 5000;

export const seriellVerfuegbar = () => plattform.kann("seriell") && typeof navigator !== "undefined" && !!navigator.serial;
export function seriellEinstellungen() { try { return pruefeSeriell(JSON.parse(localStorage.getItem(SERIELL_KEY) || "{}")); } catch { return pruefeSeriell({}); } }
const leseJson = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const schreibe = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat */ } };

// Zustand für die Anzeige in den Einstellungen (ein Scanner je Fenster).
let zustand = { stufe: "aus", text: "Aus" };
const setzeZustand = (stufe, text) => { zustand = { stufe, text }; window.dispatchEvent(new CustomEvent("lager-seriell-status", { detail: zustand })); };

/** Gewählten Port wiederfinden: gleiche Kennung (USB/Bluetooth), bei mehreren gleichen die gemerkte Position. */
async function findePort() {
  const ports = await navigator.serial.getPorts();
  const gemerkt = leseJson(PORT_KEY);
  if (!gemerkt) return ports.length === 1 ? ports[0] : null;
  const gleich = ports.filter((p) => JSON.stringify(p.getInfo?.() || {}) === JSON.stringify(gemerkt.info || {}));
  return gleich[gemerkt.nr] || gleich[0] || null;
}

async function merkePort(port) {
  const info = port.getInfo?.() || {};
  const ports = await navigator.serial.getPorts();
  const gleich = ports.filter((p) => JSON.stringify(p.getInfo?.() || {}) === JSON.stringify(info));
  schreibe(PORT_KEY, { info, nr: Math.max(0, gleich.indexOf(port)) });
}

/**
 * Liest Codes vom seriellen Scanner und gibt sie wie den Handscanner weiter: an das Scan-Ziel der Seite, sonst an `sonst(code)`.
 * Verbindet neu nach Trennung (alle 5 s) und nach Änderung der Einstellungen.
 */
export function useSeriellerScanner(scanZiel, sonst) {
  const sonstRef = useRef(sonst);
  sonstRef.current = sonst;
  useEffect(() => {
    if (!seriellVerfuegbar()) return;
    let laeuft = true, port = null, leser = null, timer = null, nr = 0;
    const trenne = async () => {
      clearTimeout(timer);
      const l = leser, p = port; leser = null; port = null;
      try { await l?.cancel(); } catch { /* schon zu */ }
      try { l?.releaseLock(); } catch { /* egal */ }
      try { await p?.close(); } catch { /* schon zu */ }
    };
    const verbinde = async () => {
      const meinNr = ++nr;
      await trenne();
      const e = seriellEinstellungen();
      if (!laeuft || meinNr !== nr) return;
      if (!e.aktiv) { setzeZustand("aus", "Aus"); return; }
      let p;
      try { p = await findePort(); } catch { p = null; }
      if (!p) { setzeZustand("warn", "Kein Scanner gewählt. Klicke auf „Scanner wählen“."); return; }
      try { await p.open({ baudRate: e.baudrate }); } catch (err) {
        if (!/already open/i.test(String(err?.message))) {
          setzeZustand("warn", `Scanner nicht erreichbar. Ist er eingeschaltet und gekoppelt? Neuer Versuch in ${NEUVERSUCH_MS / 1000} s.`);
          timer = setTimeout(() => laeuft && verbinde(), NEUVERSUCH_MS);
          return;
        }
      }
      if (!laeuft || meinNr !== nr) { try { await p.close(); } catch { /* egal */ } return; }
      port = p;
      setzeZustand("ok", `Verbunden (${e.baudrate} Baud)`);
      const h = hidEinstellungen();
      const z = zeilenLeser({ minZeichen: h.minZeichen, praefix: h.praefix, suffix: h.suffix });
      const dekoder = new TextDecoder();
      try {
        leser = p.readable.getReader();
        for (;;) {
          const { value, done } = await leser.read();
          if (done) break;
          for (const code of z.daten(dekoder.decode(value, { stream: true }))) {
            if (scanZiel.current) scanZiel.current(code);
            else sonstRef.current?.(code);
          }
        }
      } catch { /* getrennt */ }
      if (laeuft && meinNr === nr) {
        await trenne();
        setzeZustand("warn", `Verbindung zum Scanner getrennt. Neuer Versuch in ${NEUVERSUCH_MS / 1000} s.`);
        timer = setTimeout(() => laeuft && verbinde(), NEUVERSUCH_MS);
      }
    };
    const neu = () => verbinde();
    window.addEventListener("lager-seriell", neu);
    navigator.serial.addEventListener?.("connect", neu);
    verbinde();
    return () => { laeuft = false; nr++; window.removeEventListener("lager-seriell", neu); navigator.serial.removeEventListener?.("connect", neu); trenne(); };
  }, [scanZiel]);
}

/** Einstellungen: an/aus, Baudrate, Port wählen, Zustand. Nur in den Apps (Electron) bzw. Browsern mit Web Serial. */
export function SeriellEinstellungen() {
  const [w, setW] = useState(() => seriellEinstellungen());
  const [z, setZ] = useState(zustand);
  const [meldung, setMeldung] = useState(null);
  const [auswahl, setAuswahl] = useState(null);
  useEffect(() => {
    const h = (e) => setZ(e.detail);
    window.addEventListener("lager-seriell-status", h);
    // Portliste vom Hauptprozess (Electron zeigt selbst keine Auswahl)
    const ab = plattform.onSeriellAuswahl((liste) => setAuswahl(liste));
    return () => { window.removeEventListener("lager-seriell-status", h); ab?.(); };
  }, []);
  if (plattform.istWeb) return <NurDesktop funktion="seriell" titel="Bluetooth-Scanner seriell (dieses Gerät)" />;
  if (!seriellVerfuegbar()) return null;
  const speichern = (x) => { const y = pruefeSeriell(x); schreibe(SERIELL_KEY, y); setW(y); window.dispatchEvent(new Event("lager-seriell")); };
  const waehlen = async () => {
    setMeldung(null);
    try {
      const port = await navigator.serial.requestPort();
      await merkePort(port);
      speichern({ ...w, aktiv: true });
      setMeldung({ level: "success", text: "Scanner gewählt. Scanne einen Code zum Testen." });
    } catch (e) {
      setMeldung(e?.name === "NotFoundError" ? { level: "info", text: "Kein Scanner gewählt. Koppel den Scanner zuerst in den Bluetooth-Einstellungen des Rechners (Modus SPP/seriell)." }
        : { level: "error", text: `Der Scanner ließ sich nicht wählen (${e?.message || e}). Prüfe die Kopplung und versuche es erneut.` });
    }
  };
  const antworte = (portId) => { setAuswahl(null); plattform.seriellGewaehlt(portId || ""); };
  return (
    <Section titel="Bluetooth-Scanner seriell (dieses Gerät)" icon="ScanLine">
      <p className="lp-hinweis" style={{ marginTop: 0, marginBottom: 8 }}>Für Scanner im Modus SPP (serieller Port) statt Tastatur. Ein Code je Zeile; Präfix, Suffix und Mindestlänge wie beim Handscanner.</p>
      {meldung && <Meldung level={meldung.level} text={meldung.text} onSchliessen={() => setMeldung(null)} />}
      <div className="lp-raster">
        <Feld label="Seriellen Scanner nutzen"><Toggle checked={w.aktiv} onChange={(v) => speichern({ ...w, aktiv: v })} label={w.aktiv ? "An" : "Aus"} /></Feld>
        <Feld label="Baudrate" hinweis="Steht in der Anleitung des Scanners, meist 9600">
          <Auswahl value={String(w.baudrate)} onChange={(e) => speichern({ ...w, baudrate: Number(e.target.value) })} optionen={SERIELL_BAUDRATEN.map((b) => ({ wert: String(b), titel: String(b) }))} />
        </Feld>
        <Feld label="Zustand"><span data-testid="seriell-status" data-stufe={z.stufe}>{z.text}</span></Feld>
      </div>
      <Knopf icon="ScanLine" onClick={waehlen}>Scanner wählen</Knopf>
      {auswahl && (
        <Modal titel="Seriellen Scanner wählen" onSchliessen={() => antworte("")} fuss={<Knopf onClick={() => antworte("")}>Abbrechen</Knopf>}>
          {auswahl.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {auswahl.map((p) => <Knopf key={p.portId} onClick={() => antworte(p.portId)}>{p.name}</Knopf>)}
            </div>
          ) : <p>Kein serieller Port gefunden. Koppel den Scanner in den Bluetooth-Einstellungen des Rechners und versuche es erneut.</p>}
        </Modal>
      )}
    </Section>
  );
}
