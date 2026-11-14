// Fotos zu Reparaturen (FA-07) und Schäden (FA-09): Upload als Rohdaten (Content-Type = Bildtyp), max. 15 MB.
// Ablage im Datenordner (damit in der Sicherung), Dateirechte 0600, Ausgabe nur mit passendem Bildtyp + nosniff.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fehler } from "./hilfen.js";
import { datenOrdner } from "./projekte.js";

export const MAX_BILD = 15 * 1024 * 1024;
const TYPEN = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic" };
const ENDUNG_TYP = Object.fromEntries(Object.entries(TYPEN).map(([t, e]) => [e, t]));
const NAME_RE = /^foto-[0-9a-z-]+\.(jpg|png|webp|heic)$/;

/** Speichert den Request-Body als Foto unter <Daten>/<ordner>/ und liefert den Dateinamen. */
export async function speichereBild(ctx, ordner) {
  const typ = String(ctx.req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const endung = TYPEN[typ];
  if (!endung) { ctx.req.resume(); throw fehler(415, "Nur Fotos als JPG, PNG, WEBP oder HEIC. Wähle ein anderes Bild."); }
  if (Number(ctx.req.headers["content-length"] || 0) > MAX_BILD) { ctx.req.resume(); throw fehler(413, "Das Foto ist größer als 15 MB. Verkleinere es und lade es erneut hoch."); }
  const ziel = path.join(datenOrdner(ctx), ordner);
  await fsp.mkdir(ziel, { recursive: true, mode: 0o700 });
  const name = `foto-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}${endung}`;
  const voll = path.join(ziel, name);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(voll, { mode: 0o600 });
    let groesse = 0;
    ctx.req.on("data", (t) => {
      groesse += t.length;
      if (groesse > MAX_BILD) { ctx.req.unpipe(out); out.destroy(); fs.rm(voll, { force: true }, () => {}); ctx.req.resume(); reject(fehler(413, "Das Foto ist größer als 15 MB. Verkleinere es und lade es erneut hoch.")); }
    });
    ctx.req.on("aborted", () => { out.destroy(); fs.rm(voll, { force: true }, () => {}); reject(fehler(400, "Der Upload wurde abgebrochen. Lade das Foto erneut hoch.")); });
    out.on("error", reject).on("finish", () => (groesse ? resolve() : reject(fehler(400, "Das Foto ist leer. Wähle ein anderes Bild."))));
    ctx.req.pipe(out);
  });
  return name;
}

/** Sendet ein gespeichertes Foto. */
export async function sendeBild(ctx, ordner, name) {
  if (!NAME_RE.test(name || "")) throw fehler(404, "Dieses Foto gibt es nicht (mehr). Lade die Seite neu.");
  const voll = path.join(datenOrdner(ctx), ordner, name);
  let st;
  try { st = await fsp.stat(voll); } catch { throw fehler(404, "Dieses Foto gibt es nicht (mehr). Lade die Seite neu."); }
  ctx.res.writeHead(200, { "Content-Type": ENDUNG_TYP[path.extname(name)], "Content-Length": st.size, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
  fs.createReadStream(voll).pipe(ctx.res);
}
