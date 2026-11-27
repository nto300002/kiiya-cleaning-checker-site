import { cleanWork, invalidateChangedTaskTargets, ROOM_CODES, type WorkData } from "./domain.ts";

export type MergeChoice = "server" | "local";
export type MergeConflict = { path: string; server: unknown; local: unknown };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function mergeWork(base: WorkData, server: WorkData, local: WorkData, choices: Record<string, MergeChoice> = {}): { data: WorkData; conflicts: MergeConflict[] } {
  const conflicts: MergeConflict[] = [];
  function merge(path: string, before: unknown, remote: unknown, mine: unknown): unknown {
    if (equal(mine, before)) return remote;
    if (equal(remote, before) || equal(remote, mine)) return mine;
    if (object(before) && object(remote) && object(mine)) {
      const result: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(before), ...Object.keys(remote), ...Object.keys(mine)])) {
        const value = merge(path ? `${path}.${key}` : key, before[key], remote[key], mine[key]);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    if (!choices[path]) conflicts.push({ path, server: remote, local: mine });
    return choices[path] === "local" ? mine : remote;
  }
  const merged = merge("", base, server, local) as WorkData;
  if (conflicts.length) return { data: merged, conflicts };
  const result = cleanWork(merged, base);
  for (const code of ROOM_CODES) {
    if (!base.roomCodes.includes(code) && result.roomCodes.includes(code)) delete result.roomAnswers[code];
    if (base.rooms[code].type !== result.rooms[code].type) {
      delete result.roomAnswers[code];
      result.tasks.bedmaking.completed = false;
      result.tasks.roomclean.completed = false;
      result.tasks.amenities.completed = false;
    }
  }
  invalidateChangedTaskTargets(base, result);
  return { data: result, conflicts };
}
