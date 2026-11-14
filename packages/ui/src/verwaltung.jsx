// Verwaltung (nur Admin, R-03): gemeinsame Seiten für beide Apps. Hier: Übersicht und Netzwerk-Scanner (ARCHITEKTUR §5).
import React, { useState } from "react";
import { Seite, Section, Knopf, Tabelle, Eingabe, Feld, Meldung, Modal, Toggle, useDaten, useFormular, useBestaetigung } from "./bausteine.jsx";
import { useLager, HID_KEY, hidEinstellungen } from "./huelle.jsx";
import { pruefeHid } from "@lager/domain/scannen.js";
import { fehlerText } from "./texte.js";
import { zeitpunktAnzeige } from "@lager/domain/zeit.js";

const BEREICHE = [
  { pfad: "/verwaltung/scanner", titel: "Scanner", text: "Netzwerk-Scanner anlegen, Token, Zuordnung zum Arbeitsplatz, letzter Kontakt.", icon: "ScanLine" },
];

export function VerwaltungStart() {
  const { navigiere } = useLager();
  return (
    <Seite titel="Verwaltung" untertitel="Nur für Administratoren">
      <div className="lp-raster">
        {BEREICHE.map((b) => (
          <Section key={b.pfad} titel={b.titel} icon={b.icon} aktionen={<Knopf klein onClick={() => navigiere(b.pfad)}>Öffnen</Knopf>}>
            <p style={{ margin: 0 }}>{b.text}</p>
          </Section>
        ))}
      </div>
    </Seite>
  );
}

const LEER = { name: "", kennung: "", ip: "", arbeitsplatz_id: "", aktiv: true };

