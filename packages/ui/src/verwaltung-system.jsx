// Verwaltung (nur Admin): Benutzer + Rollen (FA-47), Einstellungen (FA-48), Datensicherung (FA-49), Sicherheit (FA-50), System (FA-51).
import React, { useState } from "react";
import { Seite, Section, Knopf, Tabelle, Eingabe, Auswahl, Feld, Meldung, Modal, Toggle, Badge, Textfeld, GeldEingabe, useDaten, useFormular, useBestaetigung } from "./bausteine.jsx";
import { useLager } from "./huelle.jsx";
import { useOeffne } from "./uebersicht.jsx";
import { ladeHerunter } from "./download.js";
import { fehlerText } from "./texte.js";
import { zeitpunktAnzeige } from "@lager/domain/zeit.js";
import { BEREICHE } from "@lager/domain/rechte.js";
import { EINSTELLUNGEN_STANDARD } from "@lager/domain/einstellungen.js";

export const BEREICH_TITEL = {
  kunden: "Kunden", projekte: "Projekte & Aufgaben", angebote: "Angebote", rechnungen: "Rechnungen", ausgaben: "Ausgaben", auswertung: "Auswertung",
  material: "Material", geraete: "Geräte", packen: "Packen & Rückgabe", zeitrechner: "Kalkulator & Zeitrechner", zeiten: "Planungszeit",
  zonen: "Ladezonen", anzeige: "Anzeige-Bildschirm", verwaltung: "Verwaltung (Administrator)",
};
const STUFEN = [{ wert: "", titel: "kein Zugriff" }, { wert: "r", titel: "ansehen" }, { wert: "w", titel: "ändern" }];
const groesse = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const Ergebnis = ({ m, onZu }) => (m ? <Meldung level={m.level || "success"} text={m.text} onSchliessen={onZu} /> : null);

/* ── FA-47 Benutzer ── */
export function BenutzerVerwaltung() {
  const { api, nutzer } = useLager();
  const l = useDaten(() => api.get("/api/v1/verwaltung/benutzer"), []);
  const rollen = useDaten(() => api.get("/api/v1/verwaltung/rollen"), []);
  const [form, setForm] = useState(null);
  const [m, setM] = useState(null);
  const [fragen, dialog] = useBestaetigung();
  const fertig = (r) => { setForm(null); if (r) { setM(r); l.laden(); } };
  const loeschen = async (b) => {
    if (!(await fragen({ titel: "Benutzer löschen?", text: `${b.benutzername} wird gelöscht. Seine Buchungen behalten den Namen. Besser: deaktivieren.`, knopf: "Löschen" }))) return;
    try { await api.del(`/api/v1/verwaltung/benutzer/${b.id}`); fertig({ level: "success", text: `${b.benutzername} gelöscht.` }); } catch (e) { setM({ level: "error", text: fehlerText(e) }); }
  };
  return (
    <Seite titel="Benutzer" untertitel="Konten anlegen, Rolle zuweisen, deaktivieren, Passwort setzen"
      aktionen={<Knopf art="primaer" icon="Plus" onClick={() => setForm({})}>Neuer Benutzer</Knopf>}>
      <Ergebnis m={m} onZu={() => setM(null)} />
      {l.fehler && <Meldung level="error" text={l.fehler} />}
      <Section>
        <Tabelle zeilen={l.daten} onZeile={(b) => setForm(b)} leer="Noch keine Benutzer." spalten={[
          { titel: "Benutzername", wert: (b) => <strong>{b.benutzername}</strong> }, { titel: "Name", feld: "name" }, { titel: "Rolle", feld: "rolle" },
          { titel: "Status", wert: (b) => (b.aktiv ? <Badge farbe="var(--lp-ok)" text="#fff">aktiv</Badge> : <Badge>deaktiviert</Badge>) },
          { titel: "2FA", wert: (b) => (b.totp_aktiv ? "an" : "–") }, { titel: "Letzte Anmeldung", wert: (b) => zeitpunktAnzeige(b.letzter_login) || "nie" },
          { titel: "", wert: (b) => b.id !== nutzer.id && <Knopf klein art="geist" icon="Trash2" aria-label={`${b.benutzername} löschen`} onClick={(e) => { e.stopPropagation(); loeschen(b); }} /> },
        ]} />
      </Section>
      {form && <BenutzerFormular b={form} rollen={rollen.daten || []} onFertig={fertig} />}
      {dialog}
    </Seite>
  );
}

