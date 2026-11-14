import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

// Ersatz für navigator.serial: ein Port, dessen Daten der Test schickt (echte Bluetooth-Hardware gibt es in der VM nicht).
function falscherPort() {
  let ctl = null, offen = false;
  const port = {
    getInfo: () => ({ bluetoothServiceClassId: "00001101-0000-1000-8000-00805f9b34fb" }),
    async open({ baudRate }) { if (offen) throw new Error("The port is already open."); offen = true; window.__seriell.baud = baudRate; port.readable = new ReadableStream({ start(c) { ctl = c; } }); },
    async close() { offen = false; },
    readable: null,
  };
  window.__seriell = {
    sende: (t) => ctl.enqueue(new TextEncoder().encode(t)),
    trenne: () => { offen = false; ctl.error(new Error("Verbindung weg")); },
    get offen() { return offen; },
  };
  Object.defineProperty(navigator, "serial", { configurable: true, value: Object.assign(new EventTarget(), {
    getPorts: async () => [port], requestPort: async () => port,
  }) });
}

test("ARCHITEKTUR-5 BT-SPP Materialplaner: seriellen Scanner wählen, Codes zeilenweise, Neuverbinden", async () => {
  const s = await starteServer();
  try {
    await s.benutzer("admin", "Administrator", "Ada Admin");
    const { rows: [kat] } = await s.db.pool.query("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 5) RETURNING id");
    const { rows: [a] } = await s.db.pool.query("INSERT INTO artikel (name, kategorie_id) VALUES ('Akku', $1) RETURNING id", [kat.id]);
    await s.db.pool.query("INSERT INTO geraet (code, artikel_id) VALUES ('LI-0001', $1), ('LI-0002', $1)", [a.id]);
    const m = await starteApp("materialplaner", s.url);
    try {
      const w = m.win;
      await anmelden(w, "admin");
      const zurScannerVerwaltung = async () => {
        await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Verwaltung", { exact: true }).click();
        await w.getByRole("heading", { name: "Scanner", exact: true }).locator("xpath=../..").getByRole("button", { name: "Öffnen" }).click();
        await w.getByRole("heading", { name: "Bluetooth-Scanner seriell (dieses Gerät)" }).waitFor();
      };
      await zurScannerVerwaltung();
      const status = w.getByTestId("seriell-status");
      assert.equal(await status.textContent(), "Aus");
      // Echte Web-Serial-Auswahl über den Hauptprozess: Electron liefert die Portliste, die Oberfläche zeigt sie (VM: ttyS0), Abbrechen
      await w.getByRole("button", { name: "Scanner wählen" }).click();
      const dlg = w.getByRole("dialog", { name: "Seriellen Scanner wählen" });
      await dlg.getByRole("button").or(dlg.getByText("Kein serieller Port gefunden")).first().waitFor();
      if (await dlg.getByText("ttyS0").count()) assert.ok(await dlg.getByRole("button", { name: /ttyS0/ }).isVisible(), "Port als Knopf");
      await dlg.getByRole("button", { name: "Abbrechen" }).click();
      await w.getByText("Kein Scanner gewählt. Koppel den Scanner zuerst").waitFor();

      // Ab jetzt ein simulierter Port
      await m.app.context().addInitScript(falscherPort);
      await w.reload();
      await w.getByTestId("benutzer").waitFor();
      await zurScannerVerwaltung();
      await w.getByLabel("Baudrate").selectOption("115200");
      await w.getByRole("button", { name: "Scanner wählen" }).click();
      await w.getByText("Verbunden (115200 Baud)").waitFor();
      assert.equal(await w.evaluate(() => window.__seriell.baud), 115200);
      await screenshot(w, "BT-SPP-einstellungen");
      // Code in zwei Stücken, CRLF → öffnet das Gerät wie das Codefeld
      await w.evaluate(() => { window.__seriell.sende("LI-00"); window.__seriell.sende("01\r\n"); });
      await w.getByRole("heading", { name: "LI-0001" }).waitFor();
      // Trennung → Neuverbindung nach 5 s, danach kommen Codes wieder an
      await zurScannerVerwaltung();
      await w.evaluate(() => window.__seriell.trenne());
      await w.getByText("Verbindung zum Scanner getrennt").waitFor();
      await w.getByText("Verbunden (115200 Baud)").waitFor({ timeout: 10000 });
      await w.evaluate(() => window.__seriell.sende("LI-0002\n"));
      await w.getByRole("heading", { name: "LI-0002" }).waitFor();
      // Ausschalten schließt den Port
      await zurScannerVerwaltung();
      await w.getByLabel("Seriellen Scanner nutzen").uncheck();
      await w.getByTestId("seriell-status").getByText("Aus").waitFor();
      assert.equal(await w.evaluate(() => window.__seriell.offen), false);
    } finally { await m.ende(); }
  } finally { await s.ende(); }
});
