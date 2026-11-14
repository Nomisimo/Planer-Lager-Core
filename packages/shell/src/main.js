// Gemeinsamer Electron-Hauptprozess für Materialplaner und Productionplaner.
// Wird je App mit esbuild nach dist-app/main.cjs gebündelt (siehe scripts/app-build.cjs).
import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { linkAusArgv } from "./deeplink.js";

const SPLASH = (titel, farbe) => `data:text/html;charset=utf-8,${encodeURIComponent(
  `<!DOCTYPE html><html><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#1c2127;color:#e8eaed;font-family:'Segoe UI',system-ui,sans-serif;border-bottom:3px solid ${farbe}">
  <div style="font-size:26px;font-weight:700;color:${farbe}">${titel}</div><div style="font-size:12px;color:#9aa4af;margin-top:8px">Planer-Familie · wird geladen …</div></body></html>`)}`;

/**
 * @param {{id: string, titel: string, protokoll: string, akzent?: string, root: string, version: string}} cfg
 *   root = Ordner mit dist-app/ (gebündelt: __dirname)
 */
export function starteShell(cfg) {
  const test = process.env.LAGER_TEST === "1";
  if (process.env.LAGER_USER_DATA) app.setPath("userData", process.env.LAGER_USER_DATA);
  const serverUrl = (process.env.LAGER_SERVER_URL || "http://localhost:8080").replace(/\/+$/, "");

  if (!test && !app.requestSingleInstanceLock()) { app.quit(); return; }
  if (!test) {
    if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(cfg.protokoll, process.execPath, [path.resolve(process.argv[1])]);
    else app.setAsDefaultProtocolClient(cfg.protokoll);
  }

  /** @type {BrowserWindow | null} */
  let win = null;
  let bereit = false;
  const wartend = [];
  const ersterLink = linkAusArgv(process.argv, cfg.protokoll);
  if (ersterLink) wartend.push(ersterLink);

  const sendeLink = (url) => {
    if (win && bereit) win.webContents.send("deep-link", url);
    else wartend.push(url);
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  };
  app.on("second-instance", (_e, argv) => { const l = linkAusArgv(argv, cfg.protokoll); if (l) sendeLink(l); else if (win) win.focus(); });
  app.on("open-url", (e, url) => { e.preventDefault(); sendeLink(url); });

  ipcMain.handle("shell-info", () => ({ id: cfg.id, titel: cfg.titel, version: cfg.version, serverUrl, test, plattform: process.platform }));
  ipcMain.handle("shell-bereit", () => { bereit = true; const l = wartend.splice(0); return l; });
  ipcMain.handle("shell-extern", (_e, url) => {
    // Nur eigene Protokolle und http(s) öffnen, nie Dateien.
    if (!/^(https?|materialplaner|productionplaner):\/\//i.test(String(url))) return false;
    if (test) { process.stdout.write(`[shell-extern] ${url}\n`); return true; }
    return shell.openExternal(url).then(() => true, () => false);
  });

  const erstelleFenster = () => {
    const splash = test ? null : new BrowserWindow({ width: 380, height: 220, frame: false, resizable: false, center: true,
      alwaysOnTop: true, skipTaskbar: true, backgroundColor: "#1c2127", webPreferences: { contextIsolation: true } });
    splash?.loadURL(SPLASH(cfg.titel, cfg.akzent || "#b3483f"));
    win = new BrowserWindow({
      width: 1440, height: 920, minWidth: 1024, minHeight: 680, title: cfg.titel, show: false, backgroundColor: "#15191e",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(cfg.root, "preload.cjs") },
    });
    // Navigation nur innerhalb der App; Links nach außen über den Standardbrowser.
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
    win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) e.preventDefault(); });
    win.once("ready-to-show", () => { win?.show(); if (splash && !splash.isDestroyed()) splash.close(); });
    win.on("closed", () => { win = null; bereit = false; });
    win.loadFile(path.join(cfg.root, "index.html"));
  };

  app.whenReady().then(erstelleFenster);
  app.on("activate", () => { if (!win) erstelleFenster(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin" || test) app.quit(); });
}
