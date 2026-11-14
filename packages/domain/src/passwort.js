// Passwortregeln (R-09): mind. 10 Zeichen, nicht nur Ziffern, keine häufigen Passwörter, nicht dem Benutzernamen ähnlich.

// Kurze Liste häufiger Passwörter (Auswahl der verbreitetsten, ≥ 10 Zeichen relevant + Grundformen).
const HAEUFIG = new Set(`123456789012 1234567890 12345678910 qwertyuiop qwertzuiop passwort123 password123 password1234
passwort1234 abcdefghij abc1234567 iloveyou123 1q2w3e4r5t 1qaz2wsx3edc qwerty12345 qwertz12345 asdfghjkl1 hallo12345
hallo123456 sommer2024 sommer2025 sommer2026 winter2025 winter2026 fruehling2026 herbst2026 schalke04 borussia09
fussball123 schatz1234 passwort12 password12 administrator admin12345 admin123456 willkommen willkommen1 willkommen123
letmein1234 welcome123 welcome1234 football123 baseball123 dragon12345 sunshine123 princess123 master12345 monkey12345
starwars123 trustno1234 superman123 batman12345 michael123 charlie123 jennifer123 1111111111 0000000000 9876543210
qwerty123456 zaq12wsx34 abcd123456 a1b2c3d4e5 passwort passwort1 passwort! geheim1234 geheimnis1 geheimnis123
lagerlager veranstaltung technik1234 eventtechnik`.split(/\s+/).filter(Boolean));

function abstand(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Ähnlichkeit 0..1 (1 = gleich), wie Djangos Ähnlichkeitsprüfung mit Grenze 0,7. */
export function aehnlichkeit(a, b) {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (!x || !y) return 0;
  return 1 - abstand(x, y) / Math.max(x.length, y.length);
}

/**
 * @param {string} pw @param {string} [benutzername]
 * @returns {string[]} Fehlertexte (leer = in Ordnung)
 */
export function pruefePasswort(pw, benutzername = "") {
  const f = [];
  const p = String(pw || "");
  if (p.length < 10) f.push("Das Passwort ist zu kurz. Nimm mindestens 10 Zeichen.");
  if (/^\d+$/.test(p)) f.push("Das Passwort besteht nur aus Ziffern. Nimm auch Buchstaben dazu.");
  if (HAEUFIG.has(p.toLowerCase())) f.push("Dieses Passwort ist sehr verbreitet. Wähle ein anderes.");
  const u = String(benutzername || "").toLowerCase();
  if (u.length >= 3 && (p.toLowerCase().includes(u) || aehnlichkeit(p, u) >= 0.7))
    f.push("Das Passwort ähnelt deinem Benutzernamen. Wähle ein anderes.");
  return f;
}
