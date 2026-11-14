// Kamera-Scan am Arbeitsplatz-Web (Spec 6.3, FA-15, UI-2): echte Dekodierung über eine simulierte Kamera, die einen QR-Code zeigt.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import { starteServer, starteBrowser, screenshot, PW } from "./helfer.js";

/** Y4M-Video (Graustufen) mit dem QR-Code von `text` – Chromium nutzt es als Kamera. */
function qrVideo(text, datei) {
  const W = 640, H = 480;
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" }).modules;
  const skala = 10, rand = 4, groesse = (qr.size + 2 * rand) * skala;
  const y = Buffer.alloc(W * H, 255);
  const x0 = (W - groesse) / 2, y0 = (H - groesse) / 2;
  for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) {
    if (!qr.get(r, c)) continue;
    for (let dy = 0; dy < skala; dy++) for (let dx = 0; dx < skala; dx++) y[(y0 + (r + rand) * skala + dy) * W + x0 + (c + rand) * skala + dx] = 0;
  }
  const uv = Buffer.alloc((W / 2) * (H / 2), 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, uv, uv]);
  fs.writeFileSync(datei, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)]));
}

test("Kamera-Scan FA-15 UI-2 Rückgabe-Arbeitsplatz liest QR-Code über die Kamera und bucht ihn (einmal, nicht 10×)", async () => {
  const s = await starteServer();
  await s.benutzer("chef", "Administrator", "Clara Chef");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [kat] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 9) RETURNING id");
  const { rows: [art] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Spot', $1) RETURNING id", [kat.id]);
  const { rows: [p] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ('P-2027-001', 'projekt', 'Stadtfest', $1, 'laeuft', '2027-05-01') RETURNING id", [k.id]);
  await q("INSERT INTO geraet (code, artikel_id, status, projekt_id, letzte_pruefung) VALUES ('LI-0001', $1, 'gepackt', $2, (now() AT TIME ZONE 'Europe/Berlin')::date)", [art.id, p.id]);
  const api = async (pfad, body, token) => (await fetch(`${s.url}${pfad}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json();
  const { token } = await api("/api/v1/anmelden", { benutzername: "chef", passwort: PW });
  await api("/api/v1/verwaltung/mitarbeiter", { name: "Lea", pin: "4711" }, token);
  const { code } = await api("/api/v1/verwaltung/arbeitsplaetze", { name: "Rückgabe 1", art: "rueckgabe" }, token);
  assert.ok(code);
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "kamera-"));
  const video = path.join(ordner, "qr.y4m");
  qrVideo("LI-0001", video);
  const b = await starteBrowser({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`], rechte: ["camera"] });
  try {
    const sp = b.seite;
    await sp.goto(`${s.url}/station`);
    await sp.getByLabel("Einrichtungscode").fill(code);
    await sp.getByRole("button", { name: "Einrichten" }).click();
    await sp.getByRole("button", { name: /Lea/ }).click();
    await sp.getByLabel("PIN für Lea").fill("4711");
    await sp.getByRole("button", { name: "Entsperren" }).click();
    await sp.getByTestId("mitarbeiter").getByText("Lea").waitFor();
    await sp.getByRole("button", { name: "Mit der Kamera scannen" }).click();
    await sp.getByRole("dialog", { name: "Mit der Kamera scannen" }).waitFor();
    await sp.getByTestId("kamera-status").getByText("Gelesen: LI-0001").waitFor({ timeout: 20000 });
    await sp.getByTestId("scan-ergebnis").getByText("LI-0001 Spot – Zurück im Lager").waitFor();
    await screenshot(sp, "FA-15-kamera-scan");
    await sp.waitForTimeout(1500); // Kamera liest weiter – Wiederholsperre verhindert Doppelbuchung
    await sp.getByRole("dialog", { name: "Mit der Kamera scannen" }).getByRole("button", { name: "Schließen", exact: true }).last().click();
    await sp.getByRole("dialog", { name: "Mit der Kamera scannen" }).waitFor({ state: "detached" });
    const { rows } = await q("SELECT count(*)::int AS n FROM bewegung b JOIN geraet g ON g.id = b.geraet_id WHERE g.code = 'LI-0001' AND b.aktion = 'Zurück im Lager'");
    assert.equal(rows[0].n, 1);
  } finally { await b.ende(); await s.ende(); fs.rmSync(ordner, { recursive: true, force: true }); }
});
