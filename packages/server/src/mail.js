// FA-40 / E-5: E-Mail-Benachrichtigungen über SMTP (ohne Zusatzpaket, Spec 1.4).
// Unterstützt TLS direkt (Port 465), STARTTLS (587) und unverschlüsselt (nur für lokale Tests/Relays), AUTH PLAIN.
import net from "node:net";
import tls from "node:tls";
import os from "node:os";

/** SMTP-Konfiguration aus der Umgebung; null = keine E-Mails. */
export function smtpAusEnv(env = process.env) {
  if (!env.SMTP_HOST) return null;
  const tlsArt = env.SMTP_TLS || (Number(env.SMTP_PORT) === 465 ? "direkt" : "starttls");
  return { host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || (tlsArt === "direkt" ? 465 : 587), tls: tlsArt,
    benutzer: env.SMTP_BENUTZER || "", passwort: env.SMTP_PASSWORT || "", von: env.SMTP_VON || `planer-lager@${env.SMTP_HOST}` };
}

const kodiereKopf = (t) => (/^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t, "utf8").toString("base64")}?=`);
const adresse = (a) => { const s = String(a).trim(); if (!/^[^\s@<>]+@[^\s@<>]+$/.test(s)) throw new Error(`Ungültige E-Mail-Adresse: ${s}`); return s; };

/** Baut die Nachricht (RFC 5322, Text als UTF-8 base64). */
export function baueNachricht({ von, an, betreff, text, datum = new Date() }) {
  const body = Buffer.from(text, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [`From: ${von}`, `To: ${an}`, `Subject: ${kodiereKopf(betreff)}`, `Date: ${datum.toUTCString()}`, "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", body].join("\r\n");
}

/**
 * Sendet eine Text-Mail. Wirft bei Fehlern mit der Antwort des Servers.
 * @param {{host:string, port:number, tls:"direkt"|"starttls"|"aus", benutzer?:string, passwort?:string, von:string, timeoutMs?:number}} cfg
 */
export async function sendeMail(cfg, { an, betreff, text }) {
  const von = adresse(cfg.von), ziel = adresse(an);
  let sock = cfg.tls === "direkt" ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }) : net.connect({ host: cfg.host, port: cfg.port });
  sock.setTimeout(cfg.timeoutMs || 20000);
  let puffer = "";
  let warte = null;
  const anDaten = (d) => {
    puffer += d.toString("utf8");
    const zeilen = puffer.split("\r\n");
    // vollständige Antwort: letzte Zeile „NNN Text“ (ohne Bindestrich)
    const fertig = zeilen.findIndex((z) => /^\d{3} /.test(z));
    if (fertig >= 0 && warte) { const antwort = zeilen.slice(0, fertig + 1); puffer = zeilen.slice(fertig + 1).join("\r\n"); const w = warte; warte = null; w.ok(antwort); }
  };
  const lies = () => new Promise((ok, nein) => { warte = { ok, nein }; anDaten(Buffer.alloc(0)); });
  const binde = (s) => {
    s.on("data", anDaten);
    s.on("error", (e) => warte?.nein(e));
    s.on("timeout", () => { warte?.nein(new Error("SMTP-Server antwortet nicht (Zeitüberschreitung).")); s.destroy(); });
  };
  binde(sock);
  const befehl = async (zeile, erwartet) => {
    if (zeile != null) sock.write(`${zeile}\r\n`);
    const a = await lies();
    const code = Number(a[a.length - 1].slice(0, 3));
    if (!erwartet.includes(code)) throw new Error(`SMTP ${zeile ? zeile.split(" ")[0] : "Begrüßung"}: ${a.join(" ")}`);
    return a;
  };
  try {
    await befehl(null, [220]);
    const name = os.hostname() || "localhost";
    let ehlo = await befehl(`EHLO ${name}`, [250]);
    if (cfg.tls === "starttls") {
      if (!ehlo.some((z) => /STARTTLS/i.test(z))) throw new Error("Der SMTP-Server bietet kein STARTTLS an. Setze SMTP_TLS=direkt oder prüfe den Port.");
      await befehl("STARTTLS", [220]);
      sock.removeAllListeners("data");
      sock = tls.connect({ socket: sock, servername: cfg.host });
      binde(sock);
      await new Promise((ok, nein) => { sock.once("secureConnect", ok); sock.once("error", nein); });
      ehlo = await befehl(`EHLO ${name}`, [250]);
    }
    if (cfg.benutzer) await befehl(`AUTH PLAIN ${Buffer.from(`\0${cfg.benutzer}\0${cfg.passwort}`).toString("base64")}`, [235]);
    await befehl(`MAIL FROM:<${von}>`, [250]);
    await befehl(`RCPT TO:<${ziel}>`, [250, 251]);
    await befehl("DATA", [354]);
    const nachricht = baueNachricht({ von, an: ziel, betreff, text }).replace(/^\./gm, "..");
    await befehl(`${nachricht}\r\n.`, [250]);
    await befehl("QUIT", [221]).catch(() => {});
  } finally { sock.destroy(); }
}
