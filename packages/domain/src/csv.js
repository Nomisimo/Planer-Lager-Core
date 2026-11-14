// CSV-Ausgabe mit Schutz gegen Formelinjektion (NFA-01): Zellen, die mit = + - @ Tab oder CR beginnen, bekommen ein '.
export function csvZelle(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Zeilen → CSV (Semikolon, Excel-DE), mit BOM. */
export const csv = (zeilen) => "﻿" + zeilen.map((z) => z.map(csvZelle).join(";")).join("\r\n") + "\r\n";
