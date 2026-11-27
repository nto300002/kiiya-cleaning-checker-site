// New manifests have exactly one report item; old snapshots keep their legacy shape.
export const testReportManifestShape = `EXISTS (SELECT 1 FROM report_versions rv WHERE rv.id=chatwork_delivery_jobs.report_id AND rv.work_id=chatwork_delivery_jobs.work_id AND json_valid(rv.snapshot_json) AND (CASE
 WHEN json_type(rv.snapshot_json,'$.deliveryFormat') IS NULL THEN
   EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND a.kind='body') AND EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND a.kind='markdown') AND EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND a.kind='pdf')
 WHEN json_extract(rv.snapshot_json,'$.deliveryFormat')='markdown' AND rv.format='markdown' THEN
   (SELECT count(*) FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND a.kind='body')=1 AND NOT EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND a.kind IN ('markdown','pdf'))
 WHEN json_extract(rv.snapshot_json,'$.deliveryFormat')='pdf' AND rv.format='pdf' THEN
   (SELECT count(*) FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND a.kind='pdf')=1 AND NOT EXISTS(SELECT 1 FROM chatwork_report_artifacts a WHERE a.job_id=chatwork_delivery_jobs.id AND a.kind IN ('markdown','body'))
 ELSE 0 END))`;
