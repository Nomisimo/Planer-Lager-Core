import { test } from "node:test";
import assert from "node:assert/strict";
import { totpCode, pruefeTotp, base32, vonBase32 } from "../src/totp.js";

test("FA-54 TOTP nach RFC 6238 (Testvektor SHA-1) und Toleranz ±30 s", () => {
  const geheim = base32(Buffer.from("12345678901234567890"));
  assert.deepEqual(vonBase32(geheim), Buffer.from("12345678901234567890"));
  // RFC 6238 Anhang B: T=59 s → 94287082 (8 Stellen) → 6 Stellen 287082
  assert.equal(totpCode(geheim, 59_000), "287082");
  assert.equal(totpCode(geheim, 1_111_111_109_000), "081804");
  assert.equal(pruefeTotp(geheim, "287082", 59_000 + 30_000), true);
  assert.equal(pruefeTotp(geheim, "287082", 59_000 + 90_000), false);
  assert.equal(pruefeTotp(geheim, "abc"), false);
});
