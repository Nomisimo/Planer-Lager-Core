// FA-09 Schadensdokumentation bei Rückgabe: Dialog (Code, Beschreibung, Fotos, optional defekt melden) und Liste je Projekt/Kunde.
// Gemeinsam für Materialplaner, Productionplaner und Arbeitsplatz-Web.
import React, { useState } from "react";
import { Section, Knopf, Tabelle, Eingabe, Textfeld, Feld, Meldung, Modal, Toggle, useDaten, useFormular } from "./bausteine.jsx";
import { useLager, useLive } from "./huelle.jsx";
import { fehlerText } from "./texte.js";
import { zeitpunktAnzeige } from "@lager/domain/zeit.js";

/** projektId leer = Projekt aus dem Gerät (Rückgabe-Arbeitsplatz). */
export function SchadenDialog({ projektId = null, code = "", onFertig, onSchliessen }) {
  const { api } = useLager();
  const f = useFormular({ code, beschreibung: "", defekt: false });
  const [fotos, setFotos] = useState([]);
  const speichern = async () => {
    const r = await f.absenden((w) => api.post(projektId ? `/api/v1/projekte/${projektId}/schaeden` : "/api/v1/schaeden", w));
    if (!r) return;
    let text = r.text.replace(" Füge jetzt Fotos hinzu.", "");
    let ok = 0;
    for (const foto of fotos) {
      try { await api.anfrage("POST", `/api/v1/schaeden/${r.id}/foto`, foto, { headers: { "Content-Type": foto.type || "image/jpeg" } }); ok++; }
      catch (e) { text += ` Foto „${foto.name}“ nicht gespeichert: ${fehlerText(e)}`; }
    }
    if (fotos.length) text += ` ${ok} Foto(s) gespeichert.`;
    onFertig({ ...r, text });
  };
  return (
    <Modal titel="Schaden dokumentieren" onSchliessen={onSchliessen} fuss={<><Knopf onClick={onSchliessen}>Abbrechen</Knopf><Knopf art="primaer" icon="Camera" onClick={speichern}>Speichern</Knopf></>}>
      {f.meldung && <Meldung {...f.meldung} />}
      <Feld label="Gerätecode" pflicht fehler={f.fehler.code}><Eingabe value={f.werte.code} onChange={f.setze("code")} placeholder="z. B. LI-0001" autoFocus={!code} /></Feld>
      <Feld label="Schaden" pflicht fehler={f.fehler.beschreibung} hinweis="Was ist beschädigt, wo, wie sichtbar? Für Haftungsfragen möglichst genau.">
        <Textfeld rows={3} value={f.werte.beschreibung} onChange={f.setze("beschreibung")} autoFocus={!!code} />
      </Feld>
      <Feld label="Fotos" hinweis="Bis zu 10 Fotos, JPG, PNG, WEBP oder HEIC, je höchstens 15 MB.">
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" aria-label="Fotos" onChange={(e) => setFotos([...(e.target.files || [])].slice(0, 10))} />
      </Feld>
      <Feld label="Gerät"><Toggle checked={f.werte.defekt} onChange={f.setze("defekt")} label="auch als defekt melden (gesperrt bis Reparatur)" /></Feld>
    </Modal>
  );
}

function FotoAnsicht({ s, onSchliessen }) {
  const { api } = useLager();
  const bilder = useDaten(async () => {
    const urls = [];
    for (let n = 1; n <= s.fotos; n++) { const x = await api.anfrage("GET", `/api/v1/schaeden/${s.id}/foto/${n}`, undefined, { roh: true }); urls.push(URL.createObjectURL(await x.blob())); }
    return urls;
  }, [s.id]);
  return (
    <Modal titel={`Schaden ${s.code} · ${s.projekt_nummer}`} breite={720} onSchliessen={onSchliessen} fuss={<Knopf onClick={onSchliessen}>Schließen</Knopf>}>
      <p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{s.beschreibung}</p>
      <p className="lp-meta">{zeitpunktAnzeige(s.zeit)} · {s.von}</p>
      {bilder.fehler && <Meldung level="error" text={bilder.fehler} />}
      <div className="lp-zeile" style={{ flexWrap: "wrap", gap: 8 }}>
        {(bilder.daten || []).map((u, i) => <img key={u} src={u} alt={`Foto ${i + 1} zu ${s.code}`} style={{ maxWidth: 320, maxHeight: 240, borderRadius: 6 }} />)}
      </div>
    </Modal>
  );
}

/** Liste der Schäden (pfad: /api/v1/projekte/:id/schaeden oder /api/v1/kunden/:id/schaeden). */
export function SchadenListe({ pfad, projektId = null, darfMelden = false, mitProjekt = false }) {
  const { api } = useLager();
  const l = useDaten(() => api.get(pfad), [pfad]);
  const [neu, setNeu] = useState(false);
  const [zeige, setZeige] = useState(null);
  const [meldung, setMeldung] = useState(null);
  useLive(["schaden"], () => l.laden());
  return (
    <Section titel={`Schäden (${l.daten?.zeilen.length ?? 0})`} icon="AlertTriangle" aktionen={darfMelden && <Knopf icon="Camera" onClick={() => setNeu(true)}>Schaden dokumentieren</Knopf>}>
      {meldung && <Meldung {...meldung} onSchliessen={() => setMeldung(null)} />}
      {l.fehler && <Meldung level="error" text={l.fehler} />}
      <Tabelle zeilen={l.daten?.zeilen || []} leer="Keine Schäden dokumentiert." onZeile={(s) => setZeige(s)} spalten={[
        { titel: "Gerät", wert: (s) => <div><strong>{s.code}</strong><div className="lp-meta">{s.artikel}</div></div> },
        ...(mitProjekt ? [{ titel: "Projekt", wert: (s) => `${s.projekt_nummer} ${s.projekt}` }] : []),
        { titel: "Schaden", feld: "beschreibung" },
        { titel: "Fotos", rechts: true, feld: "fotos" },
        { titel: "Dokumentiert", wert: (s) => `${zeitpunktAnzeige(s.zeit)} · ${s.von}` },
        { titel: "", wert: (s) => (s.reparatur_id ? "defekt gemeldet" : "") },
      ]} />
      {neu && <SchadenDialog projektId={projektId} onSchliessen={() => setNeu(false)} onFertig={(r) => { setNeu(false); setMeldung({ level: r.level, text: r.text }); l.laden(); }} />}
      {zeige && <FotoAnsicht s={zeige} onSchliessen={() => setZeige(null)} />}
    </Section>
  );
}
