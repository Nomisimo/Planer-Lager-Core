// Gemeinsame React-Bausteine (UI-STIL, UI-2, UI-4, UI-7). Beide Apps und station-web nutzen nur diese.
import { badgeSchrift } from "./themen.js";
import React, { useEffect, useRef, useState, useId, useCallback } from "react";
import { ICONS } from "./icons.js";
import { useLager } from "./kontext.js";
import { plattform } from "./plattform.js";
import { RUECKMELDUNG, stufeVon, fehlerText } from "./texte.js";
import { einmalig, fassungsUnterschiede, uebernimmFassung, feldTitel } from "./formular.js";
import { euro, centAusText } from "@lager/domain/geld.js";

export const Icon = ({ name, size = 16, ...p }) => { const C = ICONS[name] || ICONS.Circle; return <C size={size} aria-hidden="true" {...p} />; };

/** `tour` = Anker für die Einführungs-Tour (data-tour, ARCHITEKTUR §11). */
export const Section = ({ titel, icon, aktionen, children, tour, ...p }) => (
  <section className="lp-section" data-tour={tour} {...p}>
    {(titel || aktionen) && <div className="lp-titelzeile" style={{ marginBottom: 12 }}>
      {titel && <h2 className="lp-h2" style={{ margin: 0 }}>{icon && <Icon name={icon} />}{titel}</h2>}
      {aktionen && <div className="lp-aktionen">{aktionen}</div>}
    </div>}
    {children}
  </section>
);

export const Seite = ({ titel, untertitel, aktionen, children, tour }) => (
  <div className="lp-main" data-tour={tour}>
    <div className="lp-titelzeile">
      <div><h1 className="lp-h1">{titel}</h1>{untertitel && <div className="lp-meta">{untertitel}</div>}</div>
      {aktionen && <div className="lp-aktionen">{aktionen}</div>}
    </div>
    {children}
  </div>
);

/** Knopf. art: primaer | normal | geist | gefahr. onClick darf async sein → sperrt bis Antwort (UI-4). */
export function Knopf({ art = "normal", icon, klein, onClick, disabled, children, tour, ...p }) {
  const [laeuft, setLaeuft] = useState(false);
  // Immer den aktuellen Handler aufrufen (auch wenn der Klick vor dem nächsten Effekt kommt), einmalig gegen Doppelklick
  const aktuell = useRef(onClick);
  aktuell.current = onClick;
  const ref = useRef(null);
  if (!ref.current) ref.current = einmalig(async (e) => { const r = aktuell.current?.(e); if (r && typeof r.then === "function") { setLaeuft(true); try { await r; } finally { setLaeuft(false); } } });
  const cls = ["lp-btn", art === "primaer" && "lp-btn-primaer", art === "geist" && "lp-btn-geist", art === "gefahr" && "lp-btn-gefahr", klein && "lp-btn-klein"].filter(Boolean).join(" ");
  return (
    <button type={p.type || "button"} className={cls} disabled={disabled || laeuft} aria-busy={laeuft || undefined} data-tour={tour} onClick={(e) => ref.current(e)} {...p}>
      {icon && <Icon name={laeuft ? "Loader2" : icon} size={klein ? 14 : 16} />}{children}
    </button>
  );
}

/** Formularfeld mit Beschriftung, Pflichtmarke und Fehler direkt am Feld (UI-4, UI-7). */
export function Feld({ label, pflicht, fehler, hinweis, children, breit }) {
  const id = useId();
  const kind = React.isValidElement(children) ? React.cloneElement(children, { id: children.props.id || id, "aria-invalid": fehler ? "true" : undefined, "aria-describedby": fehler ? id + "-f" : undefined, required: pflicht || undefined }) : children;
  return (
    <div className="lp-feld" style={breit ? { gridColumn: "1/-1" } : undefined}>
      {label && <label htmlFor={children?.props?.id || id}>{label}{pflicht && <span className="lp-pflicht" aria-label="Pflichtfeld">*</span>}</label>}
      {kind}
      {fehler && <div className="lp-feldfehler" id={id + "-f"} role="alert">{fehler}</div>}
      {hinweis && !fehler && <div className="lp-hinweis">{hinweis}</div>}
    </div>
  );
}
export const Eingabe = React.forwardRef((p, ref) => <input ref={ref} className="lp-input" {...p} value={p.value ?? ""} />);
export const Auswahl = ({ optionen, leer, ...p }) => (
  <select className="lp-select" {...p} value={p.value ?? ""}>
    {leer !== undefined && <option value="">{leer}</option>}
    {optionen.map((o) => typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.wert} value={o.wert}>{o.titel}</option>)}
  </select>
);
export const Textfeld = (p) => <textarea className="lp-textarea" {...p} value={p.value ?? ""} />;

