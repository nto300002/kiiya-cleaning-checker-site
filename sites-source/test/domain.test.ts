import test from "node:test";
import assert from "node:assert/strict";
import { activeTasks, bedmakingLabel, bedmakingTargetLabel, cleanWork, extraBedRequired, makeWork, missingForReport, reportBody, roomCheckKeys, setRoomNoStay, targetRooms, updateRoomOccupancy } from "../lib/domain.ts";

test("204号室は5名、206号室は3名のときだけEXベッドを表示する", () => {
  const work = makeWork("担当職員");
  for (const [code, total, expected] of [["204", 4, false], ["204", 5, true], ["206", 2, false], ["206", 3, true], ["203", 2, false], ["205", 4, false]] as const) {
    work.rooms[code].adults = total;
    assert.equal(extraBedRequired(code, work.rooms[code]), expected);
    assert.equal(bedmakingLabel(code, work.rooms[code]), expected ? "ベッドメイク+EXベッド" : "ベッドメイク");
  }
  work.rooms["204"].adults = 3;
  work.rooms["204"].children = 2;
  assert.equal(extraBedRequired("204", work.rooms["204"]), true);
});

test("人数変更はEX判定を更新し、ベッドメイクと最終確認を再確認に戻す", () => {
  const work = makeWork("担当職員");
  work.roomCodes = ["204"];
  work.roomAnswers["204"] = { type: "checkout", checks: { bedmaking: true, pillows: true }, finalConfirmed: true };
  updateRoomOccupancy(work, "204", 5, 0);
  assert.equal(work.rooms["204"].extraBedUsers, 1);
  assert.equal(work.roomAnswers["204"]?.checks.bedmaking, false);
  assert.equal(work.roomAnswers["204"]?.finalConfirmed, false);
  assert.equal(work.roomAnswers["204"]?.checks.pillows, false);
  updateRoomOccupancy(work, "204", 4, 0);
  assert.equal(work.rooms["204"].extraBedUsers, 0);
});

test("API保存は手動のEX値を採用せず、人数変更時の古い確認を無効にする", () => {
  const original = makeWork("担当職員");
  original.roomCodes = ["206"];
  original.rooms["206"].adults = 2;
  original.roomAnswers["206"] = { type: "checkout", checks: { bedmaking: true }, finalConfirmed: true };
  const next = structuredClone(original);
  next.rooms["206"].adults = 2;
  next.rooms["206"].children = 1;
  next.rooms["206"].extraBedUsers = 0;
  const saved = cleanWork(next, original);
  assert.equal(saved.rooms["206"].extraBedUsers, 1);
  assert.equal(saved.roomAnswers["206"]?.checks.bedmaking, false);
  assert.equal(saved.roomAnswers["206"]?.finalConfirmed, false);
});

test("混在する対象室と報告にはEX対象の部屋だけを示す", () => {
  const work = makeWork("担当職員");
  work.roomCodes = ["203", "204", "206"];
  work.rooms["204"].adults = 5;
  work.rooms["206"].adults = 2;
  assert.equal(bedmakingTargetLabel(work), "203号室・204号室（EX）・206号室");
  const body = reportBody("2026-10-22", work);
  assert.match(body, /204号室（EX）/);
  assert.doesNotMatch(body, /206号室（EX）/);
});

