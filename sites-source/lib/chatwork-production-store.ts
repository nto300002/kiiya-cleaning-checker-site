// D1 batch runs these statements in one transaction. The audit INSERT is conditional
// on the same version/candidate predicate as the setting UPDATE, so a conflict
// cannot leave a history entry or consume a room candidate.
type Base = { actorId: string; staffRevision: number; expectedVersion: number; now: string; auditId: string };
type Connection = Base & { accountId: string; displayName: string; tokenCipher: string; expiresAt: number };
type AccountConfirmation = Base & { accountId: string };
type RoomConfirmation = Base & { candidateId: string; nowMs: number };

type PublicRow = { status: string; account_id: string | null; display_name: string | null; account_confirmed: number;
  room_id: string | null; room_name: string | null; destination_verified: number; paused: number; version: number;
  refresh_lease_until: number | null };

export function publicDeliverySettings(row: PublicRow, nowMs: number) {
  const reconnectRequired = row.status === "ReconnectRequired" || row.status === "RefreshInProgress" && (!row.refresh_lease_until || row.refresh_lease_until <= nowMs);
  const setupReason = !row.room_id ? "RoomNotConfigured" : !row.account_id ? "AccountNotConnected" : !row.account_confirmed ? "AccountConfirmationRequired"
    : row.paused ? "PausedByOperator" : reconnectRequired ? "ReconnectRequired" : !row.destination_verified ? "RoomVerificationRequired" : "DeliveryPathUnavailable";
  return { setupRequired: true, setupReason, sourceDisplayName: row.account_confirmed ? row.display_name : null,
    roomName: row.account_confirmed && row.room_id ? row.room_name : null, destinationStatus: row.status,
    deliveryEnabled: false, configurationVersion: row.destination_verified ? String(row.version) : null };
}

export async function connectAccount(db: D1Database, input: Connection): Promise<boolean> {
  const row = await db.prepare("SELECT account_id,account_confirmed,account_confirmed_by,account_confirmed_at,room_id,room_name FROM chatwork_production_settings WHERE id='production' AND version=?")
    .bind(input.expectedVersion).first<{ account_id: string | null; account_confirmed: number; account_confirmed_by: string | null;
      account_confirmed_at: string | null; room_id: string | null; room_name: string | null }>();
  if (!row) return false;
  const same = row.account_id === input.accountId;
  const results = await db.batch([
    db.prepare("INSERT INTO chatwork_production_audit (id,actor_id,action,detail_json,created_at) SELECT ?,?,'OAuthConnected',?,? FROM chatwork_production_settings WHERE id='production' AND version=? AND NOT EXISTS (SELECT 1 FROM chatwork_delivery_jobs WHERE status='Posting') AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role='field' AND staff_revision=?)")
      .bind(input.auditId, input.actorId, JSON.stringify({ accountId: input.accountId, previousVersion: input.expectedVersion }), input.now, input.expectedVersion, input.actorId, input.staffRevision),
    db.prepare("UPDATE chatwork_production_settings SET version=version+1,account_id=?,display_name=?,account_confirmed=?,account_confirmed_by=?,account_confirmed_at=?,room_id=?,room_name=?,room_confirmed_by=NULL,room_confirmed_at=NULL,destination_verified=0,token_cipher=?,token_expires_at=?,token_revision=token_revision+1,refresh_lease_until=NULL,status=?,updated_at=? WHERE id='production' AND version=? AND EXISTS (SELECT 1 FROM chatwork_production_audit WHERE id=?)")
      .bind(input.accountId, input.displayName, same ? row.account_confirmed : 0, same ? row.account_confirmed_by : null,
        same ? row.account_confirmed_at : null, same ? row.room_id : null, same ? row.room_name : null, input.tokenCipher,
        input.expiresAt, same && row.account_confirmed ? "DestinationVerificationRequired" : "AccountConfirmationRequired",
        input.now, input.expectedVersion, input.auditId),
  ]);
  return results[1].meta.changes === 1;
}

