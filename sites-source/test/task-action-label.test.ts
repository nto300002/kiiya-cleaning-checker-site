import { test } from "node:test";
import { strict as assert } from "node:assert";
import { taskActionLabel } from "../lib/task-action-label.ts";

test("task action shows the current state after starting, retaining the completion action", () => {
  assert.deepEqual(taskActionLabel({ startedAt: "", timeNote: "" }), { label: "開始", action: "start", status: null });
  assert.deepEqual(taskActionLabel({ startedAt: "13:20", timeNote: "" }), { label: "完了", action: "finish", status: "作業中" });
  assert.deepEqual(taskActionLabel({ startedAt: "", timeNote: "作業メモ" }), { label: "完了", action: "finish", status: null });
});
