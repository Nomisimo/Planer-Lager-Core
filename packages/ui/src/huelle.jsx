// App-Hülle beider Apps: Anmeldung, Kopfleiste, Seitenmenü (UI-1), Router, Live-Verbindung, Deep-Links, App-Schalter.
import { Glocke } from "./glocke.jsx";
import { plattform } from "./plattform.js";
import { useSeriellerScanner } from "./seriell.jsx";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { erstelleApi, Live } from "@lager/client";
import { themaVariablen, THEMEN, DICHTEN, MODI } from "./themen.js";
import { menueFuer, aktiverEintrag, MENUE } from "./menue.js";
import { passeMuster, zerlegeHash, deepLinkZuPfad } from "./router.js";
import { fehlerText } from "./texte.js";
import { Icon, Knopf, Feld, Eingabe, Meldung, Modal, Section, Auswahl, Seite } from "./bausteine.jsx";
import STIL from "./stil.css";
import { hidErkenner, pruefeHid } from "@lager/domain/scannen.js";
import { planungsKontext, HERZSCHLAG_S, dauerText } from "@lager/domain/planung.js";

/** Handscanner-Einstellungen dieses Geräts (ARCHITEKTUR §5), localStorage. */
export const HID_KEY = "lager-hid";
export function hidEinstellungen() { try { return pruefeHid(JSON.parse(localStorage.getItem(HID_KEY) || "{}")); } catch { return pruefeHid({}); } }

export const PROTOKOLL_ERWARTET = 1;
const APPS = { m: { id: "materialplaner", titel: "Materialplaner" }, p: { id: "productionplaner", titel: "Productionplaner" } };

const Ctx = createContext(null);
/** Kontext für eigene Hüllen (Arbeitsplatz-Web): { api, live, nutzer, navigiere, scanZiel, … }. */
export const LagerKontext = Ctx;
/** Zugriff auf api, live, nutzer, navigiere, pfad, query, oeffneAndereApp … */
export const useLager = () => useContext(Ctx);

function stilEinfuegen() {
  if (document.getElementById("lp-stil")) return;
  const s = document.createElement("style");
  s.id = "lp-stil"; s.textContent = STIL;
  document.head.appendChild(s);
}

const systemDunkel = () => { try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return true; } };
const DESIGN_KEY = "lager_design";
export function leseDesign() { try { return JSON.parse(localStorage.getItem(DESIGN_KEY) || "null"); } catch { return null; } }
/** Wendet Thema/Dichte/Modus als CSS-Variablen an (FA-52, UI-6). */
export function wendeDesignAn(d = {}) {
  const modus = d.modus === "hell" ? "hell" : d.modus === "dunkel" ? "dunkel" : systemDunkel() ? "dunkel" : "hell";
  const { css } = themaVariablen({ thema: d.thema, modus, dichte: d.dichte });
  const root = document.documentElement;
  for (const [k, v] of Object.entries(css)) root.style.setProperty(k, v);
  root.dataset.modus = modus; root.dataset.thema = d.thema || "planer"; root.dataset.dichte = d.dichte || "normal";
  root.style.colorScheme = modus === "hell" ? "light" : "dark";
}

