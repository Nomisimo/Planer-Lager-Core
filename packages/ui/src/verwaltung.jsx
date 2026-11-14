// Verwaltung (nur Admin, R-03): gemeinsame Seiten für beide Apps. Hier: Übersicht und Netzwerk-Scanner (ARCHITEKTUR §5).
import React, { useState } from "react";
import { Seite, Section, Knopf, Tabelle, Eingabe, Auswahl, Feld, Meldung, Modal, Toggle, Badge, useDaten, useFormular, useBestaetigung } from "./bausteine.jsx";
import { useLager, HID_KEY, hidEinstellungen } from "./huelle.jsx";
import { pruefeHid } from "@lager/domain/scannen.js";
import { STATION_ARTEN } from "@lager/domain/station.js";
import { fehlerText } from "./texte.js";
import { zeitpunktAnzeige } from "@lager/domain/zeit.js";

const BEREICHE = [
  { pfad: "/verwaltung/benutzer", titel: "Benutzer", text: "Konten anlegen, Rolle zuweisen, deaktivieren, Passwort setzen.", icon: "Users" },
  { pfad: "/verwaltung/rollen", titel: "Rollen", text: "Rechte je Bereich: kein Zugriff, ansehen oder ändern.", icon: "UserCog" },
  { pfad: "/verwaltung/einstellungen", titel: "Einstellungen", text: "Firma, Angebote, Etiketten, Zeiterfassung, Ladezonen, Sicherung.", icon: "Settings" },
  { pfad: "/verwaltung/sicherung", titel: "Datensicherung", text: "Jetzt sichern, Liste, Download, Prüfung, Wiederherstellung.", icon: "Database" },
  { pfad: "/verwaltung/sicherheit", titel: "Sicherheit", text: "Sicherheits-Check, Dateirechte, Sicherheitsprotokoll (30 Tage).", icon: "ShieldCheck" },
  { pfad: "/verwaltung/aenderungen", titel: "Änderungsprotokoll", text: "Wer hat wann was an Artikeln, Kunden, Projekten und Rechten geändert.", icon: "History" },
  { pfad: "/verwaltung/system", titel: "System", text: "Ping, Wartung, Neustart des Servers.", icon: "Server" },
  { pfad: "/verwaltung/arbeitsplaetze", titel: "Arbeitsplätze", text: "Lager-Arbeitsplätze und Anzeige-Bildschirme einrichten, Mitarbeiter mit PIN, Sperrzeit, Funktionstest.", icon: "Monitor" },
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

const AP_LEER = { name: "", art: "packen", ladezone_id: "", sperrzeit_minuten: 10, funktionstest: false, aktiv: true };
const MA_LEER = { name: "", pin: "", aktiv: true };
const codeAnzeige = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;

/** FA-25: Arbeitsplätze (inkl. Anzeige-Bildschirme) und Mitarbeiter verwalten. */
export function ArbeitsplatzVerwaltung() {
  const { api } = useLager();
  const l = useDaten(() => api.get("/api/v1/verwaltung/arbeitsplaetze"), []);
  const ma = useDaten(() => api.get("/api/v1/verwaltung/mitarbeiter"), []);
  const zonen = useDaten(() => api.get("/api/v1/verwaltung/zonen"), []);
  const [form, setForm] = useState(null);
  const [mForm, setMForm] = useState(null);
  const [code, setCode] = useState(null);
  const [meldung, setMeldung] = useState(null);
  const [fragen, dialog] = useBestaetigung();
  const f = useFormular(AP_LEER);
  const m = useFormular(MA_LEER);
  const aktion = async (fn, neu) => { setMeldung(null); try { const r = await fn(); setMeldung({ level: r.level || "success", text: r.text }); neu?.(); return r; } catch (e) { setMeldung({ level: "error", text: fehlerText(e) }); return null; } };
  const oeffne = (a) => { f.setWerte(a ? { ...AP_LEER, ...a, ladezone_id: a.ladezone_id ?? "" } : AP_LEER); f.setFehler({}); f.setMeldung(null); setForm(a || {}); };
  const speichern = async () => {
    const r = await f.absenden((w) => (form.id ? api.put(`/api/v1/verwaltung/arbeitsplaetze/${form.id}`, w) : api.post("/api/v1/verwaltung/arbeitsplaetze", w)));
    if (!r) return;
    setForm(null); setMeldung({ level: "success", text: r.text }); l.laden();
    if (r.code) setCode({ name: f.werte.name, code: r.code });
  };
  const oeffneM = (x) => { m.setWerte(x ? { ...MA_LEER, ...x, pin: "" } : MA_LEER); m.setFehler({}); m.setMeldung(null); setMForm(x || {}); };
  const speichernM = async () => {
    const r = await m.absenden((w) => { const d = { ...w }; if (mForm.id && !d.pin && !d.pinLoeschen) delete d.pin; if (d.pinLoeschen) d.pin = ""; delete d.pinLoeschen;
      return mForm.id ? api.put(`/api/v1/verwaltung/mitarbeiter/${mForm.id}`, d) : api.post("/api/v1/verwaltung/mitarbeiter", d); });
    if (r) { setMForm(null); setMeldung({ level: "success", text: r.text }); ma.laden(); }
  };
  const stationUrl = `${(api.basis || "").replace(/\/+$/, "")}/station`;
  return (
    <Seite titel="Arbeitsplätze" untertitel={`Feste Geräte im Lager (Packplatz, Rückgabe) und Anzeige-Bildschirme. Am Gerät ${stationUrl} öffnen und den Einrichtungscode eingeben.`}
      aktionen={<Knopf art="primaer" icon="Plus" onClick={() => oeffne(null)}>Arbeitsplatz anlegen</Knopf>}>
      {dialog}
      {meldung && <Meldung {...meldung} onSchliessen={() => setMeldung(null)} />}
      <Section titel="Arbeitsplätze" icon="Monitor">
        {l.fehler && <Meldung level="error" text={l.fehler} />}
        <Tabelle zeilen={l.daten} leer="Noch keine Arbeitsplätze." spalten={[
          { titel: "Name", wert: (a) => <strong>{a.name}</strong> },
          { titel: "Art", wert: (a) => STATION_ARTEN[a.art] + (a.ladezone ? ` · ${a.ladezone}` : "") + (a.funktionstest ? " · Funktionstest" : "") },
          { titel: "Zustand", wert: (a) => (!a.aktiv ? <Badge farbe="#6b7280" text="#fff">aus</Badge> : !a.eingerichtet ? <Badge farbe="#8a4b00" text="#fff">nicht eingerichtet</Badge>
            : a.art === "anzeige" ? "läuft" : a.gesperrt ? "gesperrt" : `entsperrt: ${a.mitarbeiter}`) },
          { titel: "Letzter Kontakt", wert: (a) => (a.letzter_kontakt ? zeitpunktAnzeige(a.letzter_kontakt) : "noch nie") },
          { titel: "", wert: (a) => <div className="lp-zeile" style={{ justifyContent: "flex-end" }}>
            <Knopf klein icon="Pencil" aria-label={`${a.name} bearbeiten`} onClick={() => oeffne(a)} />
            <Knopf klein icon="Key" onClick={async () => { const r = await aktion(() => api.post(`/api/v1/verwaltung/arbeitsplaetze/${a.id}/einrichtung`, {}), l.laden); if (r) setCode({ name: a.name, code: r.code }); }}>Einrichtungscode</Knopf>
            {a.eingerichtet && <Knopf klein icon="LogOut" onClick={async () => { if (await fragen({ titel: "Gerät abmelden?", text: `„${a.name}“ wird abgemeldet und braucht danach einen neuen Einrichtungscode.`, knopf: "Abmelden" })) aktion(() => api.post(`/api/v1/verwaltung/arbeitsplaetze/${a.id}/trennen`, {}), l.laden); }}>Abmelden</Knopf>}
            <Knopf klein art="geist" icon="Trash2" aria-label={`${a.name} löschen`} onClick={async () => { if (await fragen({ titel: "Arbeitsplatz löschen?", text: `„${a.name}“ und sein Gerätekonto werden gelöscht.`, knopf: "Löschen", gefahr: true })) aktion(() => api.del(`/api/v1/verwaltung/arbeitsplaetze/${a.id}`), l.laden); }} />
          </div> },
        ]} />
      </Section>
      <Section titel="Mitarbeiter" icon="Users" aktionen={<Knopf icon="Plus" onClick={() => oeffneM(null)}>Mitarbeiter anlegen</Knopf>}>
        <p className="lp-meta" style={{ marginTop: 0 }}>Mitarbeiter haben kein Benutzerkonto. Sie entsperren den Arbeitsplatz mit ihrem Namen und optional einer PIN; jede Buchung trägt ihren Namen.</p>
        <Tabelle zeilen={ma.daten} leer="Noch keine Mitarbeiter." spalten={[
          { titel: "Name", wert: (x) => <strong>{x.name}</strong> },
          { titel: "PIN", wert: (x) => (x.pin ? "ja" : "nein") },
          { titel: "Aktiv", wert: (x) => (x.aktiv ? "ja" : "nein") },
          { titel: "", wert: (x) => <div className="lp-zeile" style={{ justifyContent: "flex-end" }}>
            <Knopf klein icon="Pencil" aria-label={`${x.name} bearbeiten`} onClick={() => oeffneM(x)} />
            <Knopf klein art="geist" icon="Trash2" aria-label={`${x.name} löschen`} onClick={async () => { if (await fragen({ titel: "Mitarbeiter löschen?", text: `„${x.name}“ kann sich danach nicht mehr am Arbeitsplatz anmelden. Bisherige Buchungen behalten den Namen.`, knopf: "Löschen", gefahr: true })) aktion(() => api.del(`/api/v1/verwaltung/mitarbeiter/${x.id}`), ma.laden); }} />
          </div> },
        ]} />
      </Section>
      {form && <Modal titel={form.id ? "Arbeitsplatz bearbeiten" : "Arbeitsplatz anlegen"} onSchliessen={() => setForm(null)}
        fuss={<><Knopf onClick={() => setForm(null)}>Abbrechen</Knopf><Knopf art="primaer" icon="Save" onClick={speichern}>Speichern</Knopf></>}>
        {f.meldung && <Meldung {...f.meldung} />}
        <Feld label="Name" pflicht fehler={f.fehler.name}><Eingabe value={f.werte.name} onChange={f.setze("name")} /></Feld>
        <Feld label="Art" fehler={f.fehler.art}><Auswahl value={f.werte.art} onChange={f.setze("art")} optionen={Object.entries(STATION_ARTEN).map(([wert, titel]) => ({ wert, titel }))} /></Feld>
        {f.werte.art === "packen" && <Feld label="Ladezone" pflicht fehler={f.fehler.ladezone_id} hinweis="Die Startseite zeigt das Projekt dieser Zone">
          <Auswahl value={String(f.werte.ladezone_id ?? "")} leer="Ladezone wählen" onChange={f.setze("ladezone_id")} optionen={(zonen.daten || []).map((z) => ({ wert: String(z.id), titel: z.bezeichnung }))} /></Feld>}
        {f.werte.art !== "anzeige" && <Feld label="Sperrzeit (Minuten)" fehler={f.fehler.sperrzeit_minuten} hinweis="Ohne Eingabe sperrt sich der Platz nach dieser Zeit"><Eingabe type="number" min="1" value={f.werte.sperrzeit_minuten} onChange={f.setze("sperrzeit_minuten")} /></Feld>}
        {f.werte.art === "rueckgabe" && <Toggle label="Funktionstest bei jeder Rückgabe abfragen" checked={f.werte.funktionstest} onChange={f.setze("funktionstest")} />}
        <Toggle label="Aktiv" checked={f.werte.aktiv} onChange={f.setze("aktiv")} />
      </Modal>}
      {mForm && <Modal titel={mForm.id ? "Mitarbeiter bearbeiten" : "Mitarbeiter anlegen"} onSchliessen={() => setMForm(null)}
        fuss={<><Knopf onClick={() => setMForm(null)}>Abbrechen</Knopf><Knopf art="primaer" icon="Save" onClick={speichernM}>Speichern</Knopf></>}>
        {m.meldung && <Meldung {...m.meldung} />}
        <Feld label="Name" pflicht fehler={m.fehler.name}><Eingabe value={m.werte.name} onChange={m.setze("name")} /></Feld>
        <Feld label="PIN" fehler={m.fehler.pin} hinweis={mForm.id ? (mForm.pin ? "Leer lassen = PIN bleibt. Neue PIN: 4–8 Ziffern" : "Optional, 4–8 Ziffern") : "Optional, 4–8 Ziffern"}>
          <Eingabe type="password" inputMode="numeric" autoComplete="new-password" value={m.werte.pin} onChange={m.setze("pin")} /></Feld>
        {mForm.id && mForm.pin && <Toggle label="PIN entfernen" checked={!!m.werte.pinLoeschen} onChange={m.setze("pinLoeschen")} />}
        <Toggle label="Aktiv" checked={m.werte.aktiv} onChange={m.setze("aktiv")} />
      </Modal>}
      {code && <Modal titel={`Einrichtungscode für „${code.name}“`} onSchliessen={() => setCode(null)} fuss={<Knopf art="primaer" onClick={() => setCode(null)}>Notiert</Knopf>}>
        <p style={{ marginTop: 0 }}>Öffne am Gerät <code>{stationUrl}</code> im Browser und gib diesen Code ein. Er gilt 24 Stunden und nur einmal.</p>
        <pre className="lp-code" data-testid="einrichtungscode" style={{ fontSize: "2rem", textAlign: "center", userSelect: "all" }}>{codeAnzeige(code.code)}</pre>
      </Modal>}
    </Seite>
  );
}
