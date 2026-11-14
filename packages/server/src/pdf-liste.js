// Gemeinsames Layout für Listen-Belege (Inventurprotokoll FA-06, Lieferschein und Rückgabeprotokoll FA-21):
// Firmenkopf, Titel, Kopfangaben, Abschnitte mit Tabellen, Unterschriftsfelder.
import PDFDocument from "pdfkit";

export const MM = 72 / 25.4;

/**
 * @param {{titel: string, firma?: object, kopf?: Array<[string, string]>, abschnitte: Array<{titel: string, spalten: Array<{t: string, w: number, r?: boolean}>, zeilen: string[][], leer?: string, hinweis?: string}>, unterschriften?: string[], fuss?: string}} beleg
 * @returns {Promise<Buffer>}
 */
export function listenPdf({ titel, firma = {}, kopf = [], abschnitte, unterschriften = [], fuss = "" }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 20 * MM, info: { Title: titel }, bufferPages: true });
    const teile = [];
    doc.on("data", (d) => teile.push(d)).on("end", () => resolve(Buffer.concat(teile))).on("error", reject);
    const L = 20 * MM, B = doc.page.width - 40 * MM, UNTEN = doc.page.height - 25 * MM;
    const neueSeite = () => { doc.addPage(); doc.y = 20 * MM; };
    if (firma.name) {
      doc.font("Helvetica-Bold").fontSize(10).text(firma.name, L, 15 * MM);
      doc.font("Helvetica").fontSize(7.5).fillColor("#555").text([firma.strasse, [firma.plz, firma.ort].filter(Boolean).join(" "), firma.telefon, firma.email].filter(Boolean).join(" · ")).fillColor("#000");
      doc.moveDown(1.5);
    }
    doc.font("Helvetica-Bold").fontSize(14).text(titel, L);
    doc.moveDown(0.4);
    for (const [k, v] of kopf) doc.font("Helvetica-Bold").fontSize(9).text(`${k}: `, L, doc.y, { continued: true }).font("Helvetica").text(v || "–");
    for (const a of abschnitte) {
      doc.moveDown(1);
      if (doc.y + 40 > UNTEN) neueSeite();
      doc.font("Helvetica-Bold").fontSize(11).text(a.titel, L);
      if (a.hinweis) doc.font("Helvetica").fontSize(8).fillColor("#555").text(a.hinweis, L, doc.y, { width: B }).fillColor("#000");
      doc.moveDown(0.3);
      const breite = a.spalten.reduce((s, x) => s + x.w, 0);
      const faktor = B / (breite * MM);
      const kopfzeile = () => {
        let x = L; const y = doc.y;
        doc.font("Helvetica-Bold").fontSize(8.5);
        for (const s of a.spalten) { doc.text(s.t, x, y, { width: s.w * MM * faktor, align: s.r ? "right" : "left" }); x += s.w * MM * faktor; }
        doc.moveTo(L, doc.y + 2).lineTo(L + B, doc.y + 2).strokeColor("#999").stroke();
        doc.y += 5;
      };
      if (!a.zeilen.length) { doc.font("Helvetica").fontSize(9).text(a.leer || "Keine Einträge.", L); continue; }
      kopfzeile();
      for (const z of a.zeilen) {
        doc.font("Helvetica").fontSize(9);
        const h = Math.max(...a.spalten.map((s, j) => doc.heightOfString(String(z[j] ?? ""), { width: s.w * MM * faktor }))) + 3;
        if (doc.y + h > UNTEN) { neueSeite(); kopfzeile(); }
        const y = doc.y; let x = L;
        a.spalten.forEach((s, j) => { doc.text(String(z[j] ?? ""), x, y, { width: s.w * MM * faktor, align: s.r ? "right" : "left" }); x += s.w * MM * faktor; });
        doc.y = y + h;
      }
    }
    if (unterschriften.length) {
      if (doc.y + 30 * MM > UNTEN) neueSeite();
      doc.y += 18 * MM;
      const w = (B - (unterschriften.length - 1) * 10 * MM) / unterschriften.length;
      const y = doc.y;
      unterschriften.forEach((u, i) => {
        const x = L + i * (w + 10 * MM);
        doc.moveTo(x, y).lineTo(x + w, y).strokeColor("#000").stroke();
        doc.font("Helvetica").fontSize(8).text(`${u} (Datum, Name, Unterschrift)`, x, y + 3, { width: w });
      });
    }
    // Seitenzahlen und Fußzeile
    const r = doc.bufferedPageRange();
    for (let i = 0; i < r.count; i++) {
      doc.switchToPage(r.start + i);
      doc.page.margins.bottom = 0; // Fußzeile im unteren Rand ohne neue Seite
      doc.font("Helvetica").fontSize(7).fillColor("#777").text(`${fuss ? `${fuss} · ` : ""}Seite ${i + 1} von ${r.count}`, L, doc.page.height - 15 * MM, { width: B, align: "right", lineBreak: false }).fillColor("#000");
    }
    doc.end();
  });
}

/** Sendet ein PDF (inline zur Vorschau oder als Download). */
export function sendePdf(ctx, puffer, name, inline = true) {
  ctx.res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  ctx.res.end(puffer);
}
