// Rückgabe-Bausteine (FA-18, R-46–R-48, R-47/R-11g): aktive Tasche und Funktionstest. Gemeinsam für Materialplaner und Arbeitsplatz-Web.
import React, { useEffect, useRef, useState } from "react";
import { Section, Knopf, Feld, Eingabe, Meldung, useBestaetigung } from "./bausteine.jsx";
import { useLager } from "./huelle.jsx";
import { fehlerText } from "./texte.js";

/** Aktive Tasche bei der Rückgabe (R-46/R-48): Stand, offene Teile, „Offene als vermisst melden“, „Tasche beenden“. */
export function TaschenKarte({ tasche, onNeu, onEnde }) {
  const { api } = useLager();
  const [fragen, dialog] = useBestaetigung();
  const [meldung, setMeldung] = useState(null);
  return (
    <Section titel={`Aktive Tasche ${tasche.code}`} icon="Box" aktionen={<>
      {tasche.offen.length > 0 && <Knopf icon="AlertTriangle" onClick={async () => {
        if (!(await fragen({ titel: "Offene als vermisst melden?", knopf: "Als vermisst melden", text: `${tasche.offen.length} Teil(e) wurden nicht zurückgescannt: ${tasche.offen.join(", ")}. Sie bleiben am Projekt und gelten als vermisst, bis sie wieder auftauchen.` }))) return;
        try { const r = await api.post("/api/v1/vermisst", { codes: tasche.offen, tasche: tasche.code }); setMeldung({ level: "warning", text: r.text }); onNeu(r.tasche); }
        catch (e) { setMeldung({ level: "error", text: fehlerText(e) }); }
      }}>Offene als vermisst melden</Knopf>}
      <Knopf icon="Check" onClick={onEnde}>Tasche beenden</Knopf></>}>
      {dialog}
      {meldung && <Meldung {...meldung} onSchliessen={() => setMeldung(null)} />}
      <p style={{ margin: 0 }} data-testid="tasche-stand"><strong>{tasche.name}: {tasche.anzahl} von {tasche.soll || "?"}</strong> Teilen eingetragen.
        {tasche.offen.length ? ` Noch nicht zurück: ${tasche.offen.join(", ")}.` : " Alle Teile sind zurück."}</p>
    </Section>
  );
}

const FT_KEY = "lager-funktionstest";
/** R-47: Funktionstest nach jedem Rückgabe-Scan, an diesem Gerät ein-/ausschaltbar. */
export function useFunktionstestSchalter() {
  const [an, setAn] = useState(() => { try { return localStorage.getItem(FT_KEY) === "1"; } catch { return false; } });
  return [an, (v) => { setAn(v); try { localStorage.setItem(FT_KEY, v ? "1" : "0"); } catch { /* privat */ } }];
}

/** R-47 Funktionstest für das zuletzt zurückgebuchte Gerät: „bestanden“ oder „Mangel“ mit Notiz. */
export function FunktionstestKarte({ code, onFertig }) {
  const { api } = useLager();
  const [mangel, setMangel] = useState(false);
  const [notiz, setNotiz] = useState("");
  const [fehler, setFehler] = useState(null);
  // R-11g: „In Ordnung (1) / Mangel (2)“ per Taste. Ziffern aus einem schnellen Handscanner-Scan zählen nicht:
  // die Taste gilt erst, wenn 150 ms davor und danach keine weitere Taste kam.
  const sendeRef = useRef(null);
  useEffect(() => {
    let letzte = 0, warte = null;
    const k = (ev) => {
      const t = ev.timeStamp || performance.now();
      const el = document.activeElement;
      // Im leeren Scanfeld zählt die Taste auch (dort steht der Fokus fast immer); andere Felder nehmen sie selbst.
      const scanfeld = el?.dataset?.scanfeld ? el : null;
      const imFeld = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") && !(scanfeld && scanfeld.value === "");
      const vorher = t - letzte; letzte = t;
      if (warte) { clearTimeout(warte); warte = null; }
      if (imFeld || mangel || (ev.key !== "1" && ev.key !== "2") || vorher < 150) return;
      const key = ev.key;
      warte = setTimeout(() => {
        warte = null;
        if (scanfeld) { // Ziffer wieder aus dem Scanfeld nehmen (React-Zustand mitziehen)
          if (scanfeld.value !== key) return;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(scanfeld, "");
          scanfeld.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (key === "1") sendeRef.current?.("ok"); else setMangel(true);
      }, 150);
    };
    window.addEventListener("keydown", k, true);
    return () => { window.removeEventListener("keydown", k, true); if (warte) clearTimeout(warte); };
  }, [mangel]);
  const sende = async (ergebnis) => {
    setFehler(null);
    try { const r = await api.post("/api/v1/pruefung", { code, ergebnis, notiz }); onFertig({ level: ergebnis === "ok" ? "success" : "warning", text: r.text }); }
    catch (e) { setFehler(fehlerText(e)); }
  };
  sendeRef.current = sende;
  return (
    <Section titel={`Funktionstest ${code}`} icon="Wrench" aktionen={<Knopf klein art="geist" onClick={() => onFertig(null)}>Überspringen</Knopf>}>
      {fehler && <Meldung level="error" text={fehler} />}
      {!mangel ? <div className="lp-zeile">
        <Knopf art="primaer" icon="CheckCircle2" onClick={() => sende("ok")}>In Ordnung (1)</Knopf>
        <Knopf icon="AlertTriangle" onClick={() => setMangel(true)}>Mangel (2)</Knopf>
      </div> : <div>
        <Feld label="Was ist kaputt?" pflicht hinweis="Landet mit Datum in den Notizen am Gerät"><Eingabe value={notiz} autoFocus onChange={(e) => setNotiz(e.target.value)} /></Feld>
        <div className="lp-zeile"><Knopf art="primaer" icon="Save" onClick={() => sende("mangel")}>Mangel speichern</Knopf><Knopf onClick={() => setMangel(false)}>Zurück</Knopf></div>
      </div>}
    </Section>
  );
}

