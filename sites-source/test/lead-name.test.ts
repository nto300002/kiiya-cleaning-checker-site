import test from "node:test";
import assert from "node:assert/strict";
import { leadNameForNewWork } from "../lib/lead-name.ts";

test("管理者の新規作業には設定された担当職員名を使う", () => {
  assert.equal(leadNameForNewWork("admin", "登録名", "admin", "  新しい氏名  "), "新しい氏名");
});

test("他職員には本人の台帳名を使い、設定が空・長すぎる場合も台帳名へ戻す", () => {
  assert.equal(leadNameForNewWork("staff", "職員A", "admin", "管理者名"), "職員A");
  assert.equal(leadNameForNewWork("admin", "登録名", "admin", "   "), "登録名");
  assert.equal(leadNameForNewWork("admin", "登録名", "admin", "あ".repeat(81)), "登録名");
});
