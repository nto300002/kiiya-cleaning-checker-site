"use client";
import { connectionMessage, statusLabel } from "../lib/display-labels";
import { taskActionLabel } from "../lib/task-action-label";
import { useEffect, useRef, useState } from "react";
import { activeTasks, bedmakingLabel, bedmakingTargetLabel, extraBedRequired, invalidateChangedTaskTargets, missingForReport, roomCheckKeys, setRoomNoStay, targetRooms as taskTargetRooms, ROOM_CODES, TASKS, todayJst, updateRoomOccupancy, type RoomCode, type RoomType, type TaskId, type WorkData } from "@/lib/domain";
import ChatworkProductionSettings from "@/app/chatwork-production-settings";
import StaffDirectory from "@/app/staff-directory";
import ReportDeliveryHistory from "@/app/report-delivery-history";
import { ReportConfirmActions } from "@/app/report-confirm-actions";
import { startCandidate } from "@/lib/report-candidate-client";

type Me = { id: string; email: string; name: string; active: boolean; role: "normal" | "field" | null; appAdmin: boolean; manageChatwork: boolean };
type DeliveryStatus = { setupRequired: boolean; setupReason: string; sourceDisplayName: string | null; roomName: string | null; deliveryEnabled: boolean };
type Detail = { id: string; day: string; ownerId: string; revision: number; status: string; data: WorkData; images: { id: string; file_name: string }[]; reports: { id: string; sequence: number; body: string; status: string }[] };
type Candidate = {id:string;body:string;imageIds:string[];workRevision:number;stale:boolean;confirmed:boolean;trial?:{jobId:string;permitId:string;roomName:string;status:string;permitValid:boolean;prepared:boolean;expiresAt:number;permitStatus:string}};
type Summary = { id: string; day: string; owner_id: string; status: string; updated_at: string };
type Tab = "welcome" | "today" | "scope" | "checks" | "report" | "result" | "settings" | "archive" | "archiveDetail" | "master" | "chatwork" | "people";
const typeLabels: Record<RoomType, string> = { checkout: "通常清掃", stay_cleaning: "連泊清掃", stay_amenities_only: "連泊（アメニティのみ）" };
const checkLabels: Record<string, string> = {
  adult_slippers: "大人用スリッパ", child_slippers: "子ども用スリッパ", toothbrushes: "歯ブラシ",
  bedmaking: "ベッドメイク", pillows: "枕", roomclean: "部屋掃除", sheets: "シーツ交換",
  trash: "ごみ回収", placement: "設置場所", amenities_message: "アメニティとメッセージカード",
};
const masterTutorialSteps = [
  { target: "reason", title: "変更内容", description: "変更したい設備・清掃項目・客室情報と、変更理由を具体的に記入します。ここへの入力だけではマスタは変わりません。" },
  { target: "approver", title: "承認した別職員の氏名", description: "当日の担当職員とは別の職員から承認を得たうえで、その職員の氏名を記録します。承認者本人のアプリ操作はありません。" },
  { target: "approval", title: "承認取得を自己申告", description: "実際に承認を得た場合だけチェックします。氏名とこのチェックがそろわないと申請を記録できません。" },
  { target: "submit", title: "申請を記録", description: "入力内容を確認して申請を保存します。現行版ではChatwork通知、マスタの編集・確認・適用はまだ行われません。" },
] as const;
async function call<T = any>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch("/api/" + path, { ...init, cache: "no-store" });
  const value: any = await response.json();
  if (!response.ok) throw new Error(value.error || "通信に失敗しました");
  return value;
}
function jsonBody(value: unknown): RequestInit { return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }; }
function clone<T>(value: T): T { return structuredClone(value); }
function clearReportRequest(workId?:string){
  try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith('kiiya-report-request-')&&(!workId||key===`kiiya-report-request-${workId}`))sessionStorage.removeItem(key)}}catch{}
}

