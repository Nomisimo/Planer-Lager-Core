// Server-Konfiguration aus Umgebungsvariablen (Werte zentral, NFA-07).
import { smtpAusEnv } from "./mail.js";

export function configAusEnv(env = process.env) {
  const publicUrl = env.PUBLIC_URL || "";
  const https = publicUrl.startsWith("https://");
  return {
    publicUrl,
    // FA-54: 2FA Pflicht für Admins, sobald aus dem Netz erreichbar (D-01: Cloud → Standard an, wenn PUBLIC_URL https).
    imNetz: env.LAGER_IM_NETZ ? env.LAGER_IM_NETZ === "1" : https,
    secureCookies: https,
    hsts: https,
    vertraueProxy: env.LAGER_HINTER_PROXY === "1",
    dataDir: env.DATA_DIR || "./data",
    // ARCHITEKTUR §10: Browser-Versionen beider Apps (<WEB_APPS_DIR>/materialplaner, …/productionplaner); leer = <core>/web
    webAppsDir: env.WEB_APPS_DIR || "",
    // NFA-02 ALLOWED_HOSTS: aus LAGER_HOSTS (kommagetrennt), sonst Host aus PUBLIC_URL; leer = keine Prüfung (lokal)
    erlaubteHosts: (env.LAGER_HOSTS || (publicUrl ? new URL(publicUrl).hostname : "")).split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
    adminBenutzer: env.LAGER_ADMIN_BENUTZER || "",
    adminPasswort: env.LAGER_ADMIN_PASSWORT || "",
    // Netzwerk-Scanner-Gateway (ARCHITEKTUR §5): TCP-Port, leer/0 = aus. Nur im LAN/VPN freigeben.
    scannerTcpPort: env.SCANNER_TCP_PORT === undefined ? 9101 : Number(env.SCANNER_TCP_PORT) || 0,
    scannerTcpHost: env.SCANNER_TCP_HOST || "0.0.0.0",
    // FA-49/FA-50/FA-51: Sicherung beim Start, Dateirechte absichern, Neustart aus der Oberfläche (Docker startet neu)
    // NFA-04: Sicherungen verschlüsseln (Cloud), Schlüssel außerhalb des Codes
    backupSchluessel: env.BACKUP_SCHLUESSEL || "",
    autoSicherung: env.LAGER_AUTO_SICHERUNG !== "0",
    absichernBeimStart: env.LAGER_ABSICHERN !== "0",
    neustartErlaubt: env.LAGER_NEUSTART !== "0",
    // FA-40 / E-5: Benachrichtigungen – Hintergrundlauf (Minuten, 0 = aus) und E-Mail per SMTP_HOST/SMTP_PORT/SMTP_TLS/SMTP_BENUTZER/SMTP_PASSWORT/SMTP_VON
    hintergrundMinuten: env.LAGER_HINTERGRUND_MINUTEN === undefined ? 60 : Number(env.LAGER_HINTERGRUND_MINUTEN) || 0,
    smtp: smtpAusEnv(env),
  };
}
