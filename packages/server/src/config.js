// Server-Konfiguration aus Umgebungsvariablen (Werte zentral, NFA-07).
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
    adminBenutzer: env.LAGER_ADMIN_BENUTZER || "",
    adminPasswort: env.LAGER_ADMIN_PASSWORT || "",
    // Netzwerk-Scanner-Gateway (ARCHITEKTUR §5): TCP-Port, leer/0 = aus. Nur im LAN/VPN freigeben.
    scannerTcpPort: env.SCANNER_TCP_PORT === undefined ? 9101 : Number(env.SCANNER_TCP_PORT) || 0,
    scannerTcpHost: env.SCANNER_TCP_HOST || "0.0.0.0",
    // FA-49/FA-50/FA-51: Sicherung beim Start, Dateirechte absichern, Neustart aus der Oberfläche (Docker startet neu)
    autoSicherung: env.LAGER_AUTO_SICHERUNG !== "0",
    absichernBeimStart: env.LAGER_ABSICHERN !== "0",
    neustartErlaubt: env.LAGER_NEUSTART !== "0",
  };
}
