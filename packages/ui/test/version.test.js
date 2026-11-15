import { test } from "node:test";
import assert from "node:assert/strict";
import { vergleicheVersion, changelogAbschnitt, neuereVersion } from "../src/version.js";


test("REL-03 Versionsvergleich mit Vorabversionen (SemVer)", () => {
  const folge = ["0.1.0-beta.1", "0.2.0-beta.1", "0.2.0-beta.2", "0.2.0-beta.10", "0.2.0", "0.10.0", "1.0.0-beta.1", "1.0.0"];
  for (let i = 1; i < folge.length; i++) assert.ok(vergleicheVersion(folge[i - 1], folge[i]) < 0, `${folge[i - 1]} < ${folge[i]}`);
  assert.equal(vergleicheVersion("v1.2.3", "1.2.3"), 0);
});

test("REL-03 neuere Version aus der Releases-Liste, Entwürfe zählen nicht", () => {
  const liste = [
    { tag_name: "v0.3.0-beta.1", html_url: "https://example.invalid/r/3", prerelease: true },
    { tag_name: "v0.4.0", draft: true },
    { tag_name: "v0.2.0-beta.1", html_url: "https://example.invalid/r/2" },
  ];
  assert.deepEqual(neuereVersion(liste, "0.2.0-beta.1"), { version: "0.3.0-beta.1", url: "https://example.invalid/r/3" });
  assert.equal(neuereVersion(liste, "0.3.0-beta.1"), null);
  assert.equal(neuereVersion(null, "0.1.0"), null);
});

test("REL-02 CHANGELOG-Abschnitt der laufenden Version", () => {
  const md = "# Änderungen\n\n## [Unveröffentlicht]\n\n## [0.2.0-beta.1] – 2026-11-15\n\n- A\n- B\n\n## [0.1.0-beta.1] – 2026-11-14\n\n- C\n";
  assert.equal(changelogAbschnitt(md, "0.2.0-beta.1"), "- A\n- B");
  assert.equal(changelogAbschnitt(md, "0.1.0-beta.1"), "- C");
  assert.equal(changelogAbschnitt(md, "0.2.0"), "");
});

