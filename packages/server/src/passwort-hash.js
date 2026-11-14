// Passwort-Hashing mit scrypt (node:crypto). Format: scrypt$N$r$p$salt$hash (base64url).
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

const N = 16384, R = 8, P = 1, LEN = 32;
const scryptP = (pw, salt, n, r, p) => new Promise((ok, nein) =>
  scrypt(pw, salt, LEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? nein(e) : ok(k))));

export async function hashePasswort(pw) {
  const salt = randomBytes(16);
  const k = await scryptP(String(pw), salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${k.toString("base64url")}`;
}

export async function pruefePasswortHash(pw, gespeichert) {
  const t = String(gespeichert || "").split("$");
  if (t.length !== 6 || t[0] !== "scrypt") return false;
  const k = await scryptP(String(pw), Buffer.from(t[4], "base64url"), +t[1], +t[2], +t[3]);
  const soll = Buffer.from(t[5], "base64url");
  return soll.length === k.length && timingSafeEqual(soll, k);
}

/** Vergleichs-Hash, damit unbekannte Benutzer gleich lange brauchen (kein Hinweis auf Existenz, R-08). */
export const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
