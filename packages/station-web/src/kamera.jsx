// Kamera-Scan am Arbeitsplatz (Spec 6.3/FA-15, UI-2): breites Lesefenster für Barcodes, QR-Codes, Dialog schließbar.
// html5-qrcode wird lokal mit ausgeliefert. Die Kamera geht nur in sicherem Kontext (HTTPS oder localhost).
import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats as F } from "html5-qrcode";
import { Knopf, Meldung, Modal } from "@lager/ui/bausteine.jsx";
import { neuerTreffer } from "@lager/domain/scannen.js";

const FORMATE = [F.CODE_128, F.CODE_39, F.EAN_13, F.EAN_8, F.QR_CODE, F.DATA_MATRIX, F.ITF];

export const kameraMoeglich = () => typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

function KameraDialog({ onCode, onSchliessen }) {
  const ref = useRef(null);
  const letzter = useRef(null);
  const [fehler, setFehler] = useState(null);
  const [gelesen, setGelesen] = useState(null);
  useEffect(() => {
    let scanner = null, aus = false;
    (async () => {
      try {
        scanner = new Html5Qrcode(ref.current.id, { formatsToSupport: FORMATE, verbose: false, useBarCodeDetectorIfSupported: true });
        await scanner.start({ facingMode: "environment" }, {
          fps: 10, // breites, flaches Lesefenster für 1D-Barcodes; QR passt auch hinein
          qrbox: (b, h) => ({ width: Math.max(200, Math.floor(b * 0.9)), height: Math.max(120, Math.floor(Math.min(h * 0.5, b * 0.45))) }),
        }, (text) => {
          const jetzt = Date.now();
          if (!neuerTreffer(letzter.current, text, jetzt)) return;
          letzter.current = { code: text, zeit: jetzt };
          setGelesen(text);
          onCode(text);
        }, () => {});
        if (aus) scanner.stop().catch(() => {});
      } catch (e) {
        setFehler(/Permission|NotAllowed/i.test(String(e)) ? "Kein Zugriff auf die Kamera. Erlaube die Kamera in den Browser-Einstellungen und öffne den Dialog erneut."
          : "Die Kamera lässt sich nicht starten. Prüfe, ob eine Kamera angeschlossen ist und kein anderes Programm sie nutzt.");
      }
    })();
    return () => { aus = true; if (scanner?.isScanning) scanner.stop().catch(() => {}); };
  }, []);
  return (
    <Modal titel="Mit der Kamera scannen" breite={640} onSchliessen={onSchliessen} fuss={<Knopf art="primaer" icon="X" onClick={onSchliessen}>Schließen</Knopf>}>
      {fehler && <Meldung level="error" text={fehler} />}
      <div id="lp-kamera" ref={ref} data-testid="kamera-bild" style={{ width: "100%", minHeight: 240, background: "#000", borderRadius: 8, overflow: "hidden" }} />
      <p className="lp-hinweis" role="status" aria-live="polite" data-testid="kamera-status">{gelesen ? `Gelesen: ${gelesen}` : "Halte den Code in das helle Feld. Jeder erkannte Code wird sofort gebucht."}</p>
    </Modal>
  );
}

/** Knopf neben „Buchen“; gibt jeden erkannten Code an das Scanfeld weiter. */
export function KameraKnopf({ onCode }) {
  const [offen, setOffen] = useState(false);
  const [hinweis, setHinweis] = useState(null);
  return (
    <>
      <Knopf icon="Camera" aria-label="Mit der Kamera scannen" onClick={() => {
        if (!kameraMoeglich()) { setHinweis("Die Kamera geht nur, wenn der Arbeitsplatz über HTTPS geöffnet ist. Öffne die Seite über die https-Adresse des Servers."); return; }
        setOffen(true);
      }}>Kamera</Knopf>
      {hinweis && <Modal titel="Kamera nicht verfügbar" onSchliessen={() => setHinweis(null)} fuss={<Knopf onClick={() => setHinweis(null)}>Schließen</Knopf>}><Meldung level="warning" text={hinweis} /></Modal>}
      {offen && <KameraDialog onCode={onCode} onSchliessen={() => setOffen(false)} />}
    </>
  );
}