function BenutzerFormular({ b, rollen, onFertig }) {
  const { api } = useLager();
  const neu = !b.id;
  const f = useFormular({ benutzername: b.benutzername || "", name: b.name || "", email: b.email || "", rolle_id: b.rolle_id ? String(b.rolle_id) : "", aktiv: b.aktiv !== false, passwort: "" });
  const speichern = () => f.absenden(async (w) => {
    const body = { name: w.name, email: w.email, rolle_id: Number(w.rolle_id) || undefined, aktiv: w.aktiv, ...(w.passwort ? { passwort: w.passwort } : {}) };
    if (neu) await api.post("/api/v1/verwaltung/benutzer", { ...body, benutzername: w.benutzername, passwort: w.passwort });
    else await api.put(`/api/v1/verwaltung/benutzer/${b.id}`, body);
    onFertig({ level: "success", text: neu ? `${w.benutzername} angelegt.` : `${b.benutzername} gespeichert.${w.passwort ? " Neues Passwort gilt, alte Anmeldungen sind beendet." : ""}` });
  });
  return (
    <Modal titel={neu ? "Neuer Benutzer" : `Benutzer ${b.benutzername}`} onSchliessen={() => onFertig(null)} fuss={<>
      <Knopf art="geist" onClick={() => onFertig(null)}>Abbrechen</Knopf><Knopf art="primaer" icon="Check" onClick={speichern}>Speichern</Knopf></>}>
      {f.meldung?.level === "error" && <Meldung level="error" text={f.meldung.text} />}
      {neu && <Feld label="Benutzername" pflicht fehler={f.fehler.benutzername}><Eingabe aria-label="Benutzername" autoComplete="off" value={f.werte.benutzername} onChange={f.setze("benutzername")} /></Feld>}
      <Feld label="Name" fehler={f.fehler.name}><Eingabe aria-label="Name" value={f.werte.name} onChange={f.setze("name")} /></Feld>
      <Feld label="E-Mail" fehler={f.fehler.email}><Eingabe aria-label="E-Mail" type="email" value={f.werte.email} onChange={f.setze("email")} /></Feld>
      <Feld label="Rolle" pflicht fehler={f.fehler.rolle_id}><Auswahl aria-label="Rolle" leer="Rolle wählen" value={f.werte.rolle_id} onChange={f.setze("rolle_id")} optionen={rollen.map((r) => ({ wert: String(r.id), titel: r.name }))} /></Feld>
      <Feld label={neu ? "Passwort" : "Neues Passwort"} pflicht={neu} fehler={f.fehler.passwort} hinweis={neu ? "mindestens 10 Zeichen" : "leer lassen = unverändert"}>
        <Eingabe aria-label={neu ? "Passwort" : "Neues Passwort"} type="password" autoComplete="new-password" value={f.werte.passwort} onChange={f.setze("passwort")} /></Feld>
      {!neu && <Toggle label="Aktiv (darf sich anmelden)" checked={f.werte.aktiv} onChange={f.setze("aktiv")} />}
    </Modal>
  );
}

