// Preload beider Apps: schmale Brücke, kein Node im Renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lagerShell", {
  info: () => ipcRenderer.invoke("shell-info"),
  /** Meldet „Oberfläche bereit“ und liefert Deep-Links, die vorher ankamen. */
  bereit: () => ipcRenderer.invoke("shell-bereit"),
  oeffneExtern: (url) => ipcRenderer.invoke("shell-extern", url),
  onDeepLink: (cb) => { const h = (_e, url) => cb(url); ipcRenderer.on("deep-link", h); return () => ipcRenderer.removeListener("deep-link", h); },
});
