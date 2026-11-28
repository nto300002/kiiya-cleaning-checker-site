import { env } from 'cloudflare:workers';
import { getAuthenticatedUser } from '@/app/chatgpt-auth';
import policy from '@/lib/export-policy.json';
import { sha256, streamedZip } from '@/lib/export-zip';

export const dynamic = 'force-dynamic';
type Row = Record<string, unknown>;
type TablePolicy = { columns: string[]; export: string[] };
const approved = policy.tables as Record<string, TablePolicy>;
const allTables = Object.keys(approved).sort();
const businessTables = allTables.filter(name => approved[name].export.length > 0);
const encoder = new TextEncoder();
function quote(name: string) { if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Unknown SQL identifier'); return `"${name}"`; }
function failure(message: string, status = 503) { return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } }); }
function isApprovedKey(key: string) {
  return /^works\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key) || /^chatwork-trial\/[0-9a-f-]{36}\/(?:[0-9a-f]{32}|[0-9a-f-]{36})\/[0-9a-f]{64}$/.test(key);
}
async function listObjects() {
  if (!env.BUCKET) throw new Error('画像保存先が利用できません');
  const objects: Array<{ key: string; size: number; etag: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ cursor, limit: 1000 });
    for (const item of page.objects) {
      if (!isApprovedKey(item.key)) throw new Error(`未分類のR2キー: ${item.key}`);
      objects.push({ key: item.key, size: item.size, etag: item.etag });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects.sort((a,b) => a.key.localeCompare(b.key));
}
async function createExport() {
  if (!env.DB || !env.BUCKET) throw new Error('DBまたは画像保存先が利用できません');
  const before = await listObjects();
  const db = env.DB;
  const countsQuery = `SELECT ${allTables.map(name => `(SELECT COUNT(*) FROM ${quote(name)}) AS ${quote(name)}`).join(', ')}`;
  const statements: D1PreparedStatement[] = [
    db.prepare(`SELECT name, type, tbl_name AS tableName, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name NOT IN ('d1_migrations', '__drizzle_migrations', '__appgarden_migrations') ORDER BY type, name`),
    db.prepare(countsQuery),
  ];
  for (const table of allTables) {
    statements.push(db.prepare(`PRAGMA table_xinfo(${quote(table)})`));
    statements.push(db.prepare(`PRAGMA foreign_key_list(${quote(table)})`));
  }
  for (const table of businessTables) {
    statements.push(db.prepare(`SELECT ${approved[table].export.map(quote).join(', ')} FROM ${quote(table)} ORDER BY rowid`));
  }
  const results = await db.batch(statements);
  const schema = results[0].results as Row[];
  const found = schema.filter(row => row.type === 'table').map(row => String(row.name)).sort();
  if (JSON.stringify(found) !== JSON.stringify(allTables)) throw new Error(`DBのテーブルが許可リストと異なります: ${found.join(', ')}`);
  const countRow = results[1].results[0] as Row;
  const counts = new Map(allTables.map(name => [name, Number(countRow[name])]));
  const tableInfo: Row[] = [];
  let position = 2;
  for (const table of allTables) {
    const columns = results[position++].results as Row[];
    const foreignKeys = results[position++].results as Row[];
    const expected = [...approved[table].columns].sort();
    const actual = columns.filter(row => Number(row.hidden) === 0).map(row => String(row.name)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`未承認の列構造: ${table}`);
    const count = counts.get(table);
    if (!Number.isSafeInteger(count) || count! < 0) throw new Error(`件数が不正: ${table}`);
    const indexes = schema.filter(row => row.type === 'index' && row.tableName === table);
    tableInfo.push({ name: table, columns, foreignKeys, indexes, count, classification: businessTables.includes(table) ? 'business-data' : 'schema-and-count-only', omittedColumns: approved[table].columns.filter(name => !approved[table].export.includes(name)) });
  }
  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  const definitions = schema.filter(row => typeof row.sql === 'string').sort((a,b) => (a.type === 'table' ? 0 : 1) - (b.type === 'table' ? 0 : 1));
  files.push({ name: 'schema/schema.sql', bytes: encoder.encode(definitions.map(row => `${String(row.sql).replace(/;\s*$/, '')};`).join('\n\n') + '\n') });
  files.push({ name: 'schema/tables.json', bytes: encoder.encode(JSON.stringify(tableInfo, null, 2) + '\n') });
  const exportedRows: Record<string, number> = {};
  for (const [index, table] of businessTables.entries()) {
    const rows = results[position + index].results as Row[];
    if (rows.length !== counts.get(table)) throw new Error(`不完全な取得: ${table}`);
    exportedRows[table] = rows.length;
    files.push({ name: `data/${table}.jsonl`, bytes: encoder.encode(rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')) });
  }
  const timestamp = new Date().toISOString();
  const filename = `kiiya-cleaning-${timestamp.replace(/[:.]/g, '-')}.zip`;
  async function* entries() {
    const fileHashes: Array<{ path: string; size: number; sha256: string }> = [];
    const assets: Array<{ originalKey: string; archivePath: string; size: number; mime: string | null; etag: string }> = [];
    for (const file of files) {
      fileHashes.push({ path: file.name, size: file.bytes.length, sha256: await sha256(file.bytes) });
      yield file;
    }
    for (const [index, item] of before.entries()) {
      const object = await env.BUCKET!.get(item.key);
      if (!object || object.etag !== item.etag || object.size !== item.size) throw new Error(`画像が取得中に変更されました: ${item.key}`);
      const bytes = new Uint8Array(await object.arrayBuffer());
      const archivePath = `assets/${String(index + 1).padStart(6, '0')}.bin`;
      fileHashes.push({ path: archivePath, size: bytes.length, sha256: await sha256(bytes) });
      assets.push({ originalKey: item.key, archivePath, size: bytes.length, mime: object.httpMetadata?.contentType ?? null, etag: item.etag });
      yield { name: archivePath, bytes };
    }
    if (JSON.stringify(before) !== JSON.stringify(await listObjects())) throw new Error('R2一覧が取得中に変更されました');
    const manifest = { formatVersion: 1, exportId: crypto.randomUUID(), siteUrl: env.APP_ORIGIN?.trim() || 'https://kiiya-cleaning-checker.hherocl278.chatgpt.site', generatedAt: timestamp, policyVersion: policy.version, snapshotMethod: 'single D1 batch transaction; R2 object bytes verified against two listings and ETag/size', tables: tableInfo.map(row => ({ name: row.name, count: row.count, classification: row.classification, exportedRows: exportedRows[String(row.name)] ?? 0, omittedColumns: row.omittedColumns })), assets, files: fileHashes, complete: true };
    yield { name: 'manifest.json', bytes: encoder.encode(JSON.stringify(manifest, null, 2) + '\n') };
  }
  return new Response(streamedZip(entries()), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export async function GET() {
  const user = await getAuthenticatedUser();
  const id = user?.userId ?? null;
  if (!id) return failure('サインインしてください', 401);
  if (!env.DB) return failure('DBを利用できません');
  const account = await env.DB.prepare('SELECT role, active FROM app_users WHERE id=?').bind(id).first<{ role: string; active: number }>();
  if (!account?.active || account.role !== 'field' || id !== env.APP_ADMIN_USER_ID) return failure('アプリ管理者のみ利用できます', 403);
  try {
    await env.DB.prepare('INSERT INTO chatwork_production_audit (id,actor_id,action,detail_json,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), id, 'business_export_started', '{}', new Date().toISOString()).run();
    return await createExport();
  } catch (cause) {
    console.error('KIIYA export failed', cause);
    return failure(cause instanceof Error ? cause.message : 'エクスポートに失敗しました');
  }
}
