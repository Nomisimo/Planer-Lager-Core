// Arbeitsplatz-Web (Spec 2.4, R-11a–g, FA-18, FA-25) und Ladezonen-Anzeige (R-59, FA-24).
// Läuft im Browser am Lager-Arbeitsplatz bzw. am Anzeige-Bildschirm. Anmeldung einmalig per Einrichtungscode (Geräte-Sitzung).
import { KameraKnopf } from "./kamera.jsx";
import { SchadenDialog } from "@lager/ui/schaeden.jsx";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { erstelleApi, Live } from "@lager/client";
import { wendeDesignAn, LagerKontext, useHandscanner, useLive } from "@lager/ui/huelle.jsx";
import { Section, Meldung, Knopf, Feld, Eingabe, Tabelle, Badge, Leerzustand, Icon, useDaten, useBestaetigung } from "@lager/ui/bausteine.jsx";
import { ScanPanel } from "@lager/ui/scannen.jsx";
import { TaschenKarte, FunktionstestKarte } from "@lager/ui/rueckgabe.jsx";
import { fehlerText } from "@lager/ui/texte.js";
import { datumAnzeige } from "@lager/domain/zeit.js";
import STIL from "@lager/ui/stil.css";

const s = document.createElement("style"); s.textContent = STIL; document.head.appendChild(s);
wendeDesignAn({ dichte: "gross" });

/* ── Einrichtung ── */
function Einrichten({ api, onFertig }) {
  const [code, setCode] = useState("");
  const [fehler, setFehler] = useState(null);
  const [laeuft, setLaeuft] = useState(false);
  const senden = async (e) => {
    e.preventDefault(); setFehler(null); setLaeuft(true);
    try { await api.post("/api/v1/station/einrichten", { code }); onFertig(); } catch (x) { setFehler(fehlerText(x)); } finally { setLaeuft(false); }
  };
  return (
    <div className="lp-login">
      <Section titel="Arbeitsplatz einrichten" icon="Monitor">
        <p style={{ marginTop: 0 }}>Gib den Einrichtungscode ein. Ein Administrator erzeugt ihn im Materialplaner unter Verwaltung → Arbeitsplätze. Danach bleibt dieses Gerät angemeldet.</p>
        {fehler && <Meldung level="error" text={fehler} />}
        <form onSubmit={senden}>
          <Feld label="Einrichtungscode"><Eingabe value={code} autoFocus autoComplete="off" onChange={(e) => setCode(e.target.value)} placeholder="z. B. ABCDE-FGHJK" /></Feld>
          <Knopf art="primaer" type="submit" icon="LogIn" disabled={laeuft || !code.trim()}>Einrichten</Knopf>
        </form>
      </Section>
    </div>
  );
}

/* ── R-11a/R-11c Sperrbildschirm ── */
function Sperrbildschirm({ api, zustand, onNeu }) {
  const [wahl, setWahl] = useState(null);
  const [pin, setPin] = useState("");
  const [fehler, setFehler] = useState(null);
  const [warte, setWarte] = useState(zustand.wartezeit || 0);
  useEffect(() => { if (warte <= 0) return; const t = setTimeout(() => setWarte((w) => w - 1), 1000); return () => clearTimeout(t); }, [warte]);
  const entsperre = async (m, p) => {
    setFehler(null);
    try { onNeu(await api.post("/api/v1/station/entsperren", { mitarbeiter: m.id, pin: p })); }
    catch (e) { setFehler(fehlerText(e)); setPin(""); if (e.daten?.wartezeit) setWarte(e.daten.wartezeit); }
  };
  const liste = zustand.mitarbeiterListe || [];
  return (
    <div className="lp-sperre" data-testid="sperrbildschirm">
      <div className="lp-sperre-kopf"><Icon name="Lock" size={32} /><div><h1 className="lp-h1" style={{ margin: 0 }}>{zustand.arbeitsplatz.name}</h1>
        <p className="lp-meta" style={{ margin: 0 }}>Gesperrt. Wer arbeitet hier? Tippe deinen Namen an.</p></div></div>
      {fehler && <Meldung level="error" text={fehler} />}
      {warte > 0 && <Meldung level="warning" text={`Zu viele falsche PINs. Neuer Versuch in ${warte} Sekunden.`} />}
      {!liste.length && <Leerzustand icon="Users" text="Noch keine Mitarbeiter angelegt. Ein Administrator legt sie im Materialplaner unter Verwaltung → Arbeitsplätze an." />}
      {!wahl ? <div className="lp-sperre-namen">
        {liste.map((m) => <button key={m.id} type="button" className="lp-sperre-name" disabled={warte > 0} onClick={() => (m.pin ? setWahl(m) : entsperre(m, ""))}>
          <Icon name="Users" size={22} /><span>{m.name}</span>{m.pin && <Icon name="Key" size={16} />}</button>)}
      </div> : <form className="lp-sperre-pin" onSubmit={(e) => { e.preventDefault(); entsperre(wahl, pin); }}>
        <Feld label={`PIN für ${wahl.name}`}><Eingabe type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} /></Feld>
        <div className="lp-zeile"><Knopf art="primaer" type="submit" icon="Unlock" disabled={warte > 0 || pin.length < 4}>Entsperren</Knopf>
          <Knopf onClick={() => { setWahl(null); setPin(""); setFehler(null); }}>Anderer Name</Knopf></div>
      </form>}
    </div>
  );
}

