import { test } from "node:test";
import assert from "node:assert/strict";
import { starteServer, starteApp, screenshot } from "./helfer.js";

test("Gerüst-Rauchtest: Testserver + beide Apps starten und zeigen die Anmeldung", async () => {
  const s = await starteServer();
  try {
    for (const name of ["materialplaner", "productionplaner"]) {
      const a = await starteApp(name, s.url);
      try {
        await a.win.getByTestId("anmeldung").waitFor({ timeout: 15000 });
        assert.match(await a.win.title(), /planer/i);
        await screenshot(a.win, `rauchtest-${name}`);
      } finally { await a.ende(); }
    }
  } finally { await s.ende(); }
});
