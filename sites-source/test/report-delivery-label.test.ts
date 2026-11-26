import { test } from "node:test";
import { strict as assert } from "node:assert";
import { reportDeliveryLabel } from "../lib/report-delivery-label.ts";

test("report history distinguishes delivered, failed and uncertain outcomes",()=>{
 assert.equal(reportDeliveryLabel("Sent"),"送信済み");
 assert.equal(reportDeliveryLabel("Failed"),"送信できませんでした");
 assert.equal(reportDeliveryLabel("Unknown"),"結果不明：再送せず担当者に確認");
 assert.equal(reportDeliveryLabel("Dispatched"),"送信待ち");
 assert.equal(reportDeliveryLabel("future-state"),"状態を確認できません");
});
