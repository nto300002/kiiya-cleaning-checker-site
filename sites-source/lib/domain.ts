export const ROOM_CODES = ["203", "204", "205", "206"] as const;
export const ROOM_TYPES = ["checkout", "stay_cleaning", "stay_amenities_only", "arrival_amenities_only"] as const;
export const TASKS = [
  { id: "bedmaking", label: "ベッドメイキング", unit: 1, rooms: "cleaning" },
  { id: "amenities", label: "アメニティセット", unit: 1, rooms: "all" },
  { id: "roomclean", label: "部屋掃除", unit: 1, rooms: "cleaning" },
  { id: "corridor", label: "廊下", unit: 1 },
  { id: "stairsEntrance", label: "階段・玄関掃除", unit: 1 },
  { id: "showers", label: "シャワールーム", unit: 2 },
  { id: "lounge", label: "ラウンジ", unit: 2 },
  { id: "basins", label: "洗面台", unit: 2 },
  { id: "toilets", label: "トイレ掃除", unit: 2 },
  { id: "washCorridor", label: "洗面周り廊下", unit: 2 },
] as const;
export type RoomCode = (typeof ROOM_CODES)[number];
export type RoomType = (typeof ROOM_TYPES)[number];
export type TaskId = (typeof TASKS)[number]["id"];
export type Room = { type: RoomType; adults: number; children: number; extraBedUsers: number };
export type TaskProgress = { assignees: string[]; startedAt: string; finishedAt: string; timeNote: string; completed: boolean; completedCount: number; assigneeCustomized?: boolean; timeUnrecorded?: boolean };
export type RoomAnswer = { type: RoomType; checks: Record<string, boolean>; finalConfirmed: boolean };
export type Defect = { id: string; roomCode: RoomCode; itemCode: string; description: string; status: "open" | "resolved"; createdAt: string; resolvedAt?: string };
export type BedmakingException = {reason: ''|'staff_shortage'|'other'; detail:string; action:''|'tomorrow'|'kiiya'|'tomorrow_asobe'|'kiiya_approved'};
export type WorkData = {
  staffNames: string[]; leadName: string; startedAt: string;
  roomCodes: RoomCode[]; rooms: Record<RoomCode, Room>;
  toiletTarget: number; showerTarget: number;
  tasks: Record<TaskId, TaskProgress>; roomAnswers: Partial<Record<RoomCode, RoomAnswer>>;
  defects: Defect[]; breakAnswer: "" | "yes" | "no"; breakStart: string; breakEnd: string;
  notes: string; keyMemo: string; sheetMemo: string; imageIds: string[];
  bedmakingExceptions?: Partial<Record<RoomCode,BedmakingException>>;
};
export const initialMaster = {
  rooms: {
    "203": { capacity: 2, beds: "ダブル1台", extraBedAtOccupancy: 0 },
    "204": { capacity: 5, beds: "シングル4台＋エキストラ1台", extraBedAtOccupancy: 5 },
    "205": { capacity: 4, beds: "ダブル2台", extraBedAtOccupancy: 0 },
    "206": { capacity: 3, beds: "シングル2台＋エキストラ1台", extraBedAtOccupancy: 3 },
  },
  taskLabels: Object.fromEntries(TASKS.map(t => [t.id, t.label])),
};
export function extraBedRequired(code: RoomCode, room: Room): boolean {
  const threshold = initialMaster.rooms[code].extraBedAtOccupancy;
  return threshold > 0 && room.adults + room.children === threshold;
}
export function bedmakingLabel(code: RoomCode, room: Room): string {
  return extraBedRequired(code, room) ? "ベッドメイク+EXベッド" : "ベッドメイク";
}
export function updateRoomOccupancy(data: WorkData, code: RoomCode, adults: number, children: number): void {
  const room = data.rooms[code];
  const changed = room.adults !== adults || room.children !== children;
  room.adults = adults;
  room.children = children;
  const exception=data.bedmakingExceptions?.[code];
  if(adults+children>0 && exception && ['tomorrow','tomorrow_asobe'].includes(exception.action)) exception.action='';
  room.extraBedUsers = extraBedRequired(code, room) ? 1 : 0;
  if (changed) {
    invalidateOccupancyChecks(data.roomAnswers[code]);
    data.tasks.amenities.completed = false;
    if (room.type !== "stay_amenities_only") data.tasks.bedmaking.completed = false;
  }
}
export function setRoomNoStay(data: WorkData, code: RoomCode, noStay: boolean): void {
  if (noStay) updateRoomOccupancy(data, code, 0, 0);
  else if (data.rooms[code].adults + data.rooms[code].children === 0) updateRoomOccupancy(data, code, 1, 0);
}
function invalidateOccupancyChecks(answer?: RoomAnswer): void {
  if (!answer) return;
  for (const key of ["adult_slippers", "child_slippers", "toothbrushes", "pillows", "placement", "amenities_message", "arrival_placement_room", "bedmaking"]) answer.checks[key] = false;
  answer.finalConfirmed = false;
}
export function todayJst(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function makeWork(leadName: string): WorkData {
  return {
    staffNames: [], leadName, startedAt: "", roomCodes: [], rooms: Object.fromEntries(ROOM_CODES.map(code =>
      [code, { type: "checkout", adults: 1, children: 0, extraBedUsers: 0 }]
    )) as Record<RoomCode, Room>, toiletTarget: 2, showerTarget: 3,
    tasks: Object.fromEntries(TASKS.map(t => [t.id, { assignees: [], startedAt: "", finishedAt: "", timeNote: "", completed: false, completedCount: 0 }])) as unknown as Record<TaskId, TaskProgress>,
    roomAnswers: {}, defects: [], breakAnswer: "", breakStart: "", breakEnd: "",
    notes: "", keyMemo: "", sheetMemo: "", imageIds: [], bedmakingExceptions: {},
  };
}
function int(value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error("入力数値が範囲外です");
  return n;
}
function str(value: unknown, max = 2000): string {
  if (typeof value !== "string" || value.length > max) throw new Error("入力文字列が不正です");
  return value.trim();
}
export function cleanWork(input: unknown, original?: WorkData): WorkData {
  if (!input || typeof input !== "object") throw new Error("作業内容がありません");
  const v = input as Record<string, unknown>;
  const names = Array.isArray(v.staffNames) ? v.staffNames.map(x => str(x, 80)).filter(Boolean) : [];
  if (names.length > 5) throw new Error("参加スタッフは5名までです");
  const roomCodes = Array.isArray(v.roomCodes) ? [...new Set(v.roomCodes.map(x => str(x, 3)))] : [];
  if (roomCodes.some(x => !ROOM_CODES.includes(x as RoomCode))) throw new Error("対象客室が不正です");
  const roomsIn = (v.rooms || {}) as Record<string, any>;
  const rooms = Object.fromEntries(ROOM_CODES.map(code => {
    const room = roomsIn[code] || {};
    if (!ROOM_TYPES.includes(room.type)) throw new Error("清掃種別が不正です");
    const adults = int(room.adults, 0, 9), children = int(room.children, 0, 9);
    return [code, { type: room.type, adults, children, extraBedUsers: extraBedRequired(code, { ...room, adults, children }) ? 1 : 0 }];
  })) as Record<RoomCode, Room>;
  const tasksIn = (v.tasks || {}) as Record<string, any>;
  const tasks = Object.fromEntries(TASKS.map(task => {
    const p = tasksIn[task.id] || {};
    const assignees = Array.isArray(p.assignees) ? [...new Set(p.assignees.map((x: unknown) => str(x, 80)).filter(Boolean))] : [];
    if (assignees.length > 6) throw new Error("担当者が多すぎます");
    const startedAt = str(p.startedAt ?? "", 40), finishedAt = str(p.finishedAt ?? "", 40);
    if (p.timeUnrecorded === true && (startedAt || finishedAt)) throw new Error('作業時刻を確認してください');
    return [task.id, { assignees, startedAt, finishedAt, timeNote: str(p.timeNote ?? "", 500), completed: p.completed === true, completedCount: int(p.completedCount ?? 0, 0, 3), ...(p.assigneeCustomized === true ? { assigneeCustomized: true } : {}), ...(p.timeUnrecorded === true ? { timeUnrecorded: true } : {}) }];
  })) as Record<TaskId, TaskProgress>;
  const answersIn = (v.roomAnswers || {}) as Record<string, any>;
  const roomAnswers: Partial<Record<RoomCode, RoomAnswer>> = {};
  for (const code of ROOM_CODES) {
    const answer = answersIn[code];
    if (!answer) continue;
    if (!ROOM_TYPES.includes(answer.type)) throw new Error("回答の清掃種別が不正です");
    const checks: Record<string, boolean> = {};
    for (const key of roomCheckKeys(rooms[code])) checks[key] = answer.checks?.[key] === true;
    const previousAnswer = original?.roomAnswers[code];
    if (previousAnswer && previousAnswer.type === answer.type && typeof previousAnswer.checks.arrival_placement_confirm === 'boolean') checks.arrival_placement_confirm = previousAnswer.checks.arrival_placement_confirm;
    roomAnswers[code] = { type: answer.type, checks, finalConfirmed: answer.finalConfirmed === true };
    if (original && (original.rooms[code].adults !== rooms[code].adults || original.rooms[code].children !== rooms[code].children)) invalidateOccupancyChecks(roomAnswers[code]);
  }
  if (original && ROOM_CODES.some(code => roomCodes.includes(code) && (original.rooms[code].adults !== rooms[code].adults || original.rooms[code].children !== rooms[code].children))) {
    tasks.amenities.completed = false;
    tasks.bedmaking.completed = false;
  }
  const defects = Array.isArray(v.defects) ? v.defects.map((item: any) => {
    if (!ROOM_CODES.includes(item.roomCode)) throw new Error("不備の客室が不正です");
    const itemCode = str(item.itemCode, 100);
    const previouslyRegistered = original?.defects.some(d => d.id === item.id && d.roomCode === item.roomCode && d.itemCode === itemCode);
    if (!roomCheckKeys(rooms[item.roomCode as RoomCode]).includes(itemCode) && !previouslyRegistered) throw new Error("不備項目が不正です");
    if (item.status !== "open" && item.status !== "resolved") throw new Error("不備状態が不正です");
    return { id: str(item.id, 80), roomCode: item.roomCode as RoomCode, itemCode, description: str(item.description, 2000), status: item.status, createdAt: str(item.createdAt, 40), ...(item.resolvedAt ? { resolvedAt: str(item.resolvedAt, 40) } : {}) };
  }) : [];
  if (defects.length > 100 || new Set(defects.map(d => d.id)).size !== defects.length) throw new Error("不備IDが重複しています");
  if (original) {
    for (const current of defects) if (!original.defects.some(d => d.id === current.id) && current.status !== "open") throw new Error("新しい不備は未解消で登録してください");
    for (const previous of original.defects) {
      const current = defects.find(d => d.id === previous.id);
      if (!current || current.createdAt !== previous.createdAt || current.roomCode !== previous.roomCode || current.itemCode !== previous.itemCode || current.description !== previous.description || (previous.status === "resolved" && current.status !== "resolved")) throw new Error("登録済み不備は削除・改変できません");
      if (previous.status === "open" && current.status === "resolved") {
        const answer = roomAnswers[current.roomCode];
        if (answer) { answer.checks[current.itemCode] = false; answer.finalConfirmed = false; }
      }
    }
  }
  const breakAnswer = v.breakAnswer === "yes" || v.breakAnswer === "no" ? v.breakAnswer : "";
  const breakStart = str(v.breakStart ?? "", 40), breakEnd = str(v.breakEnd ?? "", 40);
  const imageIds = Array.isArray(v.imageIds) ? [...new Set(v.imageIds.map(x => str(x, 80)))] : [];
  if (imageIds.length > 20) throw new Error("画像は20枚までです");
  const exceptionsIn = v.bedmakingExceptions ?? original?.bedmakingExceptions ?? {};
  if(!exceptionsIn || typeof exceptionsIn !== 'object' || Array.isArray(exceptionsIn)) throw new Error('ベッドメイク未実施の記録が不正です');
  const bedmakingExceptions: Partial<Record<RoomCode,BedmakingException>> = {};
  for(const [code,raw] of Object.entries(exceptionsIn)){
    if(!ROOM_CODES.includes(code as RoomCode) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ベッドメイク未実施の客室が不正です');
    const item=raw as Record<string,unknown>;
    if(item.reason!=='' && item.reason!=='staff_shortage' && item.reason!=='other' || item.action!=='' && item.action!=='tomorrow' && item.action!=='kiiya' && item.action!=='tomorrow_asobe' && item.action!=='kiiya_approved') throw new Error('ベッドメイク未実施の選択が不正です');
    const detail=str(item.detail ?? '',500);
    if((item.action==='tomorrow' || item.action==='tomorrow_asobe') && roomCodes.includes(code) && rooms[code as RoomCode].adults+rooms[code as RoomCode].children>0) throw new Error('翌日対応は宿泊なしの客室に選択してください');
    if(roomCodes.includes(code) && roomAnswers[code as RoomCode]?.checks.bedmaking) throw new Error('同じ客室のベッドメイクを完了と未実施の両方にできません');
    bedmakingExceptions[code as RoomCode]={reason:item.reason,detail,action:item.action};
  }
  const work: WorkData = { staffNames: names, leadName: original ? original.leadName : str(v.leadName, 80), startedAt: original ? original.startedAt : str(v.startedAt ?? "", 40), roomCodes: roomCodes as RoomCode[], rooms,
    toiletTarget: int(v.toiletTarget, 0, 2), showerTarget: int(v.showerTarget, 0, 3), tasks, roomAnswers, defects,
    breakAnswer, breakStart, breakEnd, bedmakingExceptions, notes: str(v.notes ?? "", 5000), keyMemo: str(v.keyMemo ?? "", 2000), sheetMemo: str(v.sheetMemo ?? "", 2000), imageIds };
  if (original) invalidateChangedTaskTargets(original, work);
  return work;
}
export function roomCheckKeys(room: Room): string[] {
  const occupied = room.adults + room.children > 0;
  const keys = occupied ? ["adult_slippers", "toothbrushes"] : [];
  if (occupied && room.children > 0) keys.push("child_slippers");
  if (room.type === "checkout") keys.push("bedmaking", ...(occupied ? ["pillows"] : []), "roomclean");
  if (room.type === "stay_cleaning") keys.push("sheets", "trash", "roomclean", ...(occupied ? ["pillows", "placement"] : []));
  if (room.type === "stay_amenities_only" && occupied) keys.push("amenities_message");
  if (room.type === "arrival_amenities_only" && occupied) keys.push("arrival_placement_room");
  return keys;
}
export function targetRooms(data: WorkData, taskId: TaskId): RoomCode[] {
  if (taskId === "amenities") return data.roomCodes.filter(code => data.rooms[code].adults + data.rooms[code].children > 0);
  if (taskId === "bedmaking" || taskId === "roomclean") return data.roomCodes.filter(code => data.rooms[code].type !== "stay_amenities_only" && data.rooms[code].type !== "arrival_amenities_only");
  return [];
}
export function invalidateChangedTaskTargets(before: WorkData, after: WorkData): void {
  for (const taskId of ["bedmaking", "amenities", "roomclean"] as const) {
    if (targetRooms(before, taskId).join(",") !== targetRooms(after, taskId).join(",")) after.tasks[taskId].completed = false;
  }
}
export function bedmakingTargetLabel(data: WorkData): string {
  return targetRooms(data, "bedmaking").map(code => `${code}号室${extraBedRequired(code, data.rooms[code]) ? "（EX）" : ""}`).join("・");
}
export function activeTasks(data: WorkData): TaskId[] {
  return TASKS.filter(task => {
    if (task.id === "toilets") return data.toiletTarget > 0;
    if (task.id === "showers") return data.showerTarget > 0;
    if ("rooms" in task) return targetRooms(data, task.id).length > 0;
    return true;
  }).map(task => task.id);
}
export function bedmakingExceptionValid(data:WorkData,code:RoomCode):boolean {
 return !!data.bedmakingExceptions?.[code];
}
export function renameStaff(data: WorkData, index: number, name: string, previousName = data.staffNames[index] || ''): void {
 const oldName = previousName.trim(), newName = name.trim();
 data.staffNames[index] = name;
 if (!oldName || !newName || oldName === newName || oldName === data.leadName || data.staffNames.some((value, i) => i !== index && value.trim() === oldName)) return;
 for (const task of Object.values(data.tasks)) task.assignees = [...new Set(task.assignees.map(value => value === oldName ? newName : value))];
}
export function assignUnassignedTasks(data: WorkData, name: string): void {
  if (!name || !data.staffNames.includes(name) && data.leadName !== name) return;
  for (const id of activeTasks(data)) {
    const task = data.tasks[id];
    if (!task.assignees.length && !task.assigneeCustomized && !task.startedAt && !task.finishedAt && !task.completed) task.assignees = [name];
  }
}
export function missingForReport(data: WorkData): string[] {
  const missing: string[] = [];
  if (!data.startedAt) missing.push("作業開始");
  if (data.staffNames.length < 1 || data.staffNames.length > 5) missing.push("参加スタッフ");
  for (const code of data.roomCodes) {
    const room = data.rooms[code], capacity = initialMaster.rooms[code].capacity;
    if (room.adults + room.children > capacity) missing.push(code + "号室の宿泊人数");
    const exception = data.bedmakingExceptions?.[code];
    const answer = data.roomAnswers[code];
    if (!answer || answer.type !== data.rooms[code].type) { missing.push(code + "号室の確認"); continue; }
    for (const key of roomCheckKeys(data.rooms[code])) if (!answer.checks[key] && !(key === "bedmaking" && bedmakingExceptionValid(data,code))) missing.push(code + "号室: " + key);
    if (!answer.finalConfirmed) missing.push(code + "号室の職員最終確認");
  }
  if (data.defects.some(d => d.status === "open" && data.roomCodes.includes(d.roomCode))) missing.push("未解消の不備");
  for (const id of activeTasks(data)) {
    const task = data.tasks[id];
    if ((task.finishedAt && !task.startedAt) || (task.startedAt && task.finishedAt && task.startedAt > task.finishedAt)) missing.push(TASKS.find(t => t.id === id)!.label + "の時刻");
    if (id === "bedmaking") {
      const unresolved=targetRooms(data,id).filter(code=>!bedmakingExceptionValid(data,code) && !(data.roomAnswers[code]?.type===data.rooms[code].type && data.roomAnswers[code]?.checks.bedmaking) && !task.completed);
      if(unresolved.length) missing.push('ベッドメイクの完了または未実施: '+unresolved.join('、')+'号室');
      continue;
    }
    if (!task.completed || task.assignees.length === 0 || !(task.startedAt && task.finishedAt) && !task.timeNote) missing.push(TASKS.find(t => t.id === id)!.label);
    if (id === "showers" && (task.completedCount < 1 || task.completedCount > data.showerTarget)) missing.push("シャワー実施数");
  }
  if (!data.breakAnswer) missing.push("休憩の回答");
  if (data.breakStart && data.breakEnd && data.breakStart > data.breakEnd) missing.push("休憩時刻");
  return missing;
}
export function workElapsedMinutes(data: WorkData): number | null {
  const parse = (s: string): number | null => { const m = /^(\d{2}):(\d{2})$/.exec(s); if (!m || +m[1] > 23 || +m[2] > 59) return null; return +m[1] * 60 + +m[2]; };
  const ids = activeTasks(data).filter(id => id !== 'bedmaking' || targetRooms(data, id).some(code => !bedmakingExceptionValid(data, code)));
  const starts = ids.map(id => parse(data.tasks[id].startedAt)).filter((n): n is number => n !== null);
  const finishes = ids.filter(id => data.tasks[id].completed).map(id => parse(data.tasks[id].finishedAt)).filter((n): n is number => n !== null);
  if (!starts.length || !finishes.length) return null;
  const diff = Math.max(...finishes) - Math.min(...starts); return diff < 0 ? null : diff;
}
export function formatElapsedMinutes(n: number | null): string {
  return n === null ? '算出できません' : n >= 60 ? `${Math.floor(n / 60)}時間${n % 60}分` : `${n}分`;
}
export function reportBody(day: string, data: WorkData): string {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", weekday: "short" }).format(new Date(`${day}T00:00:00+09:00`));
  const started = data.startedAt ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(data.startedAt)) : "未開始";
  const breakTime = data.breakAnswer === "yes" ? data.breakStart && data.breakEnd ? `${data.breakStart}〜${data.breakEnd}` : "あり（時刻未記録）" : data.breakAnswer === "no" ? "なし" : "未回答";
  const lines = ["KIIYA / CLEANING REPORT", "本日の作業時間のデータとなります。", "", ...(day < todayJst() ? ["過去日付の報告", ""] : []),
    `${year}年${month}月${date}日（${weekday}）`, `スタッフ ${data.staffNames.length}名　職員 1名`, `参加スタッフ：${data.staffNames.join("、") || "未入力"}`, `担当職員：${data.leadName}`,
    `作業開始　${started}`, `休憩　${breakTime}`, `作業時間（最初の開始〜最後の完了）　${formatElapsedMinutes(workElapsedMinutes(data))}`];
  const zeroGuestRooms = data.roomCodes.filter(code => data.rooms[code].adults + data.rooms[code].children === 0);
  const roomTypes: Record<RoomType, string> = { checkout: "通常清掃", stay_cleaning: "連泊清掃", stay_amenities_only: "連泊・アメニティのみ", arrival_amenities_only: "新規宿泊・アメニティのみ" };
  if (zeroGuestRooms.length) lines.push(`宿泊なし：${zeroGuestRooms.map(code => `${code}号室（${roomTypes[data.rooms[code].type]}）`).join("、")}`);
  for (const unit of [1, 2]) {
    lines.push("", `【ユニット${unit}】`);
    for (const taskInfo of TASKS.filter(task => task.unit === unit && activeTasks(data).includes(task.id))) {
      const task = data.tasks[taskInfo.id];
      const rooms = targetRooms(data, taskInfo.id).filter(code => taskInfo.id !== "bedmaking" || !bedmakingExceptionValid(data,code));
      if(taskInfo.id === "bedmaking" && !rooms.length) continue;
      const target = rooms.length ? taskInfo.id === "bedmaking" ? `　${rooms.map(code=>`${code}号室${extraBedRequired(code,data.rooms[code])?"（EX）":""}`).join("・")}` : `　${rooms.join("、")}号室` : taskInfo.id === "showers" ? `　${data.showerTarget}箇所` : taskInfo.id === "toilets" ? `　${data.toiletTarget}箇所` : "";
      const time = task.startedAt && task.finishedAt ? `${task.startedAt}〜${task.finishedAt}` : task.timeNote || "時刻未入力";
      lines.push(`● ${taskInfo.label}${target}`, `  ${task.assignees.join("、") || "担当未設定"}　${time}`);
      if (task.timeNote && task.startedAt && task.finishedAt) lines.push(`  ${task.timeNote}`);
      if (taskInfo.id === "showers") lines.push(`  清掃済み ${task.completedCount}箇所`);
    }
  }
  lines.push("", "【所感・課題】", data.notes || "記載なし", "", "【鍵に関するメモ】", data.keyMemo || "記載なし", "", "【シーツに関するメモ】", data.sheetMemo || "記載なし");
  const unfinished=data.roomCodes.flatMap(code=>{const x=data.bedmakingExceptions?.[code];if(!x || !targetRooms(data,'bedmaking').includes(code)) return []; const action = x.action==='tomorrow'?'翌日対応':x.action==='tomorrow_asobe'?'翌日asoBeが対応（本日の宿泊なし）':x.action==='kiiya_approved'?'KIIIYAさんが対応（了承済み）':x.action==='kiiya'?'KIIYAに対応をお願いする・連絡要確認':''; return [`● ${code}号室：未実施${action ? ` ／ ${action}` : ''}`]});
  if(unfinished.length)lines.push('', '【ベッドメイク未実施】',...unfinished);
  const pendingLocation=data.roomCodes.filter(code=>data.rooms[code].type==='arrival_amenities_only'&&data.rooms[code].adults+data.rooms[code].children>0);
  if(pendingLocation.length)lines.push('', '【新規宿泊・アメニティ】',`${pendingLocation.join('、')}号室：アメニティは室内にセット`);
  const defects = data.defects.filter(d => data.roomCodes.includes(d.roomCode));
  if (defects.length) lines.push("", "【不備】", ...defects.map(d => `● ${d.roomCode}号室 ${d.itemCode}：${d.description}（${d.status === "resolved" ? "解消済み" : "未解消"}）`));
  if (data.imageIds.length) lines.push("", "【添付画像】", ...data.imageIds);
  return lines.join("\n");
}