/* ── R-06 Rollen ── */
export function RollenVerwaltung() {
  const { api } = useLager();
  const l = useDaten(() => api.get("/api/v1/verwaltung/rollen"), []);
  const [form, setForm] = useState(null);
  const [m, setM] = useState(null);
  const [fragen, dialog] = useBestaetigung();
  const fertig = (r) => { setForm(null); if (r) { setM(r); l.laden(); } };
  const loeschen = async (r) => {
    if (!(await fragen({ titel: "Rolle löschen?", text: `Die Rolle „${r.name}“ wird gelöscht.`, knopf: "Löschen" }))) return;
    try { await api.del(`/api/v1/verwaltung/rollen/${r.id}`); fertig({ level: "success", text: `Rolle „${r.name}“ gelöscht.` }); } catch (e) { setM({ level: "error", text: fehlerText(e) }); }
  };
  return (
    <Seite titel="Rollen" untertitel="Welche Bereiche eine Rolle sehen oder ändern darf"
      aktionen={<Knopf art="primaer" icon="Plus" onClick={() => setForm({ name: "", rechte: {} })}>Neue Rolle</Knopf>}>
      <Ergebnis m={m} onZu={() => setM(null)} />
      <Section>
        <Tabelle zeilen={l.daten} onZeile={(r) => setForm(r)} spalten={[
          { titel: "Rolle", wert: (r) => <strong>{r.name}</strong> }, { titel: "Benutzer", rechts: true, feld: "benutzer" },
          { titel: "Rechte", wert: (r) => BEREICHE.filter((b) => r.rechte[b]).map((b) => `${BEREICH_TITEL[b]} (${r.rechte[b] === "w" ? "ändern" : "ansehen"})`).join(", ") || "–" },
          { titel: "", wert: (r) => (r.eingebaut ? <Badge>eingebaut</Badge> : <Knopf klein art="geist" icon="Trash2" aria-label={`Rolle ${r.name} löschen`} onClick={(e) => { e.stopPropagation(); loeschen(r); }} />) },
        ]} />
      </Section>
      {form && <RollenFormular r={form} onFertig={fertig} />}
      {dialog}
    </Seite>
  );
}

function RollenFormular({ r, onFertig }) {
  const { api } = useLager();
  const [name, setName] = useState(r.name);
  const [rechte, setRechte] = useState({ ...r.rechte });
  const [fehler, setFehler] = useState(null);
  const speichern = async () => {
    try {
      if (r.id) await api.put(`/api/v1/verwaltung/rollen/${r.id}`, { name, rechte }); else await api.post("/api/v1/verwaltung/rollen", { name, rechte });
      onFertig({ level: "success", text: `Rolle „${name}“ gespeichert. Gilt sofort für alle Benutzer der Rolle.` });
    } catch (e) { setFehler(fehlerText(e)); }
  };
  return (
    <Modal titel={r.id ? `Rolle ${r.name}` : "Neue Rolle"} breite={620} onSchliessen={() => onFertig(null)} fuss={<>
      <Knopf art="geist" onClick={() => onFertig(null)}>Abbrechen</Knopf><Knopf art="primaer" icon="Check" onClick={speichern}>Speichern</Knopf></>}>
      {fehler && <Meldung level="error" text={fehler} />}
      <Feld label="Name" pflicht><Eingabe aria-label="Rollenname" disabled={r.eingebaut} value={name} onChange={(e) => setName(e.target.value)} /></Feld>
      <table className="lp-tabelle"><tbody>{BEREICHE.map((b) => (
        <tr key={b}><td>{BEREICH_TITEL[b]}</td><td style={{ width: 170 }}>
          <Auswahl aria-label={`Recht ${BEREICH_TITEL[b]}`} value={rechte[b] || ""} onChange={(e) => setRechte({ ...rechte, [b]: e.target.value })} optionen={STUFEN} /></td></tr>
      ))}</tbody></table>
    </Modal>
  );
}

