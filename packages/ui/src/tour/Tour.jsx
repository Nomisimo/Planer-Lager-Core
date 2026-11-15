// Tour-Engine (ARCHITEKTUR §11): Overlay mit Loch um den Anker (data-tour), Blase mit Titel/Text/„Schritt x von y“,
// Zurück/Weiter/Beenden, Tasten → Enter ← Esc. Keine Seiteneffekte: nur Navigation zu `vor` und Hinweise.
// Fehlt ein Anker nach 1,5 s, wird der Schritt übersprungen (console.warn).
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

const ABSTAND = 6;
const suche = (anker) => {
  const el = document.querySelector(`[data-tour="${CSS.escape(anker)}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width || r.height ? el : null;
};

/**
 * @param {{ titel: string, schritte: object[], navigiere: (p: string) => void, pfad: string, onEnde: (fertig: boolean) => void }} props
 */
export function Tour({ titel, schritte, navigiere, pfad, onEnde }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const richtung = useRef(1);
  const s = schritte[i];
  const letzter = i === schritte.length - 1;

  const weiter = () => { richtung.current = 1; if (letzter) onEnde(true); else setI((x) => x + 1); };
  const zurueck = () => { richtung.current = -1; if (i > 0) setI((x) => x - 1); };

  // Anker suchen (vorher ggf. Seite öffnen), sonst Schritt überspringen
  useEffect(() => {
    if (!s) { onEnde(true); return; }
    setRect(null);
    if (s.vor && pfad !== s.vor) navigiere(s.vor);
    let aus = false;
    const start = Date.now();
    const t = setInterval(() => {
      const el = suche(s.anker);
      if (el) {
        clearInterval(t);
        el.scrollIntoView?.({ block: "center", inline: "nearest" });
        requestAnimationFrame(() => { if (!aus) setRect(el.getBoundingClientRect()); });
      } else if (Date.now() - start > 1500) {
        clearInterval(t);
        console.warn(`Tour „${titel}“: Anker „${s.anker}“ fehlt, Schritt übersprungen.`);
        if (aus) return;
        const n = i + richtung.current;
        if (n < 0 || n >= schritte.length) onEnde(n >= schritte.length); else setI(n);
      }
    }, 100);
    return () => { aus = true; clearInterval(t); };
  }, [i]);

  // Lage mitführen (Fenstergröße, Scrollen)
  useLayoutEffect(() => {
    if (!rect || !s) return;
    const neu = () => { const el = suche(s.anker); if (el) setRect(el.getBoundingClientRect()); };
    window.addEventListener("resize", neu); window.addEventListener("scroll", neu, true);
    return () => { window.removeEventListener("resize", neu); window.removeEventListener("scroll", neu, true); };
  }, [rect && s?.anker]);

  // „klick“-Schritt: Klick auf den Anker führt weiter
  useEffect(() => {
    if (!rect || s?.art !== "klick") return;
    const el = suche(s.anker);
    if (!el) return;
    const f = () => setTimeout(weiter, 50);
    el.addEventListener("click", f);
    return () => el.removeEventListener("click", f);
  }, [rect, i]);

  // Tasten (vor allen anderen Tastatur-Hörern, z. B. Handscanner)
  useEffect(() => {
    const k = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); onEnde(false); }
      else if (e.key === "ArrowRight" || (e.key === "Enter" && s?.art !== "eingabe")) { e.preventDefault(); e.stopImmediatePropagation(); if (s?.art !== "klick") weiter(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopImmediatePropagation(); zurueck(); }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  });

  if (!s || !rect) return <div className="lp-tour-sperre" data-testid="tour-laedt" />;
  const loch = { top: rect.top - ABSTAND, left: rect.left - ABSTAND, width: rect.width + 2 * ABSTAND, height: rect.height + 2 * ABSTAND };
  const vw = window.innerWidth, vh = window.innerHeight;
  const unten = loch.top + loch.height + 220 < vh;
  const blase = { left: Math.max(12, Math.min(loch.left, vw - 372)), ...(unten ? { top: loch.top + loch.height + 12 } : { top: Math.max(12, loch.top - 12 - 200) }) };
  const offen = s.art === "klick" || s.art === "eingabe";
  return (
    <div className="lp-tour" data-testid="tour" data-anker={s.anker}>
      {/* vier Blöcke um das Loch: dunkel und klicksicher; das Loch selbst nur bei klick/eingabe bedienbar */}
      <div className="lp-tour-block" style={{ top: 0, left: 0, right: 0, height: Math.max(0, loch.top) }} />
      <div className="lp-tour-block" style={{ top: loch.top + loch.height, left: 0, right: 0, bottom: 0 }} />
      <div className="lp-tour-block" style={{ top: loch.top, left: 0, width: Math.max(0, loch.left), height: loch.height }} />
      <div className="lp-tour-block" style={{ top: loch.top, left: loch.left + loch.width, right: 0, height: loch.height }} />
      <div className="lp-tour-loch" style={{ ...loch, pointerEvents: offen ? "none" : "auto" }} />
      <div className="lp-tour-blase" role="dialog" aria-label={`Tour: ${s.titel}`} data-testid="tour-blase" style={blase}>
        <div className="lp-meta">{titel} · Schritt {i + 1} von {schritte.length}</div>
        <h2 className="lp-h2" style={{ margin: "4px 0 6px" }}>{s.titel}</h2>
        <p style={{ margin: 0 }}>{s.text}</p>
        <div className="lp-zeile" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button type="button" className="lp-btn lp-btn-geist lp-btn-klein" onClick={() => onEnde(false)}>Beenden</button>
          <button type="button" className="lp-btn lp-btn-klein" onClick={zurueck} disabled={i === 0}>Zurück</button>
          {s.art !== "klick" && <button type="button" className="lp-btn lp-btn-primaer lp-btn-klein" onClick={weiter}>{letzter ? "Fertig" : "Weiter"}</button>}
        </div>
      </div>
    </div>
  );
}
