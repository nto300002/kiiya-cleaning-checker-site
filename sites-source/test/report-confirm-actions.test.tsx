import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
import {ReportConfirmActions} from '../app/report-confirm-actions.tsx';

test('primary actions stay visible and secondary actions start collapsed',()=>{
 const html=renderToStaticMarkup(<ReportConfirmActions busy={false} confirmed={false} canSend={true} onClose={()=>{}} onSend={()=>{}} onRefresh={()=>{}} onDiscard={()=>{}}/>);
 assert.match(html,/<details[^>]*>/);
 assert.doesNotMatch(html,/<details[^>]*\sopen(?:=|\s|>)/);
 const details=html.indexOf('<details');
 assert.ok(html.indexOf('閉じる')<details && html.indexOf('確定して送信')<details);
 assert.ok(html.indexOf('候補を破棄')>details && html.indexOf('状態を更新')>details);
 assert.match(html,/<summary[^>]*>.*その他/);
});
test('busy and confirmation conditions disable the existing operations',()=>{
 const html=renderToStaticMarkup(<ReportConfirmActions busy={true} confirmed={true} canSend={false} onClose={()=>{}} onSend={()=>{}} onRefresh={()=>{}} onDiscard={()=>{}}/>);
 for(const label of ['確定して送信','候補を破棄','状態を更新'])assert.match(html,new RegExp(`<button[^>]*disabled[^>]*>${label}</button>`));
});