export function ScannerVerwaltung() {
  const { api } = useLager();
  const l = useDaten(() => api.get("/api/v1/verwaltung/scanner"), []);
  const [form, setForm] = useState(null); // null | {id?}
  const [token, setToken] = useState(null);
  const [meldung, setMeldung] = useState(null);
  const [fragen, dialog] = useBestaetigung();
  const f = useFormular(LEER);
  const oeffne = (s) => { f.setWerte(s ? { ...LEER, ...s, arbeitsplatz_id: s.arbeitsplatz_id ?? "" } : LEER); f.setFehler({}); f.setMeldung(null); setForm(s || {}); };
  const speichern = async () => {
    const r = await f.absenden((w) => (form.id ? api.put(`/api/v1/verwaltung/scanner/${form.id}`, w) : api.post("/api/v1/verwaltung/scanner", w)));
    if (!r) return;
    setForm(null); setMeldung({ level: "success", text: r.text }); l.laden();
    if (r.token) setToken({ name: r.scanner.name, token: r.token });
  };
  return (
    <Seite titel="Scanner" untertitel="Netzwerk-Scanner senden Codes per TCP (eine Zeile je Code, Port 9101) oder per HTTP mit Token an den Server."
      aktionen={<Knopf art="primaer" icon="Plus" onClick={() => oeffne(null)}>Scanner anlegen</Knopf>}>
      {dialog}
      {meldung && <Meldung {...meldung} onSchliessen={() => setMeldung(null)} />}
      <Section>
        {l.fehler && <Meldung level="error" text={l.fehler} />}
        <Tabelle zeilen={l.daten} leer="Noch keine Netzwerk-Scanner. Handscanner (USB/Bluetooth) brauchen keinen Eintrag." spalten={[
          { titel: "Name", wert: (s) => <strong>{s.name}</strong> },
          { titel: "Zuordnung TCP", wert: (s) => [s.kennung && `Kennung ${s.kennung}:`, s.ip && `IP ${s.ip}`].filter(Boolean).join(" · ") || "nur HTTP" },
          { titel: "Arbeitsplatz", wert: (s) => s.arbeitsplatz_id ?? "–" },
          { titel: "Letzter Kontakt", wert: (s) => (s.letzter_kontakt ? `${zeitpunktAnzeige(s.letzter_kontakt)} · ${s.letzter_code}` : "noch nie") },
          { titel: "Aktiv", wert: (s) => (s.aktiv ? "ja" : "nein") },
          { titel: "", wert: (s) => <div className="lp-zeile" style={{ justifyContent: "flex-end" }}>
            <Knopf klein icon="Pencil" aria-label={`${s.name} bearbeiten`} onClick={() => oeffne(s)} />
            <Knopf klein icon="Key" onClick={async () => {
              if (!(await fragen({ titel: "Neuen Token erzeugen?", text: `Der bisherige Token von „${s.name}“ gilt danach nicht mehr.`, knopf: "Neuer Token" }))) return;
              try { const r = await api.post(`/api/v1/verwaltung/scanner/${s.id}/token`, {}); setToken({ name: s.name, token: r.token }); } catch (e) { setMeldung({ level: "error", text: fehlerText(e) }); }
            }}>Token</Knopf>
            <Knopf klein art="geist" icon="Trash2" aria-label={`${s.name} löschen`} onClick={async () => {
              if (!(await fragen({ titel: "Scanner löschen?", text: `„${s.name}“ kann danach keine Codes mehr senden.`, knopf: "Löschen" }))) return;
              try { const r = await api.del(`/api/v1/verwaltung/scanner/${s.id}`); setMeldung({ level: "success", text: r.text }); l.laden(); } catch (e) { setMeldung({ level: "error", text: fehlerText(e) }); }
            }} />
          </div> },
        ]} />
      </Section>
      <HandscannerEinstellungen />
      {form && <Modal titel={form.id ? "Scanner bearbeiten" : "Scanner anlegen"} onSchliessen={() => setForm(null)}
        fuss={<><Knopf onClick={() => setForm(null)}>Abbrechen</Knopf><Knopf art="primaer" icon="Save" onClick={speichern}>Speichern</Knopf></>}>
        {f.meldung && <Meldung {...f.meldung} />}
        <Feld label="Name" pflicht fehler={f.fehler.name}><Eingabe value={f.werte.name} onChange={f.setze("name")} /></Feld>
        <Feld label="Kennung" fehler={f.fehler.kennung} hinweis="Optional: Scanner sendet „KENNUNG:CODE“"><Eingabe value={f.werte.kennung} onChange={f.setze("kennung")} /></Feld>
        <Feld label="IP-Adresse" fehler={f.fehler.ip} hinweis="Optional: Zuordnung über die Absender-IP"><Eingabe value={f.werte.ip} onChange={f.setze("ip")} /></Feld>
        <Feld label="Arbeitsplatz (Nr.)" fehler={f.fehler.arbeitsplatz_id} hinweis="Codes gehen an diesen Arbeitsplatz"><Eingabe type="number" min="1" value={f.werte.arbeitsplatz_id} onChange={f.setze("arbeitsplatz_id")} /></Feld>
        <Toggle label="Aktiv" checked={f.werte.aktiv} onChange={f.setze("aktiv")} />
      </Modal>}
      {token && <Modal titel={`Token für „${token.name}“`} onSchliessen={() => setToken(null)} fuss={<Knopf art="primaer" onClick={() => setToken(null)}>Notiert</Knopf>}>
        <p style={{ marginTop: 0 }}>Trage diesen Token im Scanner bzw. Gateway ein (HTTP-Kopf <code>Authorization: Scanner …</code>). Er wird nur jetzt angezeigt.</p>
        <pre className="lp-code" data-testid="scanner-token" style={{ userSelect: "all", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{token.token}</pre>
      </Modal>}
    </Seite>
  );
}

/** ARCHITEKTUR §5: Handscanner (USB/Bluetooth, Tastatur) je Gerät einstellen – Schwellwert, Mindestlänge, Präfix/Suffix. */
export function HandscannerEinstellungen() {
  const [w, setW] = useState(() => hidEinstellungen());
  const [ok, setOk] = useState(null);
  const setze = (k) => (e) => setW({ ...w, [k]: e.target.value });
  const speichern = () => {
    const x = pruefeHid({ ...w, schwelleMs: Number(w.schwelleMs), minZeichen: Number(w.minZeichen) });
    try { localStorage.setItem(HID_KEY, JSON.stringify(x)); } catch { /* privat */ }
    setW(x); setOk("Handscanner-Einstellungen gespeichert. Sie gelten auf diesem Gerät.");
    window.dispatchEvent(new Event("lager-hid"));
  };
  return (
    <Section titel="Handscanner (dieses Gerät)" icon="ScanLine">
      {ok && <Meldung level="success" text={ok} onSchliessen={() => setOk(null)} />}
      <div className="lp-raster">
        <Feld label="Zeichenabstand (ms)" hinweis="Schneller als dieser Abstand gilt als Scanner (10–200)"><Eingabe type="number" min="10" max="200" value={w.schwelleMs} onChange={setze("schwelleMs")} /></Feld>
        <Feld label="Mindestlänge" hinweis="Kürzere Folgen sind kein Scan (2–20)"><Eingabe type="number" min="2" max="20" value={w.minZeichen} onChange={setze("minZeichen")} /></Feld>
        <Feld label="Präfix" hinweis="Vom Scanner vorangestellt, wird entfernt"><Eingabe value={w.praefix} onChange={setze("praefix")} /></Feld>
        <Feld label="Suffix" hinweis="Vom Scanner angehängt, wird entfernt"><Eingabe value={w.suffix} onChange={setze("suffix")} /></Feld>
      </div>
      <Knopf art="primaer" icon="Save" onClick={speichern}>Handscanner speichern</Knopf>
    </Section>
  );
}
