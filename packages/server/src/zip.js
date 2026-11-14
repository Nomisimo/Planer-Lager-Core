// Minimales ZIP (Deflate) ohne Zusatzpaket (Spec 1.4): für Sicherungen (FA-49) und SVG-Download (FA-53).
import zlib from "node:zlib";

const DOS_ZEIT = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const DOS_DATUM = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

/**
 * @param {{name: string, daten: Buffer|string}[]} eintraege
 * @returns {Buffer}
 */
export function schreibeZip(eintraege, jetzt = new Date()) {
  const teile = [], zentral = [];
  let pos = 0;
  for (const e of eintraege) {
    const roh = Buffer.isBuffer(e.daten) ? e.daten : Buffer.from(String(e.daten), "utf8");
    const komp = zlib.deflateRawSync(roh);
    const name = Buffer.from(e.name.replace(/\\/g, "/"), "utf8");
    const crc = zlib.crc32(roh) >>> 0;
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0); kopf.writeUInt16LE(20, 4); kopf.writeUInt16LE(0x0800, 6); kopf.writeUInt16LE(8, 8);
    kopf.writeUInt16LE(DOS_ZEIT(jetzt), 10); kopf.writeUInt16LE(DOS_DATUM(jetzt), 12); kopf.writeUInt32LE(crc, 14);
    kopf.writeUInt32LE(komp.length, 18); kopf.writeUInt32LE(roh.length, 22); kopf.writeUInt16LE(name.length, 26); kopf.writeUInt16LE(0, 28);
    const z = Buffer.alloc(46);
    z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(20, 4); z.writeUInt16LE(20, 6); z.writeUInt16LE(0x0800, 8); z.writeUInt16LE(8, 10);
    z.writeUInt16LE(DOS_ZEIT(jetzt), 12); z.writeUInt16LE(DOS_DATUM(jetzt), 14); z.writeUInt32LE(crc, 16);
    z.writeUInt32LE(komp.length, 20); z.writeUInt32LE(roh.length, 24); z.writeUInt16LE(name.length, 28);
    z.writeUInt32LE(pos, 42);
    teile.push(kopf, name, komp);
    zentral.push(z, name);
    pos += kopf.length + name.length + komp.length;
  }
  const zb = Buffer.concat(zentral);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(eintraege.length, 8); ende.writeUInt16LE(eintraege.length, 10);
  ende.writeUInt32LE(zb.length, 12); ende.writeUInt32LE(pos, 16);
  return Buffer.concat([...teile, zb, ende]);
}

/**
 * Liest ein ZIP und prüft jede Datei (CRC). Wirft bei Fehlern.
 * @returns {{name: string, daten: Buffer}[]}
 */
export function leseZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("Keine ZIP-Datei (Verzeichnis fehlt).");
  const anzahl = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = [];
  for (let i = 0; i < anzahl; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("ZIP-Verzeichnis beschädigt.");
    const methode = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), kGr = buf.readUInt32LE(p + 20);
    const nL = buf.readUInt16LE(p + 28), xL = buf.readUInt16LE(p + 30), cL = buf.readUInt16LE(p + 32), lokal = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nL);
    if (buf.readUInt32LE(lokal) !== 0x04034b50) throw new Error(`ZIP-Eintrag ${name} beschädigt.`);
    const start = lokal + 30 + buf.readUInt16LE(lokal + 26) + buf.readUInt16LE(lokal + 28);
    const roh = buf.subarray(start, start + kGr);
    const daten = methode === 8 ? zlib.inflateRawSync(roh) : methode === 0 ? Buffer.from(roh) : null;
    if (!daten) throw new Error(`ZIP-Eintrag ${name}: Verfahren ${methode} nicht unterstützt.`);
    if ((zlib.crc32(daten) >>> 0) !== crc) throw new Error(`ZIP-Eintrag ${name}: Prüfsumme falsch.`);
    out.push({ name, daten });
    p += 46 + nL + xL + cL;
  }
  return out;
}
