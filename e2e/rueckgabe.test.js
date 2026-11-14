import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot, anmelden } from "./helfer.js";

test("T-12 T-13 T-14 T-15 FA-18 R-46 R-47 R-48 R-49 Materialplaner: Rückgabeansicht, Tasche, vermisst, wieder aufgetaucht, Funktionstest", async () => {
  const s = await starteServer();
  await s.benutzer("lager", "Lager / Techniker", "Lars Lager");
  const q = (sql, w) => s.db.pool.query(sql, w);
  const jahr = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(new Date());
  const heute = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
  const { rows: [k] } = await q("INSERT INTO kunde (name) VALUES ('Anna Müller') RETURNING id");
  const { rows: [li] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Licht', 'LI', 20) RETURNING id");
  const { rows: [ta] } = await q("INSERT INTO kategorie (name, praefix, letzte_nummer) VALUES ('Taschen', 'TA', 2) RETURNING id");
  const { rows: [akku] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Akku', $1) RETURNING id", [li.id]);
  const { rows: [lampe] } = await q("INSERT INTO artikel (name, kategorie_id) VALUES ('Lampe', $1) RETURNING id", [li.id]);
  const { rows: [tasche] } = await q("INSERT INTO artikel (name, kategorie_id, ist_case, inhalt_artikel_id, verpackungseinheit) VALUES ('Lampen-Tasche', $1, true, $2, 4) RETURNING id", [ta.id, lampe.id]);
  const { rows: [p] } = await q("INSERT INTO projekt (nummer, art, name, kunde_id, status, beginn) VALUES ($1, 'projekt', 'Stadtfest', $2, 'laeuft', '2027-05-01') RETURNING id", [`P-${jahr}-001`, k.id]);
  const geraet = async (code, artikel, caseId = null) => (await q(`INSERT INTO geraet (code, artikel_id, status, projekt_id, case_id, letzte_pruefung)
    VALUES ($1, $2, 'gepackt', $3, $4, (now() AT TIME ZONE 'Europe/Berlin')::date) RETURNING id`, [code, artikel, p.id, caseId])).rows[0].id;
  await geraet("LI-0001", akku.id);
  const t1 = await geraet("TA-0001", tasche.id);
  const t2 = await geraet("TA-0002", tasche.id);
  for (const n of [10, 11, 12, 13]) await geraet(`LI-00${n}`, lampe.id, t1);
  await geraet("LI-0014", lampe.id, t2);
  const status = async (code) => (await q("SELECT status, projekt_id, case_id, notizen FROM geraet WHERE code = $1", [code])).rows[0];
  const letzteBewegung = async (code) => (await q("SELECT b.aktion FROM bewegung b JOIN geraet g ON g.id = b.geraet_id WHERE g.code = $1 ORDER BY b.id DESC LIMIT 1", [code])).rows[0]?.aktion;
  try {
    const a = await starteApp("materialplaner", s.url);
    try {
      const w = a.win;
      await anmelden(w, "lager");
      const ergebnis = w.getByTestId("scan-ergebnis");
      const scanne = async (code) => { await w.getByTestId("scanfeld").fill(code); await w.getByTestId("scanfeld").press("Enter"); };
      // Weg zur Rückgabeansicht: Code scannen → Projekt → Packansicht → Rückgabe
      await w.getByRole("navigation", { name: "Hauptmenü" }).getByText("Code scannen", { exact: true }).click();
      await w.getByLabel("Projekt").selectOption(String(p.id));
      await w.getByRole("button", { name: "Packansicht", exact: true }).click();
      await w.getByRole("button", { name: "Rückgabe", exact: true }).click();
      await w.getByRole("heading", { name: `Rückgabe P-${jahr}-001 Stadtfest` }).waitFor();
      await w.getByTestId("rueckgabe-stand").getByText("8 noch draußen").waitFor();
      // T-12 Tasche zuerst, dann Inhalt
      await scanne("TA-0001");
      await ergebnis.getByText("TA-0001 Lampen-Tasche – Zurück im Lager – jetzt die 4 Teile (Lampe) darin scannen").waitFor();
      await w.getByTestId("tasche-stand").getByText("Lampen-Tasche: 4 von 4").waitFor();
      for (const c of ["LI-0010", "LI-0011"]) {
        await scanne(c);
        await ergebnis.getByText(`${c} Lampe – Zurück im Lager`).waitFor();
        assert.equal(await ergebnis.getAttribute("data-level"), "ok");
      }
      // Wechsel aus anderer Tasche → Gelb + Bewegung
      await scanne("LI-0014");
      await ergebnis.getByText(/lag in TA-0002 und ist jetzt in TA-0001/).waitFor();
      assert.equal(await ergebnis.getAttribute("data-level"), "warn");
      assert.equal(await letzteBewegung("LI-0014"), "Tasche gewechselt: TA-0002 -> TA-0001");
      await w.getByTestId("tasche-stand").getByText("Lampen-Tasche: 5 von 4").waitFor();
      for (const c of ["TA-0001", "LI-0010", "LI-0011", "LI-0014"]) assert.equal((await status(c)).status, "lager", c);
      assert.equal((await status("LI-0010")).case_id, t1, "Inhalt bleibt in der Tasche");
      await screenshot(w, "FA-18-rueckgabe");
      // T-13 Ein Gerät fehlt → Offene als vermisst melden
      await w.getByRole("button", { name: "Offene als vermisst melden", exact: true }).click();
      await w.getByRole("dialog").getByRole("button", { name: "Als vermisst melden" }).click();
      await w.getByText("2 Gerät(e) als vermisst gemeldet.").waitFor();
      for (const c of ["LI-0012", "LI-0013"]) {
        const g = await status(c);
        assert.deepEqual([g.status, g.projekt_id, g.case_id], ["vermisst", p.id, null], c);
        assert.equal(await letzteBewegung(c), `Als vermisst gemeldet, Projekt P-${jahr}-001, zuletzt in TA-0001`);
      }
      await w.getByTestId("rueckgabe-stand").getByText("2 vermisst").waitFor();
      await w.getByRole("button", { name: "Tasche beenden" }).click();
      await w.getByTestId("tasche-stand").waitFor({ state: "detached" });
      // T-14 Vermisstes Gerät wird zurückgescannt
      await scanne("LI-0012");
      await ergebnis.getByText(/wieder aufgetaucht/).waitFor();
      assert.equal(await ergebnis.getAttribute("data-level"), "warn");
      assert.equal((await status("LI-0012")).status, "lager");
      await w.getByTestId("rueckgabe-stand").getByText("1 vermisst").waitFor();
      // T-15 Funktionstest „Mangel“
      await w.getByLabel("Funktionstest nach jedem Scan").check();
      await scanne("LI-0001");
      await ergebnis.getByText("LI-0001 Akku – Zurück im Lager").waitFor();
      await w.getByRole("button", { name: "Mangel", exact: true }).click();
      await w.getByLabel("Was ist kaputt?").fill("Kontakt locker");
      await w.getByRole("button", { name: "Mangel speichern" }).click();
      await w.getByText("LI-0001 ist jetzt „Defekt“ und kann nicht gepackt werden, bis es repariert ist.").waitFor();
      const d = await status("LI-0001");
      assert.equal(d.status, "defekt");
      assert.ok(d.notizen.includes("Mangel bei Rückgabe: Kontakt locker") && /\d{2}\.\d{2}\.\d{4}/.test(d.notizen), `Notiz mit Datum: ${d.notizen} (${heute})`);
      assert.equal(await letzteBewegung("LI-0001"), "Mangel bei Rückgabe: Kontakt locker");
      // Funktionstest „bestanden“
      await scanne("LI-0013");
      await w.getByRole("button", { name: "Bestanden", exact: true }).click();
      await w.getByText("LI-0013: Funktionstest bestanden.").waitFor();
      assert.equal(await letzteBewegung("LI-0013"), "Funktionstest bestanden");
      await screenshot(w, "R-47-funktionstest");
    } finally { await a.ende(); }
  } finally { await s.ende(); }
});
