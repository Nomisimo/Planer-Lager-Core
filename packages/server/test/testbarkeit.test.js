// NFA-07 Wartbarkeit (Fachcode getrennt) und NFA-08 Testbarkeit (ohne Netz, ohne echte Daten).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neueTestDb } from "@lager/db/testdb.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("NFA-07 Fachlogik (packages/domain) hängt weder an Datenbank, Server noch Oberfläche", () => {
  const dir = path.join(ROOT, "packages/domain/src");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const importe = [...fs.readFileSync(path.join(dir, f), "utf8").matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]);
    for (const i of importe) assert.ok(i.startsWith("./") || i.startsWith("node:"), `${f} importiert ${i}`);
  }
});

test("NFA-08 Tests laufen mit eigenem Schema und temporärem Datenordner, nie in echten Daten", async () => {
  const db = await neueTestDb({ migrieren: false });
  try {
    assert.match(db.schema, /^t_[0-9a-f]{10}$/);
    const { rows: [{ s }] } = await db.pool.query("SELECT current_schema() AS s");
    assert.equal(s, db.schema);
  } finally { await db.ende(); }
  const helfer = fs.readFileSync(path.join(ROOT, "packages/server/test/helfer.js"), "utf8");
  assert.match(helfer, /mkdtempSync\(path\.join\(os\.tmpdir\(\)/, "Datenordner im Test ist temporär");
  assert.ok(os.tmpdir());
});

test("NFA-08 Tests laufen ohne Netz: Verbindung zu einem fremden Rechner wird abgewiesen", { skip: !process.execArgv.join(" ").includes("ohne-netz") && "nur über npm test (lädt scripts/ohne-netz.mjs)" }, async () => {
  await assert.rejects(fetch("https://example.org/"), (e) => /NFA-08/.test(String(e.cause?.message || e.message)));
  const r = await fetch("http://127.0.0.1:1/").catch((e) => e);
  assert.doesNotMatch(String(r.cause?.message || r.message), /NFA-08/, "lokal bleibt erlaubt");
});