/* ── R-11e Packplatz: Projekt der Ladezone ── */
function PackPlatz({ zustand }) {
  const { api } = React.useContext(LagerKontext);
  const [projektId, setProjektId] = useState(zustand.projekt?.id || null);
  useEffect(() => { if (zustand.projekt?.id) setProjektId((p) => p || zustand.projekt.id); }, [zustand.projekt?.id]);
  const d = useDaten(() => (projektId ? api.get(`/api/v1/projekte/${projektId}/packstatus`) : Promise.resolve(null)), [projektId]);
  const [meldung, setMeldung] = useState(null);
  const [fragen, dialog] = useBestaetigung();
  useLive(["packen", "geraet", "projekt", "zone"], () => d.laden());
  if (!projektId) return <Section titel={`Ladezone ${zustand.arbeitsplatz.ladezone || "–"}`} icon="LayoutGrid">
    <Leerzustand icon="LayoutGrid" text="In dieser Ladezone ist gerade kein Projekt. Weise im Materialplaner unter Ladezonen eines zu oder scanne den Projektcode." />
    <ScanPanel gross kamera={KameraKnopf} modus="packen" arbeitsplatzId={zustand.arbeitsplatz.id} onErgebnis={(r) => { if (r.weiter && r.projekt) setProjektId(r.projekt.id); }} />
  </Section>;
  const st = d.daten;
  return (
    <>
      {dialog}
      {meldung && <Meldung {...meldung} onSchliessen={() => setMeldung(null)} />}
      <Section titel={st ? `Packen ${st.projekt.nummer} ${st.projekt.name}` : "Packen"} icon="ClipboardList" aktionen={st && !st.projekt.gepackt_am && <Knopf art="primaer" icon="Truck" onClick={async () => {
        const offen = st.zeilen.filter((z) => z.fertig === false).length;
        if (!(await fragen({ titel: "Packen abschließen und verladen?", knopf: "Verladen", text: `${offen ? `Achtung: ${offen} Position(en) sind noch nicht vollständig. ` : ""}Die Ladezone wird frei.` }))) return;
        try { const r = await api.post(`/api/v1/projekte/${projektId}/verladen`, {}); setMeldung({ level: "success", text: r.text }); d.laden(); } catch (e) { setMeldung({ level: "error", text: fehlerText(e) }); }
      }}>Packen abgeschlossen & verladen</Knopf>}>
        {st && <div className="lp-zeile" style={{ alignItems: "center", marginBottom: 12 }}>
          <div className="lp-fortschritt" style={{ flex: 1 }} role="progressbar" aria-valuenow={st.fortschritt} aria-valuemin={0} aria-valuemax={100} aria-label="Packfortschritt"><div style={{ width: `${st.fortschritt}%` }} /></div>
          <strong data-testid="fortschritt">{st.fortschritt} %</strong>
          {st.vollstaendig && <Badge farbe="#1f6e32" text="#fff">Packliste vollständig</Badge>}
          {st.projekt.gepackt_am && <Badge farbe="#1f6e32" text="#fff">verladen</Badge>}
        </div>}
        <ScanPanel gross kamera={KameraKnopf} modus="packen" projektId={projektId} angebotId={st?.angebot?.id || null} arbeitsplatzId={zustand.arbeitsplatz.id}
          onErgebnis={(r) => { if (r.weiter && r.projekt) setProjektId(r.projekt.id); else d.laden(); }} />
      </Section>
      {st?.angebot && <Section titel="Packliste" icon="ListChecks">
        <Tabelle zeilen={st.zeilen} schluessel="artikel_id" spalten={[
          { titel: "Artikel", wert: (z) => <strong>{z.artikel}</strong> },
          { titel: "Soll", rechts: true, wert: (z) => `${String(z.soll).replace(".", ",")} ${z.einheit}` },
          { titel: "Gepackt", rechts: true, wert: (z) => z.gepackt ?? "–" },
          { titel: "Stand", wert: (z) => (z.fertig == null ? "–" : z.fertig ? <Badge farbe="#1f6e32" text="#fff">fertig</Badge> : <Badge farbe="#8a4b00" text="#fff">offen</Badge>) },
        ]} />
      </Section>}
    </>
  );
}

