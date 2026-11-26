import assert from "node:assert/strict";
import { test } from "node:test";
import { verificationRequestId } from "../lib/verification-request-id.ts";

test("only a confirmed failed request ID is rotated; uncertain new requests are reused", () => {
  const failed = { status: "Failed", requestId: "old" };
  assert.equal(verificationRequestId("old", failed, () => "new"), "new");
  assert.equal(verificationRequestId("new", failed, () => "other"), "new");
  assert.equal(verificationRequestId("unknown", { status: "Unknown", requestId: "unknown" }, () => "other"), "unknown");
  assert.equal(verificationRequestId(null, failed, () => "new"), "new");
});