/* ── FA-48 Einstellungen ── */
export function EinstellungenSeite() {
  const { api } = useLager();
  const d = useDaten(() => api.get("/api/v1/verwaltung/einstellungen"), []);
  const [w, setW] = useState(null);
  const [m, setM] = useState(null);
  const [fehler, setFehler] = useState({});
  if (d.daten && !w) setW(d.daten);
  if (!w) return <Seite titel="Einstellungen">{d.fehler && <Meldung level="error" text={d.fehler} />}</Seite>;
  const setze = (k) => (e) => { const v = e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e; setW({ ...w, [k]: v }); setFehler({ ...fehler, [k]: undefined }); };
  const setzeFirma = (k) => (e) => setW({ ...w, firma: { ...w.firma, [k]: e.target.value } });
  const speichern = async (felder) => {
    setM(null);
    try { const r = await api.put("/api/v1/verwaltung/einstellungen", Object.fromEntries(felder.map((k) => [k, typeof EINSTELLUNGEN_STANDARD[k] === "number" && typeof w[k] === "string" ? Number(w[k].replace(",", ".")) : w[k]]))); setW(r.werte); setM(r); setFehler({}); }
    catch (e) { setFehler(e.felder || {}); setM({ level: "error", text: fehlerText(e) }); }
  };
  const zahl = (k, label, hinweis) => <Feld key={k} label={label} fehler={fehler[k]} hinweis={hinweis}><Eingabe aria-label={label} inputMode="decimal" value={String(w[k] ?? "")} onChange={setze(k)} /></Feld>;
  const knopfleiste = (felder) => <Knopf art="primaer" icon="Check" onClick={() => speichern(felder)}>Speichern</Knopf>;
  return (
    <Seite titel="Einstellungen" untertitel="Firma, Angebote, Etiketten, Zeiterfassung, Ladezonen, Sicherung">
      <Ergebnis m={m} onZu={() => setM(null)} />
      <Section titel="Firma" icon="Briefcase" aktionen={knopfleiste(["firma"])}>
        <div className="lp-raster">{[["name", "Firmenname"], ["strasse", "Straße"], ["plz", "PLZ"], ["ort", "Ort"], ["telefon", "Telefon"], ["email", "E-Mail"], ["web", "Webseite"], ["ust_id", "USt-IdNr."], ["iban", "IBAN"], ["bic", "BIC"], ["bank", "Bank"]].map(([k, l]) => (
          <Feld key={k} label={l}><Eingabe aria-label={l} value={w.firma[k]} onChange={setzeFirma(k)} /></Feld>))}</div>
      </Section>
      <Section titel="Angebote und Preise" icon="FileText" aktionen={knopfleiste(["angebot_gueltig_tage", "angebot_text_einleitung", "angebot_text_schluss", "folgetag_prozent", "ust_satz", "kleinunternehmer", "tag_stunden_standard", "tag_stunden_erweitert"])}>
        <div className="lp-raster">
          {zahl("angebot_gueltig_tage", "Angebot gültig (Tage)")}
          {zahl("folgetag_prozent", "Folgetag (% vom Tagespreis)")}
          {zahl("ust_satz", "Umsatzsteuer (%)")}
          {zahl("tag_stunden_standard", "Stunden je Tag (Standard)")}
          {zahl("tag_stunden_erweitert", "Stunden je Tag (erweitert)")}
        </div>
        <Toggle label="Kleinunternehmer (§ 19 UStG, keine Umsatzsteuer)" checked={w.kleinunternehmer} onChange={setze("kleinunternehmer")} />
        <Feld label="Einleitungstext" breit><Textfeld aria-label="Einleitungstext" rows={2} value={w.angebot_text_einleitung} onChange={setze("angebot_text_einleitung")} /></Feld>
        <Feld label="Schlusstext" breit><Textfeld aria-label="Schlusstext" rows={2} value={w.angebot_text_schluss} onChange={setze("angebot_text_schluss")} /></Feld>
      </Section>
      <Section titel="Etiketten" icon="Tag" aktionen={knopfleiste(["etikett_format", "etiketten_lieferant", "etiketten_hinweis"])}>
        <div className="lp-raster">
          <Feld label="Format (mm)" fehler={fehler.etikett_format} hinweis="Breite x Höhe, z. B. 62x29"><Eingabe aria-label="Etikettenformat" value={w.etikett_format} onChange={setze("etikett_format")} /></Feld>
          <Feld label="Lieferant"><Eingabe aria-label="Lieferant" value={w.etiketten_lieferant} onChange={setze("etiketten_lieferant")} /></Feld>
          <Feld label="Hinweis für Bestellungen"><Eingabe aria-label="Hinweis für Bestellungen" value={w.etiketten_hinweis} onChange={setze("etiketten_hinweis")} /></Feld>
        </div>
      </Section>
      <Section titel="Zeiterfassung" icon="Timer" aktionen={knopfleiste(["zeit_prozent_planung", "zeit_basis_stundensatz"])}>
        <div className="lp-raster">
          {zahl("zeit_prozent_planung", "Anteil Planung (%)")}
          <Feld label="Ersatz-Stundensatz (€)" fehler={fehler.zeit_basis_stundensatz}><GeldEingabe aria-label="Ersatz-Stundensatz" cent={w.zeit_basis_stundensatz} onCent={setze("zeit_basis_stundensatz")} /></Feld>
        </div>
        <p className="lp-hinweis">Den Posten „Technische Projektleitung“ wählst du im Productionplaner unter Planungszeit.</p>
      </Section>
      <Section titel="Ladezonen" icon="LayoutGrid" aktionen={knopfleiste(["zonen_auto"])}>
        <Toggle label="Projekte beim Anmelden automatisch auf freie Ladezonen verteilen" checked={w.zonen_auto} onChange={setze("zonen_auto")} />
      </Section>
      <Section titel="Sicherung" icon="Database" aktionen={knopfleiste(["backup_behalten", "backup_zweitordner"])}>
        <div className="lp-raster">
          {zahl("backup_behalten", "Sicherungen behalten", "Vorab-Sicherungen bleiben immer")}
          <Feld label="Zweitordner auf dem Server" fehler={fehler.backup_zweitordner} hinweis="z. B. /mnt/nas/lager – ein eingebundenes Laufwerk des Servers">
            <Eingabe aria-label="Zweitordner" value={w.backup_zweitordner} onChange={setze("backup_zweitordner")} /></Feld>
        </div>
      </Section>
    </Seite>
  );
}

