import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RoomStatus from '../app/chatwork-room-status.tsx';

test('ルーム未設定と次の操作を示す', () => {
 const html = renderToStaticMarkup(<RoomStatus loaded={true} roomName={null} roomId={null} verified={false}/>);
 assert.match(html, /ルーム未設定/); assert.match(html, /ルーム名を確認する/);
});
test('保存済みのルームと投稿確認が別であることを示す', () => {
 const html = renderToStaticMarkup(<RoomStatus loaded={true} roomName="業務報告" roomId="123" verified={false}/>);
 assert.match(html, /ルーム設定完了/); assert.match(html, /業務報告/); assert.match(html, /投稿確認は未完了/);
});
test('確認済みと読み込み中を区別する', () => {
 assert.match(renderToStaticMarkup(<RoomStatus loaded={true} roomName="業務報告" roomId="123" verified={true}/>), /投稿確認済み/);
 assert.doesNotMatch(renderToStaticMarkup(<RoomStatus loaded={false} roomName={null} roomId={null} verified={false}/>), /ルーム未設定/);
});