test("対象室ゼロ件では客室3作業を必須にしない", () => {
  const work = makeWork("担当職員");
  assert.equal(activeTasks(work).includes("amenities"), false);
  assert.equal(activeTasks(work).includes("bedmaking"), false);
  assert.equal(activeTasks(work).includes("roomclean"), false);
});
test("全室アメニティのみでもアメニティセットは必要", () => {
  const work = makeWork("担当職員");
  work.roomCodes = ["203"];
  work.rooms["203"].type = "stay_amenities_only";
  assert.equal(activeTasks(work).includes("amenities"), true);
  assert.equal(activeTasks(work).includes("bedmaking"), false);
  assert.equal(activeTasks(work).includes("roomclean"), false);
});
test("0人室は全清掃種別でアメニティと枕を確認項目から外し、最終確認を残す", () => {
  const work = makeWork("担当職員");
  work.roomCodes = ["203"];
  work.rooms["203"].adults = 0;
  for (const [type, keys] of [
    ["checkout", ["bedmaking", "roomclean"]],
    ["stay_cleaning", ["sheets", "trash", "roomclean"]],
    ["stay_amenities_only", []],
  ] as const) {
    work.rooms["203"].type = type;
    assert.deepEqual(roomCheckKeys(work.rooms["203"]), keys);
    work.roomAnswers["203"] = { type, checks: Object.fromEntries(keys.map(key => [key, true])), finalConfirmed: false };
    const missing = missingForReport(work);
    assert(!missing.includes("203号室の宿泊人数"));
    assert(missing.includes("203号室の職員最終確認"));
    assert(!missing.some(item => item.startsWith("203号室: ")));
  }
});
test("0人室をアメニティ作業から除き、清掃作業と報告の宿泊なし表示を残す", () => {
  const work = makeWork("担当職員");
  work.roomCodes = ["203", "206"];
  work.rooms["203"].adults = 0;
  work.rooms["206"].adults = 3;
  assert.deepEqual(targetRooms(work, "amenities"), ["206"]);
  assert.deepEqual(targetRooms(work, "bedmaking"), ["203", "206"]);
  assert.match(reportBody("2026-10-22", work), /宿泊なし：203号室/);
  work.rooms["206"].adults = 0;
  assert(!activeTasks(work).includes("amenities"));
  assert(activeTasks(work).includes("bedmaking"));
  work.rooms["203"].type = "stay_amenities_only";
  work.rooms["206"].type = "stay_amenities_only";
  assert(!activeTasks(work).includes("amenities"));
  assert(!activeTasks(work).includes("bedmaking"));
});
test("人数変更は旧アメニティ回答・作業完了を再利用しない", () => {
  const work = makeWork("担当職員");
  work.roomCodes = ["203"];
  work.roomAnswers["203"] = { type: "checkout", checks: { adult_slippers: true, toothbrushes: true, bedmaking: true, pillows: true, roomclean: true }, finalConfirmed: true };
  work.tasks.amenities.completed = true;
  work.tasks.bedmaking.completed = true;
  updateRoomOccupancy(work, "203", 0, 0);
  assert.equal(work.roomAnswers["203"]?.finalConfirmed, false);
  assert.equal(work.tasks.amenities.completed, false);
  assert.equal(work.tasks.bedmaking.completed, false);
  updateRoomOccupancy(work, "203", 1, 0);
  assert.equal(work.roomAnswers["203"]?.checks.adult_slippers, false);
  assert.equal(work.roomAnswers["203"]?.checks.toothbrushes, false);
  assert.equal(work.roomAnswers["203"]?.checks.pillows, false);
  assert.equal(work.roomAnswers["203"]?.finalConfirmed, false);
});
test("宿泊なしの切替は清掃種別を維持し、人数と確認条件を更新する", () => {
  const work = makeWork("担当職員");
  work.roomCodes = ["206"];
  work.rooms["206"].type = "checkout";
  work.rooms["206"].adults = 3;
  work.roomAnswers["206"] = { type: "checkout", checks: { adult_slippers: true, bedmaking: true, pillows: true }, finalConfirmed: true };
  work.tasks.amenities.completed = true;
  setRoomNoStay(work, "206", true);
  assert.equal(work.rooms["206"].type, "checkout");
  assert.equal(work.rooms["206"].adults, 0);
  assert.equal(work.rooms["206"].children, 0);
  assert.equal(work.rooms["206"].extraBedUsers, 0);
  assert.equal(work.roomAnswers["206"]?.finalConfirmed, false);
  assert(!activeTasks(work).includes("amenities"));
  assert(activeTasks(work).includes("bedmaking"));
  setRoomNoStay(work, "206", false);
  assert.equal(work.rooms["206"].adults, 1);
  assert.equal(work.rooms["206"].children, 0);
  assert(activeTasks(work).includes("amenities"));
  assert.equal(work.roomAnswers["206"]?.checks.adult_slippers, false);
});
test("API保存でも0人変更時に旧完了を流用せず、非表示項目の未解消不備を残す", () => {
  const original = makeWork("担当職員");
  original.roomCodes = ["203"];
  original.roomAnswers["203"] = { type: "checkout", checks: { adult_slippers: true, toothbrushes: true, bedmaking: true, pillows: true }, finalConfirmed: true };
  original.tasks.amenities.completed = true;
  original.defects = [{ id: "d1", roomCode: "203", itemCode: "adult_slippers", description: "破損", status: "open", createdAt: "2026-10-27T00:00:00Z" }];
  const changed = structuredClone(original);
  changed.rooms["203"].adults = 0;
  const saved = cleanWork(changed, original);
  assert.deepEqual(roomCheckKeys(saved.rooms["203"]), ["bedmaking", "roomclean"]);
  assert.equal(saved.tasks.amenities.completed, false);
  assert.equal(saved.roomAnswers["203"]?.finalConfirmed, false);
  assert.equal(saved.defects[0].status, "open");
  assert(missingForReport(saved).includes("未解消の不備"));
});
test("宿泊ありの対象室を追加したら旧アメニティ作業の完了を流用しない", () => {
  const original = makeWork("担当職員");
  original.roomCodes = ["203"];
  original.tasks.amenities.completed = true;
  original.tasks.bedmaking.completed = true;
  const changed = structuredClone(original);
  changed.roomCodes.push("206");
  const saved = cleanWork(changed, original);
  assert.equal(saved.tasks.amenities.completed, false);
  assert.equal(saved.tasks.bedmaking.completed, false);
});
test("清掃種別変更前の回答を新種別に流用しない", () => {
  const work = makeWork("担当職員");
  work.roomCodes = ["203"];
  work.rooms["203"].type = "stay_cleaning";
  work.roomAnswers["203"] = { type: "checkout", checks: Object.fromEntries(roomCheckKeys({ ...work.rooms["203"], type: "checkout" }).map(key => [key, true])), finalConfirmed: true };
  assert(missingForReport(work).includes("203号室の確認"));
});
test("不備解消時は対象チェックと最終確認を戻す", () => {
  const work = makeWork("担当職員");
  work.roomCodes = ["203"];
  work.roomAnswers["203"] = { type: "checkout", checks: { adult_slippers: true }, finalConfirmed: true };
  work.defects = [{ id: "d1", roomCode: "203", itemCode: "adult_slippers", description: "破損", status: "open", createdAt: "2026-10-22T00:00:00Z" }];
  const next = structuredClone(work);
  next.defects[0].status = "resolved";
  const clean = cleanWork(next, work);
  assert.equal(clean.roomAnswers["203"]?.checks.adult_slippers, false);
  assert.equal(clean.roomAnswers["203"]?.finalConfirmed, false);
});
test("登録済み不備を削除できない", () => {
  const work = makeWork("担当職員");
  work.defects = [{ id: "d1", roomCode: "203", itemCode: "adult_slippers", description: "破損", status: "open", createdAt: "2026-10-22T00:00:00Z" }];
  const next = structuredClone(work);
  next.defects = [];
  assert.throws(() => cleanWork(next, work), /削除/);
});
test("報告本文に過去日付と不備と画像参照を固定する", () => {
  const work = makeWork("担当職員");
  work.roomCodes = ["203"];
  work.defects = [{ id: "d1", roomCode: "203", itemCode: "adult_slippers", description: "スリッパ破損", status: "resolved", createdAt: "2026-10-22T00:00:00Z", resolvedAt: "2026-10-22T01:00:00Z" }];
  work.imageIds = ["image-1"];
  const body = reportBody("2020-01-01", work);
  assert.match(body, /過去日付の報告/);
  assert.match(body, /スリッパ破損/);
  assert.match(body, /image-1/);
});
test("報告書は作業時間とユニット別の内容を所感より前に並べる", () => {
  const work = makeWork("担当職員");
  work.staffNames = ["スタッフA", "スタッフB"];
  work.roomCodes = ["203"];
  work.startedAt = "2026-10-22T01:00:00Z";
  work.breakAnswer = "yes";
  work.breakStart = "11:50";
  work.breakEnd = "12:00";
  work.tasks.bedmaking = { assignees: ["スタッフA"], startedAt: "10:00", finishedAt: "11:30", timeNote: "", completed: true, completedCount: 0 };
  work.tasks.lounge = { assignees: ["スタッフB"], startedAt: "10:30", finishedAt: "11:00", timeNote: "", completed: true, completedCount: 0 };
  work.notes = "問題なく作業できました。";
  const body = reportBody("2026-10-22", work);
  assert.match(body, /^KIIYA \/ CLEANING REPORT/);
  assert.match(body, /スタッフ 2名　職員 1名/);
  assert.match(body, /作業開始　10:00\n休憩　11:50〜12:00/);
  assert.match(body, /【ユニット1】[\s\S]*● ベッドメイキング　203号室[\s\S]*スタッフA　10:00〜11:30/);
  assert.match(body, /【ユニット2】[\s\S]*● ラウンジ[\s\S]*スタッフB　10:30〜11:00/);
  assert(body.indexOf("【ユニット2】") < body.indexOf("【所感・課題】"));
});
test("作業開始後、終了前の途中経過を保存できる", () => {
  const work = makeWork("担当職員");
  work.tasks.bedmaking.startedAt = "10:00";
  assert.equal(cleanWork(work).tasks.bedmaking.startedAt, "10:00");
  work.tasks.bedmaking.finishedAt = "09:59";
  work.roomCodes = ["203"];
  assert.ok(missingForReport(cleanWork(work)).some(item => item.includes("時刻")));
});
test("清掃種別変更後も既存不備の解消履歴を保持する", () => {
  const work = makeWork("担当職員");
  work.roomCodes = ["203"];
  work.defects = [{ id: "d1", roomCode: "203", itemCode: "bedmaking", description: "破損", status: "open", createdAt: "2026-10-22T00:00:00Z" }];
  const next = structuredClone(work);
  next.rooms["203"].type = "stay_amenities_only";
  assert.equal(cleanWork(next, work).defects[0].itemCode, "bedmaking");
});
test("定員超過とシャワー実施数ゼロは報告を止める", () => {
  const work = makeWork("担当職員");
  work.roomCodes = ["203"];
  work.rooms["203"].adults = 3;
  assert(missingForReport(work).includes("203号室の宿泊人数"));
  assert(missingForReport(work).includes("シャワー実施数"));
});
