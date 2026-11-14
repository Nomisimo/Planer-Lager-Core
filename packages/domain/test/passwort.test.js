import { test } from "node:test";
import assert from "node:assert/strict";
import { pruefePasswort } from "../src/passwort.js";

test("R-09 Passwortregeln: Länge, nur Ziffern, häufig, ähnlich Benutzername", () => {
  assert.match(pruefePasswort("kurz1", "anna").join(), /zu kurz/);
  assert.match(pruefePasswort("12345678901", "anna").join(), /nur aus Ziffern/);
  assert.match(pruefePasswort("Passwort123", "anna").join(), /verbreitet/);
  assert.match(pruefePasswort("annamueller1", "annamueller").join(), /ähnelt/);
  assert.deepEqual(pruefePasswort("Grüner-Kabelbaum-7", "anna"), []);
});
