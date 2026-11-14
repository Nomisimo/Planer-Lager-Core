// Sicherheitsprotokoll (Spec 3.15): nur anfügen.
/** @param {import("pg").Pool|import("pg").PoolClient} db */
export async function protokolliere(db, art, { benutzer = "", ip = "", text = "" } = {}) {
  await db.query("INSERT INTO sicherheit_ereignis (art, benutzer, ip, text) VALUES ($1, $2, $3, $4)", [art, benutzer, ip, text.slice(0, 1000)]);
}

/** Absender-IP; hinter Caddy aus X-Forwarded-For (nur wenn config.vertraueProxy). */
export function clientIp(ctx) {
  const xff = ctx.config?.vertraueProxy ? String(ctx.req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
  return xff || ctx.req.socket.remoteAddress || "";
}