/* ── R-11e Rückgabeplatz (ohne Projektwahl), R-11g Funktionstest ── */
function RueckgabePlatz({ zustand }) {
  const [tasche, setTasche] = useState(null);
  const [test, setTest] = useState(null);
  const [meldung, setMeldung] = useState(null);
  const [schaden, setSchaden] = useState(null);
  const [letzter, setLetzter] = useState("");
  return (
    <>
      <Section titel="Rückgabe" icon="ScanLine" aktionen={<Knopf icon="Camera" onClick={() => setSchaden({ code: letzter })}>Schaden dokumentieren</Knopf>}>
        <ScanPanel gross kamera={KameraKnopf} modus="rueckgabe" tasche={tasche?.code || null} arbeitsplatzId={zustand.arbeitsplatz.id}
          onErgebnis={(r) => { if (r.tasche) setTasche(r.tasche); if (r.gebucht) setLetzter(r.code); if (zustand.arbeitsplatz.funktionstest && r.gebucht) setTest(r.code); }} />
      </Section>
      {meldung && <Meldung {...meldung} onSchliessen={() => setMeldung(null)} />}
      {test && <FunktionstestKarte key={test} code={test} onFertig={(m) => { setTest(null); setMeldung(m); }} />}
      {tasche && <TaschenKarte tasche={tasche} onNeu={(t) => t && setTasche(t)} onEnde={() => setTasche(null)} />}
      {schaden && <SchadenDialog code={schaden.code} onSchliessen={() => setSchaden(null)} onFertig={(r) => { setSchaden(null); setMeldung({ level: r.level, text: r.text }); }} />}
    </>
  );
}

/* ── R-59 / FA-24 Ladezonen-Anzeige ── */
function Anzeige({ api, zone }) {
  const [d, setD] = useState(null);
  const [fehler, setFehler] = useState(null);
  const laden = useCallback(() => api.get(`/api/v1/anzeige/zonen${zone ? `?zone=${zone}` : ""}`).then((x) => { setD(x); setFehler(null); }, (e) => setFehler(fehlerText(e))), [api, zone]);
  useEffect(() => { laden(); const t = setInterval(laden, 60_000); return () => clearInterval(t); }, [laden]); // selbstaktualisierend, auch ohne Live
  useLive(["zone", "projekt", "packen"], laden);
  return (
    <div className="lp-anzeige" data-testid="anzeige">
      <div className="lp-anzeige-kopf"><h1 className="lp-h1" style={{ margin: 0 }}>Ladezonen</h1>
        <span className="lp-meta">Stand {d ? new Date(d.stand).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "…"}</span></div>
      {fehler && <Meldung level="error" text={`${fehler} Die Anzeige versucht es jede Minute erneut.`} />}
      <div className="lp-anzeige-raster">
        {(d?.zonen || []).map((z) => (
          <section key={z.id} className="lp-anzeige-zone" data-testid={`anzeige-zone-${z.bezeichnung}`}>
            <h2>{z.bezeichnung} <span className="lp-meta">{z.belegt}/{z.plaetze}</span></h2>
            {z.projekte.length === 0 ? <p className="lp-anzeige-frei">frei</p> : z.projekte.map((p) => (
              <div key={p.id} className="lp-anzeige-projekt">
                <div className="lp-anzeige-qr" aria-label={`QR-Code ${p.nummer}`} role="img" dangerouslySetInnerHTML={{ __html: p.qr_svg }} />
                <div><strong className="lp-anzeige-nr">{p.nummer}</strong><div className="lp-anzeige-name">{p.name}</div>
                  <div className="lp-meta">{p.kunde_firma || p.kunde}{p.beginn ? ` · ${datumAnzeige(p.beginn)}` : ""}</div></div>
              </div>))}
          </section>))}
      </div>
    </div>
  );
}

