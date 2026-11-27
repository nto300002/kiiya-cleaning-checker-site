import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import * as domain from '../lib/domain.ts';

test('renaming a staff member updates their task assignments and report',()=>{
 const w=domain.makeWork('職員');w.staffNames=['旧名','別人'];w.tasks.corridor.assignees=['旧名','別人'];
 (domain as any).renameStaff(w,0,'新名');
 assert.deepEqual(w.tasks.corridor.assignees,['新名','別人']);
 const body=domain.reportBody('2026-11-25',w);assert.match(body,/新名/);assert.doesNotMatch(body,/旧名/);
});
test('a shared name does not silently reassign another person',()=>{
 const w=domain.makeWork('職員');w.staffNames=['同名','同名'];w.tasks.corridor.assignees=['同名'];
 domain.renameStaff(w,0,'新名');assert.deepEqual(w.tasks.corridor.assignees,['同名']);
});
test('an unperformed bed does not require action or reason',()=>{
 const w=domain.makeWork('職員');w.roomCodes=['203'];w.rooms['203'].adults=0;w.bedmakingExceptions={203:{reason:'',detail:'',action:'tomorrow_asobe'}};
 assert.equal(domain.bedmakingExceptionValid(w,'203'),true);
 assert.doesNotMatch(domain.reportBody('2026-11-25',w),/理由未選択|スタッフ不足/);
 w.bedmakingExceptions[203]!.action='';assert.equal(domain.bedmakingExceptionValid(w,'203'),true);
});
