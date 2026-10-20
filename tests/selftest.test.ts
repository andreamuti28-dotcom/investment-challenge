import { test } from "node:test";
import assert from "node:assert/strict";
import { runSelfTest } from "../supabase/functions/_shared/selftest.ts";
test("acceptance values from the organiser Excel", () => {
  const r = runSelfTest();
  for (const c of r.checks) if (!c.pass) console.log("FAIL", c);
  assert.equal(r.pass, true);
  console.log(`${r.checks.length} checks passed`);
});
