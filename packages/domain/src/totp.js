// TOTP nach RFC 6238 (FA-54): 30 s, 6 Ziffern, SHA-1 (kompatibel mit üblichen Authenticator-Apps).
import { createHmac, randomBytes } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(buf) {
  let bits = 0, wert = 0, out = "";
  for (const b of buf) {
    wert = (wert << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(wert >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(wert << (5 - bits)) & 31];
  return out;
}
export function vonBase32(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, wert = 0;
  const out = [];
  for (const c of clean) {
    wert = (wert << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((wert >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const neuesTotpGeheimnis = () => base32(randomBytes(20));

/** Code für Zeitschritt. */
export function totpCode(geheimnis, zeitMs = Date.now(), schritt = 30) {
  const zaehler = Math.floor(zeitMs / 1000 / schritt);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(zaehler));
  const h = createHmac("sha1", vonBase32(geheimnis)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** Prüft mit ±1 Zeitschritt Toleranz. */
export function pruefeTotp(geheimnis, code, zeitMs = Date.now()) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((d) => totpCode(geheimnis, zeitMs + d * 30000) === c);
}

export const totpUri = (geheimnis, konto, aussteller = "Planer-Lager") =>
  `otpauth://totp/${encodeURIComponent(aussteller)}:${encodeURIComponent(konto)}?secret=${geheimnis}&issuer=${encodeURIComponent(aussteller)}&period=30&digits=6`;
