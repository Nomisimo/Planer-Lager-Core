// Gemeinsamer Electron-Hauptprozess für Materialplaner und Productionplaner.
// Wird je App mit esbuild nach dist-app/main.cjs gebündelt (siehe scripts/app-build.cjs).
import { app, BrowserWindow, ipcMain, shell, safeStorage, session } from "electron";
import fs from "node:fs";
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
  // Server-Adresse: Umgebung LAGER_SERVER_URL (fest) > in der App eingetragen (userData/server.json) > localhost:8080
  const serverFest = !!process.env.LAGER_SERVER_URL;
  const serverDatei = () => path.join(app.getPath("userData"), "server.json");
  const leseServer = () => { try { return JSON.parse(fs.readFileSync(serverDatei(), "utf8")).url || null; } catch { return null; } };
  let serverUrl = (process.env.LAGER_SERVER_URL || "http://localhost:8080").replace(/\/+$/, "");

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

  if (!serverFest) serverUrl = leseServer() || serverUrl;
  ipcMain.handle("shell-info", () => ({ id: cfg.id, titel: cfg.titel, version: cfg.version, serverUrl, serverFest, test, plattform: process.platform,
    // REL-03: Releases der App auf GitHub (im Test nur mit LAGER_UPDATE_URL, sonst kein Netzzugriff)
    updateUrl: process.env.LAGER_UPDATE_URL || (test ? null : `https://api.github.com/repos/Nomisimo/${cfg.titel}/releases?per_page=10`) }));
  ipcMain.handle("server-setzen", (e, url) => {
    if (serverFest) return { ok: false, text: "Die Server-Adresse ist über LAGER_SERVER_URL fest eingestellt. Ändere sie dort." };
    const u = String(url || "").trim().replace(/\/+$/, "");
    let ok = false;
    try { const x = new URL(u); ok = /^https?:$/.test(x.protocol) && !!x.hostname && x.pathname === "/" && !x.search && !x.username; } catch { ok = false; }
    if (!ok) return { ok: false, text: "Die Adresse sieht nicht richtig aus. Beispiel: https://lager.meinefirma.de" };
    fs.writeFileSync(serverDatei(), JSON.stringify({ url: u }));
    serverUrl = u;
    setTimeout(() => e.sender.reload(), 50);
    return { ok: true };
  });
  ipcMain.handle("shell-bereit", () => { bereit = true; const l = wartend.splice(0); return l; });
  ipcMain.handle("shell-extern", (_e, url) => {
    // Nur eigene Protokolle und http(s) öffnen, nie Dateien.
    if (!/^(https?|materialplaner|productionplaner):\/\//i.test(String(url))) return false;
    if (test) { process.stdout.write(`[shell-extern] ${url}\n`); return true; }
    return shell.openExternal(url).then(() => true, () => false);
  });

  // FA-10/FA-14 Etikettendruck: Seitengröße aus der Vorlage, ohne Ränder. Testmodus: PDF statt Drucker.
  let druckNr = 0;
  ipcMain.handle("shell-drucken", async (e, { breite_mm, hoehe_mm } = {}) => {
    const b = Number(breite_mm), h = Number(hoehe_mm);
    if (!(b >= 10 && b <= 300 && h >= 5 && h <= 300)) return { ok: false, text: "Die Etikettengröße ist ungültig. Prüfe die Vorlage." };
    const wc = e.sender;
    if (test) {
      const pdf = await wc.printToPDF({ pageSize: { width: b / 25.4, height: h / 25.4 }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, printBackground: true });
      const datei = path.join(app.getPath("userData"), `druck-${++druckNr}.pdf`);
      fs.writeFileSync(datei, pdf);
      process.stdout.write(`[shell-druck] ${datei} ${b}x${h}\n`);
      return { ok: true, test: true, datei };
    }
    return new Promise((resolve) => wc.print({ silent: false, printBackground: true, margins: { marginType: "none" },
      pageSize: { width: Math.round(b * 1000), height: Math.round(h * 1000) } },
    (ok, grund) => resolve(ok ? { ok: true } : { ok: false, abgebrochen: grund === "cancelled", text: grund === "cancelled" ? "Druck abgebrochen." : `Drucken fehlgeschlagen (${grund}). Prüfe den Drucker und versuche es erneut.` })));
  });

  // Sitzungs-Token verschlüsselt im Benutzerordner (safeStorage = Schlüsselbund/DPAPI).
  const tokenDatei = () => path.join(app.getPath("userData"), "sitzung.bin");
  ipcMain.handle("token-lesen", () => {
    try {
      const roh = fs.readFileSync(tokenDatei());
      return safeStorage.isEncryptionAvailable() && roh[0] !== 0x7b ? safeStorage.decryptString(roh) : JSON.parse(roh.toString()).t;
    } catch { return null; }
  });
  ipcMain.handle("token-schreiben", (_e, token) => {
    if (!token) { fs.rmSync(tokenDatei(), { force: true }); return true; }
    const daten = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(JSON.stringify({ t: token }));
    fs.writeFileSync(tokenDatei(), daten, { mode: 0o600 });
    return true;
  });

  // Arbeitsplatz-Modus (nur Materialplaner, cfg.kiosk): Vollbild-Kiosk lädt station-web vom Server (R-11a–g, R-59).
  // Start: `materialplaner --arbeitsplatz` (Verknüpfung am Lagerrechner). Beenden: Strg+Umschalt+Q.
  const kioskModus = !!cfg.kiosk && (process.argv.includes("--arbeitsplatz") || process.env.LAGER_ARBEITSPLATZ === "1");
  const erstelleKiosk = () => {
    const ziel = `${String(serverUrl).replace(/\/+$/, "")}/station`;
    win = new BrowserWindow({ kiosk: !test, fullscreen: !test, width: 1280, height: 800, title: `${cfg.titel} – Arbeitsplatz`, autoHideMenuBar: true, backgroundColor: "#15191e",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const erlaubt = (url) => { try { const u = new URL(url); return u.origin === new URL(ziel).origin && u.pathname === "/station"; } catch { return false; } };
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e, url) => { if (!erlaubt(url)) e.preventDefault(); });
    win.webContents.on("before-input-event", (e, i) => { if (i.type === "keyDown" && i.control && i.shift && i.key.toLowerCase() === "q") { e.preventDefault(); app.quit(); } });
    // Server kurz nicht erreichbar → nach 10 s neu laden, Arbeitsplatz bleibt stehen
    win.webContents.on("did-fail-load", () => setTimeout(() => { if (win && !win.isDestroyed()) win.loadURL(ziel); }, 10_000));
    win.on("closed", () => { win = null; });
    if (test) process.stdout.write(`[shell-kiosk] ${ziel}\n`);
    win.loadURL(ziel);
  };

  const erstelleFenster = () => {
    if (kioskModus) return erstelleKiosk();
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

  // BT-SPP-Scanner (ARCHITEKTUR §5) über Web Serial: Electron hat keine eigene Portauswahl, darum zeigt die Oberfläche die Liste.
  // Zugriff nur für die eigene Oberfläche (file://), nie für Seiten vom Server.
  let seriellAntwort = null;
  ipcMain.handle("seriell-gewaehlt", (_e, portId) => { const cb = seriellAntwort; seriellAntwort = null; cb?.(String(portId || "")); return true; });
  const seriellEinrichten = () => {
    const ses = session.defaultSession;
    const eigen = (origin) => /^file:/i.test(String(origin || ""));
    ses.on("select-serial-port", (e, liste, wc, cb) => {
      e.preventDefault();
      if (!eigen(wc.getURL())) { cb(""); return; }
      seriellAntwort?.("");
      seriellAntwort = cb;
      wc.send("seriell-auswahl", liste.map((p) => ({ portId: p.portId, name: p.displayName ? `${p.displayName} (${p.portName})` : p.portName })));
    });
    ses.setPermissionCheckHandler((_wc, recht, origin) => (recht === "serial" ? eigen(origin) : true));
    ses.setDevicePermissionHandler((d) => d.deviceType === "serial" && eigen(d.origin));
  };

  // Datumsfelder und Zahlen im deutschen Format (TT.MM.JJJJ), unabhängig von der Systemsprache.
  app.commandLine.appendSwitch("lang", "de-DE");
  app.whenReady().then(() => { seriellEinrichten(); erstelleFenster(); });
  app.on("activate", () => { if (!win) erstelleFenster(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin" || test) app.quit(); });
}
