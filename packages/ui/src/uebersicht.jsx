// Startseite (FA-35) und Suche (FA-36), gemeinsam für beide Apps. Treffer der anderen App öffnen per Deep-Link dort.
import React, { useEffect, useState } from "react";
import { Seite, Section, Knopf, Eingabe, Meldung, Leerzustand, Icon, Badge, useDaten } from "./bausteine.jsx";
import { useLager, useLive } from "./huelle.jsx";
import { datumAnzeige } from "@lager/domain/zeit.js";

/** Öffnet einen Pfad in der zuständigen App (gleiche App: navigieren, sonst Deep-Link). */
export function useOeffne() {
  const { app, navigiere, oeffneAndereApp } = useLager();
  return (zielApp, pfad) => (zielApp === app || zielApp === "beide" ? navigiere(pfad) : oeffneAndereApp(pfad));
}

/** FA-35 Startseite. `schnell`: [{titel, icon, app, pfad}] Schnellzugriff der App. */
export function Startseite({ untertitel, schnell = [] }) {
  const { api, app, nutzer } = useLager();
  const oeffne = useOeffne();
  const d = useDaten(() => api.get("/api/v1/start"), []);
  useLive(["projekt", "geraet", "angebot", "aufgabe", "scan"], () => d.laden());
  const r = d.daten;
  // eigene App zuerst
  const kacheln = r ? [...r.kacheln].sort((a, b) => (a.app === app ? 0 : 1) - (b.app === app ? 0 : 1)) : [];
  return (
    <Seite titel="Übersicht" untertitel={untertitel}>
      <p className="lp-hinweis" style={{ marginTop: 0 }}>Hallo {nutzer.name || nutzer.benutzername}.</p>
      {d.fehler && <Meldung level="error" text={d.fehler} />}
      {schnell.length > 0 && <Section titel="Schnellzugriff" icon="Star">
        <div className="lp-zeile">{schnell.map((s) => <Knopf key={s.pfad} icon={s.icon} onClick={() => oeffne(s.app || app, s.pfad)}>{s.titel}</Knopf>)}</div>
      </Section>}
      {kacheln.length > 0 && <div className="lp-raster" data-testid="kacheln" style={{ marginBottom: 16 }}>
        {kacheln.map((k) => (
          <button key={k.id} type="button" className="lp-section lp-kachel" data-kachel={k.id} onClick={() => oeffne(k.app, k.pfad)}
            style={{ padding: 14, textAlign: "left", cursor: "pointer", borderColor: k.warn ? "var(--lp-warn)" : undefined }}>
            <div className="lp-label"><Icon name={k.icon} size={14} /> {k.titel}</div>
            <div style={{ fontSize: "1.6em", fontWeight: 700, marginTop: 4 }}>{k.wert}</div>
            {k.zusatz && <div className="lp-hinweis">{k.zusatz}</div>}
          </button>
        ))}
      </div>}
      {r?.woche && <Section titel="Diese Woche" icon="CalendarDays">
        <div className="lp-raster">
          <div data-testid="woche-starts">
            <div className="lp-label">Starts (nächste 7 Tage)</div>
            {r.woche.starts.length ? <ul className="lp-liste">{r.woche.starts.map((p) => (
              <li key={p.id}><a href={`#/projekte/${p.id}`} onClick={(e) => { e.preventDefault(); oeffne("p", `/projekte/${p.id}`); }}>{p.nummer} {p.name}</a> · {datumAnzeige(p.beginn)}
                {app === "m" && <> · <a href={`#/projekte/${p.id}/packen`}>packen</a></>}</li>))}</ul>
              : <p className="lp-hinweis">Keine Starts in den nächsten 7 Tagen.</p>}
          </div>
          <div data-testid="woche-rueckgaben">
            <div className="lp-label">Fällige Rückgaben</div>
            {r.woche.rueckgaben.length ? <ul className="lp-liste">{r.woche.rueckgaben.map((p) => (
              <li key={p.id}><a href={`#/projekte/${p.id}/rueckgabe`} onClick={(e) => { e.preventDefault(); oeffne("m", `/projekte/${p.id}/rueckgabe`); }}>{p.nummer} {p.name}</a> · bis {datumAnzeige(p.ende)} · {p.draussen} Geräte draußen</li>))}</ul>
              : <p className="lp-hinweis">Keine Rückgaben fällig.</p>}
          </div>
        </div>
      </Section>}
      {r?.aufgaben && <Section titel="Meine Aufgaben" icon="ListChecks">
        {r.aufgaben.length ? <ul className="lp-liste" data-testid="meine-aufgaben">{r.aufgaben.map((a) => (
          <li key={a.id}>{a.text} · <a href={`#/projekte/${a.projekt_id}`} onClick={(e) => { e.preventDefault(); oeffne("p", `/projekte/${a.projekt_id}?tab=aufgaben`); }}>{a.nummer}</a>
            {a.faellig && <> · {a.ueberfaellig ? <Badge farbe="var(--lp-err)" text="#fff">überfällig seit {datumAnzeige(a.faellig)}</Badge> : `fällig ${datumAnzeige(a.faellig)}`}</>}</li>))}</ul>
          : <Leerzustand text="Keine offenen Aufgaben für dich." icon="ListChecks" />}
      </Section>}
    </Seite>
  );
}

/** FA-36 Suche (nur, was die Rolle sehen darf – filtert der Server). */
export function SuchSeite({ query }) {
  const { api, navigiere } = useLager();
  const oeffne = useOeffne();
  const [text, setText] = useState(query.q || "");
  const q = query.q || "";
  useEffect(() => { setText(query.q || ""); }, [query.q]);
  const d = useDaten(() => (q.trim().length >= 2 ? api.get(`/api/v1/suche?q=${encodeURIComponent(q)}`) : Promise.resolve(null)), [q]);
  return (
    <Seite titel="Suche" untertitel="Kunden, Projekte, Angebote, Material und Geräte">
      <Section>
        <form className="lp-zeile" onSubmit={(e) => { e.preventDefault(); navigiere(`/suche?q=${encodeURIComponent(text.trim())}`); }}>
          <div style={{ flex: "1 1 320px" }}><Eingabe autoFocus type="search" aria-label="Suchbegriff" placeholder="Name, Nummer, Code, Ort …" value={text} onChange={(e) => setText(e.target.value)} /></div>
          <Knopf art="primaer" icon="Search" type="submit">Suchen</Knopf>
        </form>
      </Section>
      {d.fehler && <Meldung level="error" text={d.fehler} />}
      {q && q.trim().length < 2 && <Meldung level="info" text="Gib mindestens 2 Zeichen ein." />}
      {d.daten?.text && <Meldung level="info" text={d.daten.text} />}
      {d.daten?.gruppen.map((g) => (
        <Section key={g.bereich} titel={g.titel} data-gruppe={g.bereich}>
          <ul className="lp-liste">{g.treffer.map((t) => (
            <li key={t.id}><a href={`#${t.pfad}`} onClick={(e) => { e.preventDefault(); oeffne(g.app, t.pfad); }}><strong>{t.titel}</strong></a>{t.unter && <span className="lp-hinweis"> · {t.unter}</span>}</li>
          ))}</ul>
          {g.mehr && <p className="lp-hinweis">Weitere Treffer – grenze die Suche weiter ein.</p>}
        </Section>
      ))}
    </Seite>
  );
}
