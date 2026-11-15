// FA-40 Benachrichtigungen in der Kopfleiste: Glocke mit Zahl, Liste, „alle gelesen“, E-Mail an/aus.
import React, { useEffect, useRef, useState } from "react";
import { Icon, Toggle } from "./bausteine.jsx";
import { useLager, useLive } from "./huelle.jsx";
import { zeitpunktAnzeige } from "@lager/domain/zeit.js";

export function Glocke() {
  const { api, app, navigiere, oeffneAndereApp } = useLager();
  const [d, setD] = useState(null);
  const [offen, setOffen] = useState(false);
  const box = useRef(null);
  const laden = () => api.get("/api/v1/benachrichtigungen").then(setD, () => {});
  useEffect(() => { laden(); const t = setInterval(laden, 5 * 60_000); return () => clearInterval(t); }, []);
  useLive(["benachrichtigung"], laden);
  useEffect(() => {
    if (!offen) return;
    const zu = (e) => { if (!box.current?.contains(e.target)) setOffen(false); };
    const esc = (e) => { if (e.key === "Escape") setOffen(false); };
    document.addEventListener("mousedown", zu); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", zu); document.removeEventListener("keydown", esc); };
  }, [offen]);
  const n = d?.ungelesen || 0;
  const oeffne = async (b) => {
    setOffen(false);
    if (!b.gelesen) await api.post("/api/v1/benachrichtigungen/gelesen", { ids: [b.id] }).catch(() => {});
    laden();
    if (b.pfad) (b.app === app ? navigiere(b.pfad) : oeffneAndereApp(b.pfad));
  };
  return (
    <span ref={box} style={{ position: "relative" }}>
      <button className="lp-btn lp-btn-geist lp-btn-klein" data-testid="glocke" data-tour="glocke" aria-label={n ? `Benachrichtigungen, ${n} neu` : "Benachrichtigungen"} aria-expanded={offen} title="Benachrichtigungen" onClick={() => setOffen(!offen)}>
        <Icon name="Bell" size={14} />{n > 0 && <span className="lp-badge" data-testid="glocke-zahl" style={{ background: "var(--lp-err)", color: "#fff", marginLeft: 4, padding: "0 6px", borderRadius: 9, fontSize: 11 }}>{n}</span>}
      </button>
      {offen && <div className="lp-section" role="dialog" aria-label="Benachrichtigungen" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", width: 360, maxWidth: "90vw", maxHeight: 460, overflow: "auto", zIndex: 50, padding: 12, boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}>
        <div className="lp-zeile" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <strong>Benachrichtigungen</strong>
          {n > 0 && <button className="lp-btn lp-btn-klein" onClick={async () => { await api.post("/api/v1/benachrichtigungen/gelesen", {}); laden(); }}>Alle gelesen</button>}
        </div>
        {!d?.zeilen.length && <p className="lp-hinweis">Nichts Neues. Hier erscheinen Fristen, Prüfungen und Überbuchungen.</p>}
        {(d?.zeilen || []).map((b) => (
          <button key={b.id} className="lp-btn lp-btn-geist" style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 6px", fontWeight: b.gelesen ? 400 : 600, whiteSpace: "normal" }} onClick={() => oeffne(b)}>
            <div>{b.titel}</div>
            {b.text && <div className="lp-meta" style={{ whiteSpace: "pre-wrap", fontWeight: 400 }}>{b.text}</div>}
            <div className="lp-meta" style={{ fontWeight: 400 }}>{zeitpunktAnzeige(b.erstellt)}</div>
          </button>
        ))}
        {d?.mail.moeglich && <div style={{ borderTop: "1px solid var(--lp-rand, #ddd)", marginTop: 8, paddingTop: 8 }}>
          {d.mail.adresse
            ? <Toggle checked={d.mail.an} onChange={async (an) => { await api.put("/api/v1/benachrichtigungen/mail", { an }); laden(); }} label={`Auch per E-Mail an ${d.mail.adresse}`} />
            : <span className="lp-meta">Für E-Mails trägt ein Admin deine Adresse im Benutzerkonto ein.</span>}
        </div>}
      </div>}
    </span>
  );
}
