import {test} from 'node:test';import {strict as assert} from 'node:assert';
import {makeWork,cleanWork,missingForReport,roomCheckKeys,targetRooms,reportBody} from '../lib/domain.ts';
test('new arrival amenity-only is not a cleaning or bedmaking target',()=>{
 const w=makeWork('職員');w.roomCodes=['203'];w.rooms['203'].type='arrival_amenities_only';w.rooms['203'].adults=1;
 assert.deepEqual(targetRooms(w,'bedmaking'),[]);assert.deepEqual(targetRooms(w,'roomclean'),[]);assert.deepEqual(targetRooms(w,'amenities'),['203']);
 assert.ok(roomCheckKeys(w.rooms['203']).includes('arrival_placement_room'));assert.ok(!roomCheckKeys(w.rooms['203']).includes('bedmaking'));
 assert.equal(cleanWork(w).rooms['203'].type,'arrival_amenities_only');
});
test('an unfinished bed must show action in report and not be mistaken for completed',()=>{
 const w=makeWork('職員');w.roomCodes=['203'];w.rooms['203'].adults=0;w.staffNames=['A'];w.startedAt='2026-11-10T00:00:00Z';w.breakAnswer='no';
 w.roomAnswers['203']={type:'checkout',checks:{bedmaking:false,roomclean:true},finalConfirmed:true};
 for(const t of Object.values(w.tasks)){t.completed=true;t.assignees=['A'];t.startedAt='09:00';t.finishedAt='09:10';t.completedCount=1}
 w.tasks.bedmaking.completed=false;
 w.bedmakingExceptions={203:{reason:'staff_shortage',detail:'',action:'tomorrow'}};
 const saved=cleanWork(w);assert.ok(!missingForReport(saved).some(x=>x.includes('ベッド')||x.includes('bedmaking')));
 assert.match(reportBody('2026-11-10',saved),/203号室.*翌日/);
});
test('legacy reasons are retained without requiring text',()=>{
 const w=makeWork('職員');w.roomCodes=['203'];w.bedmakingExceptions={203:{reason:'other',detail:'',action:'kiiya'}};
 assert.equal(missingForReport(cleanWork(w)).some(x=>x.includes('未実施')),false);
 w.bedmakingExceptions={203:{reason:'other',detail:'交通障害',action:'kiiya'}};assert.equal(cleanWork(w).bedmakingExceptions?.['203']?.detail,'交通障害');
});
test('overnight guests cannot be deferred and contradictory completion is rejected',()=>{
 const w=makeWork('職員');w.roomCodes=['203'];w.rooms['203'].adults=1;w.bedmakingExceptions={203:{reason:'staff_shortage',detail:'',action:'tomorrow'}};assert.throws(()=>cleanWork(w));
 w.bedmakingExceptions={203:{reason:'staff_shortage',detail:'',action:'kiiya'}};w.roomAnswers['203']={type:'checkout',checks:{bedmaking:true},finalConfirmed:false};assert.throws(()=>cleanWork(w));
});
test('partial completion is not described as complete for an unmade room',()=>{
 const w=makeWork('職員');w.roomCodes=['203','204'];w.rooms['204'].adults=0;w.tasks.bedmaking.completed=true;w.bedmakingExceptions={204:{reason:'staff_shortage',detail:'',action:'tomorrow'}};
 const text=reportBody('2026-11-10',w);assert.match(text,/● ベッドメイキング　203号室/);assert.doesNotMatch(text,/● ベッドメイキング[^\n]*204号室/);assert.match(text,/204号室：未実施.*翌日対応/);
});
test('older client data does not erase saved exceptions and room changes require action reconfirmation',async()=>{
 const {updateRoomOccupancy}=await import('../lib/domain.ts');const original=makeWork('職員');original.roomCodes=['203'];original.rooms['203'].adults=0;original.bedmakingExceptions={203:{reason:'staff_shortage',detail:'',action:'tomorrow'}};
 const oldClient=structuredClone(original);delete oldClient.bedmakingExceptions;assert.equal(cleanWork(oldClient,original).bedmakingExceptions?.['203']?.action,'tomorrow');
 updateRoomOccupancy(original,'203',1,0);assert.equal(original.bedmakingExceptions?.['203']?.action,'');assert.ok(!missingForReport(cleanWork(original)).some(x=>x.includes('未実施')));
});
test('an exception without response is accepted without requiring task completion',()=>{
 const w=makeWork('職員');w.roomCodes=['203'];w.rooms['203'].adults=0;w.staffNames=['A'];w.startedAt='2026-11-10T00:00:00Z';w.breakAnswer='no';w.roomAnswers['203']={type:'checkout',checks:{bedmaking:false,roomclean:true},finalConfirmed:true};
 for(const t of Object.values(w.tasks)){t.completed=true;t.assignees=['A'];t.startedAt='09:00';t.finishedAt='09:10';t.completedCount=1}
 for(const x of [{reason:'',detail:'',action:''},{reason:'staff_shortage',detail:'',action:''}] as const){w.bedmakingExceptions={203:x};const saved=cleanWork(w);assert.ok(!missingForReport(saved).some(s=>s.includes('203')&&s.includes('未実施')))}
});
test('invalid time can be saved as a draft but blocks report',()=>{
 const w=makeWork('職員');w.breakStart='12:00';w.breakEnd='11:00';w.tasks.lounge.startedAt='10:00';w.tasks.lounge.finishedAt='09:00';const saved=cleanWork(w);const missing=missingForReport(saved);assert.ok(missing.includes('休憩時刻'));assert.ok(missing.includes('ラウンジの時刻'));
});
test('new response choices preserve consent and legacy report wording',()=>{
 const w=makeWork('職員');w.roomCodes=['203'];w.rooms['203'].adults=0;
 w.bedmakingExceptions={203:{reason:'staff_shortage',detail:'',action:'tomorrow_asobe'}};
 assert.equal(cleanWork(w).bedmakingExceptions?.['203']?.action,'tomorrow_asobe');
 assert.match(reportBody('2026-11-10',w),/翌日asoBeが対応（本日の宿泊なし）/);
 w.bedmakingExceptions[203]!.action='kiiya_approved';assert.match(reportBody('2026-11-10',cleanWork(w)),/KIIIYAさんが対応（了承済み）/);
 w.bedmakingExceptions[203]!.action='kiiya';assert.doesNotMatch(reportBody('2026-11-10',cleanWork(w)),/了承済み/);
 w.bedmakingExceptions[203]!.action='tomorrow_asobe';w.rooms['203'].adults=1;assert.throws(()=>cleanWork(w));
});
test('an exception without a response does not invent a response',()=>{
 const w=makeWork('職員');w.roomCodes=['203'];w.rooms['203'].adults=0;
 w.bedmakingExceptions={203:{reason:'',detail:'',action:''}};
 let text=reportBody('2026-11-10',cleanWork(w));assert.match(text,/203号室：未実施/);assert.doesNotMatch(text,/対応未選択|KIIYAに対応をお願いする/);assert.ok(!missingForReport(cleanWork(w)).some(x=>x.includes('未実施')));
 w.bedmakingExceptions[203]={reason:'staff_shortage',detail:'',action:''};text=reportBody('2026-11-10',cleanWork(w));assert.match(text,/203号室：未実施/);assert.doesNotMatch(text,/対応未選択|KIIYAに対応をお願いする/);
});
test('arrival indoor placement requires a fresh check and retains previous answer and defects',()=>{
 const w=makeWork('職員');w.roomCodes=['203'];w.rooms['203'].type='arrival_amenities_only';w.rooms['203'].adults=1;
 w.roomAnswers['203']={type:'arrival_amenities_only',checks:{adult_slippers:true,toothbrushes:true,arrival_placement_confirm:true},finalConfirmed:true};
 w.defects=[{id:'old-defect',roomCode:'203',itemCode:'arrival_placement_confirm',description:'設置先未確認',status:'open',createdAt:'2026-11-10T00:00:00Z'}];
 const saved=cleanWork(w,w);assert.equal(saved.roomAnswers['203']?.checks.arrival_placement_confirm,true);assert.notEqual(saved.roomAnswers['203']?.checks.arrival_placement_room,true);
 assert.ok(missingForReport(saved).some(x=>x.includes('arrival_placement_room')));assert.ok(missingForReport(saved).includes('未解消の不備'));
 assert.match(reportBody('2026-11-12',saved),/室内にセット/);
});
