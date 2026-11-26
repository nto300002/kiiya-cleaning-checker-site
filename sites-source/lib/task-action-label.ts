export function taskActionLabel(task: { startedAt: string; timeNote: string }): { label: string; action: "start" | "finish"; status: string | null } {
  return task.startedAt
    ? { label: "完了", action: "finish", status: "作業中" }
    : task.timeNote ? { label: "完了", action: "finish", status: null } : { label: "開始", action: "start", status: null };
}
