import { test } from "node:test";
import assert from "node:assert/strict";
import { rundeCent, centMalProzent, euro, centAusText } from "../src/geld.js";

test("Geld: Integer-Cent, kaufmännisch runden, Anzeige und Eingabe deutsch", () => {
  assert.equal(rundeCent(0.5), 1);
  assert.equal(rundeCent(-0.5), -1);
  assert.equal(rundeCent(2.4999), 2);
  assert.equal(rundeCent(2.4999999999), 3, "Gleitkomma-Rauschen wird als ,5 behandelt");
  assert.equal(rundeCent(1.005 * 100 / 100), 1);
  assert.equal(centMalProzent(1001, 50), 501, "500,5 → 501");
  assert.equal(centMalProzent(999, 50), 500, "499,5 → 500");
  assert.equal(euro(123450), "1.234,50 €");
  assert.equal(euro(-5), "-0,05 €");
  assert.equal(centAusText("1.234,50 €"), 123450);
  assert.equal(centAusText("12,5"), 1250);
  assert.equal(centAusText("12.5"), 1250);
  assert.equal(centAusText("0,005"), 1);
  assert.equal(centAusText("abc"), null);
  assert.equal(centAusText(""), null);
});