/* ── FA-49 Datensicherung ── */
export function SicherungSeite() {
  const { api } = useLager();
  const d = useDaten(() => api.get("/api/v1/verwaltung/sicherungen"), []);
  const [m, setM] = useState(null);
  const [wieder, setWieder] = useState(null);
  const lauf = async (fn) => { setM(null); try { setM(await fn()); } catch (e) { setM({ level: "error", text: fehlerText(e) }); } d.laden(); };
  return (
    <Seite titel="Datensicherung" untertitel="Datenbank und alle Dateien in einer geprüften ZIP-Datei"
      aktionen={<Knopf art="primaer" icon="Save" onClick={() => lauf(() => api.post("/api/v1/verwaltung/sicherungen", {}))}>Jetzt sichern</Knopf>}>
      <Ergebnis m={m} onZu={() => setM(null)} />
      {d.daten && <p className="lp-hinweis" style={{ marginTop: 0 }}>Automatisch beim Start, wenn die letzte Sicherung älter als {d.daten.auto_stunden} Stunden ist. Es bleiben die letzten {d.daten.behalten}. {d.daten.zweitordner ? `Zweitkopie nach ${d.daten.zweitordner}.` : "Kein Zweitort eingestellt (Einstellungen → Sicherung)."}</p>}
      <Section>
        <Tabelle zeilen={d.daten?.liste} schluessel="name" leer="Noch keine Sicherung. Klicke „Jetzt sichern“." spalten={[
          { titel: "Datei", wert: (s) => <strong>{s.name}</strong> }, { titel: "Erstellt", wert: (s) => zeitpunktAnzeige(s.erstellt) },
          { titel: "Größe", rechts: true, wert: (s) => groesse(s.groesse) }, { titel: "Art", wert: (s) => (s.vorab ? <Badge>vor Wiederherstellung</Badge> : s.name.length > 30 ? "–" : "Sicherung") },
          { titel: "", wert: (s) => <span className="lp-zeile" style={{ justifyContent: "flex-end" }}>
            <Knopf klein icon="Download" aria-label={`${s.name} herunterladen`} onClick={() => ladeHerunter(api, `/api/v1/verwaltung/sicherungen/${s.name}`, s.name).catch((e) => setM({ level: "error", text: fehlerText(e) }))} />
            <Knopf klein icon="ShieldCheck" aria-label={`${s.name} prüfen`} onClick={() => lauf(() => api.post(`/api/v1/verwaltung/sicherungen/${s.name}/pruefen`, {}))} />
            <Knopf klein art="gefahr" icon="Undo2" aria-label={`${s.name} wiederherstellen`} onClick={() => setWieder(s)} /></span> },
        ]} />
      </Section>
      {wieder && <Wiederherstellen s={wieder} onFertig={(r) => { setWieder(null); if (r) { setM(r); d.laden(); } }} />}
    </Seite>
  );
}

