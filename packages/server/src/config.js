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
  };
}
