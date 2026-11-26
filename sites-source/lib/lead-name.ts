export function leadNameForNewWork(userId: string, staffName: string, adminUserId?: string, adminLeadName?: string): string {
  const configured = adminLeadName?.trim();
  if (userId === adminUserId && configured && configured.length <= 80) return configured;
  return staffName;
}
