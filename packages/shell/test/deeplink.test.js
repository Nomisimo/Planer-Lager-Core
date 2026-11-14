import { test } from "node:test";
import assert from "node:assert/strict";
import { zerlegeDeepLink, baueDeepLink, linkAusArgv } from "../src/deeplink.js";

test("Deep-Link: materialplaner://geraet/LT-0001 wird zerlegt", () => {
  assert.deepEqual(zerlegeDeepLink("materialplaner://geraet/LT-0001"), { app: "materialplaner", pfad: ["geraet", "LT-0001"], query: {} });
  assert.deepEqual(zerlegeDeepLink("productionplaner://projekt/P-2026-001?handoff=ab"), { app: "productionplaner", pfad: ["projekt", "P-2026-001"], query: { handoff: "ab" } });
  assert.equal(zerlegeDeepLink("file:///etc/passwd"), null);
  assert.equal(zerlegeDeepLink(""), null);
});

test("Deep-Link: Bauen und Zerlegen sind umkehrbar, argv-Suche", () => {
  const l = baueDeepLink("materialplaner", ["projekt", "12", "packen"], { handoff: "x y" });
  assert.deepEqual(zerlegeDeepLink(l), { app: "materialplaner", pfad: ["projekt", "12", "packen"], query: { handoff: "x y" } });
  assert.equal(linkAusArgv(["/app", "--x", "materialplaner://geraet/A"], "materialplaner"), "materialplaner://geraet/A");
  assert.equal(linkAusArgv(["/app"], "materialplaner"), null);
  assert.throws(() => baueDeepLink("fremd", []));
});