export const Toggle = ({ checked, onChange, label, ...p }) => (
  <label className="lp-toggle"><input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} {...p} />{label}</label>
);

/** UI-2: Rückmeldung mit Farbe + Symbol + Text. level: success | warning | error | info */
export function Meldung({ level = "info", text, children, onSchliessen }) {
  const s = RUECKMELDUNG[stufeVon(level)] || RUECKMELDUNG.info;
  return (
    <div className="lp-meldung" role={level === "error" ? "alert" : "status"} style={{ borderColor: s.farbe }} data-level={level}>
      <Icon name={s.icon} size={18} style={{ color: s.farbe, flex: "none", marginTop: 1 }} />
      <span className="lp-sr">{s.wort}: </span>
      <div style={{ flex: 1 }}>{text}{children}</div>
      {onSchliessen && <button className="lp-btn lp-btn-geist lp-btn-klein" onClick={onSchliessen} aria-label="Meldung schließen"><Icon name="X" size={14} /></button>}
    </div>
  );
}

export function Modal({ titel, onSchliessen, children, fuss, breite = 560 }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onSchliessen?.(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onSchliessen]);
  return (
    <div className="lp-modal-hg" onMouseDown={(e) => { if (e.target === e.currentTarget) onSchliessen?.(); }}>
      <div className="lp-modal" role="dialog" aria-modal="true" aria-label={titel} style={{ width: breite }}>
        <div className="lp-modal-kopf"><h2>{titel}</h2>{onSchliessen && <button className="lp-btn lp-btn-geist lp-btn-klein" style={{ marginLeft: "auto" }} onClick={onSchliessen} aria-label="Schließen"><Icon name="X" /></button>}</div>
        <div className="lp-modal-inhalt">{children}</div>
        {fuss && <div className="lp-modal-fuss">{fuss}</div>}
      </div>
    </div>
  );
}

/** UI-4: Sicherheitsabfrage. */
export function Bestaetigung({ titel, text, knopf = "Ja, ausführen", gefahr = true, onJa, onNein }) {
  return (
    <Modal titel={titel} onSchliessen={onNein} breite={460}
      fuss={<><Knopf art="geist" onClick={onNein}>Abbrechen</Knopf><Knopf art={gefahr ? "gefahr" : "primaer"} onClick={onJa} autoFocus>{knopf}</Knopf></>}>
      <p style={{ margin: 0 }}>{text}</p>
    </Modal>
  );
}

/** Hook: Bestätigung anfordern → Promise<boolean>. */
export function useBestaetigung() {
  const [frage, setFrage] = useState(null);
  const fragen = useCallback((f) => new Promise((ok) => setFrage({ ...f, ok })), []);
  const dialog = frage && <Bestaetigung {...frage} onJa={() => { frage.ok(true); setFrage(null); }} onNein={() => { frage.ok(false); setFrage(null); }} />;
  return [fragen, dialog];
}

