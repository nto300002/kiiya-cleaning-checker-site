"use client";
import { connectionMessage, showConnectionNotice, statusLabel } from "../lib/display-labels";
import { taskActionLabel } from "../lib/task-action-label";
import HomeTutorial from "./home-tutorial";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { bedmakingExceptionValid, activeTasks, assignUnassignedTasks, bedmakingLabel, extraBedRequired, invalidateChangedTaskTargets, missingForReport, workElapsedMinutes, formatElapsedMinutes, renameStaff, roomCheckKeys, targetRooms as taskTargetRooms, ROOM_CODES, TASKS, todayJst, updateRoomOccupancy, type RoomCode, type RoomType, type TaskId, type WorkData } from "@/lib/domain";
import ChatworkProductionSettings from "@/app/chatwork-production-settings";
import StaffDirectory from "@/app/staff-directory";
import GuestCountPicker from "@/app/guest-count-picker";
import { mergeWork, type MergeChoice, type MergeConflict } from "@/lib/merge-work";
import ReportDeliveryHistory from "@/app/report-delivery-history";
import { ReportConfirmActions } from "@/app/report-confirm-actions";
import { ensureCandidateForReport } from "@/lib/report-candidate-client";

type Me = { id: string; email: string; name: string; active: boolean; role: "normal" | "field" | null; appAdmin: boolean; manageChatwork: boolean };
type DeliveryStatus = { setupRequired: boolean; setupReason: string; sourceDisplayName: string | null; roomName: string | null; deliveryEnabled: boolean; verificationReady?: boolean };
type Detail = { id: string; day: string; ownerId: string; revision: number; status: string; hasChangesSinceReport: boolean; data: WorkData; images: { id: string; file_name: string }[]; reports: { id: string; sequence: number; body: string; status: string }[] };
type Candidate = {id:string;body:string;format:'markdown'|'pdf'|'legacy';imageIds:string[];workRevision:number;stale:boolean;confirmed:boolean;trial?:{jobId:string;permitId:string;roomName:string;status:string;permitValid:boolean;prepared:boolean;expiresAt:number;permitStatus:string}};
type Summary = { id: string; day: string; owner_id: string; status: string; updated_at: string };
type Tab = "welcome" | "today" | "scope" | "checks" | "batchTime" | "report" | "result" | "settings" | "archive" | "archiveDetail" | "master" | "chatwork" | "people";
const typeLabels: Record<RoomType, string> = { checkout: "通常清掃", stay_cleaning: "連泊清掃", stay_amenities_only: "連泊（アメニティのみ）", arrival_amenities_only: "新規宿泊・アメニティのみ" };
const checkLabels: Record<string, string> = {
  adult_slippers: "大人用スリッパ", child_slippers: "子ども用スリッパ", toothbrushes: "歯ブラシ",
  bedmaking: "ベッドメイク", pillows: "枕", roomclean: "部屋掃除", sheets: "シーツ交換",
  trash: "ごみ回収", arrival_placement_confirm: "アメニティの設置場所：要確認（以前の項目）", arrival_placement_room: "アメニティを室内にセット", placement: "設置場所", amenities_message: "アメニティとメッセージカード",
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
  if (!response.ok) throw Object.assign(new Error(value.error || "通信に失敗しました"), { status: response.status });
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
  const [worksLoaded, setWorksLoaded] = useState(false);
  const [selected, setSelected] = useState<Detail | null>(null), [draft, setDraft] = useState<WorkData | null>(null);
  const draftRef = useRef(draft), selectedRef = useRef(selected), uploadingRef = useRef(0);
  const [uploading, setUploading] = useState(0);
  draftRef.current = draft; selectedRef.current = selected;
  const [tab, setTab] = useState<Tab>("today"), [message, setMessageState] = useState(""), [busy, setBusy] = useState(false);
  const [messageError, setMessageError] = useState(false);
  function setMessage(value: string) { setMessageState(value); setMessageError(false); }
  function setErrorMessage(value: string) { setMessageState(value); setMessageError(true); }
  const [dirty, setDirty] = useState(false), [conflict, setConflict] = useState(false), [mergeConflicts, setMergeConflicts] = useState<MergeConflict[]>([]), [mergeChoices, setMergeChoices] = useState<Record<string, MergeChoice>>({}), [preview, setPreview] = useState<{ ready: boolean; missing: string[]; body: string } | null>(null);
  const [focusRoom, setFocusRoom] = useState<RoomCode>("203");
  const [newDefect, setNewDefect] = useState({ item: "adult_slippers", description: "" });
  const [format, setFormat] = useState<"pdf" | "markdown">("markdown"), [staffCount, setStaffCount] = useState(1);
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [newDayStaff, setNewDayStaff] = useState<string[]>([""]);
  const [backHintOpen, setBackHintOpen] = useState(false);
  const [restorePosition, setRestorePosition] = useState<{ id: string; tab: Tab; y: number } | null>(null);
  const [modal, setModal] = useState<"" | "defect" | "time" | "confirm" | "report-edit" | "reset">(""), [modalTask, setModalTask] = useState<TaskId>("bedmaking"), [modalRoom, setModalRoom] = useState<RoomCode>("203"), [modalItem, setModalItem] = useState("adult_slippers"), [modalStart, setModalStart] = useState(""), [modalEnd, setModalEnd] = useState("");
  const [reportEdit, setReportEdit] = useState("");
  const [batchTimes, setBatchTimes] = useState<Partial<Record<TaskId, { start: string; end: string; completed: boolean; assignees: string[]; completedCount: number }>>>({});
  const [batchError, setBatchError] = useState("");
  const [reportEdited, setReportEdited] = useState(false), [tutorialOpen, setTutorialOpen] = useState(false);
  const [candidate,setCandidate]=useState<Candidate|null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null), [returnTab, setReturnTab] = useState<Tab>("today");
  const [masterCurrent, setMasterCurrent] = useState<any>(null), [masterChanges, setMasterChanges] = useState<any[]>([]);
  const [masterRequest, setMasterRequest] = useState({ approverName: "", reason: "", approved: false });
  const [masterTutorialStage, setMasterTutorialStage] = useState<"closed" | "intro" | "steps">("closed");
  const [masterTutorialStep, setMasterTutorialStep] = useState(0);
  const canEdit = !!me?.active && !!selected && selected.ownerId === me.id;
  const [today, setToday] = useState(todayJst());
  const nowTime = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const displayStart = (value: string) => value ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "--:--";
  const drumRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dirtyRef = useRef(dirty);
  const saveInFlightRef = useRef<Promise<Detail | null> | null>(null);
  const editedTaskNotesRef = useRef(new Set<TaskId>());
  const staffNameBeforeEdit = useRef<Record<number, string>>({});
  const autoOpenDayRef = useRef("");
  const historyReturnRef = useRef<{ id: string; tab: Tab; scrollY: number } | null>(null);
  dirtyRef.current = dirty;
  useLayoutEffect(() => {
    if (!restorePosition || selected?.id !== restorePosition.id || tab !== restorePosition.tab) return;
    const frame = window.requestAnimationFrame(() => { window.scrollTo(0, restorePosition.y); setRestorePosition(null); });
    return () => window.cancelAnimationFrame(frame);
  }, [restorePosition, selected?.id, tab]);
  useEffect(() => {
    call<Me>("me").then(setMe).catch(e => setErrorMessage(e.message));
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
        setToday(day);
        setNewDayStaff([""]);
        if (!dirty && !conflict && !busy && !uploadingRef.current && !reportEdited) { setStaffCount(1); selectedRef.current = null; draftRef.current = null; setSelected(null); setDraft(null); setPreview(null); setCandidate(null); setTab("today"); }
        setMessage(dirty || conflict || busy || uploadingRef.current || reportEdited ? "日付が変わりました。入力中の記録を保存または確認してから今日の作業へ進んでください。" : "日付が変わりました。新しい当日の記録を作成できます。前日の記録はアーカイブから開けます。");
        call<Summary[]>("works").then(value => { setItems(value); setWorksLoaded(true); }).catch(e => setErrorMessage(e.message));
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [today, dirty, conflict, busy, reportEdited]);
  useEffect(() => {
    if (!me) return;
    try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith('kiiya-report-request-')){try{const v=JSON.parse(sessionStorage.getItem(key)||'');if(v.actorId!==me.id||!Number.isFinite(v.createdAt)||Date.now()-v.createdAt>86400000)sessionStorage.removeItem(key)}catch{sessionStorage.removeItem(key)}}}}catch{}
    if (!me.active) return;
    call<Summary[]>("works").then(value => { setItems(value); setWorksLoaded(true); }).catch(e => setErrorMessage(e.message));
    call<DeliveryStatus>("report-delivery-settings").then(setDelivery).catch(() => setDelivery(null));
  }, [me?.active,me?.id]);
  useEffect(() => {
    if (!worksLoaded || !me?.active || tab !== "today" || selected) return;
    const key = `${me.id}:${today}`;
    if (autoOpenDayRef.current === key) return;
    autoOpenDayRef.current = key;
    const existing = items.find(item => item.owner_id === me.id && item.day === today);
    if (existing) void open(existing.id);
  }, [worksLoaded, me, tab, today, items, selected]);
  useEffect(() => {
    if (tab !== "master" || !me?.active) return;
    call("master").then(setMasterCurrent).catch(e => setErrorMessage(e.message));
    call<any[]>("master/changes").then(setMasterChanges).catch(e => setErrorMessage(e.message));
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
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function mutate(fn: (data: WorkData) => void) {
    const current = draftRef.current;
    if (!canEdit || !current || conflict) return;
    const next = clone(current); fn(next); invalidateChangedTaskTargets(current, next); draftRef.current = next; dirtyRef.current = true; setDraft(next); setDirty(true); setPreview(null);
  }
  function mutateTask(fn: (data: WorkData) => void) {
    if (!canEdit || !draft || conflict) return;
    mutate(fn);
    window.setTimeout(() => { void save(); }, 0);
  }
  async function open(id: string, destination?: Tab) {
    if (uploadingRef.current) { setMessage('画像の追加が完了するまでお待ちください'); return; }
    setMessage(""); setConflict(false); setMergeConflicts([]); setMergeChoices({}); setPreview(null); setCandidate(null);
    try {
      const value = await call<Detail>("works/" + id);
      selectedRef.current = value; draftRef.current = clone(value.data); dirtyRef.current = false;
      setSelected(value); setDraft(draftRef.current); setDirty(false);
      const saved = localStorage.getItem("kiiya-draft-" + id);
      let localPending = false;
      if (saved && value.ownerId === me?.id) {
        const local = JSON.parse(saved);
        if (JSON.stringify(local.data) === JSON.stringify(value.data)) localStorage.removeItem("kiiya-draft-" + id);
        else if (local.revision === value.revision) { draftRef.current = local.data; dirtyRef.current = true; setDraft(local.data); setDirty(true); localPending = true; }
        else {
          let baseData = local.baseData as WorkData | undefined;
          if (!baseData) {
            try { baseData = (await call<{ data: WorkData }>(`works/${id}/revisions/${local.revision}`)).data; }
            catch { setMessage("この端末の変更前の版を取得できません。入力内容を控えてから最新の記録を確認してください。"); }
          }
          if (baseData) localStorage.setItem("kiiya-draft-" + id, JSON.stringify({ ...local, baseData }));
          const merged = baseData ? mergeWork(baseData, value.data, local.data) : null;
          if (merged && !merged.conflicts.length) {
            draftRef.current = merged.data; dirtyRef.current = true; setDraft(merged.data); setDirty(true);
            localStorage.setItem("kiiya-draft-" + id, JSON.stringify({ revision: value.revision, baseData: value.data, data: merged.data }));
          } else {
            draftRef.current = local.data; dirtyRef.current = true; setDraft(local.data); setDirty(true); setConflict(true);
            setMergeConflicts(merged?.conflicts || []); setMergeChoices({});
          }
          localPending = true;
        }
      }
      setFocusRoom(value.data.roomCodes[0] || "203"); setStaffCount(Math.max(1, value.data.staffNames.length));
      if (value.ownerId !== me?.id || value.day !== today) setArchiveId(value.id);
      setTab(value.ownerId !== me?.id ? "archiveDetail" : value.day !== today ? "archiveDetail" : destination || (!value.data.startedAt ? "today" : localPending || !value.reports.length || value.hasChangesSinceReport ? "checks" : "result"));
    } catch (e: any) { setMessage(e.message); }
  }
  async function create() {
    setBusy(true);
    try {
      let value = await call<Detail>("works", jsonBody({ day: today }));
      const names = newDayStaff.map(name => name.trim()).filter(Boolean);
      if (!value.data.startedAt && !value.data.staffNames.some(Boolean) && names.length) {
        value = await call<Detail>("works/" + value.id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: value.revision, data: { ...value.data, staffNames: names } }) });
      }
      const started = value.data.startedAt ? value : await call<Detail>("works/" + value.id + "/start", jsonBody({ revision: value.revision }));
      setItems(await call<Summary[]>("works")); await open(started.id, "scope");
    } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  }
  async function save(): Promise<Detail | null> {
    if (uploadingRef.current) return null;
    if (saveInFlightRef.current) return saveInFlightRef.current;
    const current = selectedRef.current;
    if (!current || !draftRef.current || !canEdit || conflict) return null;
    if (!dirtyRef.current) return current;
    const operation = (async (): Promise<Detail | null> => {
      setBusy(true);
      try {
        while (dirtyRef.current) {
          const base = selectedRef.current, snapshot = draftRef.current;
          if (!base || !snapshot) return null;
          localStorage.setItem("kiiya-draft-" + base.id, JSON.stringify({ revision: base.revision, baseData: base.data, data: snapshot }));
          let value: Detail;
          try {
            value = await call<Detail>("works/" + base.id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: base.revision, data: snapshot }) });
          } catch (error: any) {
            if (error.status !== 409) throw error;
            const latest = await call<Detail>("works/" + base.id);
            const merged = mergeWork(base.data, latest.data, draftRef.current || snapshot);
            if (merged.conflicts.length) {
              setMergeConflicts(merged.conflicts); setMergeChoices({}); setConflict(true);
              setMessage("同じ項目が別の画面でも変更されました。残す内容を選んでください。");
              return null;
            }
            selectedRef.current = latest; setSelected(latest);
            draftRef.current = merged.data; setDraft(merged.data);
            localStorage.setItem("kiiya-draft-" + base.id, JSON.stringify({ revision: latest.revision, baseData: latest.data, data: merged.data }));
            continue;
          }
          selectedRef.current = value; setSelected(value);
          if (draftRef.current === snapshot) {
            draftRef.current = clone(value.data); dirtyRef.current = false;
            setDraft(draftRef.current); setDirty(false);
            localStorage.removeItem("kiiya-draft-" + base.id);
          } else {
            localStorage.setItem("kiiya-draft-" + base.id, JSON.stringify({ revision: value.revision, baseData: value.data, data: draftRef.current }));
          }
        }
        call<Summary[]>("works").then(setItems).catch(() => {});
        setMessage("");
        return selectedRef.current;
      } catch (e: any) { setMessage("自動保存に失敗しました。通信を確認して再試行してください。"); return null; }
      finally { setBusy(false); }
    })();
    saveInFlightRef.current = operation;
    try { return await operation; } finally { saveInFlightRef.current = null; }
  }
  async function start() {
    const value = dirty ? await save() : selected; if (!value) return;
    try {
      const started = await call<Detail>("works/" + value.id + "/start", jsonBody({ revision: value.revision }));
      setSelected(started); setDraft(clone(started.data)); setTab("scope"); setMessage("");
    } catch (e: any) { setMessage(e.message); }
  }
  async function loadPreview() {
    const value = dirty ? await save() : selected; if (!value) return;
    try { setPreview(await call("works/" + value.id + "/preview")); setReportEdited(false); setTab("report"); } catch (e: any) { setMessage(e.message); }
  }
  async function refreshCandidate(workId:string):Promise<Candidate|null> {
    const value=await call<{candidate:Candidate|null}>(`works/${workId}/report-candidate`);
    let next=value.candidate;
    if(next && next.format!==format){setCandidate(next);return next;}
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
      await ensureCandidateForReport({workId:selected.id,actorId:me.id,revision:selected.revision,body:preview.body,format,storage,id:()=>crypto.randomUUID(),api:(path,body)=>call(path,body===undefined?undefined:jsonBody(body))});
      const initial=(await call<{candidate:Candidate|null}>(`works/${selected.id}/report-candidate`)).candidate;
      if(!initial || initial.body!==preview.body || initial.format!==format || initial.stale)throw new Error('報告の内容が更新されました。もう一度確認してください');
      setMessage('');setCandidate(initial);setModal('confirm');
      const next=await refreshCandidate(selected.id);
      if(!next)throw new Error('報告候補を確認できません。再度確認してください');
      if(next.confirmed){
        clearReportRequest(selected.id);await open(selected.id);setTab('result');setMessage('受付済みの報告の送信状態を確認してください');return;
      }
      if(next.body!==preview.body || next.format!==format || next.stale){setCandidate(null);setModal('');throw new Error('報告の内容が更新されました。もう一度確認してください');}
    }catch(e:any){setErrorMessage(e.message)}finally{setBusy(false)}
  }
  async function refreshReport(){
    if(!selected)return;setBusy(true);
    try{const next=await refreshCandidate(selected.id);if(next?.confirmed){clearReportRequest(selected.id);setModal('');await open(selected.id);setTab('result');setMessage('受付済みの報告の送信状態を確認してください');}}
    catch(e:any){setErrorMessage(e.message)}finally{setBusy(false)}
  }
  async function prepare() {
    if (!selected || !candidate?.trial?.permitValid || !candidate.trial.prepared || candidate.stale || dirty) return;
    setBusy(true);
    try {
      await call('chatwork/production/trial/register',jsonBody({jobId:candidate.trial.jobId,permitId:candidate.trial.permitId,candidateId:candidate.id}));
      clearReportRequest(selected.id);setModal('');await open(selected.id);setTab('result');setMessage('報告を受け付けました。送信状態を確認してください');
    } catch (e: any) { setErrorMessage(e.message+'。状態を更新して受付結果を確認してください'); }
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
    } catch (e: any) { setErrorMessage(e.message); }
    finally { uploadingRef.current--; setUploading(uploadingRef.current); }
  }
  async function requestMasterChange() {
    try {
      const result = await call<{ id: string }>("master/changes", jsonBody(masterRequest));
      setMasterChanges(await call("master/changes")); setMasterRequest({ approverName: "", reason: "", approved: false });
      setMessage("変更申請 " + result.id + " を記録しました。Chatwork通知は未接続です");
    } catch (e: any) { setErrorMessage(e.message); }
  }
  async function discardLocal() {
    if (!selected) return;
    try {
      const latest = await call<Detail>("works/" + selected.id);
      localStorage.removeItem("kiiya-draft-" + selected.id); selectedRef.current = latest; setSelected(latest); draftRef.current = clone(latest.data); dirtyRef.current = false; setDraft(draftRef.current); setDirty(false); setConflict(false); setMergeConflicts([]); setMessage("最新の内容を反映しました");
    } catch (e: any) { setMessage(e.message || "最新の記録を読み込めませんでした"); }
  }
  async function resolveConflict() {
    if (!selected || !draft || mergeConflicts.some(item => !mergeChoices[item.path])) return;
    try {
      const latest = await call<Detail>("works/" + selected.id);
      const saved = JSON.parse(localStorage.getItem("kiiya-draft-" + selected.id) || "null");
      if (!saved?.baseData) { setMessage("この端末の変更前の記録がありません。入力内容を控えてから最新の記録を読み込んでください。"); return; }
      const merged = mergeWork(saved.baseData, latest.data, draft, mergeChoices);
      if (merged.conflicts.length) { setMergeConflicts(merged.conflicts); setMessage("新しい変更があります。もう一度残す内容を選んでください。"); return; }
      selectedRef.current = latest; setSelected(latest); draftRef.current = merged.data; setDraft(merged.data);
      setMergeConflicts([]); setMergeChoices({}); setConflict(false);
      const changed = JSON.stringify(merged.data) !== JSON.stringify(latest.data);
      dirtyRef.current = changed; setDirty(changed);
      if (changed) localStorage.setItem("kiiya-draft-" + latest.id, JSON.stringify({ revision: latest.revision, baseData: latest.data, data: merged.data }));
      else localStorage.removeItem("kiiya-draft-" + latest.id);
      setMessage(changed ? "選んだ内容を保存しています" : "最新の内容を反映しました");
    } catch (e: any) { setMessage(e.message || "競合を確認できませんでした"); }
  }
  async function resetToday() {
    if (!selected || !canEdit || selected.day !== today || busy || uploadingRef.current) return;
    setBusy(true); setMessage("");
    try {
      const result = await call<Detail>(`works/${selected.id}/reset`, jsonBody({revision:selected.revision}));
      localStorage.removeItem("kiiya-draft-" + selected.id); clearReportRequest(selected.id);
      selectedRef.current = result; draftRef.current = clone(result.data);
      setSelected(result); setDraft(clone(result.data)); setDirty(false); setConflict(false);
      setPreview(null); setCandidate(null); setReportEdited(false); setReportEdit(""); setStaffCount(1); setFocusRoom("203");
      setModal(""); setTab("today"); setMessage("本日の入力をリセットしました"); window.scrollTo(0, 0);
    } catch (e: any) { setModal(""); setErrorMessage(e.message); }
    finally { setBusy(false); }
  }
  const field = (label: string, node: React.ReactNode, hint?: string) => <label className="field"><span className="field-label">{label}</span>{node}{hint && <small>{hint}</small>}</label>;
  const button = (label: string, onClick: () => void, kind = "primary", disabled = false) => <button type="button" className={`button ${kind}`} disabled={disabled} onClick={onClick}>{label}</button>;
  const badge = (label: string, tone = "") => <span className={`badge ${tone}`}>{label}</span>;
  const masterTutorialBubble = (target: string) => masterTutorialStage === "steps" && masterTutorialSteps[masterTutorialStep]?.target === target ? <div className="master-tutorial-bubble" role="dialog" aria-label={`${masterTutorialStep + 1}番目の操作説明`}><small>{masterTutorialStep + 1} / {masterTutorialSteps.length}</small><strong>{masterTutorialSteps[masterTutorialStep].title}</strong><p>{masterTutorialSteps[masterTutorialStep].description}</p><div className="master-tutorial-actions"><button type="button" onClick={() => setMasterTutorialStage("closed")}>終了</button>{masterTutorialStep > 0 && <button type="button" onClick={() => setMasterTutorialStep(masterTutorialStep - 1)}>戻る</button>}<button type="button" className="next" onClick={() => masterTutorialStep + 1 < masterTutorialSteps.length ? setMasterTutorialStep(masterTutorialStep + 1) : setMasterTutorialStage("closed")}>{masterTutorialStep + 1 < masterTutorialSteps.length ? "次へ" : "完了"}</button></div></div> : null;
  const taskIds = draft ? activeTasks(draft) : [];
  const active = TASKS.filter(t => taskIds.includes(t.id));
  const missingRoom = (code: RoomCode) => !draft?.roomAnswers[code] || draft.roomAnswers[code]?.type !== draft.rooms[code].type || roomCheckKeys(draft.rooms[code]).some(key => !draft.roomAnswers[code]?.checks[key] && !(key === "bedmaking" && bedmakingExceptionValid(draft,code))) || !!draft.bedmakingExceptions?.[code] && !bedmakingExceptionValid(draft,code) || !draft.roomAnswers[code]?.finalConfirmed || draft.defects.some(d => d.roomCode === code && d.status === "open");
  const doneCount = draft ? draft.roomCodes.filter(c => !missingRoom(c)).length + active.filter(t => draft.tasks[t.id].completed).length : 0;
  const totalCount = draft ? draft.roomCodes.length + active.length : 0;
  const readOnly = !canEdit || conflict || busy;
  async function next(target: Tab) { if (uploadingRef.current) { setMessage('画像の追加が完了するまでお待ちください'); return; } if (dirty) { const value = await save(); if (!value) return; } setTab(target); window.scrollTo(0, 0); }
  async function goHome() {
    if (busy || uploadingRef.current) { setMessage("処理が完了するまでお待ちください"); return; }
    if (reportEdited && !window.confirm("編集した報告文は保存されていません。ホームへ戻ると再表示時に失われる場合があります。戻りますか？")) return;
    if (conflict) { setErrorMessage("端末の未保存入力とサーバーの内容が競合しています。確認してからホームへ戻ってください。"); return; }
    if (dirty && !(await save())) return;
    const currentDay = todayJst(); setToday(currentDay);
    if (selectedRef.current && selectedRef.current.day !== currentDay) { setSelected(null); setDraft(null); setPreview(null); setCandidate(null); setConflict(false); setStaffCount(1); setNewDayStaff([""]); }
    setReportEdited(false); setModal(""); setTab(selectedRef.current?.day === currentDay && selectedRef.current.data.startedAt ? "checks" : "today"); window.scrollTo(0, 0);
    setDelivery(null); if (me?.active) call<DeliveryStatus>("report-delivery-settings").then(setDelivery).catch(() => setDelivery(null));
  }
  async function goToday() {
    if (busy || uploadingRef.current) { setMessage("処理が完了するまでお待ちください"); return; }
    const day = todayJst(); setToday(day);
    if (selectedRef.current && selectedRef.current.day !== day) {
      if (dirty && !(await save())) return;
      if (conflict) { setErrorMessage("未保存の入力を確認してから今日の作業へ進んでください"); return; }
      setSelected(null); setDraft(null); setPreview(null); setCandidate(null); setConflict(false); setStaffCount(1); setNewDayStaff([""]);
    }
    setTab("today"); window.scrollTo(0, 0);
  }
  async function showSettings() { if (dirtyRef.current && !(await save())) return; setReturnTab(tab); setTab("settings"); window.scrollTo(0, 0); }
  async function openMenuTab(destination: Tab) { if (dirtyRef.current && !(await save())) return; setReturnTab(tab); setTab(destination); window.scrollTo(0, 0); }
  async function showHistory() {
    if (dirty && !await save()) return;
    historyReturnRef.current = selected ? { id: selected.id, tab, scrollY: window.scrollY } : null;
    setTab("archive"); window.scrollTo(0, 0);
  }
  async function returnFromHistory() {
    const previous = historyReturnRef.current;
    if (previous) { await open(previous.id); setTab(previous.tab); setRestorePosition({ id: previous.id, tab: previous.tab, y: previous.scrollY }); }
    else setTab("today");
  }
  async function showMaster() { if (dirtyRef.current && !(await save())) return; setReturnTab(tab); setTab("master"); window.scrollTo(0, 0); }
  function taskAssignee(id: TaskId, name: string) { mutateTask(d => { const current = d.tasks[id].assignees; d.tasks[id].assignees = current.includes(name) ? current.filter(x => x !== name) : [...current, name]; d.tasks[id].assigneeCustomized = true; }); }
  function assignAll(name: string) { if (name) mutateTask(d => { assignUnassignedTasks(d, name); }); }
  async function jumpToMissing(label: string) {
    const code = ROOM_CODES.find(item => label.startsWith(item + "号室"));
    if (code) setFocusRoom(code);
    const task = TASKS.find(item => label === item.label || label === "シャワー実施数" && item.id === "showers");
    if (label === "参加スタッフ") { await next("scope"); }
    window.requestAnimationFrame(() => {
      const target = code ? document.querySelector(".room-switch") : task ? document.querySelector(`[data-task-id="${task.id}"]`) : label === "参加スタッフ" ? document.querySelector(".inline-setup") : document.querySelector(".shared-fields");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  function beginTask(id: TaskId) { mutateTask(d => { d.tasks[id].startedAt = nowTime(); d.tasks[id].finishedAt = ""; d.tasks[id].timeUnrecorded = false; d.tasks[id].completed = false; }); }
  function finishTask(id: TaskId) { mutateTask(d => { if (!d.tasks[id].startedAt && !d.tasks[id].timeNote) d.tasks[id].startedAt = nowTime(); d.tasks[id].finishedAt = d.tasks[id].startedAt ? nowTime() : ""; if (d.tasks[id].startedAt) d.tasks[id].timeUnrecorded = false; d.tasks[id].completed = true; }); }
  function openTime(id: TaskId) { if (!draft) return; setModalTask(id); setModalStart(draft.tasks[id].startedAt); setModalEnd(draft.tasks[id].finishedAt); setModal("time"); }
  function openDefect(code: RoomCode) { if (!draft) return; const item = roomCheckKeys(draft.rooms[code]).find(key => !draft.defects.some(d => d.roomCode === code && d.itemCode === key && d.status === "open")); if (!item) return; setModalRoom(code); setModalItem(item); setNewDefect({ item, description: "" }); setModal("defect"); }
  function setRoomAnswer(code: RoomCode, key: string, checked: boolean) { mutate(d => { const answer = d.roomAnswers[code] || { type: d.rooms[code].type, checks: {}, finalConfirmed: false }; answer.type = d.rooms[code].type; answer.checks[key] = checked; d.roomAnswers[code] = answer; }); }
  const roomMeta = masterCurrent?.data?.rooms || { "203": { capacity: 2, beds: "ダブル1台" }, "204": { capacity: 5, beds: "シングル4台＋エキストラ1台" }, "205": { capacity: 4, beds: "ダブル2台" }, "206": { capacity: 3, beds: "シングル2台＋エキストラ1台" } };
  function drum(key: "toiletTarget" | "showerTarget", label: string, max: number) {
    const value = draft?.[key] || 0;
    const choose = (n: number) => { if (readOnly || !draft) return; mutate(d => { d[key] = Math.max(0, Math.min(max, n)); }); drumRefs.current[key]?.scrollTo({ top: n * 36, behavior: "smooth" }); };
    return <div className="scope-count-card"><div className="scope-count-heading"><strong>{label}</strong><small>最大 {max} 箇所</small></div><div className="drum-picker" role="group" aria-label={`${label}の清掃箇所数`}><button className="drum-arrow" aria-label="1箇所減らす" disabled={readOnly || value <= 0} onClick={() => choose(value - 1)}>▲</button><div className="drum-window" ref={el => { drumRefs.current[key] = el; }} role="spinbutton" tabIndex={0} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value} 箇所`} aria-label={`${label}の清掃箇所数。上下にスクロールして変更`} onScroll={e => { if (readOnly || !draft) return; const n = Math.max(0, Math.min(max, Math.round(e.currentTarget.scrollTop / 36))); if (n !== value) mutate(d => { d[key] = n; }); }} onKeyDown={e => { if (e.key === "ArrowUp") choose(value - 1); if (e.key === "ArrowDown") choose(value + 1); }}>{Array.from({ length: max + 1 }, (_, n) => <div key={n} className={`drum-option ${n === value ? "selected" : ""}`} aria-selected={n === value} onClick={() => choose(n)}>{n} 箇所</div>)}</div><button className="drum-arrow" aria-label="1箇所増やす" disabled={readOnly || value >= max} onClick={() => choose(value + 1)}>▼</button><small className="drum-hint">上下にスワイプして箇所数を変更</small></div></div>;
  }
  useLayoutEffect(() => { if (tab !== "scope" || !draft) return; for (const key of ["toiletTarget", "showerTarget"] as const) drumRefs.current[key]?.scrollTo({ top: draft[key] * 36 }); }, [tab, selected?.id]);
  const screen: Record<Tab, { title: string; eyebrow: string; step: number }> = {
    welcome: { title: "清掃を、見落とさない。", eyebrow: "WELCOME", step: 0 },
    today: { title: "今日の作業", eyebrow: "TODAY / START", step: 1 },
    scope: { title: "清掃範囲の決定", eyebrow: "02 / TODAY'S AREAS", step: 2 },
    checks: { title: "清掃チェック", eyebrow: "TODAY / CHECKLIST", step: 3 },
    batchTime: { title: "作業時間をまとめて確認", eyebrow: "TODAY / TIME REVIEW", step: 3 },
    report: { title: "報告内容を確認", eyebrow: "REPORT / PREVIEW", step: 4 },
    result: { title: "報告結果の状態", eyebrow: "REPORT / STATUS", step: 4 },
    settings: { title: "設定", eyebrow: "SETTINGS", step: 0 },
    chatwork: { title: "Chatwork連携", eyebrow: "CHATWORK", step: 0 },
    people: { title: "職員台帳", eyebrow: "STAFF", step: 0 },
    archive: { title: "アーカイブ", eyebrow: "HISTORY", step: 0 },
    archiveDetail: { title: "過去の記録", eyebrow: "ARCHIVE DETAIL", step: 0 },
    master: { title: "マニュアル変更申請", eyebrow: "MANUAL CHANGE REQUEST", step: 0 },
  };
  const selectedArchive = items.find(x => x.id === archiveId);
  function openBatchTime() {
    if (!draft) return;
    const entries: Partial<Record<TaskId, { start: string; end: string; completed: boolean; assignees: string[]; completedCount: number }>> = {};
    for (const task of active) { const p = draft.tasks[task.id]; entries[task.id] = { start: p.startedAt, end: p.finishedAt, completed: p.completed, assignees: [...p.assignees], completedCount: p.completedCount }; }
    setBatchTimes(entries); setBatchError(""); setTab("batchTime"); window.scrollTo(0, 0);
  }
  async function confirmBatchTime() {
    if (!draft || !canEdit || busy) return;
    for (const task of active) {
      const entry = batchTimes[task.id];
      if (!entry) continue;
      if ((!!entry.start !== !!entry.end) || (!!entry.start && entry.start > entry.end)) {
        setBatchError(`${task.label}の開始時刻と終了時刻を確認してください。`); return;
      }
      const p = draft.tasks[task.id];
      if (entry.completed && !p.completed && (!entry.assignees.length || (!(entry.start && entry.end) && !p.timeNote) || (task.id === "showers" && (entry.completedCount < 1 || entry.completedCount > draft.showerTarget)))) {
        setBatchError(`${task.label}の完了には担当者と時刻（またはメモ）が必要です。シャワーは清掃済みの数も確認してください。`); return;
      }
    }
    mutate(d => { for (const task of active) { const entry = batchTimes[task.id]; if (!entry) continue; const p = d.tasks[task.id]; if (p.startedAt !== entry.start || p.finishedAt !== entry.end) { p.startedAt = entry.start; p.finishedAt = entry.end; p.timeUnrecorded = false; } if (JSON.stringify(p.assignees) !== JSON.stringify(entry.assignees)) { p.assignees = [...entry.assignees]; p.assigneeCustomized = true; } p.completed = entry.completed; if (task.id === "showers") p.completedCount = entry.completedCount; } });
    if (!(await save())) return;
    setBatchError(""); setTab("checks"); window.scrollTo(0, 0);
  }
  const steps = ["作業開始", "清掃範囲", "清掃チェック", "報告内容"];
  let footer: React.ReactNode = null;
  if (me?.active) {
    if (tab === "today") footer = button(selected?.data.startedAt ? "清掃範囲へ進む →" : "作業を開始する →", () => { if (selected?.data.startedAt) void next("scope"); else if (selected) start(); else create(); }, "primary", busy || (!!selected && !canEdit));
    if (tab === "scope") footer = <>{button("戻る", () => { void next("today"); }, "secondary", busy)}{button("清掃範囲を決定", () => { void next("checks"); }, "primary", busy || !canEdit)}</>;
    if (tab === "checks") {
      const unfilled = draft ? missingForReport(draft).length : 0;
      footer = <div className="report-action"><div className="footer-shortcuts"><div className="back-control">{button("戻る", () => { setBackHintOpen(false); void next("scope"); }, "secondary")}<button type="button" className="back-hint-toggle" aria-label="戻る先を表示" aria-expanded={backHintOpen} onClick={() => setBackHintOpen(value => !value)}>▼</button>{backHintOpen && <div className="back-hint"><strong>戻る先</strong><button type="button" onClick={() => { setBackHintOpen(false); void next("scope"); }}>清掃範囲の決定</button><button type="button" onClick={() => { setBackHintOpen(false); void next("today"); }}>今日の作業</button><small>移動時に入力内容を保存します</small></div>}</div>{button("まとめて内容修正", openBatchTime, "secondary", busy || !canEdit)}</div>{button("報告内容へ →", loadPreview, "primary", busy || !draft || unfilled > 0)}</div>;
    }
    if (tab === "batchTime") footer = <>{button("戻る", () => { setBatchError(""); setTab("checks"); }, "secondary", busy)}{button("この内容で確定", () => { void confirmBatchTime(); }, "primary", busy || !canEdit)}</>;
    if (tab === "report") footer = <>{button("チェックに戻る", () => setTab("checks"), "secondary")}{button("報告へ →", () => { void beginReport(); }, "primary", !preview?.ready || !canEdit || dirty || busy)}</>;
    if (tab === "result") footer = <>{button("設定・履歴を見る", showSettings, "secondary")}{button("修正する →", () => setTab("checks"))}</>;
    if (tab === "settings") footer = button("作業画面に戻る", () => setTab(returnTab));
    if (tab === "chatwork" || tab === "people") footer = button("前の画面へ戻る", () => setTab(returnTab));
    if (tab === "archive") footer = button("作業へ戻る", () => { void returnFromHistory(); });
    if (tab === "archiveDetail") footer = button("一覧へ戻る", () => setTab("archive"));
    if (tab === "master") footer = button("前の画面へ戻る", () => setTab(returnTab));
  }
  return <div className="shell"><div className="shell-top"><button type="button" className="brand brand-home" aria-label="ホームへ戻る" onClick={() => { void goHome(); }}><span className="brand-mark">K</span><span>KIIYA <small>見落としチェッカー</small></span></button><div className="header-actions">{me && <span className="header-user-name" aria-label={`ログイン中: ${me.name}`} title={me.name}>{me.name}</span>}{me && <a className="sign-out-link" href={signOutPath} target="_top" onClick={() => clearReportRequest()}>ログアウト</a>}{me?.active && <details className="header-menu"><summary aria-label="メニューを開く"><span aria-hidden="true">☰</span><span className="header-menu-label">メニュー</span></summary><nav aria-label="メインメニュー"><button type="button" onClick={e => { e.currentTarget.closest("details")?.removeAttribute("open"); void showHistory(); }}>履歴 <small>前日の作業と報告版</small></button>{me.role === "field" && <button type="button" onClick={e => { e.currentTarget.closest("details")?.removeAttribute("open"); showMaster(); }}>マニュアル変更申請 <small>承認申告と通知状態</small></button>}<button type="button" onClick={e => { e.currentTarget.closest("details")?.removeAttribute("open"); openMenuTab("chatwork"); }}>Chatwork連携 <small>送信元と報告ルームの設定</small></button><button type="button" onClick={e => { e.currentTarget.closest("details")?.removeAttribute("open"); openMenuTab("people"); }}>職員台帳 <small>氏名と権限を確認・変更</small></button><button type="button" onClick={e => { e.currentTarget.closest("details")?.removeAttribute("open"); setTutorialOpen(true); }}>アプリの使い方 <small>操作手順を見る</small></button></nav></details>}</div></div>
    <div className="workspace">{me?.active && <aside className="desktop-rail"><div className="rail-heading">CLEANING WORKFLOW</div><div className="rail-title">清掃の確認を、<br/>ひとつずつ。</div><p>清掃範囲の選択から報告内容の確認まで。作業記録はSitesのD1、画像はR2に保存します。</p><div className="rail-line"/><div className="rail-step">01 <span>作業開始</span></div><div className="rail-step">02 <span>清掃範囲</span></div><div className="rail-step">03 <span>清掃チェック</span></div><div className="rail-step">04 <span>報告内容</span></div></aside>}
      <main className="phone"><div className="phone-inner">{me?.active && <div className="context"><span>{screen[tab].eyebrow}</span><span>{selected?.day || today} · 予定 9:55</span></div>}{me?.active && screen[tab].step > 0 && <><div className="workflow-progress-label">進捗 {screen[tab].step} / 4 · {screen[tab].title}</div><div className="stepper" aria-label="進行状況">{steps.map((s,i) => <div className={`step ${i + 1 <= screen[tab].step ? "active" : ""}`} key={s}><span>{i+1}</span><small>{s}</small></div>)}</div></>}{me?.active && screen[tab].step > 0 && <div className="reset-input-row"><button type="button" className="reset-input-button" disabled={!canEdit || selected?.day !== today || busy || uploading > 0} onClick={() => setModal("reset")}><RefreshCcw size={16} aria-hidden="true" strokeWidth={2.25}/><span>入力をリセット</span></button></div>}{me?.active && tab !== "chatwork" && <div className={`page-heading ${tab === "master" ? "master-page-heading" : ""}`}><h1>{screen[tab].title}</h1>{tab === "master" && <button type="button" className="master-tutorial-launch" onClick={() => { setMasterTutorialStep(0); setMasterTutorialStage("intro"); }}>チュートリアル</button>}</div>}
        {message && <div className={`toast ${messageError ? "toast-error" : ""}`} role={messageError ? "alert" : "status"}>{message}</div>}
        {!me && <div className="select-card">サインインを確認しています…</div>}
        {me && !me.active && <div className="select-card"><h2>利用登録が必要です</h2><p>本人確認後、下の登録用IDを開発者に伝えてください。登録が完了するまでは作業内容を閲覧できません。</p><div className="registration-id"><span>登録用ID</span><code>{me.id}</code>{button("IDをコピー", async () => { try { await navigator.clipboard.writeText(me.id); setMessage("登録用IDをコピーしました"); } catch { setMessage("コピーできませんでした。IDを選択してコピーしてください"); } }, "outline compact")}</div></div>}
        {me?.active && <>
{tab === "today" && <><div className="date-card"><div><small>作業日</small><strong>{selected?.day || today}</strong></div><div><small>開始予定 / 実開始</small><strong>9:55 / {displayStart(draft?.startedAt || "")}</strong></div></div><section className="section"><h2>作業する人</h2><p className="section-copy">参加するスタッフと職員を入力します。作業開始時刻は全体で1回記録し、各清掃作業は同時進行できます。</p>{selected && draft ? <>{field("スタッフ人数", <select disabled={readOnly} value={staffCount} onChange={e => { const n = Number(e.target.value); setStaffCount(n); mutate(d => { d.staffNames = Array.from({ length: n }, (_, i) => d.staffNames[i] || ""); }); }}>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}人</option>)}</select>)}<div className="stack">{Array.from({ length: staffCount }, (_, i) => field(`スタッフ ${i+1}`, <input key={i} value={draft.staffNames[i] || ""} placeholder="氏名を入力" disabled={readOnly} onFocus={e => { staffNameBeforeEdit.current[i] = e.currentTarget.value; }} onChange={e => { const value = e.target.value; mutate(d => { d.staffNames[i] = value; }); }} onBlur={e => { const before = staffNameBeforeEdit.current[i]; const value = e.currentTarget.value; delete staffNameBeforeEdit.current[i]; if (before !== undefined && before !== value) mutate(d => { renameStaff(d, i, value, before); }); }}/>))}</div>{field("本日の担当職員", <input value={draft.leadName} readOnly title="担当職員は作成者に固定"/>)}<p className="tiny">担当職員は作成者に固定されます。</p>{items.filter(x => x.day === today && x.id !== selected.id).map(item => <button key={item.id} className="archive-row" onClick={() => open(item.id)}><span><small>{item.day}</small><strong>他職員の作業</strong><em>{statusLabel(item.status)}</em></span><span>→</span></button>)}</> : <>{field("スタッフ人数", <select value={staffCount} onChange={e => { const n = Number(e.target.value); setStaffCount(n); setNewDayStaff(names => Array.from({length:n}, (_,i) => names[i] || "")); }}>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}人</option>)}</select>)}<div className="stack">{Array.from({length:staffCount}, (_,i) => <div key={i}>{field(`スタッフ ${i+1}`, <input value={newDayStaff[i] || ""} placeholder="氏名を入力" onChange={e => { const value = e.target.value; setNewDayStaff(names => { const next = [...names]; next[i] = value; return next; }); }}/>)}</div>)}</div>{field("本日の担当職員", <input value={me.name} readOnly title="担当職員は作成者に固定"/>)}<p className="tiny">担当職員は作成者に固定されます。</p>{items.filter(x => x.day === today && x.owner_id !== me.id).map(item => <button key={item.id} className="archive-row" onClick={() => open(item.id)}><span><small>{item.day}</small><strong>他職員の作業</strong><em>{statusLabel(item.status)}</em></span><span>→</span></button>)}</>}</section><div className="secondary-links chatwork-settings-link">{button("設定・記録アーカイブ・Chatwork連携", showSettings, "text")}{showConnectionNotice(delivery) && <span className="chatwork-link-callout" role="status">{connectionMessage(delivery)}</span>}</div></>}
        {tab === "scope" && draft && <div className="section inline-setup"><section className="section"><h2>作業する人</h2>{field("スタッフ人数", <select disabled={readOnly} value={staffCount} onChange={e => { const n = Number(e.target.value); setStaffCount(n); mutate(d => { d.staffNames = Array.from({ length: n }, (_, i) => d.staffNames[i] || ""); }); }}>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}人</option>)}</select>)}<div className="stack">{Array.from({ length: staffCount }, (_, i) => field(`スタッフ ${i+1}`, <input key={i} value={draft.staffNames[i] || ""} placeholder="氏名を入力" disabled={readOnly} onFocus={e => { staffNameBeforeEdit.current[i] = e.currentTarget.value; }} onChange={e => { const value = e.target.value; mutate(d => { d.staffNames[i] = value; }); }} onBlur={e => { const before = staffNameBeforeEdit.current[i]; const value = e.currentTarget.value; delete staffNameBeforeEdit.current[i]; if (before !== undefined && before !== value) mutate(d => { renameStaff(d, i, value, before); }); }}/>))}</div>{field("本日の担当職員", <input value={draft.leadName} readOnly title="担当職員は作成者に固定"/>)}</section><p className="lead-copy">客室と清掃対象を選びます。初期値はトイレ2箇所・シャワー3箇所です。</p><section className="section"><div className="section-title"><h2>客室</h2>{badge(`${draft.roomCodes.length}室`, "soft")}</div><div className="stack">{ROOM_CODES.map(code => { const room = draft.rooms[code]; const meta = roomMeta[code]; const capacity = meta?.capacity || 5; const total = room.adults + room.children; return <div className="select-card" key={code}><label className="select-head"><input type="checkbox" disabled={readOnly} checked={draft.roomCodes.includes(code)} onChange={e => mutate(d => { d.roomCodes = e.target.checked ? [...d.roomCodes, code].sort() : d.roomCodes.filter(x => x !== code); })}/><span className="select-card-title">{code}号室</span><span className="meta">定員{capacity}名</span></label><div className="bed-label">{meta?.beds || ""}</div>{draft.roomCodes.includes(code) && <div className="room-stay"><div className="number-pair"><GuestCountPicker roomCode={code} label="大人" value={room.adults} max={capacity} disabled={readOnly} onChange={value => mutate(d => { updateRoomOccupancy(d, code, value, d.rooms[code].children); })}/><GuestCountPicker roomCode={code} label="子ども" value={room.children} max={capacity} disabled={readOnly} onChange={value => mutate(d => { updateRoomOccupancy(d, code, d.rooms[code].adults, value); })}/></div>{field("作業種別", <select value={room.type} disabled={readOnly} onChange={e => mutate(d => { d.rooms[code].type = e.target.value as RoomType; delete d.roomAnswers[code]; if(d.bedmakingExceptions) delete d.bedmakingExceptions[code]; })}>{Object.entries(typeLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>)}{total === 0 && <div className="no-stay-notice" role="status"><strong>宿泊なし</strong><small>大人・子どもがともに0人のため、宿泊なしとして扱います。</small></div>}{(code === "204" || code === "206") && total > 0 && <div className="subnote">EXベッド：{extraBedRequired(code, room) ? "使用あり" : "使用なし"}（宿泊人数から自動判定）</div>}{total !== 0 && <div className={`subnote ${total < 0 || total > capacity ? "error" : ""}`}>{total >= 0 && total <= capacity ? `合計 ${total} 名 · 定員 ${capacity} 名` : `合計は0〜${capacity}名で入力してください`}</div>}</div>}</div>; })}</div></section><section className="section"><div className="section-title"><h2>トイレ・シャワー</h2><span className="tiny">本日の対象数</span></div>{drum("toiletTarget", "トイレ", 2)}{drum("showerTarget", "シャワー", 3)}</section><div className="info-strip">洗面台、ラウンジ、客室廊下、階段・玄関、洗面周り廊下は毎回対象です。</div></div>}
        {tab === "checks" && draft && <>
          {!!selected?.reports.length && (selected.hasChangesSinceReport || dirty) && <div className="notice mini"><strong>現在の編集は報告版に未反映です</strong><span>変更を確認して新版を作成してください。</span></div>}
          {missingForReport(draft).length > 0 && <details className="missing-list missing-top"><summary><strong>未完了 {missingForReport(draft).length}件</strong></summary><div className="missing-shortcuts">{[...new Set(missingForReport(draft))].map(label => <button type="button" key={label} onClick={() => jumpToMissing(label)}>{label} →</button>)}</div></details>}
          <div className="compact-summary"><strong>{missingForReport(draft).length ? `未完了 ${missingForReport(draft).length}件` : "報告内容を確認できます"}</strong><span>本日の作業</span></div>
          {draft.staffNames.filter(Boolean).length > 0 && <div className="bulk-assignment"><label>未設定の作業へ一括割当 <select value={bulkAssignee} onChange={e => setBulkAssignee(e.target.value)}><option value="">担当者を選ぶ</option>{[...new Set([...draft.staffNames.filter(Boolean), draft.leadName])].map(name => <option key={name} value={name}>{name}</option>)}</select></label>{button("一括適用", () => assignAll(bulkAssignee), "outline compact", readOnly || !bulkAssignee)}<small>個別に変更した作業と開始済みの作業は変更しません。</small></div>}
          <div className="top-actions">{button("スタッフ・清掃範囲を編集", () => { void next("scope"); }, "text compact")}{button("設定", showSettings, "text compact")}{me.role === "field" && button("マニュアル変更申請", showMaster, "text compact")}</div>
          <div className="room-switch"><div className="section-title"><h2>客室チェック</h2>{badge(`${draft.roomCodes.length}室`, "soft")}</div>{draft.roomCodes.length === 0 ? <div className="empty-small">本日の対象客室はありません。客室向けの作業カードと確認欄は表示されません。</div> : <><div className="room-tabs" role="group" aria-label="確認する客室">{draft.roomCodes.map(code => { const defects = draft.defects.some(d => d.roomCode === code && d.status === "open"); const unperformed = !!draft.bedmakingExceptions?.[code]; const incomplete = missingRoom(code); return <button key={code} className={`room-tab ${focusRoom === code ? "active" : ""} ${!incomplete && !unperformed ? "done" : ""} ${unperformed && !defects ? "unperformed" : ""} ${defects ? "defect" : ""}`} aria-pressed={focusRoom === code} onClick={() => setFocusRoom(code)}><strong>{code}</strong>{defects ? <small>不備{unperformed ? "・ベッドメイク未実施" : ""}</small> : unperformed ? <small>ベッドメイク未実施{incomplete ? "・未完了" : ""}</small> : incomplete ? <small>未完了</small> : <span className="room-tab-check" role="img" aria-label="完了">✓</span>}</button>; })}</div>{draft.roomCodes.includes(focusRoom) && <article className="room-panel"><div className="room-panel-head"><div><span className="card-kicker">GUEST ROOM</span><h3>{focusRoom}号室</h3><p>{typeLabels[draft.rooms[focusRoom].type]} · 大人{draft.rooms[focusRoom].adults}名 / 子ども{draft.rooms[focusRoom].children}名</p></div>{badge(missingRoom(focusRoom) ? "確認中" : "確認完了", missingRoom(focusRoom) ? "soft" : "good")}</div><p className="room-bed">{roomMeta[focusRoom]?.beds} · 定員{roomMeta[focusRoom]?.capacity}名{draft.rooms[focusRoom].adults + draft.rooms[focusRoom].children === 0 ? " · 宿泊なし" : <> · アメニティ設置：{draft.rooms[focusRoom].type === "stay_amenities_only" ? "玄関靴箱" : draft.rooms[focusRoom].type === "arrival_amenities_only" ? "室内" : "部屋"}</>}</p>{draft.rooms[focusRoom].adults + draft.rooms[focusRoom].children > 0 && <div className="room-amenity">大人用スリッパ {draft.rooms[focusRoom].adults}足 ／ 子ども用 {draft.rooms[focusRoom].children}足 ／ 歯ブラシ {draft.rooms[focusRoom].adults + draft.rooms[focusRoom].children}本{draft.rooms[focusRoom].type !== "stay_amenities_only" && draft.rooms[focusRoom].type !== "arrival_amenities_only" && ` ／ 枕 ${draft.rooms[focusRoom].adults + draft.rooms[focusRoom].children}個`}</div>}<p className="tiny">気づきは下の備考へ、報告を止める問題は該当項目で不備登録します。</p>{draft.rooms[focusRoom].adults + draft.rooms[focusRoom].children === 0 && draft.rooms[focusRoom].type === "stay_amenities_only" && <p className="empty-small">宿泊なしのため個別の客室チェックはありません。職員の最終確認を行ってください。</p>}{["清掃", "アメニティ"].map(group => { const keys = roomCheckKeys(draft.rooms[focusRoom]).filter(k => (group === "アメニティ") === ["adult_slippers","child_slippers","toothbrushes","placement","amenities_message","arrival_placement_confirm","arrival_placement_room"].includes(k)); return keys.length > 0 && <div className="room-check-group" key={group}><h4>{group}</h4>{keys.map(key => { const activeDefect = draft.defects.find(d => d.roomCode === focusRoom && d.itemCode === key && d.status === "open"); const resolved = draft.defects.filter(d => d.roomCode === focusRoom && d.itemCode === key && d.status === "resolved").length; return <div className="check-with-defect" key={key}><label className="task-row"><input type="checkbox" disabled={readOnly || (key === "bedmaking" && !!draft.bedmakingExceptions?.[focusRoom])} checked={draft.roomAnswers[focusRoom]?.type === draft.rooms[focusRoom].type && !!draft.roomAnswers[focusRoom]?.checks[key]} onChange={e => setRoomAnswer(focusRoom, key, e.target.checked)}/><span><span className="task-box">✓</span>{key === "bedmaking" ? bedmakingLabel(focusRoom, draft.rooms[focusRoom]) : checkLabels[key] || key}</span></label>{!draft.roomAnswers[focusRoom]?.checks[key] && !(key === "bedmaking" && !!draft.bedmakingExceptions?.[focusRoom]) && <span className="field-error">確認してください</span>}{(activeDefect || resolved > 0) && <div className="defect-actions">{activeDefect && <div className="defect-note"><strong>未解消の不備</strong><span>{activeDefect.description}</span>{button("解消済みにする", () => mutate(d => { const item = d.defects.find(x => x.id === activeDefect.id); if (item) { item.status = "resolved"; item.resolvedAt = new Date().toISOString(); } }), "outline compact", readOnly)}</div>}{resolved > 0 && <small>解消履歴 {resolved}件</small>}</div>}</div>; })}</div>; })}{draft.defects.filter(d => d.roomCode === focusRoom && d.status === "open" && !roomCheckKeys(draft.rooms[focusRoom]).includes(d.itemCode)).map(defect => <div className="defect-note" key={defect.id}><strong>対象変更前の未解消不備</strong><span>{checkLabels[defect.itemCode] || defect.itemCode}：{defect.description}</span>{button("解消済みにする", () => mutate(d => { const item = d.defects.find(x => x.id === defect.id); if (item) { item.status = "resolved"; item.resolvedAt = new Date().toISOString(); } }), "outline compact", readOnly)}</div>)}{(draft.rooms[focusRoom].type === "checkout" || draft.rooms[focusRoom].type === "stay_cleaning") && <div className="notice mini bed-exception-form"><label className="approval-check"><input type="checkbox" disabled={readOnly} checked={!!draft.bedmakingExceptions?.[focusRoom]} onChange={e=>mutate(d=>{d.bedmakingExceptions ||= {}; if(e.target.checked){d.bedmakingExceptions[focusRoom]={reason:'',detail:'',action:''}; if(d.roomAnswers[focusRoom]){d.roomAnswers[focusRoom]!.checks.bedmaking=false;d.roomAnswers[focusRoom]!.finalConfirmed=false;}}else delete d.bedmakingExceptions[focusRoom];})}/>この客室のベッドメイクは未実施</label></div>}<div className="room-final"><label className="task-row"><input type="checkbox" disabled={readOnly} checked={!!draft.roomAnswers[focusRoom]?.finalConfirmed} onChange={e => mutate(d => { const answer = d.roomAnswers[focusRoom] || { type: d.rooms[focusRoom].type, checks: {}, finalConfirmed: false }; answer.finalConfirmed = e.target.checked; d.roomAnswers[focusRoom] = answer; })}/><span><span className="task-box">✓</span>職員の最終確認</span></label>{!draft.roomAnswers[focusRoom]?.finalConfirmed && <span className="field-error">最終確認をしてください</span>}<small>{draft.bedmakingExceptions?.[focusRoom] ? "確認内容：室内セットの確認" : "エアコンを消し、窓を閉めたことを確認"}</small>{button("不備を登録", () => openDefect(focusRoom), "text compact defect-register", readOnly || roomCheckKeys(draft.rooms[focusRoom]).every(key => draft.defects.some(d => d.roomCode === focusRoom && d.itemCode === key && d.status === "open")))}</div>{draft.defects.some(d => d.roomCode === focusRoom && d.status === "open") && <p className="inline-error">未解消不備があります。解消後は該当項目と最終確認をやり直してください。</p>}</article>}</>}</div>
          {[1,2].map(unit => <section className="section task-section" key={unit}><div className="section-title"><h2>ユニット{unit}の作業</h2>{badge(unit === 1 ? "作業別に時間を記録" : "同時進行できます", "soft")}</div>{active.filter(t => t.unit === unit).map(task => { const p = draft.tasks[task.id]; const allTargetRooms = taskTargetRooms(draft, task.id); const unperformedRooms = task.id === "bedmaking" ? allTargetRooms.filter(code => !!draft.bedmakingExceptions?.[code]) : []; const targetRooms = task.id === "bedmaking" ? allTargetRooms.filter(code => !draft.bedmakingExceptions?.[code]) : allTargetRooms; const target = targetRooms.length ? task.id === "bedmaking" ? `対象 ${targetRooms.map(code => `${code}号室${extraBedRequired(code, draft.rooms[code]) ? "（EX）" : ""}`).join("・")}` : `対象 ${targetRooms.join("・")}号室` : task.id === "showers" ? `対象 ${draft.showerTarget}箇所` : task.id === "toilets" ? `対象 ${draft.toiletTarget}箇所` : ""; const candidates = [...new Set([...draft.staffNames.filter(Boolean), draft.leadName, ...p.assignees])]; return <Fragment key={task.id}>{unperformedRooms.length > 0 && <article className="work-task bed-unperformed"><h3>ベッドメイキング</h3><p>{unperformedRooms.map(code => `${code}号室`).join("・")}：未実施</p></article>}{(task.id !== "bedmaking" || targetRooms.length > 0) && <article data-task-id={task.id} className={`work-task ${p.completed ? "done" : ""}`}><div className="work-task-head"><div><h3>{task.label}</h3>{target && <small>{target}</small>}</div><div className="task-progress-status">{badge(p.completed ? "完了" : p.startedAt ? "作業中" : "未開始", p.completed ? "good" : "soft")}<div className={`task-progress ${p.completed ? "complete" : p.startedAt ? "running" : ""}`} role="progressbar" aria-label={`${task.label}の進捗`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.completed ? 100 : p.startedAt ? undefined : 0} aria-valuetext={p.completed ? "完了" : p.startedAt ? "作業中" : "未開始"}><span/></div></div></div><div className="micro-label">担当者</div>{!p.assignees.length && !(task.id === "bedmaking" && targetRooms.every(code => bedmakingExceptionValid(draft,code) || !!draft.roomAnswers[code]?.checks.bedmaking)) && <span className="field-error">担当者を選択してください</span>}<div className="assignees">{candidates.map(name => <label className="check-pill" key={name}><input type="checkbox" checked={p.assignees.includes(name)} disabled={readOnly} onChange={() => taskAssignee(task.id, name)}/><span>{name === draft.leadName ? `職員：${name}` : name}</span></label>)}</div>{!p.completed && !(task.id === "bedmaking" && targetRooms.every(code => bedmakingExceptionValid(draft,code) || !!draft.roomAnswers[code]?.checks.bedmaking)) && <span className="field-error">作業を完了してください</span>}<div className="work-task-time"><span>開始 <strong>{p.startedAt || "--:--"}</strong></span><span>終了 <strong>{p.finishedAt || "--:--"}</strong></span></div>{task.id === "showers" && <label className="task-count">清掃済みのシャワー<select disabled={readOnly} value={p.completedCount} onChange={e => { const value = Number(e.target.value); mutateTask(d => { d.tasks.showers.completedCount = value; }); }}>{Array.from({ length: draft.showerTarget + 1 }, (_, n) => <option key={n} value={n}>{n}箇所</option>)}</select>{p.completedCount < 1 && <span className="field-error">清掃済みの数を選択してください</span>}</label>}<label className="task-note">時間・進め方のメモ<input value={p.timeNote} disabled={readOnly} placeholder="例：ベッドメイク後の部屋から随時" onChange={e => { const value = e.target.value; editedTaskNotesRef.current.add(task.id); mutate(d => { d.tasks[task.id].timeNote = value; }); }} onBlur={() => { if (editedTaskNotesRef.current.delete(task.id)) void save(); }}/></label><div className="card-actions">{p.completed ? <>{button("時刻編集", () => openTime(task.id), "outline compact", readOnly)}<span className="task-complete-mark" role="img" aria-label="完了">✓</span></> : taskActionLabel(p).action === "finish" ? <button type="button" className="button secondary compact" title="押すと作業を完了します" aria-label={`${task.label}の作業を完了する`} onClick={() => finishTask(task.id)} disabled={readOnly || !p.assignees.length || (task.id === "showers" && (p.completedCount < 1 || p.completedCount > draft.showerTarget))}>{taskActionLabel(p).label}</button> : button("開始", () => beginTask(task.id), "secondary compact", readOnly || !p.assignees.length)}</div></article>}</Fragment>; })}</section>)}
          <section className="section shared-fields"><div className="section-title"><h2>共通の記録</h2>{badge("報告に反映", "soft")}</div>{field("休憩は取れましたか？", <div className="segmented">{(["yes","no"] as const).map(value => <label key={value}><input type="radio" name="break" disabled={readOnly} checked={draft.breakAnswer === value} onChange={() => mutate(d => { d.breakAnswer = value; })}/><span>{value === "yes" ? "はい" : "いいえ"}</span></label>)}</div>)}{!draft.breakAnswer && <span className="field-error">休憩の有無を選択してください</span>}{field("休憩開始", <input type="time" value={draft.breakStart} disabled={readOnly} onChange={e => mutate(d => { d.breakStart = e.target.value; })}/>)}{field("休憩終了", <input type="time" value={draft.breakEnd} disabled={readOnly} onChange={e => mutate(d => { d.breakEnd = e.target.value; })}/>)}{draft.breakStart && draft.breakEnd && draft.breakStart > draft.breakEnd && <span className="field-error">休憩終了時刻を開始時刻以降にしてください</span>}{([ ["所感・課題","notes"], ["鍵に関するメモ","keyMemo"], ["シーツに関するメモ","sheetMemo"] ] as const).map(([label,key]) => <div key={key}>{field(label, <textarea value={draft[key]} disabled={readOnly} onChange={e => mutate(d => { d[key] = e.target.value; })}/>)}</div>)}<div className="photo-actions"><label className="button outline compact upload">写真を撮る<input type="file" accept="image/*" capture="environment" hidden disabled={readOnly} onChange={e => { if (e.target.files?.[0]) void upload(e.target.files[0]); e.target.value = ""; }}/></label><label className="button outline compact upload">画像を選ぶ<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={readOnly} onChange={e => { if (e.target.files?.[0]) void upload(e.target.files[0]); e.target.value = ""; }}/></label></div>{selected?.images.filter(image => draft.imageIds.includes(image.id)).length ? <div className="photo-grid">{selected.images.filter(image => draft.imageIds.includes(image.id)).map(image => <div className="photo" key={image.id}><img src={`/api/works/${selected.id}/images/${image.id}`} alt={image.file_name}/><button aria-label="画像を作業から外す" disabled={readOnly} onClick={() => mutate(d => { d.imageIds = d.imageIds.filter(x => x !== image.id); })}>×</button></div>)}</div> : <p className="tiny">添付画像はありません。</p>}</section>
          {missingForReport(draft).length > 0 && <div className="missing-list" role="status"><strong>未完了の項目</strong><ul>{missingForReport(draft).map((x,i) => <li key={i}>{x}</li>)}</ul></div>}
        </>}
        {tab === "batchTime" && draft && <section className="section batch-time"><p>作業ごとに担当者と時間を確認できます。客室の作業時間は対象客室をまとめた作業単位で記録します。</p>{batchError && <div className="toast toast-error" role="alert">{batchError}</div>}<div className="batch-time-list">{([1,2] as const).map(unit => { const tasks = active.filter(task => task.unit === unit && !(task.id === "bedmaking" && taskTargetRooms(draft, task.id).every(code => bedmakingExceptionValid(draft, code)))); const done = tasks.length > 0 && tasks.every(task => batchTimes[task.id]?.completed); return <section className="batch-unit" data-unit={unit} key={unit}><div className="batch-unit-heading"><h2>ユニット{unit}の作業</h2><span>{tasks.length ? done ? "完了" : "未完了" : "対象なし"}</span></div><div className="batch-unit-tasks">{tasks.map(task => { const item = batchTimes[task.id]; if (!item) return null; const p = draft.tasks[task.id]; const rooms = taskTargetRooms(draft, task.id); if (task.id === "bedmaking" && rooms.length && rooms.every(code => bedmakingExceptionValid(draft, code))) return null; const target = rooms.length ? `対象 ${rooms.filter(code => task.id !== "bedmaking" || !bedmakingExceptionValid(draft, code)).join("・")}号室` : task.id === "showers" ? `対象 ${draft.showerTarget}箇所` : task.id === "toilets" ? `対象 ${draft.toiletTarget}箇所` : ""; const update = (patch: Partial<typeof item>) => setBatchTimes(current => ({ ...current, [task.id]: { ...current[task.id]!, ...patch } })); return <article className="batch-time-row" key={task.id}><div><strong>{task.label}</strong>{target && <small>{target}</small>}<div className="micro-label">担当者</div><div className="assignees">{[...new Set([...draft.staffNames.filter(Boolean), draft.leadName, ...item.assignees])].map(name => <label className="check-pill" key={name}><input type="checkbox" aria-label={`${task.label}の担当者: ${name}`} checked={item.assignees.includes(name)} disabled={readOnly} onChange={() => update({assignees: item.assignees.includes(name) ? item.assignees.filter(x => x !== name) : [...item.assignees, name]})}/><span>{name === draft.leadName ? `職員：${name}` : name}</span></label>)}</div>{task.id === "showers" && <label className="task-count batch-shower-count">清掃済みのシャワー<select aria-label="シャワールームの清掃済み数" disabled={readOnly} value={item.completedCount} onChange={e => update({completedCount: Number(e.target.value)})}>{Array.from({length: draft.showerTarget + 1}, (_, n) => <option key={n} value={n}>{n}箇所</option>)}</select></label>}</div><div className="batch-time-fields"><div className="batch-time-inputs"><label>開始<input aria-label={`${task.label}の開始時刻`} type="time" value={item.start} onChange={e => update({start:e.target.value})}/></label><label>終了<input aria-label={`${task.label}の終了時刻`} type="time" value={item.end} onChange={e => update({end:e.target.value})}/></label><label className="batch-complete"><input type="checkbox" aria-label={`${task.label}を完了`} checked={item.completed} disabled={readOnly} onChange={e => update({completed:e.target.checked})}/> 完了</label></div></div></article>})}</div></section>})}</div><div className="batch-elapsed" role="status"><strong>作業時間（最初の開始〜最後の完了）</strong><span>{formatElapsedMinutes(workElapsedMinutes({...draft, tasks: Object.fromEntries(Object.entries(draft.tasks).map(([id, task]) => { const entry = batchTimes[id as TaskId]; return [id, entry ? {...task, startedAt:entry.start, finishedAt:entry.end, completed:entry.completed} : task]; })) as WorkData["tasks"]}))}</span><small>休憩時間は差し引いていません。</small></div></section>}
        {tab === "report" && selected && <><div className="report-status">{badge("送信前のプレビュー", "soft")}<span>送信版はまだ作成されていません</span></div><section className="section"><div className="section-title"><h2>形式を選ぶ</h2></div><div className="segmented"><label><input type="radio" name="format" checked={format === "pdf"} onChange={() => setFormat("pdf")}/><span>PDF</span></label><label><input type="radio" name="format" checked={format === "markdown"} onChange={() => setFormat("markdown")}/><span>Markdown</span></label></div><p className="tiny">{format === "pdf" ? "PDFファイルと添付画像をChatworkへ送信します。" : "報告本文と添付画像をChatworkへ送信します。"}</p></section>{preview?.missing.length ? <div className="missing-list"><strong>未完了の項目</strong><ul>{preview.missing.map((x,i) => <li key={i}>{x}</li>)}</ul></div> : null}<div className={`report-paper ${format}`}><pre>{preview?.body || "プレビューを読み込み中です"}</pre>{selected.images.filter(image => draft?.imageIds.includes(image.id)).length > 0 && <div className="report-photos">添付画像 {selected.images.filter(image => draft?.imageIds.includes(image.id)).length}枚 <div>{selected.images.filter(image => draft?.imageIds.includes(image.id)).map(image => <img key={image.id} src={`/api/works/${selected.id}/images/${image.id}`} alt={image.file_name}/>)}</div></div>}</div><div className="report-actions">{button("レポートを編集", () => { setReportEdit(preview?.body || ""); setModal("report-edit"); }, "outline", !preview || !canEdit || dirty)}{button("報告", () => { void beginReport(); }, "primary", !preview?.ready || !canEdit || dirty || busy)}</div>{selected.reports.length > 0 && <section className="section"><h2>確定済みの版</h2>{selected.reports.map(report => <details className="area-dropdown" key={report.id}><summary><strong>第{report.sequence}版 · {statusLabel(report.status)}</strong></summary><div className="area-options"><a href={`/api/works/${selected.id}/reports/${report.id}/markdown`}>Markdownを取得</a>{selected.ownerId === me?.id && <ReportDeliveryHistory workId={selected.id} reportId={report.id}/>}<pre className="archived-body">{report.body}</pre></div></details>)}</section>}</>}
        {tab === "result" && selected && <><div className="result-hero unknown"><div className="result-symbol">…</div><h2>報告を受け付けました</h2><p>Chatworkへの送信状態を確認してください。</p></div><section className="section"><h2>送信状態</h2>{selected.reports[0] ? <ReportDeliveryHistory workId={selected.id} reportId={selected.reports[0].id}/> : <p>報告の状態を確認中です。再読み込みしてください。</p>}</section><div className="stack">{button("内容を修正して新版を作る", () => setTab("checks"), "outline")}{button("今日の作業へ戻る", () => setTab("today"), "secondary")}</div></>}
        {tab === "settings" && <>{me.role !== "field" && <section className="section"><h2>Chatwork送信先</h2><div className="detail-list"><div><span>現在のルーム名</span><strong>{delivery === null ? "確認できません" : delivery.roomName || "未設定"}</strong></div></div></section>}
          <section className="section"><h2>記録と管理</h2><div className="settings-links"><button onClick={() => { void showHistory(); }}><span>アーカイブを開く<small>前日の作業と報告版を見る</small></span><b>→</b></button>{me.role === "field" && <button onClick={showMaster}><span>マニュアル変更申請<small>承認申告と通知状態</small></span><b>→</b></button>}{<button onClick={() => openMenuTab("chatwork")}><span>Chatwork連携<small>送信元と報告ルームの設定</small></span><b>→</b></button>}<button onClick={() => openMenuTab("people")}><span>職員台帳<small>氏名と権限を確認・変更</small></span><b>→</b></button></div></section></>}
        {tab === "chatwork" && <ChatworkProductionSettings canManage canManageRoom={me.role === "field"} deliveryStatus={delivery} onUpdated={() => { call<DeliveryStatus>("report-delivery-settings").then(setDelivery).catch(() => setDelivery(null)); }}/>}
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
        {conflict && <div className="warning" role="alert"><strong>別の画面でも変更されています</strong><p>同じ項目の変更は残す内容を選んでください。</p>{mergeConflicts.map(item => <div className="merge-choice" key={item.path}><strong>{item.path}</strong><label><input type="radio" name={`merge-${item.path}`} checked={mergeChoices[item.path] === "server"} onChange={() => setMergeChoices(current => ({ ...current, [item.path]: "server" }))}/>別の画面：{JSON.stringify(item.server)}</label><label><input type="radio" name={`merge-${item.path}`} checked={mergeChoices[item.path] === "local"} onChange={() => setMergeChoices(current => ({ ...current, [item.path]: "local" }))}/>この端末：{JSON.stringify(item.local)}</label></div>)}{mergeConflicts.length > 0 && button("選んだ内容を反映", () => { void resolveConflict(); }, "primary", mergeConflicts.some(item => !mergeChoices[item.path]))}{button("別の画面の内容を使う", () => { void discardLocal(); }, "outline")}</div>}

        </>}
      </div>{footer && <div className="bottom-bar">{footer}</div>}</main></div><div className="desktop-foot">KIIYA 見落としチェッカー</div>
      {tab === "master" && masterTutorialStage === "steps" && <div className="master-tutorial-scrim" aria-hidden="true"/>}
      {tab === "master" && masterTutorialStage === "intro" && <div className="master-tutorial-intro-backdrop"><div className="master-tutorial-intro" role="dialog" aria-modal="true" aria-labelledby="master-tutorial-title"><p className="overline">HOW TO USE</p><h2 id="master-tutorial-title">マニュアル変更申請の流れ</h2><ul><li>当日の担当職員が作業開始後に、別職員1名の承認を得たことを自己申告して申請します。</li><li>承認者の氏名を記録します。承認者本人によるアプリ操作は不要です。</li><li>現在のアプリでできるのは申請の記録までです。Chatwork通知とマスタの編集・確認・適用は未接続です。</li><li>連携後は、通知に成功した申請を職員が編集し、編集に参加していない別職員が確認します。確認の翌日0時から新版を新規作業に適用する設計です。</li></ul><div className="master-tutorial-intro-actions"><button type="button" onClick={() => setMasterTutorialStage("closed")}>閉じる</button><button type="button" className="next" onClick={() => { setMasterTutorialStep(0); setMasterTutorialStage("steps"); }}>入力場所を見る</button></div></div></div>}
      {tutorialOpen && <HomeTutorial onClose={() => setTutorialOpen(false)}/>}
      {modal && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">{modal === "reset" && <><div className="modal-head"><h2 id="modal-title">本日の入力をリセットしますか？</h2><p>作業開始時刻、スタッフ、清掃範囲、チェック、不備、メモ、添付画像の選択を初期化し、最初の工程に戻ります。保存済みの入力も対象です。確定済みの報告履歴は残ります。</p></div><div className="modal-actions">{button("キャンセル", () => setModal(""), "secondary", busy)}{button("リセットする", () => { void resetToday(); }, "primary", busy)}</div></>}{modal === "defect" && <><div className="modal-head"><p className="overline">ROOM DEFECT</p><h2 id="modal-title">不備を登録</h2><p>{modalRoom}号室</p></div>{field("該当する項目", <select value={modalItem} onChange={e => setModalItem(e.target.value)}>{draft && roomCheckKeys(draft.rooms[modalRoom]).filter(key => !draft.defects.some(d => d.roomCode === modalRoom && d.itemCode === key && d.status === "open")).map(key => <option key={key} value={key}>{checkLabels[key] || key}</option>)}</select>)}{field("不備の内容", <textarea value={newDefect.description} placeholder="確認した問題を入力" onChange={e => setNewDefect({ ...newDefect, description: e.target.value })}/>)}<div className="modal-actions">{button("キャンセル", () => setModal(""), "secondary")}{button("登録", () => { mutate(d => { d.defects.push({ id: crypto.randomUUID(), roomCode: modalRoom, itemCode: modalItem, description: newDefect.description.trim(), status: "open", createdAt: new Date().toISOString() }); }); setModal(""); }, "primary", !newDefect.description.trim())}</div></>}{modal === "time" && <><div className="modal-head"><p className="overline">EDIT TIME</p><h2 id="modal-title">{TASKS.find(t => t.id === modalTask)?.label}の時刻編集</h2><p>開始時刻と終了時刻を修正できます。</p></div><div className="time-edit-fields">{field("開始時刻", <input type="time" value={modalStart} onChange={e => setModalStart(e.target.value)}/>)}{field("終了時刻", <input type="time" value={modalEnd} onChange={e => setModalEnd(e.target.value)}/>)}</div><div className="modal-actions">{button("キャンセル", () => setModal(""), "secondary")}{button("保存", () => { mutateTask(d => { d.tasks[modalTask].startedAt = modalStart; d.tasks[modalTask].finishedAt = modalEnd; d.tasks[modalTask].timeUnrecorded = false; }); setModal(""); }, "primary", !!modalStart !== !!modalEnd || (!!modalStart && modalStart > modalEnd))}</div></>}{modal === "report-edit" && <><div className="modal-head"><p className="overline">EDIT REPORT</p><h2 id="modal-title">レポートを編集</h2><p>報告に表示する文章を編集できます。変更は「報告」で確定すると保存されます。</p></div>{field("報告内容", <textarea value={reportEdit} maxLength={50000} onChange={e => setReportEdit(e.target.value)}/>)}<div className="modal-actions">{button("キャンセル", () => setModal(""), "secondary")}{button("変更を反映", () => { setPreview(current => current ? { ...current, body: reportEdit } : current); setReportEdited(true); setModal(""); }, "primary", !reportEdit.trim())}</div></>}{modal === "confirm" && <><div className="modal-head"><p className="overline">FINAL CHECK</p><h2 id="modal-title">報告送信の確認</h2><p>送信先と報告内容を確認してください。「確定」でChatworkへの送信を開始します。</p></div>{candidate && <><div className="detail-list"><div><span>送信元</span><strong>{delivery?.sourceDisplayName || "確認中"}</strong></div><div><span>送信先</span><strong>{candidate.trial?.roomName || delivery?.roomName || "確認中"}</strong></div><div><span>形式</span><strong>{candidate.format === "pdf" ? "PDF・画像" : candidate.format === "markdown" ? "Markdown本文・画像" : "従来形式（本文・Markdown・PDF・画像）"}</strong></div><div><span>作業日</span><strong>{selected?.day}</strong></div></div><p>添付画像 {candidate.imageIds?.length || 0}枚</p>{selected && candidate.imageIds?.length > 0 && <div className="report-photos">{candidate.imageIds.map(id => <img key={id} src={`/api/works/${selected.id}/images/${id}`} alt="添付画像"/>)}</div>}<pre className="archived-body candidate-body">{candidate.body}</pre>{candidate.stale ? <div className="warning">作業または職員情報が変更されています。候補を作り直してください。</div> : !candidate.trial ? <div className="notice mini">送信の準備を確認しています。</div> : !candidate.trial.permitValid ? <div className="warning">送信設定または配送状況を確認してください。</div> : !candidate.trial.prepared ? <div className="notice mini">添付と送信内容の確認が必要です。状態を更新してください。</div> : <div className="notice mini">表示された送信先と報告内容を確認してください。</div>}</>}{message&&<p role="status">{message}</p>}<ReportConfirmActions busy={busy} confirmed={!!candidate?.confirmed} canSend={!!candidate?.trial?.permitValid && candidate.trial.prepared && !candidate.stale && candidate.format===format} onClose={() => setModal("")} onSend={() => { void prepare(); }} onRefresh={() => { void refreshReport(); }}/></>}</div></div>}
    </div>;
}
