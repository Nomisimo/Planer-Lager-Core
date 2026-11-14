// Preload beider Apps: schmale Brücke, kein Node im Renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lagerShell", {
  info: () => ipcRenderer.invoke("shell-info"),
  /** Meldet „Oberfläche bereit“ und liefert Deep-Links, die vorher ankamen. */
  bereit: () => ipcRenderer.invoke("shell-bereit"),
  /** Server-Adresse ändern (gespeichert im Benutzerordner), lädt die Oberfläche neu. */
  serverSetzen: (url) => ipcRenderer.invoke("server-setzen", url),
  tokenLesen: () => ipcRenderer.invoke("token-lesen"),
  tokenSchreiben: (t) => ipcRenderer.invoke("token-schreiben", t),
  oeffneExtern: (url) => ipcRenderer.invoke("shell-extern", url),
  /** Etikettendruck mit Seitengröße in mm (FA-10/FA-14). */
  drucken: (opt) => ipcRenderer.invoke("shell-drucken", opt),
  /** BT-SPP: Portliste für die eigene Auswahl (Electron zeigt keine) und Antwort mit portId ("" = abbrechen). */
  onSeriellAuswahl: (cb) => { const h = (_e, liste) => cb(liste); ipcRenderer.on("seriell-auswahl", h); return () => ipcRenderer.removeListener("seriell-auswahl", h); },
  seriellGewaehlt: (portId) => ipcRenderer.invoke("seriell-gewaehlt", portId),
  onDeepLink: (cb) => { const h = (_e, url) => cb(url); ipcRenderer.on("deep-link", h); return () => ipcRenderer.removeListener("deep-link", h); },
});
