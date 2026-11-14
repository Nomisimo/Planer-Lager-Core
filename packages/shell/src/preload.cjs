// Preload beider Apps: schmale Brücke, kein Node im Renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lagerShell", {
  info: () => ipcRenderer.invoke("shell-info"),
  /** Meldet „Oberfläche bereit“ und liefert Deep-Links, die vorher ankamen. */
  bereit: () => ipcRenderer.invoke("shell-bereit"),
  tokenLesen: () => ipcRenderer.invoke("token-lesen"),
  tokenSchreiben: (t) => ipcRenderer.invoke("token-schreiben", t),
  oeffneExtern: (url) => ipcRenderer.invoke("shell-extern", url),
  /** Etikettendruck mit Seitengröße in mm (FA-10/FA-14). */
  drucken: (opt) => ipcRenderer.invoke("shell-drucken", opt),
  onDeepLink: (cb) => { const h = (_e, url) => cb(url); ipcRenderer.on("deep-link", h); return () => ipcRenderer.removeListener("deep-link", h); },
});