export const Leerzustand = ({ text, icon = "Inbox", children }) => (
  <div className="lp-leer"><Icon name={icon} size={28} /><div style={{ marginTop: 8 }}>{text}</div>{children}</div>
);
export const Chip = ({ children, farbe, ...p }) => <span className="lp-chip" style={farbe ? { borderColor: farbe } : undefined} {...p}>{children}</span>;
export const Badge = ({ children, farbe = "var(--lp-btn)", text = "var(--lp-text)" }) => <span className="lp-badge" style={{ background: farbe, color: badgeSchrift(farbe, text) }}>{children}</span>;
export const StatusPunkt = ({ farbe, titel }) => <span className="lp-punkt" style={{ background: farbe }} title={titel} aria-label={titel} role="img" />;

/** Tabelle: spalten [{titel, feld | wert(row), breite, rechts}] */
export function Tabelle({ spalten, zeilen, onZeile, leer = "Keine Einträge.", schluessel = "id" }) {
  if (!zeilen?.length) return <Leerzustand text={leer} />;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="lp-tabelle">
        <thead><tr>{spalten.map((s) => <th key={s.titel} style={{ width: s.breite, textAlign: s.rechts ? "right" : undefined }}>{s.titel}</th>)}</tr></thead>
        <tbody>{zeilen.map((z, i) => (
          <tr key={z[schluessel] ?? i} className={onZeile ? "lp-klickbar" : undefined} onClick={onZeile ? () => onZeile(z) : undefined}
            tabIndex={onZeile ? 0 : undefined} onKeyDown={onZeile ? (e) => { if (e.key === "Enter") onZeile(z); } : undefined}>
            {spalten.map((s) => <td key={s.titel} style={{ textAlign: s.rechts ? "right" : undefined }}>{s.wert ? s.wert(z, i) : z[s.feld]}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function Tabs({ tabs, aktiv, onWechsel }) {
  return (
    <div className="lp-tabs" role="tablist">
      {tabs.map((t) => <button key={t.id} role="tab" className="lp-tab" aria-selected={aktiv === t.id} onClick={() => onWechsel(t.id)}>{t.titel}</button>)}
    </div>
  );
}

/** Hook: lädt Daten (async fn), mit Neu-Laden; Fehler als UI-5-Text. */
export function useDaten(fn, abh = []) {
  const [z, setZ] = useState({ daten: null, fehler: null, laedt: true });
  const lauf = useRef(0);
  const laden = useCallback(async () => {
    const n = ++lauf.current;
    setZ((a) => ({ ...a, laedt: true }));
    try { const d = await fn(); if (n === lauf.current) setZ({ daten: d, fehler: null, laedt: false }); }
    catch (e) { if (n === lauf.current) setZ((a) => ({ ...a, fehler: fehlerText(e), laedt: false })); }
  }, abh);
  useEffect(() => { laden(); }, [laden]);
  return { ...z, laden };
}

const zeigeWert = (v) => (v === true ? "ja" : v === false ? "nein" : v == null || v === "" ? "–" : String(v));

/** GLEICH: Vergleich „Deine Werte | Aktuelle Werte“ nach 409, mit „Neue Fassung laden“ und „Meine Eingaben behalten“. */
export function FassungsKonflikt({ werte, aktuell, titel = {}, onLaden, onBehalten }) {
  const u = fassungsUnterschiede(werte, aktuell);
  return (
    <div data-testid="fassung-konflikt" style={{ marginTop: 8 }}>
      {u.length > 0 && <table className="lp-tabelle" style={{ marginBottom: 8 }}>
        <thead><tr><th>Feld</th><th>Deine Werte</th><th>Aktuelle Werte</th></tr></thead>
        <tbody>{u.map((x) => <tr key={x.feld}><td>{titel[x.feld] || feldTitel(x.feld)}</td><td>{zeigeWert(x.deine)}</td><td>{zeigeWert(x.aktuell)}</td></tr>)}</tbody>
      </table>}
      <div className="lp-zeile">
        <Knopf art="primaer" icon="RefreshCw" onClick={onLaden}>Neue Fassung laden</Knopf>
        <Knopf onClick={onBehalten}>Meine Eingaben behalten</Knopf>
      </div>
    </div>
  );
}

/** GLEICH: Band, wenn jemand anderes den offenen Datensatz geändert hat („[Neu laden] [Meine Eingaben behalten]“). */
export function AenderungsBand({ von, onNeuLaden, onBehalten }) {
  return (
    <div className="lp-meldung" role="status" data-testid="aenderungs-band" data-level="warning" style={{ borderColor: RUECKMELDUNG.warning?.farbe }}>
      <Icon name="RefreshCw" size={18} style={{ flex: "none", marginTop: 1 }} />
      <div style={{ flex: 1 }}>{von ? `${von} hat das gerade geändert.` : "Das wurde gerade woanders geändert."} Lade die neue Fassung oder behalte deine Eingaben.
        <div className="lp-zeile" style={{ marginTop: 8 }}><Knopf klein art="primaer" icon="RefreshCw" onClick={onNeuLaden}>Neu laden</Knopf><Knopf klein onClick={onBehalten}>Meine Eingaben behalten</Knopf></div>
      </div>
    </div>
  );
}

/**
 * Formular-Hook: Werte, Feldfehler aus ApiFehler.felder, Speichern einmalig.
 * GLEICH: 409 zeigt den Vergleich mit der aktuellen Fassung, 404 „gelöscht“ führt zurück zur Liste.
 * live: { typ: "projekt", id } zeigt das Änderungsband, wenn der Datensatz woanders gespeichert wird.
 * @param {any} start @param {{ live?: { typ: string, id: number|string }, titel?: Record<string,string>, zurueck?: () => void }} [opt]
 */
export function useFormular(start, opt = {}) {
  const [werte, setWerte] = useState(start);
  const [fehler, setFehler] = useState({});
  const [meldung, setMeldung] = useState(null);
  const [band, setBand] = useState(null);
  const werteRef = useRef(werte);
  werteRef.current = werte;
  const eigen = useRef(0);
  const geaendert = useRef(new Set());
  const setze = (k) => (v) => { geaendert.current.add(k); setWerte((w) => ({ ...w, [k]: v?.target ? (v.target.type === "checkbox" ? v.target.checked : v.target.value) : v })); setFehler((f) => ({ ...f, [k]: undefined })); };
  const lager = useLager();
  const live = opt.live;
  useEffect(() => {
    if (!live?.typ || !live.id || !lager?.live) return;
    return lager.live.on(live.typ, (m) => {
      if (Number(m.id) !== Number(live.id)) return;
      if (m.geloescht) { setBand({ geloescht: true, von: m.von }); return; }
      const v = werteRef.current?.version;
      // Nur echte neue Fassungen: eigene Speicherungen und Ereignisse ohne Fassung (z. B. Datei hochgeladen) lösen kein Band aus.
      if (m.version == null || v == null || Number(m.version) <= Number(v) || Date.now() - eigen.current < 1500) return;
      setBand({ von: m.von, version: m.version });
    });
  }, [lager?.live, live?.typ, live?.id]);
  const neuLaden = async () => {
    setBand(null);
    if (!opt.laden) return;
    const a = await opt.laden();
    if (a) { setWerte((w) => uebernimmFassung(w, a)); setMeldung({ level: "info", text: "Neue Fassung geladen." }); }
  };
  const absenden = async (fn) => {
    setMeldung(null);
    eigen.current = Date.now();
    try {
      const r = await fn(werte); setFehler({}); setBand(null);
      const nv = r && typeof r === "object" ? (r.version ?? Object.values(r).find((x) => x && typeof x === "object" && !Array.isArray(x) && x.version != null)?.version) : undefined;
      if (nv != null) setWerte((w) => (w && typeof w === "object" ? { ...w, version: nv } : w));
      if (r?.text) setMeldung({ level: r.level || "success", text: r.text });
      return r;
    } catch (e) {
      setFehler(e.felder || {});
      const d = e.daten || {};
      if (e.status === 409 && d.aktuell) {
        const aktuell = d.aktuell;
        setMeldung({ level: "error", text: fehlerText(e), children: <FassungsKonflikt werte={werteRef.current} aktuell={aktuell} titel={opt.titel}
          onLaden={() => { setWerte((w) => uebernimmFassung(w, aktuell)); setMeldung({ level: "info", text: "Neue Fassung geladen. Übernimm deine Änderungen und speichere erneut." }); }}
          onBehalten={() => { setWerte((w) => ({ ...w, version: aktuell.version })); setMeldung({ level: "warning", text: "Deine Eingaben bleiben stehen. Wenn du jetzt speicherst, ersetzen sie die neue Fassung." }); }} /> });
      } else if (e.status === 404 && d.geloescht) {
        const zur = opt.zurueck || (() => history.back());
        setMeldung({ level: "error", text: fehlerText(e), children: <div className="lp-zeile" style={{ marginTop: 8 }}><Knopf icon="ArrowLeft" onClick={zur}>Zurück zur Liste</Knopf></div> });
      } else setMeldung({ level: "error", text: fehlerText(e) });
      return null;
    }
  };
  const bandElement = band ? (band.geloescht
    ? <Meldung level="error" text={`${band.von ? `${band.von} hat` : "Jemand hat"} das gerade gelöscht.`}><div className="lp-zeile" style={{ marginTop: 8 }}><Knopf icon="ArrowLeft" onClick={opt.zurueck || (() => history.back())}>Zurück zur Liste</Knopf></div></Meldung>
    : <AenderungsBand von={band.von} onNeuLaden={neuLaden} onBehalten={() => setBand(null)} />) : null;
  // Erstes Laden eines Datensatzes: Felder, die schon bearbeitet wurden, bleiben stehen (Laden kann später ankommen als die Eingabe)
  const geladen = (daten) => setWerte((w) => {
    const neu = { ...daten };
    for (const k of geaendert.current) if (w && k in w) neu[k] = w[k];
    return neu;
  });
  return { werte, setWerte, geladen, setze, fehler, setFehler, meldung, setMeldung, absenden, band: bandElement };
}

/** Geld-Eingabe: zeigt Euro, liefert Cent (Integer) oder null. */
export function GeldEingabe({ cent, onCent, ...p }) {
  const [text, setText] = useState(cent == null ? "" : euroOhne(cent));
  useEffect(() => { setText((t) => (centAusText(t) === cent ? t : cent == null ? "" : euroOhne(cent))); }, [cent]);
  return <input className="lp-input" inputMode="decimal" {...p} value={text}
    onChange={(e) => { setText(e.target.value); const c = centAusText(e.target.value); onCent(e.target.value.trim() === "" ? null : c ?? NaN); }}
    onBlur={() => { const c = centAusText(text); if (c != null) setText(euroOhne(c)); }} />;
}
const euroOhne = (c) => euro(c, { symbol: false });

const APP_NAME = { m: "Materialplaner", p: "Productionplaner" };
/** GLEICH-06: Präsenz-Chips „wer ist gerade hier“ (WebSocket-Hub, verfällt nach 30 s ohne Erneuerung). ort z. B. "projekt:5". */
export function Praesenz({ ort }) {
  const lager = useLager();
  const live = lager?.live;
  const [wer, setWer] = useState([]);
  useEffect(() => {
    if (!live || !ort) return;
    const web = plattform.istWeb;
    live.praesenz?.({ ort, app: `${lager.app || ""}${web ? "-web" : ""}` });
    const ab = live.on("praesenz", (m) => { if (m.ort === ort) setWer(m.wer || []); });
    return () => { ab(); live.praesenz?.(null); setWer([]); };
  }, [live, ort]);
  if (!wer.length) return null;
  return (
    <span className="lp-zeile" data-testid="praesenz" aria-label="Gerade hier" style={{ gap: 6 }}>
      {wer.map((w, i) => {
        const [app, web] = String(w.app || "").split("-");
        const wo = `${APP_NAME[app] || "App"}${web ? " im Browser" : ""}`;
        return <span key={i} className="lp-chip" data-testid="praesenz-chip" title={`${w.ich ? "Du" : w.name} · ${wo}`}><Icon name="Eye" size={14} /> {w.ich ? `Du (${wo})` : w.name}</span>;
      })}
    </span>
  );
}
