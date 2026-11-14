// NFA-08: Tests laufen ohne Netz. Wird von scripts/test.js per --import geladen und lässt nur
// Verbindungen zum eigenen Rechner zu (Testserver, PostgreSQL). Externe Dienste müssen im Test gemockt sein.
import net from "node:net";

const LOKAL = /^(localhost|127\.\d+\.\d+\.\d+|::1|::ffff:127\.0\.0\.1)$/;
const ziel = (a) => {
  const o = Array.isArray(a[0]) ? a[0][0] : a[0];
  if (o && typeof o === "object") return o.path ? null : (o.host ?? "localhost");
  return typeof a[0] === "number" || /^\d+$/.test(String(a[0])) ? (typeof a[1] === "string" ? a[1] : "localhost") : null;
};
const orig = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  const host = ziel(a);
  if (host !== null && !LOKAL.test(host)) {
    const e = new Error(`NFA-08: Test wollte ins Netz (${host}). Externe Dienste im Test mocken.`);
    e.code = "ENETWORK_IM_TEST";
    process.nextTick(() => this.destroy(e));
    return this;
  }
  return orig.apply(this, a);
};