export default function CleaningApp({ signOutPath }: { signOutPath: string }) {
  const [me, setMe] = useState<Me | null>(null), [items, setItems] = useState<Summary[]>([]);
  const [delivery, setDelivery] = useState<DeliveryStatus | null>(null);
  const [selected, setSelected] = useState<Detail | null>(null), [draft, setDraft] = useState<WorkData | null>(null);
  const draftRef = useRef(draft), selectedRef = useRef(selected), uploadingRef = useRef(0);
  const [uploading, setUploading] = useState(0);
  draftRef.current = draft; selectedRef.current = selected;
  const [tab, setTab] = useState<Tab>("welcome"), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false), [conflict, setConflict] = useState(false), [preview, setPreview] = useState<{ ready: boolean; missing: string[]; body: string } | null>(null);
  const [focusRoom, setFocusRoom] = useState<RoomCode>("203");
  const [newDefect, setNewDefect] = useState({ item: "adult_slippers", description: "" });
  const [format, setFormat] = useState<"pdf" | "markdown">("markdown"), [staffCount, setStaffCount] = useState(1);
  const [modal, setModal] = useState<"" | "defect" | "time" | "confirm" | "report-edit">(""), [modalTask, setModalTask] = useState<TaskId>("bedmaking"), [modalRoom, setModalRoom] = useState<RoomCode>("203"), [modalItem, setModalItem] = useState("adult_slippers"), [modalStart, setModalStart] = useState(""), [modalEnd, setModalEnd] = useState("");
  const [reportEdit, setReportEdit] = useState("");
  const [candidate,setCandidate]=useState<Candidate|null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null), [returnTab, setReturnTab] = useState<Tab>("today");
  const [masterCurrent, setMasterCurrent] = useState<any>(null), [masterChanges, setMasterChanges] = useState<any[]>([]);
  const [masterRequest, setMasterRequest] = useState({ approverName: "", reason: "", approved: false });
  const [masterTutorialStage, setMasterTutorialStage] = useState<"closed" | "intro" | "steps">("closed");
  const [masterTutorialStep, setMasterTutorialStep] = useState(0);
  const canEdit = !!me && me.role === "field" && !!selected && selected.ownerId === me.id;
  const [today, setToday] = useState(todayJst());
  const nowTime = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const displayStart = (value: string) => value ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "--:--";
  const drumRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    call<Me>("me").then(setMe).catch(e => setMessage(e.message));
    const chatworkReturn = new URLSearchParams(window.location.search).get("chatwork");
    if (chatworkReturn === "connected" || chatworkReturn === "production-connected") {
      setTab("chatwork");
      window.history.replaceState(null, "", window.location.pathname);
      setMessage("Chatworkから戻りました。送信元の登録名と識別番号を確認してください");
    }
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const day = todayJst();
      if (day !== today) {
        setToday(day); setSelected(null); setDraft(null); setDirty(false); setTab("today");
        setMessage("日付が変わりました。新しい当日の記録を作成できます。前日の記録はアーカイブから開けます。");
        call<Summary[]>("works").then(setItems).catch(e => setMessage(e.message));
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [today]);
  useEffect(() => {
    if (!me) return;
    try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith('kiiya-report-request-')){try{const v=JSON.parse(sessionStorage.getItem(key)||'');if(v.actorId!==me.id||!Number.isFinite(v.createdAt)||Date.now()-v.createdAt>86400000)sessionStorage.removeItem(key)}catch{sessionStorage.removeItem(key)}}}}catch{}
    if (!me.active) return;
    call<Summary[]>("works").then(setItems).catch(e => setMessage(e.message));
    call<DeliveryStatus>("report-delivery-settings").then(setDelivery).catch(() => setDelivery(null));
  }, [me?.active,me?.id]);
  useEffect(() => {
    if (tab !== "master" || !me?.active) return;
    call("master").then(setMasterCurrent).catch(e => setMessage(e.message));
    call<any[]>("master/changes").then(setMasterChanges).catch(e => setMessage(e.message));
  }, [tab, me?.active]);
  useEffect(() => {
    if (tab !== "master") { setMasterTutorialStage("closed"); return; }
    if (masterTutorialStage !== "steps") return;
    const target = masterTutorialSteps[masterTutorialStep]?.target;
    const frame = window.requestAnimationFrame(() => document.querySelector(`[data-master-tutorial="${target}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [tab, masterTutorialStage, masterTutorialStep]);
  useEffect(() => {
    if (masterTutorialStage === "closed") return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setMasterTutorialStage("closed"); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [masterTutorialStage]);
  useEffect(() => {
    if (draft?.roomCodes.length && !draft.roomCodes.includes(focusRoom)) setFocusRoom(draft.roomCodes[0]);
  }, [draft?.roomCodes.join(","), focusRoom]);
  function mutate(fn: (data: WorkData) => void) {
    const current = draftRef.current;
    if (!canEdit || !current || conflict) return;
    const next = clone(current); fn(next); invalidateChangedTaskTargets(current, next); draftRef.current = next; setDraft(next); setDirty(true); setPreview(null);
    if (selected) localStorage.setItem("kiiya-draft-" + selected.id, JSON.stringify({ revision: selected.revision, data: next }));
  }
  async function open(id: string) {
    if (uploadingRef.current) { setMessage('画像の追加が完了するまでお待ちください'); return; }
    setMessage(""); setConflict(false); setPreview(null);setCandidate(null);
    try {
      const value = await call<Detail>("works/" + id);
      setSelected(value); setDraft(clone(value.data)); setDirty(false);
      const saved = localStorage.getItem("kiiya-draft-" + id);
      if (saved && me?.role === "field" && value.ownerId === me?.id) {
        const local = JSON.parse(saved);
        if (local.revision === value.revision) { setDraft(local.data); setDirty(true); setMessage("端末に残っていた未保存の入力を復元しました"); }
        else { setConflict(true); setMessage("端末の未保存入力とサーバーの更新番号が異なります。確認するまで上書きできません"); }
      }
      setFocusRoom(value.data.roomCodes[0] || "203"); setStaffCount(Math.max(1, value.data.staffNames.length));
      setTab(value.day === today ? "today" : "archive");
    } catch (e: any) { setMessage(e.message); }
  }
  async function create() {
    setBusy(true);
    try {
      const value = await call<Detail>("works", jsonBody({ day: today }));
      setItems(await call<Summary[]>("works")); await open(value.id);
    } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  }
  async function save(): Promise<Detail | null> {
    if (!selected || !draft || !canEdit || conflict) return null;
    if (uploadingRef.current) { setMessage('画像の追加が完了してから保存してください'); return null; }
    if (!dirty) return selected;
    setBusy(true);
    try {
      const value = await call<Detail>("works/" + selected.id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: selected.revision, data: draft }) });
      setSelected(value); setDraft(clone(value.data)); setDirty(false); setMessage("保存しました");
      localStorage.removeItem("kiiya-draft-" + selected.id);
      setItems(await call<Summary[]>("works"));
      return value;
    } catch (e: any) { setMessage(e.message); return null; } finally { setBusy(false); }
  }
  async function start() {
    const value = dirty ? await save() : selected; if (!value) return;
    try {
      const started = await call<Detail>("works/" + value.id + "/start", jsonBody({ revision: value.revision }));
      setSelected(started); setDraft(clone(started.data)); setTab("scope"); setMessage("作業を開始しました");
    } catch (e: any) { setMessage(e.message); }
  }
  async function loadPreview() {
    if (uploadingRef.current) { setMessage('画像の追加が完了するまでお待ちください'); return; }
    const value = dirty ? await save() : selected; if (!value) return;
    try { setPreview(await call("works/" + value.id + "/preview")); setTab("report"); } catch (e: any) { setMessage(e.message); }
  }
  async function refreshCandidate(workId:string):Promise<Candidate|null> {
    const value=await call<{candidate:Candidate|null}>(`works/${workId}/report-candidate`);
    let next=value.candidate;
    if(next&&!next.trial&&!next.stale&&!next.confirmed){
      await call('chatwork/production/trial/self-reserve',jsonBody({candidateId:next.id}));
      next=(await call<{candidate:Candidate|null}>(`works/${workId}/report-candidate`)).candidate;
    }
    setCandidate(next);
    if(next?.trial?.permitValid&&!next.trial.prepared&&!next.stale){
      await call('chatwork/production/trial/prepare',jsonBody({jobId:next.trial.jobId,permitId:next.trial.permitId}));
      next=(await call<{candidate:Candidate|null}>(`works/${workId}/report-candidate`)).candidate;
    }
    setCandidate(next);return next;
  }
  async function beginReport() {
    if(!selected||!me||!preview?.ready||dirty)return;
    setBusy(true);
    try{
      let storage:Storage|undefined;try{storage=window.sessionStorage}catch{}
      const create=()=>startCandidate({workId:selected.id,actorId:me.id,revision:selected.revision,body:preview.body,storage,id:()=>crypto.randomUUID(),api:(path,body)=>call(path,body===undefined?undefined:jsonBody(body))});
      await create();
      let initial=(await call<{candidate:Candidate|null}>(`works/${selected.id}/report-candidate`)).candidate;
      if(initial?.confirmed && (initial.stale || initial.body!==preview.body)){
        await call(`works/${selected.id}/report-candidate/close`,jsonBody({revision:selected.revision,candidateId:initial.id}));
        clearReportRequest(selected.id);await create();
        initial=(await call<{candidate:Candidate|null}>(`works/${selected.id}/report-candidate`)).candidate;
      }
      setCandidate(initial);setModal('confirm');
      const next=await refreshCandidate(selected.id);
      if(!next)throw new Error('報告候補を確認できません。再度確認してください');
      if(next.confirmed){
        clearReportRequest(selected.id);await open(selected.id);setTab('result');setMessage('受付済みの報告の送信状態を確認してください');return;
      }
      if(next.body!==preview.body)setMessage('保存済みの報告候補を表示しています。内容を変更するには候補の破棄が必要です');
    }catch(e:any){setMessage(e.message)}finally{setBusy(false)}
  }
  async function refreshReport(){
    if(!selected)return;setBusy(true);
    try{const next=await refreshCandidate(selected.id);if(next?.confirmed){clearReportRequest(selected.id);setModal('');await open(selected.id);setTab('result');setMessage('受付済みの報告の送信状態を確認してください');}}
    catch(e:any){setMessage(e.message)}finally{setBusy(false)}
  }
  async function discardCandidate(){
    if(!selected||!candidate)return;setBusy(true);
    try{if(candidate.trial?.permitStatus==='Active')await call('chatwork/production/trial/self-cancel',jsonBody({candidateId:candidate.id}));await call(`works/${selected.id}/report-candidate/close`,jsonBody({revision:selected.revision,candidateId:candidate.id}));clearReportRequest(selected.id);setCandidate(null);setModal('');setMessage('報告候補を破棄しました。内容を編集できます');}
    catch(e:any){setMessage(e.message+'。送信状態の照合が必要な場合があります')}finally{setBusy(false)}
  }
  async function prepare() {
    if (!selected || !candidate?.trial?.permitValid || !candidate.trial.prepared || candidate.stale || dirty) return;
    setBusy(true);
    try {
      await call('chatwork/production/trial/register',jsonBody({jobId:candidate.trial.jobId,permitId:candidate.trial.permitId,candidateId:candidate.id}));
      clearReportRequest(selected.id);setModal('');await open(selected.id);setTab('result');setMessage('報告を受け付けました。送信状態を確認してください');
    } catch (e: any) { setMessage(e.message+'。状態を更新して受付結果を確認してください'); }
    finally{setBusy(false)}
  }
  async function upload(file: File) {
    if (!selected || !canEdit) return;
    const workId = selected.id;
    uploadingRef.current++; setUploading(uploadingRef.current);
    try {
      const form = new FormData(); form.append("file", file);
      const result = await call<{ id: string; fileName: string }>("works/" + workId + "/images", { method: "POST", body: form });
      if (selectedRef.current?.id !== workId) return;
      setSelected(current => current?.id === workId && !current.images.some(image => image.id === result.id) ? { ...current, images: [...current.images, { id: result.id, file_name: result.fileName }] } : current);
      mutate(data => { if (!data.imageIds.includes(result.id)) data.imageIds.push(result.id); }); setMessage("画像を追加しました。作業を保存してください");
    } catch (e: any) { setMessage(e.message); }
    finally { uploadingRef.current--; setUploading(uploadingRef.current); }
  }
  async function requestMasterChange() {
    try {
      const result = await call<{ id: string }>("master/changes", jsonBody(masterRequest));
      setMasterChanges(await call("master/changes")); setMasterRequest({ approverName: "", reason: "", approved: false });
      setMessage("変更申請 " + result.id + " を記録しました。Chatwork通知は未接続です");
    } catch (e: any) { setMessage(e.message); }
  }
  function discardLocal() {
    if (!selected) return;
    localStorage.removeItem("kiiya-draft-" + selected.id); setDraft(clone(selected.data)); setDirty(false); setConflict(false); setMessage("端末の未保存入力を破棄しました");
  }
  const field = (label: string, node: React.ReactNode, hint?: string) => <label className="field"><span className="field-label">{label}</span>{node}{hint && <small>{hint}</small>}</label>;
  const button = (label: string, onClick: () => void, kind = "primary", disabled = false) => <button type="button" className={`button ${kind}`} disabled={disabled} onClick={onClick}>{label}</button>;
  const badge = (label: string, tone = "") => <span className={`badge ${tone}`}>{label}</span>;
  const masterTutorialBubble = (target: string) => masterTutorialStage === "steps" && masterTutorialSteps[masterTutorialStep]?.target === target ? <div className="master-tutorial-bubble" role="dialog" aria-label={`${masterTutorialStep + 1}番目の操作説明`}><small>{masterTutorialStep + 1} / {masterTutorialSteps.length}</small><strong>{masterTutorialSteps[masterTutorialStep].title}</strong><p>{masterTutorialSteps[masterTutorialStep].description}</p><div className="master-tutorial-actions"><button type="button" onClick={() => setMasterTutorialStage("closed")}>終了</button>{masterTutorialStep > 0 && <button type="button" onClick={() => setMasterTutorialStep(masterTutorialStep - 1)}>戻る</button>}<button type="button" className="next" onClick={() => masterTutorialStep + 1 < masterTutorialSteps.length ? setMasterTutorialStep(masterTutorialStep + 1) : setMasterTutorialStage("closed")}>{masterTutorialStep + 1 < masterTutorialSteps.length ? "次へ" : "完了"}</button></div></div> : null;
  const taskIds = draft ? activeTasks(draft) : [];
  const active = TASKS.filter(t => taskIds.includes(t.id));
  const missingRoom = (code: RoomCode) => !draft?.roomAnswers[code] || draft.roomAnswers[code]?.type !== draft.rooms[code].type || roomCheckKeys(draft.rooms[code]).some(key => !draft.roomAnswers[code]?.checks[key]) || !draft.roomAnswers[code]?.finalConfirmed || draft.defects.some(d => d.roomCode === code && d.status === "open");
  const doneCount = draft ? draft.roomCodes.filter(c => !missingRoom(c)).length + active.filter(t => draft.tasks[t.id].completed).length : 0;
  const totalCount = draft ? draft.roomCodes.length + active.length : 0;
  const readOnly = !canEdit || conflict || busy;
  async function next(target: Tab) { if (uploadingRef.current) { setMessage('画像の追加が完了するまでお待ちください'); return; } if (dirty) { const value = await save(); if (!value) return; } setTab(target); window.scrollTo(0, 0); }
  function showSettings() { setReturnTab(tab); setTab("settings"); window.scrollTo(0, 0); }
  function showMaster() { setReturnTab(tab); setTab("master"); window.scrollTo(0, 0); }
  function taskAssignee(id: TaskId, name: string) { mutate(d => { const current = d.tasks[id].assignees; d.tasks[id].assignees = current.includes(name) ? current.filter(x => x !== name) : [...current, name]; }); }
  function beginTask(id: TaskId) { mutate(d => { d.tasks[id].startedAt = nowTime(); d.tasks[id].finishedAt = ""; d.tasks[id].completed = false; }); }
  function finishTask(id: TaskId) { mutate(d => { if (!d.tasks[id].startedAt && !d.tasks[id].timeNote) d.tasks[id].startedAt = nowTime(); d.tasks[id].finishedAt = d.tasks[id].startedAt ? nowTime() : ""; d.tasks[id].completed = true; }); }
  function openTime(id: TaskId) { if (!draft) return; setModalTask(id); setModalStart(draft.tasks[id].startedAt); setModalEnd(draft.tasks[id].finishedAt); setModal("time"); }
  function openDefect(code: RoomCode) { if (!draft) return; const item = roomCheckKeys(draft.rooms[code]).find(key => !draft.defects.some(d => d.roomCode === code && d.itemCode === key && d.status === "open")); if (!item) return; setModalRoom(code); setModalItem(item); setNewDefect({ item, description: "" }); setModal("defect"); }
  function setRoomAnswer(code: RoomCode, key: string, checked: boolean) { mutate(d => { const answer = d.roomAnswers[code] || { type: d.rooms[code].type, checks: {}, finalConfirmed: false }; answer.type = d.rooms[code].type; answer.checks[key] = checked; d.roomAnswers[code] = answer; }); }
  const roomMeta = masterCurrent?.data?.rooms || { "203": { capacity: 2, beds: "ダブル1台" }, "204": { capacity: 5, beds: "シングル4台＋エキストラ1台" }, "205": { capacity: 4, beds: "ダブル2台" }, "206": { capacity: 3, beds: "シングル2台＋エキストラ1台" } };
  function drum(key: "toiletTarget" | "showerTarget", label: string, max: number) {
    const value = draft?.[key] || 0;
    const choose = (n: number) => { if (readOnly || !draft) return; mutate(d => { d[key] = Math.max(0, Math.min(max, n)); }); drumRefs.current[key]?.scrollTo({ top: n * 36, behavior: "smooth" }); };
    return <div className="scope-count-card"><div className="scope-count-heading"><strong>{label}</strong><small>最大 {max} 箇所</small></div><div className="drum-picker" role="group" aria-label={`${label}の清掃箇所数`}><button className="drum-arrow" aria-label="1箇所減らす" disabled={readOnly || value <= 0} onClick={() => choose(value - 1)}>▲</button><div className="drum-window" ref={el => { drumRefs.current[key] = el; }} role="spinbutton" tabIndex={0} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value} 箇所`} aria-label={`${label}の清掃箇所数。上下にスクロールして変更`} onScroll={e => { if (readOnly || !draft) return; const n = Math.max(0, Math.min(max, Math.round(e.currentTarget.scrollTop / 36))); if (n !== value) mutate(d => { d[key] = n; }); }} onKeyDown={e => { if (e.key === "ArrowUp") choose(value - 1); if (e.key === "ArrowDown") choose(value + 1); }}>{Array.from({ length: max + 1 }, (_, n) => <div key={n} className={`drum-option ${n === value ? "selected" : ""}`} aria-selected={n === value} onClick={() => choose(n)}>{n} 箇所</div>)}</div><button className="drum-arrow" aria-label="1箇所増やす" disabled={readOnly || value >= max} onClick={() => choose(value + 1)}>▼</button><small className="drum-hint">上下にスワイプして箇所数を変更</small></div></div>;
  }
  useEffect(() => { if (tab !== "scope" || !draft) return; for (const key of ["toiletTarget", "showerTarget"] as const) drumRefs.current[key]?.scrollTo({ top: draft[key] * 36 }); }, [tab, selected?.id]);
  const screen: Record<Tab, { title: string; eyebrow: string; step: number }> = {
    welcome: { title: "清掃を、見落とさない。", eyebrow: "WELCOME", step: 0 },
    today: { title: "今日の作業", eyebrow: "01 / WORK START", step: 1 },
    scope: { title: "清掃範囲を選ぶ", eyebrow: "02 / TODAY'S AREAS", step: 2 },
    checks: { title: "全体チェック", eyebrow: "03 / CHECKLIST", step: 0 },
    report: { title: "報告内容を確認", eyebrow: "04 / REPORT PREVIEW", step: 4 },
    result: { title: "報告結果の状態", eyebrow: "REPORT STATUS", step: 0 },
    settings: { title: "設定", eyebrow: "SETTINGS", step: 0 },
    chatwork: { title: "Chatwork連携", eyebrow: "CHATWORK", step: 0 },
    people: { title: "職員台帳", eyebrow: "STAFF", step: 0 },
    archive: { title: "アーカイブ", eyebrow: "HISTORY", step: 0 },
    archiveDetail: { title: "過去の記録", eyebrow: "ARCHIVE DETAIL", step: 0 },
    master: { title: "マニュアル変更申請", eyebrow: "MANUAL CHANGE REQUEST", step: 0 },
  };
  const selectedArchive = items.find(x => x.id === archiveId);
  const steps = ["開始", "対象選択", "チェック", "報告内容"];
  let footer: React.ReactNode = null;
  if (me?.active) {
    if (tab === "today" && me.role === "field") footer = button(selected?.data.startedAt ? "清掃範囲へ進む →" : "作業を開始する →", () => { if (selected?.data.startedAt) next("scope"); else if (selected) start(); else create(); }, "primary", busy || (!!selected && !canEdit));
    if (tab === "scope") footer = <>{button("戻る", () => setTab("today"), "secondary")}{button("チェックを始める →", () => next("checks"), "primary", busy)}</>;
    if (tab === "checks") {
      const unfilled = draft?.roomCodes.reduce((count, code) => count + roomCheckKeys(draft.rooms[code]).filter(key => !draft.roomAnswers[code]?.checks[key]).length + (draft.roomAnswers[code]?.finalConfirmed ? 0 : 1), 0) || 0;
      footer = <>{button("戻る", () => setTab("scope"), "secondary")}<div className="report-action">{unfilled > 0 && <button className="missing-bubble" onClick={() => { const node = document.querySelector(".room-switch"); node?.scrollIntoView({ behavior: "smooth" }); }} aria-label="未入力のチェック項目を確認">{unfilled}箇所入力されていません！<span>タップして確認</span></button>}{button("報告内容へ →", loadPreview, "primary", busy || !draft || missingForReport(draft).length > 0)}</div></>;
    }
    if (tab === "report") footer = <>{button("チェックに戻る", () => setTab("checks"), "secondary")}{button("報告へ →", () => { void beginReport(); }, "primary", !preview?.ready || format !== "markdown" || !canEdit || dirty || busy)}</>;
    if (tab === "result") footer = <>{button("設定・履歴を見る", showSettings, "secondary")}{button("修正する →", () => setTab("checks"))}</>;
    if (tab === "settings") footer = button("作業画面に戻る", () => setTab(returnTab));
    if (tab === "chatwork" || tab === "people") footer = button("設定へ戻る", () => setTab("settings"));
    if (tab === "archive") footer = button("設定へ戻る", () => setTab("settings"));
    if (tab === "archiveDetail") footer = button("一覧へ戻る", () => setTab("archive"));
    if (tab === "master") footer = button("前の画面へ戻る", () => setTab(returnTab));
  }
  return <div className="shell"><div className="shell-top"><div className="brand"><span className="brand-mark">K</span><span>KIIYA <small>見落としチェッカー</small></span></div><div className="header-actions">{me && <span className="header-user-name" aria-label={`ログイン中: ${me.name}`} title={me.name}>{me.name}</span>}{me && <a className="sign-out-link" href={signOutPath} target="_top" onClick={() => clearReportRequest()}>ログアウト</a>}</div></div>
    <div className={`workspace ${me?.active && me.role === "normal" ? "viewer-workspace" : ""}`}>{me?.active && me.role === "field" && <aside className="desktop-rail"><div className="rail-heading">CLEANING WORKFLOW</div><div className="rail-title">清掃の確認を、<br/>ひとつずつ。</div><p>清掃範囲の選択から報告内容の確認まで。作業記録はSitesのD1、画像はR2に保存します。</p><div className="rail-line"/><div className="rail-step">01 <span>今日の作業</span></div><div className="rail-step">02 <span>清掃範囲</span></div><div className="rail-step">03 <span>全体チェック</span></div><div className="rail-step">04 <span>報告内容</span></div></aside>}
      <main className="phone"><div className="phone-inner">{me?.active && <div className="context"><span>{screen[tab].eyebrow}</span><span>{selected?.day || today} · 予定 9:55</span></div>}{me?.active && me.role === "field" && screen[tab].step > 0 && <div className="stepper" aria-label="進行状況">{steps.map((s,i) => <div className={`step ${i + 1 <= screen[tab].step ? "active" : ""}`} key={s}><span>{i+1}</span><small>{s}</small></div>)}</div>}{me?.active && tab !== "chatwork" && <div className={`page-heading ${tab === "master" ? "master-page-heading" : ""}`}><h1>{screen[tab].title}</h1>{tab === "master" && <button type="button" className="master-tutorial-launch" onClick={() => { setMasterTutorialStep(0); setMasterTutorialStage("intro"); }}>チュートリアル</button>}</div>}
        {message && <div className="toast" role="status">{message}</div>}
        {!me && <div className="select-card">サインインを確認しています…</div>}
        {me && !me.active && <div className="select-card"><h2>利用登録が必要です</h2><p>本人確認後、下の登録用IDを開発者に伝えてください。登録が完了するまでは作業内容を閲覧できません。</p><div className="registration-id"><span>登録用ID</span><code>{me.id}</code>{button("IDをコピー", async () => { try { await navigator.clipboard.writeText(me.id); setMessage("登録用IDをコピーしました"); } catch { setMessage("コピーできませんでした。IDを選択してコピーしてください"); } }, "outline compact")}</div></div>}
        {me?.active && <>
        {tab === "welcome" && <><div className="hero-card"><div className="hero-icon">✓</div><p className="overline">KIIYA CLEANING CHECKER</p><h2>今日やることが、<br/>ひと目でわかる。</h2><p>清掃範囲の選択から報告内容の確認まで。スマートフォンで作業を記録できます。</p></div>
          <div className="notice"><strong>{delivery === null ? "送信設定を確認できません" : delivery.setupReason === "RoomNotConfigured" ? "業務報告ルームの設定が必要です" : delivery.deliveryEnabled ? "Chatwork送信の準備ができています" : delivery.setupReason === "RoomVerificationRequired" ? "送信元・送信先を登録済み／投稿確認待ち" : "Chatwork送信は準備中です"}</strong><span>{delivery === null ? "設定状態を読み込めません。作業記録は続けられます。" : delivery.setupReason === "RoomNotConfigured" ? me.manageChatwork ? "設定画面で送信元を接続し、業務報告ルームのIDを入力してください。" : "現場職員に業務報告ルームの登録を依頼してください。閲覧は続けられます。" : delivery.roomName ? `送信先：${delivery.roomName}。確認投稿と業務報告の送信はまだ利用できません。` : "送信先の確認と送信経路の準備が必要です。"}</span>{me.manageChatwork && delivery?.setupRequired && <button type="button" className="button outline compact" onClick={() => { setReturnTab("welcome"); setTab("chatwork"); }}>Chatwork設定を開く</button>}</div>
          {button(me.role === "field" ? "今日の作業を開く →" : "清掃記録を見る →", () => setTab("today"))}{me.role === "normal" && <p className="tiny">通常職員は閲覧のみ利用できます。</p>}</>}
        {tab === "today" && me.role === "normal" && <><div className="notice mini"><strong>閲覧のみ利用できます</strong><span>清掃記録・報告書・写真を確認できます。作業の入力は現場職員に依頼してください。</span></div><section className="section"><h2>本日の清掃記録</h2><div className="stack">{items.filter(x => x.day === today).map(item => <button key={item.id} className="archive-row" onClick={async () => { await open(item.id); setArchiveId(item.id); setTab("archiveDetail"); }}><span><strong>{item.day}の清掃記録</strong><em>{item.owner_id === me.id ? "自分の作業" : "他職員の作業"}</em></span><span>{badge(statusLabel(item.status))} →</span></button>)}{!items.some(x => x.day === today) && <div className="empty-small">本日の記録はまだありません。</div>}</div></section>{button("設定・アーカイブ", showSettings, "outline")}</>}{tab === "today" && me.role === "field" && <><div className="date-card"><div><small>作業日</small><strong>{selected?.day || today}</strong></div><div><small>開始予定 / 実開始</small><strong>9:55 / {displayStart(draft?.startedAt || "")}</strong></div></div><section className="section"><h2>作業する人</h2><p className="section-copy">参加するスタッフと職員を入力します。作業開始時刻は全体で1回記録し、各清掃作業は同時進行できます。</p>{selected && draft ? <>{field("スタッフ人数", <select disabled={readOnly} value={staffCount} onChange={e => { const n = Number(e.target.value); setStaffCount(n); mutate(d => { d.staffNames = Array.from({ length: n }, (_, i) => d.staffNames[i] || ""); }); }}>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}人</option>)}</select>)}<div className="stack">{Array.from({ length: staffCount }, (_, i) => field(`スタッフ ${i+1}`, <input key={i} value={draft.staffNames[i] || ""} placeholder="氏名を入力" disabled={readOnly} onChange={e => { const value = e.target.value; mutate(d => { d.staffNames[i] = value; }); }}/>))}</div>{field("本日の担当職員", <input value={draft.leadName} readOnly title="担当職員は作成者に固定"/>)}<p className="tiny">担当職員は作成者に固定されます。</p>{dirty && button("入力内容を保存", () => { void save(); }, "outline compact", busy || uploading > 0)}{items.filter(x => x.day === today && x.id !== selected.id).map(item => <button key={item.id} className="archive-row" onClick={() => open(item.id)}><span><small>{item.day}</small><strong>他職員の作業</strong><em>{statusLabel(item.status)}</em></span><span>→</span></button>)}</> : <>{!items.some(x => x.owner_id === me.id && x.day === today) && <div className="empty-small">本日の作業はまだありません。</div>}{button(items.some(x => x.owner_id === me.id && x.day === today) ? "本日の作業を開く" : "本日の作業を作成", create, "outline", busy)}{items.filter(x => x.day === today && x.owner_id !== me.id).map(item => <button key={item.id} className="archive-row" onClick={() => open(item.id)}><span><small>{item.day}</small><strong>他職員の作業</strong><em>{statusLabel(item.status)}</em></span><span>→</span></button>)}</>}</section><div className="secondary-links chatwork-settings-link">{button("設定・アーカイブ", showSettings, "text")}{!delivery?.deliveryEnabled && <span className="chatwork-link-callout" role="status">{connectionMessage(delivery)}</span>}</div></>}
        {tab === "scope" && draft && <><p className="lead-copy">客室と清掃対象を選びます。初期値はトイレ2箇所・シャワー3箇所です。</p><section className="section"><div className="section-title"><h2>客室</h2>{badge(`${draft.roomCodes.length}室`, "soft")}</div><div className="stack">{ROOM_CODES.map(code => { const room = draft.rooms[code]; const meta = roomMeta[code]; const capacity = meta?.capacity || 5; const total = room.adults + room.children; return <div className="select-card" key={code}><label className="select-head"><input type="checkbox" disabled={readOnly} checked={draft.roomCodes.includes(code)} onChange={e => mutate(d => { d.roomCodes = e.target.checked ? [...d.roomCodes, code].sort() : d.roomCodes.filter(x => x !== code); })}/><span className="select-card-title">{code}号室</span><span className="meta">定員{capacity}名</span></label><div className="bed-label">{meta?.beds || ""}</div>{draft.roomCodes.includes(code) && <div className="room-stay"><div className="number-pair">{field("大人", <input type="number" min="0" max={capacity} value={room.adults} disabled={readOnly || total === 0} onChange={e => mutate(d => { updateRoomOccupancy(d, code, Number(e.target.value), d.rooms[code].children); })}/>)}{field("子ども", <input type="number" min="0" max={capacity} value={room.children} disabled={readOnly || total === 0} onChange={e => mutate(d => { updateRoomOccupancy(d, code, d.rooms[code].adults, Number(e.target.value)); })}/>)}</div>{field("作業種別", <select value={room.type} disabled={readOnly} onChange={e => mutate(d => { d.rooms[code].type = e.target.value as RoomType; delete d.roomAnswers[code]; })}>{Object.entries(typeLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>)}<label className="no-stay-toggle"><input type="checkbox" checked={total === 0} disabled={readOnly} onChange={e => mutate(d => setRoomNoStay(d, code, e.target.checked))}/><span><strong>宿泊なし</strong><small>清掃種別はそのままに、宿泊人数を0人として扱います</small></span></label>{(code === "204" || code === "206") && total > 0 && <div className="subnote">EXベッド：{extraBedRequired(code, room) ? "使用あり" : "使用なし"}（宿泊人数から自動判定）</div>}{total !== 0 && <div className={`subnote ${total < 0 || total > capacity ? "error" : ""}`}>{total >= 0 && total <= capacity ? `合計 ${total} 名 · 定員 ${capacity} 名` : `合計は0〜${capacity}名で入力してください`}</div>}</div>}</div>; })}</div></section><section className="section"><div className="section-title"><h2>トイレ・シャワー</h2><span className="tiny">本日の対象数</span></div>{drum("toiletTarget", "トイレ", 2)}{drum("showerTarget", "シャワー", 3)}</section><div className="info-strip">洗面台、ラウンジ、客室廊下、階段・玄関、洗面周り廊下は毎回対象です。</div></>}
        {tab === "checks" && draft && <><div className="compact-summary"><strong>今日の進捗 {doneCount} / {totalCount}</strong><span>{missingForReport(draft).length ? `未完了 ${missingForReport(draft).length}件` : "報告内容を確認できます"}</span><div className="progress-track"><span style={{ width: `${totalCount ? Math.round(doneCount / totalCount * 100) : 0}%` }}/></div></div><div className="top-actions">{button("対象を変更", () => setTab("scope"), "text compact")}{button("設定", showSettings, "text compact")}{button("マニュアル変更申請", showMaster, "text compact")}</div>
          <div className="room-switch"><div className="section-title"><h2>客室チェック</h2>{badge(`${draft.roomCodes.length}室`, "soft")}</div>{draft.roomCodes.length === 0 ? <div className="empty-small">本日の対象客室はありません。客室向けの作業カードと確認欄は表示されません。</div> : <><div className="room-tabs" role="group" aria-label="確認する客室">{draft.roomCodes.map(code => { const defects = draft.defects.some(d => d.roomCode === code && d.status === "open"); return <button key={code} className={`room-tab ${focusRoom === code ? "active" : ""} ${!missingRoom(code) ? "done" : ""} ${defects ? "defect" : ""}`} aria-pressed={focusRoom === code} onClick={() => setFocusRoom(code)}><strong>{code}</strong>{defects || missingRoom(code) ? <small>{defects ? "不備" : "未完了"}</small> : <span className="room-tab-check" role="img" aria-label="完了">✓</span>}</button>; })}</div>{draft.roomCodes.includes(focusRoom) && <article className="room-panel"><div className="room-panel-head"><div><span className="card-kicker">GUEST ROOM</span><h3>{focusRoom}号室</h3><p>{typeLabels[draft.rooms[focusRoom].type]} · 大人{draft.rooms[focusRoom].adults}名 / 子ども{draft.rooms[focusRoom].children}名</p></div>{badge(missingRoom(focusRoom) ? "確認中" : "確認完了", missingRoom(focusRoom) ? "soft" : "good")}</div><p className="room-bed">{roomMeta[focusRoom]?.beds} · 定員{roomMeta[focusRoom]?.capacity}名{draft.rooms[focusRoom].adults + draft.rooms[focusRoom].children === 0 ? " · 宿泊なし" : <> · アメニティ設置：{draft.rooms[focusRoom].type === "stay_amenities_only" ? "玄関靴箱" : "部屋"}</>}</p>{draft.rooms[focusRoom].adults + draft.rooms[focusRoom].children > 0 && <div className="room-amenity">大人用スリッパ {draft.rooms[focusRoom].adults}足 ／ 子ども用 {draft.rooms[focusRoom].children}足 ／ 歯ブラシ {draft.rooms[focusRoom].adults + draft.rooms[focusRoom].children}本{draft.rooms[focusRoom].type !== "stay_amenities_only" && ` ／ 枕 ${draft.rooms[focusRoom].adults + draft.rooms[focusRoom].children}個`}</div>}<p className="tiny">気づきは下の備考へ、報告を止める問題は該当項目で不備登録します。</p>{draft.rooms[focusRoom].adults + draft.rooms[focusRoom].children === 0 && draft.rooms[focusRoom].type === "stay_amenities_only" && <p className="empty-small">宿泊なしのため個別の客室チェックはありません。職員の最終確認を行ってください。</p>}{["清掃", "アメニティ"].map(group => { const keys = roomCheckKeys(draft.rooms[focusRoom]).filter(k => (group === "アメニティ") === ["adult_slippers","child_slippers","toothbrushes","placement","amenities_message"].includes(k)); return keys.length > 0 && <div className="room-check-group" key={group}><h4>{group}</h4>{keys.map(key => { const activeDefect = draft.defects.find(d => d.roomCode === focusRoom && d.itemCode === key && d.status === "open"); const resolved = draft.defects.filter(d => d.roomCode === focusRoom && d.itemCode === key && d.status === "resolved").length; return <div className="check-with-defect" key={key}><label className="task-row"><input type="checkbox" disabled={readOnly} checked={draft.roomAnswers[focusRoom]?.type === draft.rooms[focusRoom].type && !!draft.roomAnswers[focusRoom]?.checks[key]} onChange={e => setRoomAnswer(focusRoom, key, e.target.checked)}/><span><span className="task-box">✓</span>{key === "bedmaking" ? bedmakingLabel(focusRoom, draft.rooms[focusRoom]) : checkLabels[key] || key}</span></label>{(activeDefect || resolved > 0) && <div className="defect-actions">{activeDefect && <div className="defect-note"><strong>未解消の不備</strong><span>{activeDefect.description}</span>{button("解消済みにする", () => mutate(d => { const item = d.defects.find(x => x.id === activeDefect.id); if (item) { item.status = "resolved"; item.resolvedAt = new Date().toISOString(); } }), "outline compact", readOnly)}</div>}{resolved > 0 && <small>解消履歴 {resolved}件</small>}</div>}</div>; })}</div>; })}{draft.defects.filter(d => d.roomCode === focusRoom && d.status === "open" && !roomCheckKeys(draft.rooms[focusRoom]).includes(d.itemCode)).map(defect => <div className="defect-note" key={defect.id}><strong>対象変更前の未解消不備</strong><span>{checkLabels[defect.itemCode] || defect.itemCode}：{defect.description}</span>{button("解消済みにする", () => mutate(d => { const item = d.defects.find(x => x.id === defect.id); if (item) { item.status = "resolved"; item.resolvedAt = new Date().toISOString(); } }), "outline compact", readOnly)}</div>)}<div className="room-final"><label className="task-row"><input type="checkbox" disabled={readOnly} checked={!!draft.roomAnswers[focusRoom]?.finalConfirmed} onChange={e => mutate(d => { const answer = d.roomAnswers[focusRoom] || { type: d.rooms[focusRoom].type, checks: {}, finalConfirmed: false }; answer.finalConfirmed = e.target.checked; d.roomAnswers[focusRoom] = answer; })}/><span><span className="task-box">✓</span>職員の最終確認</span></label><small>エアコンを消し、窓を閉めたことを確認</small>{button("不備を登録", () => openDefect(focusRoom), "text compact defect-register", readOnly || roomCheckKeys(draft.rooms[focusRoom]).every(key => draft.defects.some(d => d.roomCode === focusRoom && d.itemCode === key && d.status === "open")))}</div>{draft.defects.some(d => d.roomCode === focusRoom && d.status === "open") && <p className="inline-error">未解消不備があります。解消後は該当項目と最終確認をやり直してください。</p>}</article>}</>}</div>
          {[1,2].map(unit => <section className="section task-section" key={unit}><div className="section-title"><h2>ユニット{unit}の作業</h2>{badge(unit === 1 ? "作業別に時間を記録" : "同時進行できます", "soft")}</div>{active.filter(t => t.unit === unit).map(task => { const p = draft.tasks[task.id]; const targetRooms = taskTargetRooms(draft, task.id); const target = targetRooms.length ? task.id === "bedmaking" ? `対象 ${bedmakingTargetLabel(draft)}` : `対象 ${targetRooms.join("・")}号室` : task.id === "showers" ? `対象 ${draft.showerTarget}箇所` : task.id === "toilets" ? `対象 ${draft.toiletTarget}箇所` : ""; const candidates = [...new Set([...draft.staffNames.filter(Boolean), draft.leadName])]; return <article className={`work-task ${p.completed ? "done" : ""}`} key={task.id}><div className="work-task-head"><div><h3>{task.label}</h3>{target && <small>{target}</small>}</div>{(p.completed || !p.startedAt) && badge(p.completed ? "完了" : "未開始", p.completed ? "good" : "soft")}</div><div className="micro-label">担当者</div><div className="assignees">{candidates.map(name => <label className="check-pill" key={name}><input type="checkbox" checked={p.assignees.includes(name)} disabled={readOnly} onChange={() => taskAssignee(task.id, name)}/><span>{name === draft.leadName ? `職員：${name}` : name}</span></label>)}</div><div className="work-task-time"><span>開始 <strong>{p.startedAt || "--:--"}</strong></span><span>終了 <strong>{p.finishedAt || "--:--"}</strong></span></div>{task.id === "showers" && <label className="task-count">清掃済みのシャワー<select disabled={readOnly} value={p.completedCount} onChange={e => mutate(d => { d.tasks.showers.completedCount = Number(e.target.value); })}>{Array.from({ length: draft.showerTarget + 1 }, (_, n) => <option key={n} value={n}>{n}箇所</option>)}</select></label>}<label className="task-note">時間・進め方のメモ<input value={p.timeNote} disabled={readOnly} placeholder="例：ベッドメイク後の部屋から随時" onChange={e => mutate(d => { d.tasks[task.id].timeNote = e.target.value; })}/></label><div className="card-actions">{!p.completed && taskActionLabel(p).status && badge(taskActionLabel(p).status!, "soft")}{p.completed ? <>{button("時刻編集", () => openTime(task.id), "outline compact", readOnly)}<span className="task-complete-mark" role="img" aria-label="完了">✓</span></> : taskActionLabel(p).action === "finish" ? <button type="button" className="button secondary compact" title="押すと作業を完了します" aria-label={`${task.label}の作業を完了する`} onClick={() => finishTask(task.id)} disabled={readOnly || !p.assignees.length || (task.id === "showers" && p.completedCount < 1)}>{taskActionLabel(p).label}</button> : button("開始", () => beginTask(task.id), "secondary compact", readOnly || !p.assignees.length)}</div></article>; })}</section>)}
          <section className="section shared-fields"><div className="section-title"><h2>共通の記録</h2>{badge("報告に反映", "soft")}</div>{field("休憩は取れましたか？", <div className="segmented">{(["yes","no"] as const).map(value => <label key={value}><input type="radio" name="break" disabled={readOnly} checked={draft.breakAnswer === value} onChange={() => mutate(d => { d.breakAnswer = value; })}/><span>{value === "yes" ? "はい" : "いいえ"}</span></label>)}</div>)}{field("休憩開始", <input type="time" value={draft.breakStart} disabled={readOnly} onChange={e => mutate(d => { d.breakStart = e.target.value; })}/>)}{field("休憩終了", <input type="time" value={draft.breakEnd} disabled={readOnly} onChange={e => mutate(d => { d.breakEnd = e.target.value; })}/>)}{([ ["所感・課題","notes"], ["鍵に関するメモ","keyMemo"], ["シーツに関するメモ","sheetMemo"] ] as const).map(([label,key]) => <div key={key}>{field(label, <textarea value={draft[key]} disabled={readOnly} onChange={e => mutate(d => { d[key] = e.target.value; })}/>)}</div>)}<div className="photo-actions"><label className="button outline compact upload">写真を撮る<input type="file" accept="image/*" capture="environment" hidden disabled={readOnly} onChange={e => { if (e.target.files?.[0]) void upload(e.target.files[0]); e.target.value = ""; }}/></label><label className="button outline compact upload">画像を選ぶ<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={readOnly} onChange={e => { if (e.target.files?.[0]) void upload(e.target.files[0]); e.target.value = ""; }}/></label></div>{selected?.images.filter(image => draft.imageIds.includes(image.id)).length ? <div className="photo-grid">{selected.images.filter(image => draft.imageIds.includes(image.id)).map(image => <div className="photo" key={image.id}><img src={`/api/works/${selected.id}/images/${image.id}`} alt={image.file_name}/><button aria-label="画像を作業から外す" disabled={readOnly} onClick={() => mutate(d => { d.imageIds = d.imageIds.filter(x => x !== image.id); })}>×</button></div>)}</div> : <p className="tiny">添付画像はありません。</p>}</section>
          {missingForReport(draft).length > 0 && <div className="missing-list" role="status"><strong>未完了の項目</strong><ul>{missingForReport(draft).map((x,i) => <li key={i}>{x}</li>)}</ul></div>}
        </>}
        {tab === "report" && selected && <><div className="report-status">{badge("送信前のプレビュー", "soft")}<span>送信版はまだ作成されていません</span></div><section className="section"><div className="section-title"><h2>形式を選ぶ</h2></div><div className="segmented"><label><input type="radio" name="format" checked={format === "pdf"} onChange={() => setFormat("pdf")}/><span>PDF</span></label><label><input type="radio" name="format" checked={format === "markdown"} onChange={() => setFormat("markdown")}/><span>Markdown</span></label></div><p className="tiny">{format === "pdf" ? "PDFの見た目を確認できます。PDFの確定・送信は未接続です。" : "送信先と内容を確認してChatworkへ送信できます。"}</p></section>{preview?.missing.length ? <div className="missing-list"><strong>未完了の項目</strong><ul>{preview.missing.map((x,i) => <li key={i}>{x}</li>)}</ul></div> : null}<div className={`report-paper ${format}`}><pre>{preview?.body || "プレビューを読み込み中です"}</pre>{selected.images.filter(image => draft?.imageIds.includes(image.id)).length > 0 && <div className="report-photos">添付画像 {selected.images.filter(image => draft?.imageIds.includes(image.id)).length}枚 <div>{selected.images.filter(image => draft?.imageIds.includes(image.id)).map(image => <img key={image.id} src={`/api/works/${selected.id}/images/${image.id}`} alt={image.file_name}/>)}</div></div>}</div><div className="report-actions">{button("レポートを編集", () => { setReportEdit(preview?.body || ""); setModal("report-edit"); }, "outline", !preview || !canEdit || dirty)}{button("報告", () => { void beginReport(); }, "primary", !preview?.ready || format !== "markdown" || !canEdit || dirty || busy)}</div>{selected.reports.length > 0 && <section className="section"><h2>確定済みの版</h2>{selected.reports.map(report => <details className="area-dropdown" key={report.id}><summary><strong>第{report.sequence}版 · {statusLabel(report.status)}</strong></summary><div className="area-options"><a href={`/api/works/${selected.id}/reports/${report.id}/markdown`}>Markdownを取得</a>{selected.ownerId === me?.id && <ReportDeliveryHistory workId={selected.id} reportId={report.id}/>}<pre className="archived-body">{report.body}</pre></div></details>)}</section>}</>}
        {tab === "result" && selected && <><div className="result-hero unknown"><div className="result-symbol">…</div><h2>報告を受け付けました</h2><p>Chatworkへの送信状態を確認してください。</p></div><section className="section"><h2>送信状態</h2>{selected.reports[0] ? <ReportDeliveryHistory workId={selected.id} reportId={selected.reports[0].id}/> : <p>報告の状態を確認中です。再読み込みしてください。</p>}</section><div className="stack">{button("内容を修正して新版を作る", () => setTab("checks"), "outline")}{button("今日の作業へ戻る", () => setTab("today"), "secondary")}</div></>}
        {tab === "settings" && <>{me.role === "field" ? <div className="notice mini"><strong>業務報告の送信状態</strong><span>{delivery?.deliveryEnabled ? "送信できます。" : "送信経路の確認中です。報告版は準備状態で保存され、Chatworkにはまだ送信されません。"}</span></div> : <section className="section"><h2>Chatwork送信先</h2><div className="detail-list"><div><span>現在のルーム名</span><strong>{delivery === null ? "確認できません" : delivery.roomName || "未設定"}</strong></div></div></section>}
          <section className="section"><h2>記録と管理</h2><div className="settings-links"><button onClick={() => setTab("archive")}><span>アーカイブを開く<small>前日の作業と報告版を見る</small></span><b>→</b></button>{me.role === "field" && <button onClick={showMaster}><span>マニュアル変更申請<small>承認申告と通知状態</small></span><b>→</b></button>}{me.role === "field" && <button onClick={() => setTab("chatwork")}><span>Chatwork連携<small>送信元と報告ルームの設定</small></span><b>→</b></button>}<button onClick={() => setTab("people")}><span>職員台帳<small>氏名と権限を確認・変更</small></span><b>→</b></button></div></section></>}
        {tab === "chatwork" && me.role === "field" && <ChatworkProductionSettings canManage deliveryStatus={delivery} onUpdated={() => { call<DeliveryStatus>("report-delivery-settings").then(setDelivery).catch(() => setDelivery(null)); }}/>}
        {tab === "chatwork" && me.role === "normal" && <section className="section"><h2>Chatwork送信先</h2><div className="detail-list"><div><span>現在のルーム名</span><strong>{delivery === null ? "確認できません" : delivery.roomName || "未設定"}</strong></div></div></section>}
        {tab === "people" && <StaffDirectory ownId={me.id} canManage={me.role === "field"} canRegister={me.appAdmin} onOwnNameChanged={() => { call<Me>("me").then(setMe).catch(() => {}); }}/>}
        {tab === "archive" && <><p className="lead-copy">日付が変わった作業をここから確認します。作成者は保存期限内に未送信の記録を編集できます。</p><div className="stack">{items.filter(x => x.day < today).length ? items.filter(x => x.day < today).map(item => <button key={item.id} className="archive-row" onClick={async () => { await open(item.id); setArchiveId(item.id); setTab("archiveDetail"); }}><span><small>{item.day}</small><strong>{item.day}の清掃記録</strong><em>{item.owner_id === me.id ? "自分の作業" : "他職員の作業"}</em></span><span>{badge(statusLabel(item.status))} →</span></button>) : <div className="empty-small">過去の記録はありません。</div>}</div></>}
        {tab === "archiveDetail" && selectedArchive && selected && <><div className="archive-detail"><small>{selectedArchive.day}</small><h2>{selectedArchive.day}の清掃記録</h2>{badge(statusLabel(selectedArchive.status))}</div><section className="section"><h2>対象箇所</h2><div className="tag-list">{selected.data.roomCodes.map(code => <span key={code}>{badge(`${code}号室`, "soft")}</span>)}</div><p className="tiny">対象から外した箇所は、この詳細には表示しません。</p></section><section className="section"><h2>報告版</h2>{selected.reports.length ? selected.reports.map(report => <details className="area-dropdown" key={report.id}><summary><strong>第{report.sequence}版</strong>{badge(statusLabel(report.status))}</summary><div className="area-options"><a href={`/api/works/${selected.id}/reports/${report.id}/markdown`}>Markdownを取得</a><pre className="archived-body">{report.body}</pre></div></details>) : <p className="empty-small">報告版はありません。</p>}</section>{selected.images.length > 0 && <section className="section"><h2>写真</h2><div className="report-photos">{selected.images.map(image => <img key={image.id} src={`/api/works/${selected.id}/images/${image.id}`} alt={image.file_name}/>)}</div></section>}{canEdit && selected.status !== "Completed" && button("この記録を再開する", () => setTab(selected.data.startedAt ? "checks" : "today"), "outline")}</>}
        {tab === "master" && me.role === "field" && <>
          <div className="notice"><strong>マニュアル変更申請</strong><span>申請の記録まで利用できます。Chatwork通知・新版の編集と適用は未接続です。</span></div>
          <section className="section"><h2>1. 変更を申請</h2>
            <div className={`master-tutorial-focus ${masterTutorialStage === "steps" && masterTutorialSteps[masterTutorialStep]?.target === "reason" ? "active" : ""}`} data-master-tutorial="reason">{field("変更内容", <textarea value={masterRequest.reason} placeholder="例：客室の備品配置を変更" onChange={e => setMasterRequest({ ...masterRequest, reason: e.target.value })}/>)}{masterTutorialBubble("reason")}</div>
            <div className={`master-tutorial-focus ${masterTutorialStage === "steps" && masterTutorialSteps[masterTutorialStep]?.target === "approver" ? "active" : ""}`} data-master-tutorial="approver">{field("承認を得た別職員1名の氏名", <input value={masterRequest.approverName} placeholder="氏名を入力" onChange={e => setMasterRequest({ ...masterRequest, approverName: e.target.value })}/>)}{masterTutorialBubble("approver")}</div>
            <div className={`master-tutorial-focus ${masterTutorialStage === "steps" && masterTutorialSteps[masterTutorialStep]?.target === "approval" ? "active" : ""}`} data-master-tutorial="approval"><label className="approval-check"><input type="checkbox" checked={masterRequest.approved} onChange={e => setMasterRequest({ ...masterRequest, approved: e.target.checked })}/>別職員の承認を得ました（自己申告）</label>{masterTutorialBubble("approval")}</div>
            <div className={`master-tutorial-focus ${masterTutorialStage === "steps" && masterTutorialSteps[masterTutorialStep]?.target === "submit" ? "active" : ""}`} data-master-tutorial="submit">{button("申請を記録", requestMasterChange, "outline", !masterRequest.reason.trim() || !masterRequest.approverName.trim() || !masterRequest.approved || masterTutorialStage !== "closed")}{masterTutorialBubble("submit")}</div>
          </section>
          <section className="section"><h2>2. 完成版を編集・確認</h2><p className="section-copy">通知だけでは新版を適用しません。編集と別職員による確認は連携後に有効になります。</p>{field("編集した職員", <input disabled placeholder="通知後に入力"/>)}{field("内容を確認した別職員", <input disabled placeholder="編集後に入力"/>)}</section>
          <section className="section"><h2>現在の状態</h2><div className="status-line">{badge(masterChanges[0]?.status || "未申請", "soft")}</div><p className="tiny">確認が終わった翌日の0時（日本時間）から新規作業に適用する設計です。</p>{masterChanges.map(change => <div className="version-row" key={change.id}><span>{change.reason}</span>{badge(change.status)}</div>)}</section>
        </>}
        {conflict && <div className="warning"><strong>未保存入力の競合</strong><p>サーバーの記録が更新されています。端末の未保存入力を確認してください。</p>{button("端末の入力を破棄", discardLocal, "outline")}</div>}
        {dirty && <div className="notice mini"><strong>未保存の変更があります</strong>{button("保存する", () => { void save(); }, "outline compact", busy || conflict || uploading > 0)}</div>}
        </>}
      </div>{footer && <div className="bottom-bar">{footer}</div>}</main></div><div className="desktop-foot">KIIYA 見落としチェッカー</div>
      {tab === "master" && masterTutorialStage === "steps" && <div className="master-tutorial-scrim" aria-hidden="true"/>}
      {tab === "master" && masterTutorialStage === "intro" && <div className="master-tutorial-intro-backdrop"><div className="master-tutorial-intro" role="dialog" aria-modal="true" aria-labelledby="master-tutorial-title"><p className="overline">HOW TO USE</p><h2 id="master-tutorial-title">マニュアル変更申請の流れ</h2><ul><li>当日の担当職員が作業開始後に、別職員1名の承認を得たことを自己申告して申請します。</li><li>承認者の氏名を記録します。承認者本人によるアプリ操作は不要です。</li><li>現在のアプリでできるのは申請の記録までです。Chatwork通知とマスタの編集・確認・適用は未接続です。</li><li>連携後は、通知に成功した申請を職員が編集し、編集に参加していない別職員が確認します。確認の翌日0時から新版を新規作業に適用する設計です。</li></ul><div className="master-tutorial-intro-actions"><button type="button" onClick={() => setMasterTutorialStage("closed")}>閉じる</button><button type="button" className="next" onClick={() => { setMasterTutorialStep(0); setMasterTutorialStage("steps"); }}>入力場所を見る</button></div></div></div>}
      {modal && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">{modal === "defect" && <><div className="modal-head"><p className="overline">ROOM DEFECT</p><h2 id="modal-title">不備を登録</h2><p>{modalRoom}号室</p></div>{field("該当する項目", <select value={modalItem} onChange={e => setModalItem(e.target.value)}>{draft && roomCheckKeys(draft.rooms[modalRoom]).filter(key => !draft.defects.some(d => d.roomCode === modalRoom && d.itemCode === key && d.status === "open")).map(key => <option key={key} value={key}>{checkLabels[key] || key}</option>)}</select>)}{field("不備の内容", <textarea value={newDefect.description} placeholder="確認した問題を入力" onChange={e => setNewDefect({ ...newDefect, description: e.target.value })}/>)}<div className="modal-actions">{button("キャンセル", () => setModal(""), "secondary")}{button("登録", () => { mutate(d => { d.defects.push({ id: crypto.randomUUID(), roomCode: modalRoom, itemCode: modalItem, description: newDefect.description.trim(), status: "open", createdAt: new Date().toISOString() }); }); setModal(""); }, "primary", !newDefect.description.trim())}</div></>}{modal === "time" && <><div className="modal-head"><p className="overline">EDIT TIME</p><h2 id="modal-title">{TASKS.find(t => t.id === modalTask)?.label}の時刻編集</h2><p>開始時刻と終了時刻を修正できます。</p></div><div className="time-edit-fields">{field("開始時刻", <input type="time" value={modalStart} onChange={e => setModalStart(e.target.value)}/>)}{field("終了時刻", <input type="time" value={modalEnd} onChange={e => setModalEnd(e.target.value)}/>)}</div><div className="modal-actions">{button("キャンセル", () => setModal(""), "secondary")}{button("保存", () => { mutate(d => { d.tasks[modalTask].startedAt = modalStart; d.tasks[modalTask].finishedAt = modalEnd; }); setModal(""); }, "primary", !!modalStart !== !!modalEnd || (!!modalStart && modalStart > modalEnd))}</div></>}{modal === "report-edit" && <><div className="modal-head"><p className="overline">EDIT REPORT</p><h2 id="modal-title">レポートを編集</h2><p>報告に表示する文章を編集できます。変更は「報告」で確定すると保存されます。</p></div>{field("報告内容", <textarea value={reportEdit} maxLength={50000} onChange={e => setReportEdit(e.target.value)}/>)}<div className="modal-actions">{button("キャンセル", () => setModal(""), "secondary")}{button("変更を反映", () => { setPreview(current => current ? { ...current, body: reportEdit } : current); setModal(""); }, "primary", !reportEdit.trim())}</div></>}{modal === "confirm" && <><div className="modal-head"><p className="overline">FINAL CHECK</p><h2 id="modal-title">報告送信の確認</h2><p>送信先と報告内容を確認してください。「確定」でChatworkへの送信を開始します。</p></div>{candidate && <><div className="detail-list"><div><span>送信元</span><strong>{delivery?.sourceDisplayName || "確認中"}</strong></div><div><span>送信先</span><strong>{candidate.trial?.roomName || delivery?.roomName || "確認中"}</strong></div><div><span>形式</span><strong>Markdown・PDF・画像</strong></div><div><span>作業日</span><strong>{selected?.day}</strong></div></div><p>添付画像 {candidate.imageIds?.length || 0}枚</p>{selected && candidate.imageIds?.length > 0 && <div className="report-photos">{candidate.imageIds.map(id => <img key={id} src={`/api/works/${selected.id}/images/${id}`} alt="添付画像"/>)}</div>}<pre className="archived-body candidate-body">{candidate.body}</pre>{candidate.stale ? <div className="warning">作業または職員情報が変更されています。候補を作り直してください。</div> : !candidate.trial ? <div className="notice mini">送信の準備を確認しています。</div> : !candidate.trial.permitValid ? <div className="warning">送信設定または配送状況を確認してください。</div> : !candidate.trial.prepared ? <div className="notice mini">添付と送信内容の確認が必要です。状態を更新してください。</div> : <div className="notice mini">表示された送信先と報告内容を確認してください。</div>}</>}{message&&<p role="status">{message}</p>}<ReportConfirmActions busy={busy} confirmed={!!candidate?.confirmed} canSend={!!candidate?.trial?.permitValid && candidate.trial.prepared && !candidate.stale} onClose={() => setModal("")} onSend={() => { void prepare(); }} onRefresh={() => { void refreshReport(); }} onDiscard={() => { void discardCandidate(); }}/></>}</div></div>}
    </div>;
}
