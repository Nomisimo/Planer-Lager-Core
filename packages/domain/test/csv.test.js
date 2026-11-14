import { test } from "node:test";
import assert from "node:assert/strict";
import { csvZelle, csv } from "../src/csv.js";

test("NFA-01 CSV-Zellen gegen Formelinjektion geschützt", () => {
  assert.equal(csvZelle("=SUMME(A1)"), "'=SUMME(A1)");
  assert.equal(csvZelle("+49 170"), "'+49 170");
  assert.equal(csvZelle("-5"), "'-5");
  assert.equal(csvZelle("@x"), "'@x");
  assert.equal(csvZelle("\tx"), "'\tx");
  assert.equal(csvZelle("\r=1"), "\"'\r=1\"");
  assert.equal(csvZelle("normal"), "normal");
  assert.equal(csvZelle('a;"b"'), '"a;""b"""');
  assert.equal(csv([["a", 1]]), "﻿a;1\r\n");
});
