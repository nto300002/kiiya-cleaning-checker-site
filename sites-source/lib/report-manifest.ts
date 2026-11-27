type ManifestInput = { jobId:string; actorId:string; staffRevision:number; now:number };

// All manifest rows are derived from the immutable saved report snapshot. Both
// statements run as one D1 batch: incomplete or invalid snapshots stay unsealed.
export async function createReportManifest(db:D1Database,input:ManifestInput):Promise<boolean> {
  const readyStatus=`(j.status='DispatchPending' OR (j.status='TestAwaitingRegistration' AND j.delivery_mode='test' AND EXISTS
    (SELECT 1 FROM report_snapshot_candidates c WHERE c.id=j.report_id AND c.status='Active' AND c.work_revision=w.revision AND c.staff_revision=u.staff_revision)))`;
  const eligible = `FROM chatwork_delivery_jobs j
    JOIN works w ON w.id=j.work_id AND w.owner_id=j.actor_id AND w.latest_report_id=j.report_id
    JOIN app_users u ON u.id=j.actor_id AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=j.actor_staff_revision
    JOIN report_versions r ON r.id=j.report_id AND r.work_id=j.work_id AND r.status='Prepared' AND r.format=CASE json_extract(r.snapshot_json,'$.deliveryFormat') WHEN 'pdf' THEN 'pdf' ELSE 'markdown' END
    WHERE j.id=? AND j.actor_id=? AND j.actor_staff_revision=? AND j.kind='ReportDelivery'
      AND ${readyStatus} AND j.report_manifest_sealed=0
      AND json_valid(r.snapshot_json) AND (json_type(r.snapshot_json,'$.deliveryFormat') IS NULL OR json_extract(r.snapshot_json,'$.deliveryFormat') IN ('markdown','pdf')) AND json_type(r.snapshot_json,'$.imageIds')='array'
      AND json_array_length(r.snapshot_json,'$.imageIds')<=20
      AND NOT EXISTS (SELECT 1 FROM json_each(r.snapshot_json,'$.imageIds') x
        WHERE x.type<>'text' OR length(x.value)=0 OR NOT EXISTS
          (SELECT 1 FROM images i WHERE i.id=x.value AND i.work_id=j.work_id))
      AND (SELECT count(*) FROM json_each(r.snapshot_json,'$.imageIds')) =
          (SELECT count(DISTINCT x.value) FROM json_each(r.snapshot_json,'$.imageIds') x)
      AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=j.id)`;
  const now=new Date(input.now).toISOString();
  const args=[input.jobId,input.actorId,input.staffRevision];
  const insert=db.prepare(`INSERT INTO chatwork_report_artifacts(id,job_id,ordinal,kind,source_id,status,updated_at)
    SELECT lower(hex(randomblob(16))),j.id,CASE WHEN parts.kind='image' THEN parts.ordinal-2+CASE WHEN json_type(r.snapshot_json,'$.deliveryFormat') IS NULL THEN 2+CASE WHEN j.delivery_mode='test' THEN 1 ELSE 0 END ELSE 1 END ELSE parts.ordinal END,parts.kind,parts.source_id,'Pending',?
    FROM (SELECT 0 AS ordinal,'body' AS kind,NULL AS source_id UNION ALL
          SELECT 1,'markdown',NULL UNION ALL
          SELECT CASE WHEN json_type((SELECT snapshot_json FROM report_versions WHERE id=(SELECT report_id FROM chatwork_delivery_jobs WHERE id=?)),'$.deliveryFormat') IS NULL THEN 2 ELSE 0 END,'pdf',NULL UNION ALL
          SELECT CAST(x.key AS INTEGER)+2,'image',x.value FROM report_versions rr,
                 json_each(rr.snapshot_json,'$.imageIds') x WHERE rr.id=(SELECT report_id FROM chatwork_delivery_jobs WHERE id=?)) parts,
    chatwork_delivery_jobs j JOIN works w ON w.id=j.work_id AND w.owner_id=j.actor_id AND w.latest_report_id=j.report_id
    JOIN app_users u ON u.id=j.actor_id AND u.active=1 AND u.role IN ('normal','field') AND u.staff_revision=j.actor_staff_revision
    JOIN report_versions r ON r.id=j.report_id AND r.work_id=j.work_id AND r.status='Prepared' AND r.format=CASE json_extract(r.snapshot_json,'$.deliveryFormat') WHEN 'pdf' THEN 'pdf' ELSE 'markdown' END
    WHERE j.id=? AND j.actor_id=? AND j.actor_staff_revision=? AND j.kind='ReportDelivery'
      AND (CASE WHEN json_type(r.snapshot_json,'$.deliveryFormat') IS NULL THEN (parts.kind<>'pdf' OR j.delivery_mode='test') WHEN json_extract(r.snapshot_json,'$.deliveryFormat')='markdown' THEN parts.kind IN ('body','image') WHEN json_extract(r.snapshot_json,'$.deliveryFormat')='pdf' THEN parts.kind IN ('pdf','image') ELSE 0 END)
      AND ${readyStatus} AND j.report_manifest_sealed=0
      AND json_valid(r.snapshot_json) AND (json_type(r.snapshot_json,'$.deliveryFormat') IS NULL OR json_extract(r.snapshot_json,'$.deliveryFormat') IN ('markdown','pdf')) AND json_type(r.snapshot_json,'$.imageIds')='array'
      AND json_array_length(r.snapshot_json,'$.imageIds')<=20
      AND NOT EXISTS (SELECT 1 FROM json_each(r.snapshot_json,'$.imageIds') x WHERE x.type<>'text' OR length(x.value)=0 OR NOT EXISTS (SELECT 1 FROM images i WHERE i.id=x.value AND i.work_id=j.work_id))
      AND (SELECT count(*) FROM json_each(r.snapshot_json,'$.imageIds'))=(SELECT count(DISTINCT x.value) FROM json_each(r.snapshot_json,'$.imageIds') x)
      AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=j.id)`)
    .bind(now,input.jobId,input.jobId,...args);
  const seal=db.prepare(`UPDATE chatwork_delivery_jobs SET report_manifest_sealed=1 WHERE id=? AND actor_id=? AND actor_staff_revision=?
    AND report_manifest_sealed=0 AND (status='DispatchPending' OR (status='TestAwaitingRegistration' AND delivery_mode='test' AND EXISTS
      (SELECT 1 FROM report_snapshot_candidates c WHERE c.id=chatwork_delivery_jobs.report_id AND c.status='Active')))
    AND EXISTS (SELECT 1 ${eligible.replace("j.id=? AND j.actor_id=? AND j.actor_staff_revision=? AND ","") .replace("AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=j.id)","")}
      AND j.id=chatwork_delivery_jobs.id)
    AND (SELECT count(*) FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id)
      = (SELECT CASE WHEN json_type(snapshot_json,'$.deliveryFormat') IS NULL THEN 2+CASE WHEN chatwork_delivery_jobs.delivery_mode='test' THEN 1 ELSE 0 END ELSE 1 END+json_array_length(snapshot_json,'$.imageIds') FROM report_versions WHERE id=chatwork_delivery_jobs.report_id)
    AND EXISTS (SELECT 1 FROM report_versions r WHERE r.id=chatwork_delivery_jobs.report_id AND (CASE WHEN json_type(r.snapshot_json,'$.deliveryFormat') IS NULL THEN EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND a.ordinal=0 AND a.kind='body') AND EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND a.ordinal=1 AND a.kind='markdown') AND (chatwork_delivery_jobs.delivery_mode<>'test' OR EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND a.ordinal=2 AND a.kind='pdf')) WHEN json_extract(r.snapshot_json,'$.deliveryFormat')='markdown' THEN EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND a.ordinal=0 AND a.kind='body') WHEN json_extract(r.snapshot_json,'$.deliveryFormat')='pdf' THEN EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND a.ordinal=0 AND a.kind='pdf') ELSE 0 END)) AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND a.status<>'Pending')
    AND NOT EXISTS (SELECT 1 FROM report_versions r, json_each(r.snapshot_json,'$.imageIds') x
      WHERE r.id=chatwork_delivery_jobs.report_id AND NOT EXISTS (SELECT 1 FROM chatwork_report_artifacts a
        WHERE a.job_id=chatwork_delivery_jobs.id AND a.ordinal=CAST(x.key AS INTEGER)+CASE WHEN json_type(r.snapshot_json,'$.deliveryFormat') IS NULL THEN 2+CASE WHEN chatwork_delivery_jobs.delivery_mode='test' THEN 1 ELSE 0 END ELSE 1 END AND a.kind='image'
          AND a.source_id=x.value AND a.status='Pending'))`)
    .bind(...args);
  // A non-empty unsealed manifest must abort the same batch. The impossible
  // value violates the schema CHECK, rolling back any rows inserted above.
  const assertSealed=db.prepare(`UPDATE chatwork_delivery_jobs SET report_manifest_sealed=2
    WHERE id=? AND report_manifest_sealed=0
      AND EXISTS (SELECT 1 FROM chatwork_report_artifacts WHERE job_id=chatwork_delivery_jobs.id)`).bind(input.jobId);
  await db.batch([insert,seal,assertSealed]);
  const result=await db.prepare(`SELECT 1 FROM chatwork_delivery_jobs j JOIN app_users u ON u.id=j.actor_id
    JOIN works w ON w.id=j.work_id AND w.owner_id=j.actor_id
    WHERE j.id=? AND j.actor_id=? AND j.actor_staff_revision=? AND u.active=1 AND u.role IN ('normal','field')
    AND u.staff_revision=j.actor_staff_revision AND j.report_manifest_sealed=1`).bind(...args).first();
  return !!result;
}