export async function confirmAccount(db: D1Database, input: AccountConfirmation): Promise<boolean> {
  const results = await db.batch([
    db.prepare("INSERT INTO chatwork_production_audit (id,actor_id,action,detail_json,created_at) SELECT ?,?,'AccountConfirmed',?,? FROM chatwork_production_settings WHERE id='production' AND version=? AND account_id=? AND account_confirmed=0 AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1 AND role='field' AND staff_revision=?)")
      .bind(input.auditId, input.actorId, JSON.stringify({ accountId: input.accountId }), input.now, input.expectedVersion, input.accountId, input.actorId, input.staffRevision),
    db.prepare("UPDATE chatwork_production_settings SET version=version+1,account_confirmed=1,account_confirmed_by=?,account_confirmed_at=?,destination_verified=0,status=CASE WHEN room_id IS NULL THEN 'Unconfigured' ELSE 'DestinationVerificationRequired' END,updated_at=? WHERE id='production' AND version=? AND account_id=? AND account_confirmed=0 AND EXISTS (SELECT 1 FROM chatwork_production_audit WHERE id=?)")
      .bind(input.actorId, input.now, input.now, input.expectedVersion, input.accountId, input.auditId),
  ]);
  return results[1].meta.changes === 1;
}

export async function confirmRoom(db: D1Database, input: RoomConfirmation): Promise<boolean> {
  const row = await db.prepare("SELECT room_id FROM chatwork_production_settings WHERE id='production' AND version=?").bind(input.expectedVersion).first<{ room_id: string | null }>();
  const candidate = await db.prepare("SELECT room_id,room_name FROM chatwork_room_candidates WHERE id=?")
    .bind(input.candidateId).first<{ room_id: string; room_name: string }>();
  if (!row || !candidate) return false;
  const eligible = "FROM chatwork_room_candidates c JOIN chatwork_production_settings s ON s.id='production' JOIN app_users u ON u.id=c.actor_id WHERE c.id=? AND c.actor_id=? AND c.account_id=s.account_id AND c.expected_version=s.version AND c.consumed_at IS NULL AND c.expires_at>? AND s.version=? AND s.account_confirmed=1 AND c.room_id=? AND c.room_name=? AND u.active=1 AND u.role='field' AND u.staff_revision=? AND NOT EXISTS (SELECT 1 FROM chatwork_delivery_jobs WHERE status='Posting')";
  const results = await db.batch([
    db.prepare(`INSERT INTO chatwork_production_audit (id,actor_id,action,detail_json,created_at) SELECT ?,?,'RoomConfirmed',?,? ${eligible}`)
      .bind(input.auditId, input.actorId, JSON.stringify({ previousRoomId: row.room_id, roomId: candidate.room_id, version: input.expectedVersion + 1 }), input.now,
        input.candidateId, input.actorId, input.nowMs, input.expectedVersion, candidate.room_id, candidate.room_name, input.staffRevision),
    db.prepare(`UPDATE chatwork_production_settings SET version=version+1,room_id=?,room_name=?,room_confirmed_by=?,room_confirmed_at=?,destination_verified=0,status='DestinationVerificationRequired',updated_at=? WHERE id='production' AND version=? AND account_confirmed=1 AND EXISTS (SELECT 1 ${eligible}) AND EXISTS (SELECT 1 FROM chatwork_production_audit WHERE id=?)`)
      .bind(candidate.room_id, candidate.room_name, input.actorId, input.now, input.now, input.expectedVersion,
        input.candidateId, input.actorId, input.nowMs, input.expectedVersion, candidate.room_id, candidate.room_name, input.staffRevision, input.auditId),
    db.prepare("UPDATE chatwork_room_candidates SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM chatwork_production_settings WHERE id='production' AND version=? AND room_id=? AND room_confirmed_by=?) AND EXISTS (SELECT 1 FROM chatwork_production_audit WHERE id=?)")
      .bind(input.now, input.candidateId, input.expectedVersion + 1, candidate.room_id, input.actorId, input.auditId),
  ]);
  return results[1].meta.changes === 1 && results[2].meta.changes === 1;
}
