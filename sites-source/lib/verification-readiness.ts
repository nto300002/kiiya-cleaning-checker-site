/** Confirmation-post delivery path only; actual posting also requires a valid destination and no unresolved job. */
export async function verificationPathReady(db: D1Database, now = Date.now()): Promise<boolean> {
  const row = await db.prepare("SELECT approved,worker_subject,approval_generation,worker_revision,site_revision,last_healthy_heartbeat_at FROM chatwork_delivery_runtime WHERE id='production'").first<any>();
  return !!row?.approved && !!row.worker_subject && Number(row.approval_generation) > 0 && !!row.worker_revision && !!row.site_revision && Number(row.last_healthy_heartbeat_at) >= now - 180_000;
}
