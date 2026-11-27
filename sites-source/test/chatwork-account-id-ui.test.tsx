import {test} from 'node:test';import {strict as assert} from 'node:assert';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import AccountIdGuide from '../app/chatwork-account-id-guide.tsx';
test('account ID remains visible and instructions are inside a closed disclosure',()=>{
 const html=renderToStaticMarkup(<AccountIdGuide accountId="12345678"/>);
 assert.match(html,/12345678/);assert.match(html,/アカウントIDの確認方法/);assert.match(html,/環境設定/);assert.match(html,/Chatworkについて/);assert.match(html,/照合/);assert.match(html,/<details/);assert.doesNotMatch(html,/<details[^>]*\sopen/);
});