function Wiederherstellen({ s, onFertig }) {
  const { api } = useLager();
  const [text, setText] = useState("");
  const [fehler, setFehler] = useState(null);
  const los = async () => {
    try { const r = await api.post(`/api/v1/verwaltung/sicherungen/${s.name}/wiederherstellen`, { bestaetigung: text }); onFertig(r); setTimeout(() => location.reload(), 2500); }
    catch (e) { setFehler(fehlerText(e)); }
  };
  return (
    <Modal titel="Sicherung wiederherstellen?" onSchliessen={() => onFertig(null)} fuss={<>
      <Knopf art="geist" onClick={() => onFertig(null)}>Abbrechen</Knopf>
      <Knopf art="gefahr" icon="Undo2" disabled={text !== "WIEDERHERSTELLEN"} onClick={los}>Wiederherstellen</Knopf></>}>
      {fehler && <Meldung level="error" text={fehler} />}
      <p style={{ marginTop: 0 }}>Alle Daten und Dateien werden durch den Stand aus <strong>{s.name}</strong> ersetzt. Vorher wird der jetzige Stand automatisch gesichert. Danach müssen sich alle neu anmelden.</p>
      <Feld label="Zur Bestätigung WIEDERHERSTELLEN eintippen"><Eingabe aria-label="Bestätigung" value={text} onChange={(e) => setText(e.target.value)} /></Feld>
    </Modal>
  );
}

/* ── FA-50 Sicherheit ── */
const LEVEL = { ok: ["var(--lp-ok)", "in Ordnung"], warning: ["var(--lp-warn)", "Hinweis"], error: ["var(--lp-err)", "Problem"] };
export function SicherheitSeite() {
  const { api } = useLager();
  const c = useDaten(() => api.get("/api/v1/verwaltung/sicherheit/check"), []);
  const [f, setF] = useState({ art: "", benutzer: "" });
  const p = useDaten(() => api.get(`/api/v1/verwaltung/sicherheit/protokoll?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`), [f.art, f.benutzer]);
  const [m, setM] = useState(null);
  return (
    <Seite titel="Sicherheit" untertitel="Check und Sicherheitsprotokoll der letzten 30 Tage">
      <Ergebnis m={m} onZu={() => setM(null)} />
      <Section titel="Check" icon="ShieldCheck" aktionen={<Knopf icon="Lock" onClick={async () => { try { setM(await api.post("/api/v1/verwaltung/sicherheit/absichern", {})); } catch (e) { setM({ level: "error", text: fehlerText(e) }); } c.laden(); }}>Dateirechte absichern</Knopf>}>
        <Tabelle zeilen={c.daten} spalten={[
          { titel: "Prüfung", wert: (z) => <strong>{z.titel}</strong> },
          { titel: "Ergebnis", wert: (z) => <span data-check={z.id} data-level={z.level}><Badge farbe={LEVEL[z.level][0]} text="#fff">{LEVEL[z.level][1]}</Badge></span> },
          { titel: "Details", feld: "text" },
        ]} />
      </Section>
      <Loeschfristen />
      <Section titel="Sicherheitsprotokoll" icon="History">
        <div className="lp-zeile" style={{ marginBottom: 12 }}>
          <div style={{ width: 200 }}><Auswahl aria-label="Art" leer="Alle Arten" value={f.art} onChange={(e) => setF({ ...f, art: e.target.value })}
            optionen={[["login", "Anmeldung"], ["logout", "Abmeldung"], ["fehlversuch", "Fehlversuch"], ["sperre", "Sperre"], ["verweigert", "verweigert"], ["aktion", "Verwaltung"]].map(([wert, titel]) => ({ wert, titel }))} /></div>
          <div style={{ width: 200 }}><Eingabe aria-label="Benutzer filtern" placeholder="Benutzer" value={f.benutzer} onChange={(e) => setF({ ...f, benutzer: e.target.value })} /></div>
        </div>
        <Tabelle zeilen={p.daten} leer="Keine Einträge." spalten={[
          { titel: "Zeit", wert: (e) => zeitpunktAnzeige(e.zeit) }, { titel: "Art", feld: "art" }, { titel: "Benutzer", feld: "benutzer" }, { titel: "Adresse", feld: "ip" }, { titel: "Text", feld: "text" },
        ]} />
      </Section>
    </Seite>
  );
}

