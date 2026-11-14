import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp } from "./helfer.js";

test("FA-25 Kiosk-Modus: Materialplaner --arbeitsplatz lädt das Arbeitsplatz-Web vom Server und bleibt dort", async () => {
  const s = await starteServer();
  try {
    const a = await starteApp("materialplaner", s.url, { argv: ["--arbeitsplatz"] });
    try {
      const w = a.win;
      await w.getByLabel("Einrichtungscode").waitFor();
      assert.equal(new URL(w.url()).pathname, "/station");
      await w.evaluate(() => { window.location.href = "/api/v1/kunden"; }).catch(() => {});
      await w.waitForTimeout(300);
      assert.equal(new URL(w.url()).pathname, "/station", "keine Navigation weg vom Arbeitsplatz");
    } finally { await a.ende(); }
  } finally { await s.ende(); }
});
