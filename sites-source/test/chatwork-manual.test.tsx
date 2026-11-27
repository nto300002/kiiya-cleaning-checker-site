import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatworkManual from '../app/chatwork-manual.tsx';
test('連携手順と確認投稿の注意を順番に表示する',()=>{
 const html=renderToStaticMarkup(<ChatworkManual onClose={()=>{}} onWalkthrough={()=>{}}/>);
 for(const text of ['Chatworkを接続','アカウントID','環境設定','Chatworkについて','ルームID','ルーム名を確認する','確認文を送る','投稿確認済／設定完了','同じルーム','送信テスト']) assert.ok(html.includes(text),text);
 assert.ok(html.includes("Markdown本文またはPDF")); assert.ok(html.includes("添付画像"));
 assert.match(html,/role="dialog"/);assert.match(html,/入力場所を見る/);
});
