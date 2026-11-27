import test from "node:test";
import assert from "node:assert/strict";
import { assignUnassignedTasks, cleanWork, makeWork } from "../lib/domain.ts";
import { mergeWork } from "../lib/merge-work.ts";

test("別項目の変更は両方を保持する", () => {
  const base = makeWork("担当者"), server = structuredClone(base), local = structuredClone(base);
  server.notes = "別端末の所感";
  local.keyMemo = "この端末の鍵メモ";
  const result = mergeWork(base, server, local);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.data.notes, server.notes);
  assert.equal(result.data.keyMemo, local.keyMemo);
});

test("同じ項目の変更だけ選択を求める", () => {
  const base = makeWork("担当者"), server = structuredClone(base), local = structuredClone(base);
  server.notes = "別端末";
  local.notes = "この端末";
  const unresolved = mergeWork(base, server, local);
  assert.deepEqual(unresolved.conflicts.map(item => item.path), ["notes"]);
  assert.equal(mergeWork(base, server, local, { notes: "local" }).data.notes, "この端末");
  assert.equal(mergeWork(base, server, local, { notes: "server" }).data.notes, "別端末");
});

test("人数変更と旧条件の確認が別端末で重なれば再確認する", () => {
  const base = makeWork("担当者"); base.roomCodes = ["203"];
  const server = structuredClone(base), local = structuredClone(base);
  server.rooms["203"].adults = 2;
  local.roomAnswers["203"] = { type: "checkout", checks: { adult_slippers: true, toothbrushes: true, bedmaking: true }, finalConfirmed: true };
  const result = mergeWork(base, server, local);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.data.rooms["203"].adults, 2);
  assert.equal(result.data.roomAnswers["203"]?.checks.adult_slippers, false);
  assert.equal(result.data.roomAnswers["203"]?.finalConfirmed, false);
});

test("作業種別の変更後は旧条件の客室確認を残さない", () => {
  const base = makeWork("担当者"); base.roomCodes = ["203"];
  const server = structuredClone(base), local = structuredClone(base);
  server.rooms["203"].type = "stay_cleaning";
  local.roomAnswers["203"] = { type: "checkout", checks: { roomclean: true }, finalConfirmed: true };
  const result = mergeWork(base, server, local);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.data.roomAnswers["203"], undefined);
});

test("対象客室が増えたら旧対象で完了した作業を再確認する", () => {
  const base = makeWork("担当者"); base.roomCodes = ["203"];
  const server = structuredClone(base), local = structuredClone(base);
  server.roomCodes = ["203", "204"];
  local.tasks.bedmaking.completed = true;
  const result = mergeWork(base, server, local);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.data.tasks.bedmaking.completed, false);
});

test("一括割当の再実行は個別変更済みと開始済みの作業を上書きしない", () => {
  const work = makeWork("担当者"); work.staffNames = ["A", "B"];
  assignUnassignedTasks(work, "A");
  work.tasks.corridor.assignees = [];
  work.tasks.corridor.assigneeCustomized = true;
  work.tasks.lounge.startedAt = "09:55";
  work.tasks.lounge.assignees = [];
  work.tasks.stairsEntrance.assignees = [];
  assignUnassignedTasks(work, "B");
  assert.deepEqual(work.tasks.corridor.assignees, []);
  assert.deepEqual(work.tasks.lounge.assignees, []);
  assert.deepEqual(work.tasks.stairsEntrance.assignees, ["B"]);
  assert.equal(cleanWork(work).tasks.corridor.assigneeCustomized, true);
});
