import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { starteTestServer } from "./helfer.js";
import { leseZip } from "../src/zip.js";

let s, admin, lager;
before(async () => {
  s = await starteTestServer();
  admin = await s.als("admin9", "Administrator");
  lager = await s.als("lager", "Lager / Techniker");
});
after(async () => { await s.ende(); });

test("FA-53 Plan-Symbole: Bibliothek bei jeder Artikeländerung neu, SVG je Artikel als Download, alle SVG als ZIP", async () => {
  const { rows: [k] } = await s.db.pool.query("INSERT INTO kategorie (name, praefix) VALUES ('Licht', 'LI') RETURNING id");
  const a = (await admin("POST", "/api/v1/artikel", { name: "Robe T1 Profile", kategorie_id: k.id, plansymbol: "movinghead" })).json.artikel;
  assert.equal((await admin("POST", "/api/v1/artikel", { name: "X", kategorie_id: k.id, plansymbol: "rakete" })).status, 400);
  const datei = path.join(s.dataDir, "plansymbole", "Symbolbibliothek.graphml");
  const warte = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); assert.ok(fn()); };
  await warte(() => fs.existsSync(datei) && fs.readFileSync(datei, "utf8").includes("Robe T1 Profile"));
  await admin("PUT", `/api/v1/artikel/${a.id}`, { name: "Robe T2 Profile" });
  await warte(() => fs.readFileSync(datei, "utf8").includes("Robe T2 Profile"));
  await s.db.pool.query("INSERT INTO artikel (name, kategorie_id, verbrauch) VALUES ('Gaffa-Tape', $1, true)", [k.id]);
  await s.db.pool.query("INSERT INTO artikel (name, kategorie_id, ist_leistung) VALUES ('Aufbau', $1, true)", [k.id]);
  await s.db.pool.query("INSERT INTO artikel (name, kategorie_id, aktiv) VALUES ('Alt-Lampe', $1, false)", [k.id]);
  const alle = (await lager("GET", "/api/v1/plansymbole")).json.zeilen.map((x) => x.name);
  assert.deepEqual(alle.sort(), ["Gaffa-Tape", "Robe T2 Profile"], "auch Verbrauch; keine Leistungen, keine inaktiven (D-85)");
  await s.db.pool.query("DELETE FROM artikel WHERE name IN ('Gaffa-Tape', 'Aufbau', 'Alt-Lampe')");
  const l = (await lager("GET", "/api/v1/plansymbole")).json;
  assert.equal(l.zeilen[0].piktogramm, "movinghead");
  assert.match(l.zeilen[0].svg, /<svg/);
  const svg = await lager("GET", `/api/v1/plansymbole/${a.id}.svg`);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.match(svg.headers.get("content-disposition"), /^attachment; filename="\d{4}-Robe-T2-Profile\.svg"/);
  const g = await lager("GET", "/api/v1/plansymbole/Symbolbibliothek.graphml");
  assert.match(g.text, /<y:SVGNode>/);
  const z = await fetch(`${s.url}/api/v1/plansymbole/svg.zip`, { headers: { Authorization: `Bearer ${lager.token}` } });
  assert.deepEqual(leseZip(Buffer.from(await z.arrayBuffer())).map((e) => e.name), [`${String(a.id).padStart(4, "0")}-Robe-T2-Profile.svg`]);
});
