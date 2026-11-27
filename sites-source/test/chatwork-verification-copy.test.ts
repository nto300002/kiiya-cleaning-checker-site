import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app/chatwork-production-settings.tsx', import.meta.url), 'utf8');
test('投稿確認の必要性と確認後の状態を表示する', () => {
 assert.match(source, /投稿確認が完了するまで、報告の送信準備に進めません/);
 assert.match(source, /投稿確認済／設定完了/);
 assert.match(source, /view\.destinationVerified &&/);
 assert.doesNotMatch(source, /届いたことを確定する/);
});
