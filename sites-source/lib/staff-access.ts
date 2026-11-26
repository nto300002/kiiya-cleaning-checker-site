/** Site-local user IDs explicitly appointed by the developer. An unset roster denies everyone. */
export function appointedStaffIds(value: string | undefined): Set<string> {
  return new Set((value || "").split(",").map(id => id.trim()).filter(Boolean));
}

export function isAppointedStaff(value: string | undefined, id: string): boolean {
  return appointedStaffIds(value).has(id);
}

/** Developer appointments and in-app approvals are both explicit access grants. */
export async function hasStaffAccess(db: D1Database, appointments: string | undefined, id: string): Promise<boolean> {
  if (isAppointedStaff(appointments, id)) return true;
  const approved = await db.prepare("SELECT id FROM staff_registration_requests WHERE id=? AND approval_id IS NOT NULL AND approved_at IS NOT NULL").bind(id).first();
  return !!approved;
}
