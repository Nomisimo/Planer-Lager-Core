// Datei vom Server herunterladen (mit Anmeldung) und als Download speichern.
/** @param {{anfrage: Function}} api */
export async function ladeHerunter(api, pfad, dateiname) {
  const r = await api.anfrage("GET", pfad, undefined, { roh: true });
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url; a.download = dateiname; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