function useHash() {
  const [h, setH] = useState(() => zerlegeHash(window.location.hash));
  useEffect(() => { const f = () => setH(zerlegeHash(window.location.hash)); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return h;
}
export const navigiere = (pfad) => { window.location.hash = "#" + pfad; };

/* ── Anmeldung inkl. Zwei-Faktor ─────────────────────────────────────────── */
/** Server-Adresse in der App ändern (nur Electron, wenn nicht per LAGER_SERVER_URL fest). */
function ServerAdresse({ info }) {
  const [offen, setOffen] = useState(false);
  const [url, setUrl] = useState(info?.serverUrl || "");
  const [fehler, setFehler] = useState(null);
  if (!plattform.kann("serverAdresse") || !info || info.serverFest) return null;
  const speichern = async () => {
    setFehler(null);
    const r = await plattform.serverSetzen(url);
    if (!r?.ok) setFehler(r?.text || "Die Adresse ließ sich nicht speichern.");
  };
  if (!offen) return <p className="lp-hinweis" data-testid="server-adresse">Server: {info.serverUrl} · <button type="button" className="lp-link" onClick={() => setOffen(true)}>ändern</button></p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Feld label="Server-Adresse" hinweis="Bekommst du vom Admin, z. B. https://lager.meinefirma.de"><Eingabe value={url} onChange={(e) => setUrl(e.target.value)} /></Feld>
      {fehler && <Meldung level="error" text={fehler} />}
      <div style={{ display: "flex", gap: 8 }}><Knopf art="primaer" icon="Save" onClick={speichern}>Server speichern</Knopf><Knopf art="geist" onClick={() => setOffen(false)}>Abbrechen</Knopf></div>
    </div>
  );
}

function Anmeldung({ api, titel, onFertig, hinweis, info }) {
  const [w, setW] = useState({ benutzername: "", passwort: "", code: "" });
  const [zwischen, setZwischen] = useState(null);
  const [fehler, setFehler] = useState(hinweis || null);
  const absenden = async (e) => {
    e?.preventDefault?.();
    setFehler(null);
    try {
      if (zwischen) {
        const r = await api.post("/api/v1/anmelden/totp", { zwischenToken: zwischen, code: w.code, art: plattform.anmeldungsArt === "cookie" ? "web" : "app" });
        return onFertig(r);
      }
      const r = await api.post("/api/v1/anmelden", { benutzername: w.benutzername, passwort: w.passwort, art: plattform.anmeldungsArt === "cookie" ? "web" : "app" });
      if (r.zweiterFaktor) { setZwischen(r.zwischenToken); return; }
      onFertig(r);
    } catch (err) { setFehler(fehlerText(err)); }
  };
  return (
    <div className="lp-login">
      <Section titel={titel} icon="LogIn">
        <form onSubmit={absenden} style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="anmeldung">
          {!zwischen ? <>
            <Feld label="Benutzername" pflicht><Eingabe autoFocus autoComplete="username" value={w.benutzername} onChange={(e) => setW({ ...w, benutzername: e.target.value })} /></Feld>
            <Feld label="Passwort" pflicht><Eingabe type="password" autoComplete="current-password" value={w.passwort} onChange={(e) => setW({ ...w, passwort: e.target.value })} /></Feld>
          </> : <Feld label="Code aus der Authenticator-App" pflicht hinweis="6 Ziffern, wechselt alle 30 Sekunden.">
            <Eingabe autoFocus inputMode="numeric" autoComplete="one-time-code" value={w.code} onChange={(e) => setW({ ...w, code: e.target.value })} />
          </Feld>}
          {fehler && <Meldung level="error" text={fehler} />}
          <Knopf art="primaer" type="submit" icon="LogIn" onClick={absenden}>{zwischen ? "Code prüfen" : "Anmelden"}</Knopf>
        </form>
        <div style={{ marginTop: 12 }}><ServerAdresse info={info} /></div>
      </Section>
    </div>
  );
}

/** FA-54: Pflicht-Einrichtung der Zwei-Faktor-Anmeldung für Admins. */
function ZweiFaktorEinrichten({ api, onFertig }) {
  const [daten, setDaten] = useState(null);
  const [code, setCode] = useState("");
  const [meldung, setMeldung] = useState(null);
  useEffect(() => { api.post("/api/v1/ich/totp/einrichten").then(setDaten, (e) => setMeldung({ level: "error", text: fehlerText(e) })); }, [api]);
  return (
    <div className="lp-login">
      <Section titel="Zwei-Faktor-Anmeldung einrichten" icon="ShieldCheck">
        <p style={{ marginTop: 0 }}>Für Administratoren ist ein zweiter Faktor Pflicht. Scanne den QR-Code mit einer Authenticator-App (z. B. Google Authenticator, Microsoft Authenticator) und gib dann den angezeigten Code ein.</p>
        {daten?.qrSvg && <div style={{ background: "#fff", padding: 8, width: 196, borderRadius: 8 }} dangerouslySetInnerHTML={{ __html: daten.qrSvg }} />}
        {daten && <p className="lp-hinweis">Schlüssel zum Abtippen: <code>{daten.geheimnis}</code></p>}
        <Feld label="Code" pflicht><Eingabe inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></Feld>
        {meldung && <div style={{ marginTop: 10 }}><Meldung {...meldung} /></div>}
        <div style={{ marginTop: 12 }}><Knopf art="primaer" icon="Check" onClick={async () => {
          try { await api.post("/api/v1/ich/totp/bestaetigen", { code }); onFertig(); } catch (e) { setMeldung({ level: "error", text: fehlerText(e) }); }
        }}>Bestätigen</Knopf></div>
      </Section>
    </div>
  );
}

/* ── Kopfleiste ──────────────────────────────────────────────────────────── */
function OnlineStatus({ live }) {
  const [s, setS] = useState(live?.status || "getrennt");
  useEffect(() => live?.onStatus(setS), [live]);
  const farbe = s === "verbunden" ? "var(--lp-ok)" : s === "verbinde" ? "var(--lp-warn)" : "var(--lp-err)";
  const text = s === "verbunden" ? "Online" : s === "verbinde" ? "Verbinde …" : "Offline";
  return <span className="lp-online" data-testid="online-status" title={s === "verbunden" ? "Live-Verbindung zum Lager-Server steht." : "Keine Live-Verbindung. Änderungen anderer erscheinen erst nach dem Wiederverbinden."}>
    <span className="lp-punkt" style={{ background: farbe }} aria-hidden="true" />{text}</span>;
}

function DarstellungDialog({ design, onAendern, onSchliessen }) {
  return (
    <Modal titel="Darstellung" onSchliessen={onSchliessen} breite={420}>
      <div style={{ display: "grid", gap: 12 }}>
        <Feld label="Hell / Dunkel"><Auswahl value={design.modus || "system"} onChange={(e) => onAendern({ ...design, modus: e.target.value })} optionen={Object.entries(MODI).map(([wert, titel]) => ({ wert, titel }))} /></Feld>
        <Feld label="Farbthema"><Auswahl value={design.thema || "planer"} onChange={(e) => onAendern({ ...design, thema: e.target.value })} optionen={Object.entries(THEMEN).map(([wert, t]) => ({ wert, titel: t.titel }))} /></Feld>
        <Feld label="Abstände"><Auswahl value={design.dichte || "normal"} onChange={(e) => onAendern({ ...design, dichte: e.target.value })} optionen={Object.entries(DICHTEN).map(([wert, t]) => ({ wert, titel: t.titel }))} /></Feld>
      </div>
    </Modal>
  );
}

/**
 * @param {{app: "m"|"p", seiten: {muster: string, Komponente: any}[], kopfExtra?: any, onCode?: (code: string, ctx: any) => void}} props
 */
export function AppHuelle({ app, seiten, onCode }) {
  stilEinfuegen();
  const self = APPS[app], andere = APPS[app === "m" ? "p" : "m"];
  const [info, setInfo] = useState(null);
  const [token, setToken] = useState(undefined); // undefined = lädt
  const [nutzer, setNutzer] = useState(null);
  const [zweiFaktor, setZweiFaktor] = useState(false);
  const [hinweis, setHinweis] = useState(null);
  const [banner, setBanner] = useState(null);
  const [firma, setFirma] = useState("");
  const [design, setDesign] = useState(() => leseDesign() || {});
  const [darstellung, setDarstellung] = useState(false);
  const [menueOffen, setMenueOffen] = useState(false);
  const tokenRef = useRef(null); // Desktop: Sitzungs-Token; Browser: "cookie" als Merker (Sitzung im HttpOnly-Cookie)
  const csrfRef = useRef(null);
  const scanZiel = useRef(null);
  const kontextRef = useRef(null);
  const { pfad, query } = useHash();
  const web = plattform.istWeb;

  useEffect(() => {
    wendeDesignAn(design);
    // UI-6: „Wie das System“ folgt einem Wechsel sofort.
    let mq; try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch { return; }
    const f = () => wendeDesignAn(design);
    mq.addEventListener?.("change", f);
    return () => mq.removeEventListener?.("change", f);
  }, [design]);

  const bearer = () => (web ? null : tokenRef.current);
  const api = useMemo(() => info && erstelleApi({ basis: info.serverUrl, token: bearer, csrf: () => csrfRef.current, credentials: web ? "same-origin" : "include",
    beiAbmeldung: (d) => { setHinweis(d?.text || null); setzeToken(null); } }), [info]);
  const live = useMemo(() => info && token ? new Live({ basis: info.serverUrl, token: bearer }) : null, [info, token]);
  useEffect(() => { if (!live) return; live.start(); return () => live.stopp(); }, [live]);

  /** Anmeldung übernehmen: Desktop speichert das Token, Browser merkt sich nur „angemeldet“ + CSRF-Token. */
  const setzeToken = useCallback((t, csrf) => {
    if (web && t) t = "cookie";
    tokenRef.current = t; setToken(t);
    if (csrf !== undefined || !t) csrfRef.current = csrf || null;
    if (!web) plattform.tokenSchreiben(t || null);
    if (!t) setNutzer(null);
  }, []);

  // Start: Info + gespeichertes Token
  useEffect(() => {
    (async () => {
      const i = await plattform.info();
      setInfo({ ...i, titel: i.titel || self.titel });
      if (web) {
        // WEB-13: „Im Browser öffnen“ aus der Desktop-App bringt einen Handoff-Code mit → Cookie-Sitzung, Code aus der Adresse entfernen
        const code = new URLSearchParams(location.search).get("handoff");
        if (code) {
          try {
            await fetch(`${i.serverUrl}/api/v1/handoff/einloesen`, { method: "POST", credentials: "same-origin",
              headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ code, art: "web" }) });
          } catch { /* dann normale Anmeldung */ }
          history.replaceState(null, "", location.pathname + location.hash);
        }
        // Browser: besteht schon eine Cookie-Sitzung? (WEB-02: gilt für beide Web-Apps)
        try {
          const r = await fetch(`${i.serverUrl}/api/v1/ich`, { credentials: "same-origin", headers: { Accept: "application/json" } });
          const j = r.ok ? await r.json() : null;
          if (j?.nutzer) { csrfRef.current = j.csrf || null; tokenRef.current = "cookie"; setToken("cookie"); return; }
        } catch { /* Server nicht erreichbar: Anmeldung zeigen */ }
        tokenRef.current = null; setToken(null);
        return;
      }
      const t = await plattform.tokenLesen();
      tokenRef.current = t; setToken(t || null);
    })();
  }, []);

  // Protokoll-Version prüfen (ARCHITEKTUR §4.7)
  useEffect(() => {
    if (!api) return;
    api.get("/health").then((h) => {
      if (h.protokoll !== PROTOKOLL_ERWARTET) setBanner(`Diese App passt nicht zur Version des Lager-Servers (Server ${h.protokoll}, App ${PROTOKOLL_ERWARTET}). Installiere das aktuelle Update.`);
    }, () => setBanner("Der Lager-Server ist nicht erreichbar. Prüfe die Internetverbindung. Die App verbindet sich automatisch neu."));
  }, [api]);

  // Nutzer laden, wenn Token da
  useEffect(() => {
    if (!api || !token) return;
    api.get("/api/v1/ich").then((r) => { if (r.csrf) csrfRef.current = r.csrf; setNutzer(r.nutzer); setZweiFaktor(!!r.zweiFaktorEinrichten); if (r.nutzer.design && Object.keys(r.nutzer.design).length && !leseDesign()) setDesign(r.nutzer.design); },
      (e) => { if (e.status === 401) setzeToken(null); else setBanner(fehlerText(e)); });
    api.get("/api/v1/einstellungen/basis").then((b) => { setFirma(b.firma?.name || ""); if (!leseDesign() && b.design_standard) setDesign((d) => (Object.keys(d).length ? d : b.design_standard)); }, () => {});
  }, [api, token]);

  // Deep-Links (+ Handoff-Login)
  const verarbeiteLink = useCallback(async (url) => {
    const m = /^[a-z]+:\/\/([^?#]*)(?:\?([^#]*))?/i.exec(url);
    if (!m || !api) return;
    const q = Object.fromEntries(new URLSearchParams(m[2] || ""));
    if (q.handoff && !tokenRef.current) {
      try { const r = await api.post("/api/v1/handoff/einloesen", { code: q.handoff, art: web ? "web" : "app" }); setzeToken(r.token || "cookie", r.csrf); }
      catch (e) { setHinweis(fehlerText(e)); }
    }
    navigiere(deepLinkZuPfad(m[1].split("/").filter(Boolean).map(decodeURIComponent)));
  }, [api, setzeToken]);
  useEffect(() => {
    if (!api || web) return;
    const ab = plattform.onDeepLink(verarbeiteLink);
    plattform.bereit().then((wartend) => wartend.forEach(verarbeiteLink));
    return ab;
  }, [api, verarbeiteLink]);

  /** App-Schalter / Sprung in die andere App mit Kontext (ARCHITEKTUR §4.3). */
  const oeffneAndereApp = useCallback(async (zielPfad = pfad, { neuerTab = false } = {}) => {
    if (web) {
      // Browser: gleicher Server, das Sitzungs-Cookie gilt für beide Apps (WEB-02)
      await plattform.oeffneAndereApp({ appId: andere.id, pfad: zielPfad, neuerTab });
      return `/${andere.id}/#${zielPfad}`;
    }
    let code = null;
    try { code = (await api.post("/api/v1/handoff")).code; } catch { /* ohne Handoff: andere App fragt nach Login */ }
    const link = `${andere.id}://${zielPfad.replace(/^\//, "")}${code ? `?handoff=${encodeURIComponent(code)}` : ""}`;
    const ok = await plattform.oeffneAndereApp({ appId: andere.id, pfad: zielPfad, link });
    if (!ok) setBanner(`Der ${andere.titel} ist auf diesem Rechner nicht installiert oder ließ sich nicht öffnen. Installiere ihn oder frag den Admin.`);
    return link;
  }, [api, pfad, andere]);

  /** WEB-13: dieselbe Ansicht im Browser öffnen, angemeldet per Handoff-Code (nur Desktop). */
  const imBrowserOeffnen = useCallback(async () => {
    let code = null;
    try { code = (await api.post("/api/v1/handoff")).code; } catch { /* ohne Code: Browser fragt nach Login */ }
    const url = `${String(info.serverUrl).replace(/\/+$/, "")}/${self.id}/${code ? `?handoff=${encodeURIComponent(code)}` : ""}#${pfad}`;
    const ok = await plattform.oeffneExtern(url);
    if (!ok) setBanner("Der Browser ließ sich nicht öffnen. Öffne die Adresse des Lager-Servers selbst im Browser.");
    return url;
  }, [api, info, pfad]);

  // UI-3 / ARCHITEKTUR §5: Handscanner (Tastatur) global erkennen, auch ohne Fokus; an die Scan-Seite oder das Codefeld.
  useHandscanner(scanZiel, (code) => { if (kontextRef.current) onCode?.(code, kontextRef.current); });
  // BT-SPP: serieller Scanner geht denselben Weg (nur wenn in den Einstellungen eingeschaltet)
  useSeriellerScanner(scanZiel, (code) => { if (kontextRef.current) onCode?.(code, kontextRef.current); });
  // R-63 Planungszeit: Timer-Zustand + Herzschlag in beiden Apps (Sprung in den Materialplaner stoppt auf Nicht-Planungsseiten)
  const zeit = usePlanungszeit(api, live, nutzer, pfad);

  const abmelden = async () => { try { await api.post("/api/v1/abmelden"); } catch { /* egal */ } setzeToken(null); };
  const designAendern = (d) => { setDesign(d); try { localStorage.setItem(DESIGN_KEY, JSON.stringify(d)); } catch { /* privat */ } api?.put("/api/v1/ich/design", d).catch(() => {}); };

  if (!info || token === undefined) return null;
  if (!token || (!nutzer && !zweiFaktor)) {
    if (token && !nutzer) return null; // lädt /ich
    return <Anmeldung api={api} info={info} titel={`${self.titel} – Anmeldung`} hinweis={hinweis} onFertig={(r) => { setHinweis(null); setzeToken(r.token || "cookie", r.csrf); }} />;
  }
  if (zweiFaktor) return <ZweiFaktorEinrichten api={api} onFertig={() => { setZweiFaktor(false); api.get("/api/v1/ich").then((r) => setNutzer(r.nutzer)); }} />;

  const menue = menueFuer(nutzer.rechte, app);
  const alle = menue.flatMap((g) => g.eintraege);
  const aktiv = aktiverEintrag(pfad, alle);
  let treffer = null;
  for (const s of seiten) { const p = passeMuster(s.muster, pfad); if (p) { treffer = { ...s, params: p }; break; } }
  // R-05: Seite eines Bereichs ohne Recht → „Zugriff verweigert“ mit Rolle (statt leerer Seite).
  const pfadEintrag = aktiverEintrag(pfad, MENUE.flatMap((g) => g.eintraege));
  const verweigert = pfadEintrag && !alle.some((e) => e.pfad === pfadEintrag.pfad);
  const kontext = { api, live, nutzer, info, pfad, query, navigiere, oeffneAndereApp, app, firma, setBanner, scanZiel, zeit };
  kontextRef.current = kontext;

  return (
    <Ctx.Provider value={kontext}>
      <div className="lp-app">
        <header className="lp-kopf">
          <button className="lp-btn lp-btn-geist lp-btn-klein lp-nur-mobil" aria-label="Menü" onClick={() => setMenueOffen((o) => !o)}><Icon name="Menu" /></button>
          <span className="lp-logo">{self.titel}</span>
          <span className="lp-meta">{firma ? firma + " · " : ""}Version {info.version}</span>
          <div className="lp-kopf-rechts">
            <CodeFeld onCode={(c) => onCode?.(c, kontext)} />
            <button className="lp-btn lp-btn-klein" data-testid="app-schalter" title={`Zum ${andere.titel} wechseln (gleiche Stelle, ohne neue Anmeldung)`} onClick={() => oeffneAndereApp()}>
              <Icon name="ArrowLeftRight" size={14} />{andere.titel}
            </button>
            {!web && <button className="lp-btn lp-btn-geist lp-btn-klein" data-testid="im-browser" title="Diese Ansicht im Browser öffnen (ohne neue Anmeldung)" aria-label="Im Browser öffnen" onClick={imBrowserOeffnen}><Icon name="Globe" size={14} /></button>}
            {zeit.timer && <TimerAnzeige zeit={zeit} navigiere={(p) => (app === "p" ? navigiere(p) : oeffneAndereApp(p))} />}
            <OnlineStatus live={live} />
            <Glocke />
            <button className="lp-btn lp-btn-geist lp-btn-klein" title="Darstellung" aria-label="Darstellung" onClick={() => setDarstellung(true)}><Icon name="Palette" size={14} /></button>
            <span className="lp-meta" data-testid="benutzer">{nutzer.name || nutzer.benutzername} · {nutzer.rolle}</span>
            <button className="lp-btn lp-btn-geist lp-btn-klein" onClick={abmelden} title="Abmelden" aria-label="Abmelden"><Icon name="LogOut" size={14} /></button>
          </div>
        </header>
        <nav className={"lp-menue" + (menueOffen ? " lp-offen" : "")} aria-label="Hauptmenü">
          {menue.map((g) => (
            <div key={g.gruppe}>
              <div className="lp-menue-gruppe">{g.gruppe}</div>
              {g.eintraege.map((e) => (
                <button key={e.pfad} className="lp-menue-eintrag" aria-current={aktiv?.pfad === e.pfad ? "page" : undefined}
                  title={e.fremd ? `Öffnet im ${andere.titel}` : undefined}
                  onClick={() => { setMenueOffen(false); e.fremd ? oeffneAndereApp(e.pfad) : navigiere(e.pfad); }}>
                  <Icon name={e.icon} />{e.titel}{e.fremd && <Icon name="ExternalLink" size={13} className="lp-fremd" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <main className="lp-inhalt">
          {banner && <div style={{ marginBottom: 12 }}><Meldung level="warning" text={banner} onSchliessen={() => setBanner(null)} /></div>}
          {zeit.meldung && <div style={{ marginBottom: 12 }} data-testid="zeit-meldung"><Meldung level="info" text={zeit.meldung} onSchliessen={() => zeit.setMeldung(null)} /></div>}
          {verweigert ? <ZugriffVerweigert rolle={nutzer.rolle} />
            : treffer ? <treffer.Komponente params={treffer.params} query={query} key={pfad} />
            : <Seite titel="Seite nicht gefunden"><Meldung level="error" text="Diese Seite gibt es in dieser App nicht. Wähle links einen Menüpunkt." /></Seite>}
        </main>
        {darstellung && <DarstellungDialog design={design} onAendern={designAendern} onSchliessen={() => setDarstellung(false)} />}
      </div>
    </Ctx.Provider>
  );
}

/** Globales Codefeld (FA-16): Enter übergibt den Code an die App. */
export function CodeFeld({ onCode }) {
  const [w, setW] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (w.trim()) { onCode?.(w.trim()); setW(""); } }} role="search">
      <input className="lp-input lp-codefeld" placeholder="Code / Nummer …" aria-label="Code oder Nummer öffnen" value={w} onChange={(e) => setW(e.target.value)} data-testid="codefeld" />
    </form>
  );
}

/** R-05: „Zugriff verweigert“ mit Rolle. Auch von Seiten nutzbar, wenn die API 403 meldet. */
export function ZugriffVerweigert({ rolle }) {
  return (
    <Seite titel="Zugriff verweigert">
      <Meldung level="error" text={`Dafür fehlt dir die Berechtigung. Deine Rolle „${rolle}“ darf diese Seite nicht öffnen. Wenn du sie brauchst, frag den Admin.`} />
    </Seite>
  );
}

/**
 * R-62–R-64 Planungszeit-Timer: lädt den eigenen Timer, schickt alle 30 s und bei jedem Seitenwechsel einen Herzschlag
 * mit dem Seitenkontext (Projekt / neutral / keine Planung) und ob seitdem eine Eingabe war. Der Server entscheidet über den Stopp.
 */
function usePlanungszeit(api, live, nutzer, pfad) {
  const darf = !!api && !!nutzer && (nutzer.admin || ["r", "w"].includes(nutzer.rechte?.zeiten));
  const [timer, setTimer] = useState(null);
  const [meldung, setMeldung] = useState(null);
  const seite = useRef({ pfad: null, projekt: null }); // usePlanungsProjekt: Projekt einer Seite ohne Projekt im Pfad
  const aktiv = useRef(true);
  const pfadRef = useRef(pfad); pfadRef.current = pfad;
  const timerRef = useRef(null); timerRef.current = timer;
  const laden = useCallback(() => { if (darf) api.get("/api/v1/zeit/timer").then((r) => { setTimer(r.timer); if (r.text) setMeldung(r.text); }, () => {}); }, [api, darf]);
  useEffect(() => { laden(); }, [laden]);
  useEffect(() => { if (!live || !darf) return; return live.on("zeit", () => laden()); }, [live, darf, laden]);
  const ping = useCallback(async () => {
    if (!darf || !timerRef.current) return;
    const p = pfadRef.current;
    const k = planungsKontext(p, seite.current.pfad === p ? seite.current.projekt : null);
    const a = aktiv.current; aktiv.current = false;
    try { const r = await api.post("/api/v1/zeit/ping", { ...k, aktiv: a }); setTimer(r.timer); if (r.gestoppt) setMeldung(r.text); } catch { /* nächster Versuch */ }
  }, [api, darf]);
  // Seitenwechsel: kurz warten, damit eine Seite ihr Projekt melden kann (z. B. Angebot), dann Herzschlag
  useEffect(() => { aktiv.current = true; const t = setTimeout(ping, 800); return () => clearTimeout(t); }, [pfad, ping]);
  const laeuft = !!timer;
  useEffect(() => {
    if (!laeuft) return;
    const t = setInterval(ping, HERZSCHLAG_S * 1000);
    const r = () => { aktiv.current = true; };
    for (const e of ["keydown", "pointerdown", "wheel"]) window.addEventListener(e, r, true);
    return () => { clearInterval(t); for (const e of ["keydown", "pointerdown", "wheel"]) window.removeEventListener(e, r, true); };
  }, [laeuft, ping]);
  const starte = useCallback(async (projekt) => { const r = await api.post("/api/v1/zeit/start", { projekt }); setTimer(r.timer); setMeldung(null); aktiv.current = true; return r; }, [api]);
  const stoppe = useCallback(async () => { const r = await api.post("/api/v1/zeit/stopp", {}); setTimer(null); setMeldung(r.text); return r; }, [api]);
  return { darf, timer, starte, stoppe, meldung, setMeldung, seite, ping };
}

/** Seite meldet ihr Projekt für die Planungszeit (R-63), wenn der Pfad es nicht enthält. */
export function usePlanungsProjekt(projektId) {
  const { zeit, pfad } = useLager() || {};
  useEffect(() => { if (zeit && projektId) { zeit.seite.current = { pfad, projekt: Number(projektId) }; zeit.ping(); } }, [zeit?.ping, pfad, projektId]);
}

function TimerAnzeige({ zeit, navigiere }) {
  const [jetzt, setJetzt] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setJetzt(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const min = Math.max(0, Math.floor((jetzt - new Date(zeit.timer.laeuft_seit).getTime()) / 60000));
  return (
    <span className="lp-timer" data-testid="timer">
      <button className="lp-btn lp-btn-klein" title={`Planungszeit für ${zeit.timer.projekt.nummer} ${zeit.timer.projekt.name}`} onClick={() => navigiere(`/projekte/${zeit.timer.projekt.id}`)}>
        <Icon name="Timer" size={14} />{zeit.timer.projekt.nummer} · {dauerText(min)}
      </button>
      <button className="lp-btn lp-btn-klein" aria-label="Planungszeit stoppen" title="Planungszeit stoppen" onClick={() => zeit.stoppe().catch(() => {})}><Icon name="Pause" size={14} /></button>
    </span>
  );
}

/**
 * UI-3: globaler Handscanner-Listener. Schnelle Tastenfolge + Enter außerhalb von Eingabefeldern = Scan.
 * Geht an das registrierte Scan-Ziel (useScanZiel), sonst an `sonst(code)`.
 */
export function useHandscanner(scanZiel, sonst) {
  const sonstRef = useRef(sonst);
  sonstRef.current = sonst;
  useEffect(() => {
    let e = hidErkenner(hidEinstellungen());
    const neu = () => { e = hidErkenner(hidEinstellungen()); };
    const k = (ev) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return; // Feld nimmt die Eingabe selbst
      const code = e.taste(ev.key, ev.timeStamp || performance.now());
      if (!code) return;
      ev.preventDefault();
      if (scanZiel.current) scanZiel.current(code);
      else sonstRef.current?.(code);
    };
    window.addEventListener("keydown", k, true);
    window.addEventListener("lager-hid", neu);
    return () => { window.removeEventListener("keydown", k, true); window.removeEventListener("lager-hid", neu); };
  }, [scanZiel]);
}

/** Lädt bei Live-Ereignissen des Präfixes neu (ohne Neuladen der Seite). */
export function useLive(praefix, fn) {
  const { live } = useLager() || {};
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!live) return;
    const ab = [].concat(praefix).map((p) => live.on(p, (e) => ref.current(e)));
    return () => ab.forEach((f) => f());
  }, [live, String(praefix)]);
}

/** Registriert die aktuelle Seite als Ziel für Handscanner-Eingaben (UI-3). */
export function useScanZiel(fn) {
  const { scanZiel } = useLager() || {};
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!scanZiel) return;
    const f = (c) => ref.current(c);
    scanZiel.current = f;
    return () => { if (scanZiel.current === f) scanZiel.current = null; };
  }, [scanZiel]);
}
