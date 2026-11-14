import { test } from "node:test";
import assert from "node:assert/strict";
import { dubletten, pruefeKunde } from "../src/kunden.js";

const bestand = [
  { id: 1, name: "Anna Müller", firma: "Bühnenbau Müller GmbH", email: "anna@mueller.de", telefon: "0221 12345", plz: "50667", ort: "Köln" },
  { id: 2, name: "Bernd Schulz", firma: "", email: "", telefon: "+49 170 9876543", plz: "10115", ort: "Berlin" },
];

test("FA-27 Dublettenerkennung: E-Mail, Telefon, Firma ohne Rechtsform, ähnlicher Name am gleichen Ort", () => {
  assert.deepEqual(dubletten({ name: "X", email: "ANNA@mueller.de" }, bestand).map((d) => d.kunde.id), [1]);
  assert.deepEqual(dubletten({ name: "Y", telefon: "0170/9876543" }, bestand)[0].gruende, ["gleiche Telefonnummer"]);
  assert.deepEqual(dubletten({ name: "Z", firma: "Bühnenbau Müller" }, bestand)[0].gruende, ["gleiche Firma"]);
  assert.deepEqual(dubletten({ name: "Anna Mueller", ort: "Köln" }, bestand)[0].gruende, ["ähnlicher Name"]);
  assert.deepEqual(dubletten({ name: "Anna Müller", ort: "Hamburg" }, bestand), []);
  assert.deepEqual(dubletten({ name: "Clara Neu", ort: "Köln" }, bestand), []);
});
test("3.1 Kunde: Name (Ansprechpartner) ist Pflicht, E-Mail plausibel", () => {
  assert.ok(pruefeKunde({ name: " " }).name);
  assert.ok(pruefeKunde({ name: "A", email: "kaputt@" }).email);
  assert.deepEqual(pruefeKunde({ name: "A", email: "a@b.de", plz: "50667" }), {});
});