/* ── Hülle ── */
function App() {
  const csrf = useRef(null);
  const [zustand, setZustand] = useState(undefined); // undefined = lädt, null = nicht eingerichtet
  const [hinweis, setHinweis] = useState(null);
  const basis = window.location.origin;
  const rohApi = useMemo(() => erstelleApi({ basis, csrf: () => csrf.current }), [basis]);
  const ladeZustand = useCallback(async () => {
    try { const z = await rohApi.get("/api/v1/station/zustand"); csrf.current = z.csrf || null; setZustand(z.eingerichtet ? z : null); }
    catch { setZustand(null); }
  }, [rohApi]);
  useEffect(() => { ladeZustand(); }, [ladeZustand]);
  // 423 → Sperrbildschirm, 403 mit weiter → Startseite (R-11d)
  const api = useMemo(() => {
    const wrap = (f) => async (...a) => {
      try { return await f(...a); } catch (e) {
        if (e.status === 423) ladeZustand();
        if (e.status === 403 && e.daten?.weiter) setHinweis(e.daten.text);
        if (e.status === 401) setZustand(null);
        throw e;
      }
    };
    return { ...rohApi, get: wrap(rohApi.get), post: wrap(rohApi.post), put: wrap(rohApi.put), del: wrap(rohApi.del) };
  }, [rohApi, ladeZustand]);
  const eingerichtet = !!zustand;
  const live = useMemo(() => (eingerichtet ? new Live({ basis }) : null), [eingerichtet, basis]);
  useEffect(() => { if (!live) return; live.start(); return () => live.stopp(); }, [live]);
  const scanZiel = useRef(null);
  useHandscanner(scanZiel, () => {});
  // R-11b: ohne Eingabe nach sperrzeit_minuten sperren (der Server prüft das zusätzlich bei jeder Anfrage)
  const aktiv = !!zustand && !zustand.gesperrt && zustand.arbeitsplatz.art !== "anzeige";
  useEffect(() => {
    if (!aktiv) return;
    let letzte = Date.now();
    const r = () => { letzte = Date.now(); };
    const t = setInterval(() => { if (Date.now() - letzte > zustand.arbeitsplatz.sperrzeit_minuten * 60_000) rohApi.post("/api/v1/station/sperren", {}).then(setZustand, ladeZustand); }, 5000);
    window.addEventListener("keydown", r, true); window.addEventListener("pointerdown", r, true);
    return () => { clearInterval(t); window.removeEventListener("keydown", r, true); window.removeEventListener("pointerdown", r, true); };
  }, [aktiv, zustand?.arbeitsplatz?.sperrzeit_minuten, rohApi, ladeZustand]);

  if (zustand === undefined) return null;
  if (!zustand) return <Einrichten api={rohApi} onFertig={ladeZustand} />;
  const kontext = { api, live, nutzer: { admin: false, rechte: { packen: "w", geraete: "r" } }, navigiere: () => {}, scanZiel, setBanner: setHinweis };
  const ap = zustand.arbeitsplatz;
  return (
    <LagerKontext.Provider value={kontext}>
      {ap.art === "anzeige" ? <Anzeige api={api} zone={new URLSearchParams(window.location.search).get("zone")} /> :
        zustand.gesperrt ? <Sperrbildschirm key={zustand.wartezeit} api={api} zustand={zustand} onNeu={(z) => { csrf.current = z.csrf || csrf.current; setZustand(z); }} /> :
          <div className="lp-station">
            <header className="lp-station-kopf">
              <strong>{ap.name}</strong>
              <span className="lp-meta">{ap.art === "packen" ? `Ladezone ${ap.ladezone || "–"}` : "Rückgabe / Prüfung"}</span>
              <span style={{ flex: 1 }} />
              <span data-testid="mitarbeiter"><Icon name="Users" size={18} /> {zustand.mitarbeiter?.name}</span>
              <Knopf icon="Lock" onClick={() => api.post("/api/v1/station/sperren", {}).then(setZustand)}>Sperren</Knopf>
            </header>
            {hinweis && <Meldung level="warning" text={hinweis} onSchliessen={() => setHinweis(null)} />}
            <main className="lp-station-inhalt">{ap.art === "packen" ? <PackPlatz zustand={zustand} /> : <RueckgabePlatz zustand={zustand} />}</main>
          </div>}
    </LagerKontext.Provider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
