import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { connectionMessage, statusLabel } from '../lib/display-labels.ts';
test('connection message distinguishes configured, disconnected, paused and unknown', () => {
 assert.equal(connectionMessage({setupReason:'DeliveryPathUnavailable',sourceDisplayName:'担当',roomName:'テスト'}), 'Chatwork連携済み・実務送信は準備中');
 assert.equal(connectionMessage({setupReason:'ReconnectRequired',sourceDisplayName:'担当',roomName:'テスト'}), 'Chatworkの再接続が必要です');
 assert.equal(connectionMessage({setupReason:'RoomVerificationRequired',sourceDisplayName:'担当',roomName:'テスト'}), 'Chatworkの投稿確認待ち');
 assert.equal(connectionMessage({setupReason:'AccountNotConnected',sourceDisplayName:null,roomName:null}), 'Chatworkが未接続です');
 assert.equal(connectionMessage(null), 'Chatworkの連携状況を確認できません');
});
test('saved statuses are displayed in Japanese', () => {
 assert.equal(statusLabel('Draft'),'下書き'); assert.equal(statusLabel('Prepared'),'送信準備済み'); assert.equal(statusLabel('Completed'),'完了'); assert.equal(statusLabel('anything-else'),'状態を確認できません');
});
