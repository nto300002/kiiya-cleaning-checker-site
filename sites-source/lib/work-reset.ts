import { reportRetryGuard } from './report-retry-guard.ts';

type ResetInput = { workId: string; actorId: string; day: string; revision: number; nextJson: string; changeId: string; now: string };
export async function resetWork(db: D1Database, input: ResetInput): Promise<boolean> {
  const update = db.prepare(`UPDATE works SET data_json=?,revision=revision+1,status='Draft',first_pressed_at=NULL,updated_at=?
    WHERE id=? AND owner_id=? AND day=? AND revision=?
    AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role IN ('normal','field'))
    AND NOT EXISTS (SELECT 1 FROM report_snapshot_candidates c WHERE c.work_id=works.id AND c.status='Active')
    AND EXISTS (SELECT 1 FROM work_changes WHERE id=?) AND ${reportRetryGuard}`)
    .bind(input.nextJson,input.now,input.workId,input.actorId,input.day,input.revision,input.actorId,input.changeId);
  // Capture the original row before changing it; both writes are transactional.
  const audit = db.prepare(`INSERT INTO work_changes(id,work_id,actor_id,revision,before_json,after_json,changed_at)
    SELECT ?,id,?,revision+1,data_json,?,? FROM works WHERE id=? AND owner_id=? AND day=? AND revision=?
    AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role IN ('normal','field'))
    AND ${reportRetryGuard}`)
    .bind(input.changeId,input.actorId,input.nextJson,input.now,input.workId,input.actorId,input.day,input.revision,input.actorId);
  const close = db.prepare(`UPDATE report_snapshot_candidates SET status='Closed' WHERE work_id=? AND status='Active' AND EXISTS (SELECT 1 FROM work_changes WHERE id=?)`)
    .bind(input.workId,input.changeId);
  const results = await db.batch([audit, close, update]);
  return !!results[0].meta.changes && !!results[2].meta.changes;
}
