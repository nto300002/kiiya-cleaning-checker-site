import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {makeWork,cleanWork,missingForReport,reportBody,bedmakingExceptionValid,workElapsedMinutes} from '../lib/domain.ts';

test('elapsed time spans earliest start to latest completed finish, including overlaps',()=>{
 const w=makeWork('職員');w.tasks.corridor.startedAt='09:15';w.tasks.corridor.finishedAt='09:45';w.tasks.corridor.completed=true;
 w.tasks.lounge.startedAt='09:20';w.tasks.lounge.finishedAt='10:30';w.tasks.lounge.completed=true;
 assert.equal(workElapsedMinutes(w),75);assert.match(reportBody('2026-11-26',w),/作業時間.*1時間15分/);
 w.tasks.lounge.completed=false;assert.equal(workElapsedMinutes(w),30);
 w.tasks.corridor.completed=false;assert.equal(workElapsedMinutes(w),null);
});

test('legacy unrecorded data is retained but does not replace required work time',()=>{
 const w=makeWork('職員');w.staffNames=['A'];w.startedAt='2026-11-25T00:00:00Z';w.breakAnswer='no';
 for(const task of Object.values(w.tasks)){task.completed=true;task.assignees=['A'];task.startedAt='09:00';task.finishedAt='09:10';task.completedCount=1}
 Object.assign(w.tasks.corridor,{startedAt:'',finishedAt:'',timeUnrecorded:true});
 const saved=cleanWork(w);assert.equal((saved.tasks.corridor as any).timeUnrecorded,true);
 assert.ok(missingForReport(saved).includes('廊下'));
 assert.match(reportBody('2026-11-25',saved),/● 廊下\n\s+A\s+時刻未入力/);
 saved.tasks.corridor.completed=false;assert.ok(missingForReport(saved).includes('廊下'));
});
test('a checked unperformed room no longer needs a response choice',()=>{
 const w=makeWork('職員');w.roomCodes=['203'];w.bedmakingExceptions={203:{reason:'',detail:'',action:''}};
 assert.equal(bedmakingExceptionValid(w,'203'),true);
 const body=reportBody('2026-11-25',w);assert.match(body,/203号室：未実施/);assert.doesNotMatch(body,/対応未選択/);
});
