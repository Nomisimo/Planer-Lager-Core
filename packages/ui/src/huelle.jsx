// App-Hülle beider Apps: Anmeldung, Kopfleiste, Seitenmenü (UI-1), Router, Live-Verbindung, Deep-Links, App-Schalter.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { erstelleApi, Live } from "@lager/client";
import { themaVariablen, THEMEN, DICHTEN, MODI } from "./themen.js";
import { menueFuer, aktiverEintrag, MENUE } from "./menue.js";
import { passeMuster, zerlegeHash, deepLinkZuPfad } from "./router.js";
import { fehlerText } from "./texte.js";
import { Icon, Knopf, Feld, Eingabe, Meldung, Modal, Section, Auswahl, Seite } from "./bausteine.jsx";
import STIL from "./stil.css";
import { hidErkenner, pruefeHid } from "@lager/domain/scannen.js";

/** Handscanner-Einstellungen dieses Geräts (ARCHITEKTUR §5), localStorage. */
export const HID_KEY = "lager-hid";
export function hidEinstellungen() { try { return pruefeHid(JSON.parse(localStorage.getItem(HID_KEY) || "{}")); } catch { return pruefeHid({}); } }

export const PROTOKOLL_ERWARTET = 1;
const APPS = { m: { id: "materialplaner", titel: "Materialplaner" }, p: { id: "productionplaner", titel: "Productionplaner" } };

const Ctx = createContext(null);
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
function Anmeldung({ api, titel, onFertig, hinweis }) {
  const [w, setW] = useState({ benutzername: "", passwort: "", code: "" });
  const [zwischen, setZwischen] = useState(null);
  const [fehler, setFehler] = useState(hinweis || null);
  const absenden = async (e) => {
    e?.preventDefault?.();
    setFehler(null);
    try {
      if (zwischen) {
        const r = await api.post("/api/v1/anmelden/totp", { zwischenToken: zwischen, code: w.code, art: "app" });
        return onFertig(r);
      }
      const r = await api.post("/api/v1/anmelden", { benutzername: w.benutzername, passwort: w.passwort, art: "app" });
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
  const tokenRef = useRef(null);
  const scanZiel = useRef(null);
  const kontextRef = useRef(null);
  const { pfad, query } = useHash();
  const shellApi = window.lagerShell;

  useEffect(() => {
    wendeDesignAn(design);
    // UI-6: „Wie das System“ folgt einem Wechsel sofort.
    let mq; try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch { return; }
    const f = () => wendeDesignAn(design);
    mq.addEventListener?.("change", f);
    return () => mq.removeEventListener?.("change", f);
  }, [design]);

  const api = useMemo(() => info && erstelleApi({ basis: info.serverUrl, token: () => tokenRef.current,
    beiAbmeldung: (d) => { setHinweis(d?.text || null); setzeToken(null); } }), [info]);
  const live = useMemo(() => info && token ? new Live({ basis: info.serverUrl, token: () => tokenRef.current }) : null, [info, token]);
  useEffect(() => { if (!live) return; live.start(); return () => live.stopp(); }, [live]);

  const setzeToken = useCallback((t) => { tokenRef.current = t; setToken(t); shellApi?.tokenSchreiben(t || null); if (!t) setNutzer(null); }, [shellApi]);

  // Start: Info + gespeichertes Token
  useEffect(() => {
    (async () => {
      const i = shellApi ? await shellApi.info() : { serverUrl: location.origin, titel: self.titel, version: "web" };
      setInfo(i);
      const t = shellApi ? await shellApi.tokenLesen() : null;
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
    api.get("/api/v1/ich").then((r) => { setNutzer(r.nutzer); setZweiFaktor(!!r.zweiFaktorEinrichten); if (r.nutzer.design && Object.keys(r.nutzer.design).length && !leseDesign()) setDesign(r.nutzer.design); },
      (e) => { if (e.status === 401) setzeToken(null); else setBanner(fehlerText(e)); });
    api.get("/api/v1/einstellungen/basis").then((b) => { setFirma(b.firma?.name || ""); if (!leseDesign() && b.design_standard) setDesign((d) => (Object.keys(d).length ? d : b.design_standard)); }, () => {});
  }, [api, token]);

  // Deep-Links (+ Handoff-Login)
  const verarbeiteLink = useCallback(async (url) => {
    const m = /^[a-z]+:\/\/([^?#]*)(?:\?([^#]*))?/i.exec(url);
    if (!m || !api) return;
    const q = Object.fromEntries(new URLSearchParams(m[2] || ""));
    if (q.handoff && !tokenRef.current) {
      try { const r = await api.post("/api/v1/handoff/einloesen", { code: q.handoff }); setzeToken(r.token); }
      catch (e) { setHinweis(fehlerText(e)); }
    }
    navigiere(deepLinkZuPfad(m[1].split("/").filter(Boolean).map(decodeURIComponent)));
  }, [api, setzeToken]);
  useEffect(() => {
    if (!api || !shellApi) return;
    const ab = shellApi.onDeepLink(verarbeiteLink);
    shellApi.bereit().then((wartend) => wartend.forEach(verarbeiteLink));
    return ab;
  }, [api, shellApi, verarbeiteLink]);

  /** App-Schalter / Sprung in die andere App mit Kontext (ARCHITEKTUR §4.3). */
  const oeffneAndereApp = useCallback(async (zielPfad = pfad) => {
    let code = null;
    try { code = (await api.post("/api/v1/handoff")).code; } catch { /* ohne Handoff: andere App fragt nach Login */ }
    const link = `${andere.id}://${zielPfad.replace(/^\//, "")}${code ? `?handoff=${encodeURIComponent(code)}` : ""}`;
    const ok = await shellApi?.oeffneExtern(link);
    if (!ok) setBanner(`Der ${andere.titel} ist auf diesem Rechner nicht installiert oder ließ sich nicht öffnen. Installiere ihn oder frag den Admin.`);
    return link;
  }, [api, pfad, andere, shellApi]);

  // UI-3 / ARCHITEKTUR §5: Handscanner (Tastatur) global erkennen, auch ohne Fokus; an die Scan-Seite oder das Codefeld.
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
      else if (kontextRef.current) onCode?.(code, kontextRef.current);
    };
    window.addEventListener("keydown", k, true);
    window.addEventListener("lager-hid", neu);
    return () => { window.removeEventListener("keydown", k, true); window.removeEventListener("lager-hid", neu); };
  }, [onCode]);

  const abmelden = async () => { try { await api.post("/api/v1/abmelden"); } catch { /* egal */ } setzeToken(null); };
  const designAendern = (d) => { setDesign(d); try { localStorage.setItem(DESIGN_KEY, JSON.stringify(d)); } catch { /* privat */ } api?.put("/api/v1/ich/design", d).catch(() => {}); };

  if (!info || token === undefined) return null;
  if (!token || (!nutzer && !zweiFaktor)) {
    if (token && !nutzer) return null; // lädt /ich
    return <Anmeldung api={api} titel={`${self.titel} – Anmeldung`} hinweis={hinweis} onFertig={(r) => { setHinweis(null); setzeToken(r.token); }} />;
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
  const kontext = { api, live, nutzer, info, pfad, query, navigiere, oeffneAndereApp, app, firma, setBanner, scanZiel };
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
            <OnlineStatus live={live} />
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