/** NFA-03: Kunden, deren Aufbewahrungsfristen abgelaufen sind (Anonymisieren im Kunden im Productionplaner). */
function Loeschfristen() {
  const { api } = useLager();
  const oeffne = useOeffne();
  const d = useDaten(() => api.get("/api/v1/verwaltung/loeschfristen"), []);
  return (
    <Section titel="Löschfristen Kundendaten" icon="EyeOff">
      {d.daten?.length ? <ul className="lp-liste" data-testid="loeschfristen">{d.daten.map((k) => (
        <li key={k.id}><a href={`#/kunden/${k.id}`} onClick={(e) => { e.preventDefault(); oeffne("p", `/kunden/${k.id}`); }}>{k.firma || k.name}</a> · {k.text}</li>))}</ul>
        : <p className="lp-hinweis" style={{ margin: 0 }}>Kein Kunde, dessen Aufbewahrungsfristen abgelaufen sind.</p>}
    </Section>
  );
}

/* ── FA-51 System ── */
export function SystemSeite() {
  const { api } = useLager();
  const d = useDaten(() => api.get("/api/v1/verwaltung/system"), []);
  const [m, setM] = useState(null);
  const [text, setText] = useState(null);
  const [ping, setPing] = useState(null);
  const [fragen, dialog] = useBestaetigung();
  const w = d.daten?.wartung;
  if (w && text === null) setText(w.text || "");
  const lauf = async (fn) => { setM(null); try { setM(await fn()); } catch (e) { setM({ level: "error", text: fehlerText(e) }); } d.laden(); };
  return (
    <Seite titel="System" untertitel="Erreichbarkeit, Wartung, Neustart">
      <Ergebnis m={m} onZu={() => setM(null)} />
      <Section titel="Server" icon="Server" aktionen={<Knopf icon="RefreshCw" onClick={async () => { const t = performance.now(); try { await api.get("/api/v1/ping"); setPing(Math.round(performance.now() - t)); } catch (e) { setM({ level: "error", text: fehlerText(e) }); } }}>Ping</Knopf>}>
        {d.daten && <p style={{ margin: 0 }}>Läuft seit {zeitpunktAnzeige(d.daten.laeuft_seit)} · Node {d.daten.node}{d.daten.clients != null ? ` · ${d.daten.clients} verbundene Apps` : ""}{ping != null && <span data-testid="ping"> · Antwort in {ping} ms</span>}</p>}
      </Section>
      <Section titel="Wartung" icon="Wrench" aktionen={<Knopf art={w?.aktiv ? "primaer" : "normal"} onClick={() => lauf(() => api.put("/api/v1/verwaltung/system/wartung", { aktiv: !w?.aktiv, text }))}>{w?.aktiv ? "Wartung beenden" : "Wartung starten"}</Knopf>}>
        <p className="lp-hinweis" style={{ marginTop: 0 }}>{w?.aktiv ? "Wartung ist an: Nur Administratoren können arbeiten." : "Während der Wartung sehen alle anderen nur die Meldung unten."}</p>
        <Feld label="Meldung für alle" breit><Eingabe aria-label="Wartungsmeldung" placeholder="z. B. Update bis 14 Uhr." value={text || ""} onChange={(e) => setText(e.target.value)} /></Feld>
      </Section>
      <Section titel="Neustart" icon="RotateCw" aktionen={<Knopf art="gefahr" icon="RotateCw" onClick={async () => { if (await fragen({ titel: "Server neu starten?", text: "Alle Apps verlieren kurz die Verbindung und verbinden sich danach selbst wieder.", knopf: "Neu starten" })) lauf(() => api.post("/api/v1/verwaltung/system/neustart", {})); }}>Server neu starten</Knopf>}>
        <p className="lp-hinweis" style={{ margin: 0 }}>Startet den Server-Dienst neu (z. B. nach einer Störung).</p>
      </Section>
      {dialog}
    </Seite>
  );
}
