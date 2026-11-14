import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

test("T-07 T-08 T-09 T-10 T-11 FA-15 FA-17 R-23 UI-3 UI-4 Materialplaner: Scannen, Packansicht, Handscanner, Netzwerk-Scanner, Verladen", async () => {
  const s = await starteServer();
  await s.benutzer("lager", "Lager / Techniker", "Lars Lager");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const jahr = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(new Date());
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [li] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 20) RETURNING id");
  const { rows: [ta] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Taschen', 'TA', 2) RETURNING id");
  const { rows: [akku] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Akku', $1) RETURNING id", [li.id]);
  const { rows: [lampe] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Lampe', $1) RETURNING id", [li.id]);
  const { rows: [tasche] } = await q("INSERT INTO artikel (name, kategorie_id, ist_case, inhalt_artikel_id, verpackungseinheit) VALUES ('Lampen-Tasche', $1, true, $2, 4) RETURNING id", [ta.id, lampe.id]);
  const geraet = async (code, artikel, extra = "") => (await q(`INSERT INTO geraet (code, artikel_id, letzte_pruefung) VALUES ($1, $2, ${extra || "(now() AT TIME ZONE 'Europe/Berlin')::date"}) RETURNING id`, [code, artikel])).rows[0].id;
  for (const n of [1, 2, 3, 5]) await geraet(`LI-000${n}`, akku.id);
  await geraet("LI-0004", akku.id, "'2020-01-01'");
  const t1 = await geraet("TA-0001", tasche.id);
  const t2 = await geraet("TA-0002", tasche.id);
  for (let n = 10; n < 17; n++) { const g = await geraet(`LI-00${n}`, lampe.id); await q("UPDATE geraet SET case_id = $1 WHERE id = $2", [n < 14 ? t1 : t2, g]); }
  const projekt = async (nr, name, status) => (await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ($1, 'projekt', $2, $3, $4, '2027-05-01') RETURNING id", [`P-${jahr}-00${nr}`, name, k.id, status])).rows[0].id;
  const p1 = await projekt(1, "Stadtfest", "bestaetigt");
  const p2 = await projekt(2, "Messe", "laeuft");
  await q("UPDATE geraet SET projekt_id = $1, status = 'gepackt' WHERE code = 'LI-0003'", [p2]);
  const { rows: [a] } = await q("INSERT INTO angebot (nummer, projekt_id, status) VALUES ($1, $2, 'angenommen') RETURNING id", [`A-${jahr}-001`, p1]);
  for (const [i, [art, menge]] of [[akku.id, 2], [tasche.id, 1], [lampe.id, 4]].entries())
    await q("INSERT INTO angebot_position (angebot_id, pos, art, artikel_id, menge) VALUES ($1, $2, 'miete', $3, $4)", [a.id, i + 1, art, menge]);
  const token = "e2e-netzwerk-scanner-token-123456";
  await q("INSERT INTO scanner (name, token_hash) VALUES ('Rampe', $1)", [createHash("sha256").update(token).digest("hex")]);
  try {
    const p = await starteApp("materialplaner", s.url);
    try {
      const w = p.win;
      await anmelden(w, "lager");
      const menue = w.getByRole("navigation", { name: "Hauptmenü" });
      const ergebnis = w.getByTestId("scan-ergebnis");
      const scanne = async (code) => { await w.getByTestId("scanfeld").fill(code); await w.getByTestId("scanfeld").press("Enter"); };
      // FA-15 Scan-Seite
      await menue.getByText("Code scannen", { exact: true }).click();
      assert.equal(await w.getByTestId("scanfeld").isDisabled(), true, "ohne Projekt gesperrt");
      await w.getByLabel("Projekt").selectOption(String(p1));
      await scanne("li1");
      await ergebnis.getByText("LI-0001 Akku – Gepackt").waitFor();
      assert.equal(await ergebnis.getAttribute("data-level"), "ok");
      assert.ok(Number(await ergebnis.getAttribute("data-dauer")) < 2000, "FA-15: Rückmeldung unter 2 s");
      await screenshot(w, "FA-15-scan");
      // R-23 Projektcode öffnet die Packansicht
      await scanne(`p ${jahr} 1`);
      await w.getByRole("heading", { name: `Packen P-${jahr}-001 Stadtfest` }).waitFor();
      // UI-3 Handscanner ohne Fokus im Feld: schnelle Tastenfolge + Enter
      await w.getByRole("button", { name: "Rückgabe" }).focus();
      await w.keyboard.type("LI-0002", { delay: 5 });
      await w.keyboard.press("Enter");
      assert.equal(await w.getByTestId("scanfeld").inputValue(), "", "Zeichen landen nicht im Feld");
      await ergebnis.getByText("LI-0002 Akku – Gepackt").waitFor();
      // T-08 Case mit Inhalt → mitgebucht
      await scanne("TA-0001");
      await ergebnis.getByText("TA-0001 Lampen-Tasche – Gepackt (inkl. 4 Inhalte)").waitFor();
      assert.equal(await ergebnis.getAttribute("data-level"), "ok");
      // T-07 alle grün, Packliste vollständig
      await w.getByTestId("fortschritt").getByText("100 %").waitFor();
      await w.getByText("Packliste vollständig").waitFor();
      await screenshot(w, "FA-17-packansicht");
      // T-09 Gerät aus anderem Projekt → rot, nennt Projekt
      await scanne("LI-0003");
      await ergebnis.getByText(`LI-0003 ist bereits in Projekt P-${jahr}-002 Messe, übersprungen.`).waitFor();
      assert.equal(await ergebnis.getAttribute("data-level"), "error");
      await ergebnis.getByText("LI-0003 Akku – nicht gebucht").waitFor();
      // T-10 überfällige Prüfung → gelb, trotzdem gebucht
      await scanne("LI-0004");
      await ergebnis.getByText("LI-0004: Prüfung überfällig!").waitFor();
      assert.equal(await ergebnis.getAttribute("data-level"), "warn");
      assert.equal((await q("SELECT status FROM geraet WHERE code = 'LI-0004'")).rows[0].status, "gepackt");
      // T-08 Case mit zu wenig Inhalt → gelb
      await scanne("TA-0002");
      await ergebnis.getByText(/Case unvollständig: 3 von 4 Teilen eingetragen/).waitFor();
      assert.equal(await ergebnis.getAttribute("data-level"), "warn");
      // Netzwerk-Scanner per HTTP → Ergebnis erscheint am abonnierten Bildschirm
      await w.getByLabel("Netzwerk-Scanner").selectOption({ label: "Rampe" });
      await w.waitForTimeout(300);
      const r = await fetch(`${s.url}/api/v1/scanner/eingang`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Scanner ${token}` }, body: JSON.stringify({ code: "LI-0005" }) });
      assert.equal(r.status, 200);
      await ergebnis.getByText("LI-0005 Akku – Gepackt").waitFor();
      // T-11 Packen abgeschlossen & verladen
      await w.getByRole("button", { name: "Packen abgeschlossen & verladen" }).click();
      await w.getByRole("dialog").getByRole("button", { name: "Verladen" }).click();
      await w.getByText(/verladen, Status „Läuft“/).waitFor();
      const { rows: [x] } = await q("SELECT status, gepackt_am, gepackt_von_name, ladezone_id FROM projekt WHERE id = $1", [p1]);
      assert.deepEqual([x.status, !!x.gepackt_am, x.gepackt_von_name, x.ladezone_id], ["laeuft", true, "Lars Lager", null]);
      await w.getByRole("button", { name: "Packen wieder öffnen" }).waitFor();
    } finally { await p.ende(); }
  } finally { await s.ende(); }
});
