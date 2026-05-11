import { mkdir, readFile } from 'fs/promises';
import path from 'path';
import { Script, Topic, Tutorial, VideoAsset, VideoProject, VideoScene, RenderJob, QualityReview, UserAccount, UserSession, AuditLog } from './types';
import { resolveAppPath, resolveDataPath } from './runtime/paths';

type SqliteValue = string | number | bigint | Uint8Array | null;
type DatabaseSyncConstructor = new (path: string) => any;

const dbPath = resolveDataPath('video-factory.sqlite');
let db: any | null = null;
let sqliteUnavailable = false;
let ready = false;

type TableName = 'tutorials' | 'topics' | 'scripts' | 'video_projects' | 'video_scenes' | 'video_assets' | 'render_jobs' | 'quality_reviews' | 'users' | 'sessions' | 'audit_logs';
type TableConfig<T> = {
  file: string;
  createSql: string;
  selectSql: string;
  insertSql: string;
  fromRow: (row: any) => T;
  toParams: (item: T, rowOrder: number) => SqliteValue[];
};

const tables: Record<TableName, TableConfig<any>> = {
  tutorials: {
    file: 'data/tutorials.json',
    createSql: 'CREATE TABLE IF NOT EXISTS tutorials (id TEXT PRIMARY KEY,row_order INTEGER NOT NULL,owner_user_id TEXT,title TEXT NOT NULL,source_type TEXT NOT NULL,source_file TEXT,raw_content TEXT NOT NULL,summary TEXT NOT NULL,target_audience_json TEXT NOT NULL,scenarios_json TEXT NOT NULL,tools_json TEXT NOT NULL,methods_json TEXT NOT NULL,steps_json TEXT NOT NULL,key_quotes_json TEXT NOT NULL,risks_json TEXT NOT NULL,categories_json TEXT NOT NULL,tags_json TEXT NOT NULL,short_video_score INTEGER NOT NULL,priority TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)',
    selectSql: 'SELECT * FROM tutorials ORDER BY row_order ASC',
    insertSql: 'INSERT INTO tutorials (id,row_order,owner_user_id,title,source_type,source_file,raw_content,summary,target_audience_json,scenarios_json,tools_json,methods_json,steps_json,key_quotes_json,risks_json,categories_json,tags_json,short_video_score,priority,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    fromRow: (r): Tutorial => ({ id: r.id, ownerUserId: r.owner_user_id ?? undefined, title: r.title, sourceType: r.source_type, sourceFile: r.source_file ?? undefined, rawContent: r.raw_content, summary: r.summary, targetAudience: JSON.parse(r.target_audience_json), scenarios: JSON.parse(r.scenarios_json), tools: JSON.parse(r.tools_json), methods: JSON.parse(r.methods_json), steps: JSON.parse(r.steps_json), keyQuotes: JSON.parse(r.key_quotes_json), risks: JSON.parse(r.risks_json), categories: JSON.parse(r.categories_json), tags: JSON.parse(r.tags_json), shortVideoScore: r.short_video_score, priority: r.priority, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at }),
    toParams: (i: Tutorial, o) => [i.id, o, i.ownerUserId ?? null, i.title, i.sourceType, i.sourceFile ?? null, i.rawContent, i.summary, JSON.stringify(i.targetAudience), JSON.stringify(i.scenarios), JSON.stringify(i.tools), JSON.stringify(i.methods), JSON.stringify(i.steps), JSON.stringify(i.keyQuotes), JSON.stringify(i.risks), JSON.stringify(i.categories), JSON.stringify(i.tags), i.shortVideoScore, i.priority, i.status, i.createdAt, i.updatedAt]
  },
  topics: {
    file: 'data/topics.json',
    createSql: 'CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY,row_order INTEGER NOT NULL,owner_user_id TEXT,tutorial_id TEXT NOT NULL,title TEXT NOT NULL,angle TEXT NOT NULL,hook_type TEXT NOT NULL,pain_point TEXT NOT NULL,audience TEXT NOT NULL,platform_fit_json TEXT NOT NULL,viral_score INTEGER NOT NULL,created_at TEXT NOT NULL)',
    selectSql: 'SELECT * FROM topics ORDER BY row_order ASC',
    insertSql: 'INSERT INTO topics (id,row_order,owner_user_id,tutorial_id,title,angle,hook_type,pain_point,audience,platform_fit_json,viral_score,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    fromRow: (r): Topic => ({ id: r.id, ownerUserId: r.owner_user_id ?? undefined, tutorialId: r.tutorial_id, title: r.title, angle: r.angle, hookType: r.hook_type, painPoint: r.pain_point, audience: r.audience, platformFit: JSON.parse(r.platform_fit_json), viralScore: r.viral_score, createdAt: r.created_at }),
    toParams: (i: Topic, o) => [i.id, o, i.ownerUserId ?? null, i.tutorialId, i.title, i.angle, i.hookType, i.painPoint, i.audience, JSON.stringify(i.platformFit), i.viralScore, i.createdAt]
  },
  scripts: {
    file: 'data/scripts.json',
    createSql: 'CREATE TABLE IF NOT EXISTS scripts (id TEXT PRIMARY KEY,row_order INTEGER NOT NULL,owner_user_id TEXT,topic_id TEXT NOT NULL,tutorial_id TEXT NOT NULL,platform TEXT NOT NULL,duration TEXT NOT NULL,title TEXT NOT NULL,hook TEXT NOT NULL,body TEXT NOT NULL,cta TEXT NOT NULL,style TEXT NOT NULL,created_at TEXT NOT NULL,version INTEGER,source_script_id TEXT)',
    selectSql: 'SELECT * FROM scripts ORDER BY row_order ASC',
    insertSql: 'INSERT INTO scripts (id,row_order,owner_user_id,topic_id,tutorial_id,platform,duration,title,hook,body,cta,style,created_at,version,source_script_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    fromRow: (r): Script => ({ id: r.id, ownerUserId: r.owner_user_id ?? undefined, topicId: r.topic_id, tutorialId: r.tutorial_id, platform: r.platform, duration: r.duration, title: r.title, hook: r.hook, body: r.body, cta: r.cta, style: r.style, createdAt: r.created_at, version: typeof r.version === 'number' ? r.version : undefined, sourceScriptId: r.source_script_id ?? undefined }),
    toParams: (i: Script, o) => [i.id, o, i.ownerUserId ?? null, i.topicId, i.tutorialId, i.platform, i.duration, i.title, i.hook, i.body, i.cta, i.style, i.createdAt, i.version ?? null, i.sourceScriptId ?? null]
  },
  video_projects: {
    file: 'data/video-projects.json',
    createSql: 'CREATE TABLE IF NOT EXISTS video_projects (id TEXT PRIMARY KEY,row_order INTEGER NOT NULL,owner_user_id TEXT,tutorial_id TEXT NOT NULL,topic_id TEXT NOT NULL,script_id TEXT NOT NULL,status TEXT NOT NULL,template TEXT NOT NULL,title TEXT NOT NULL,aspect_ratio TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,output_path TEXT,last_error TEXT,last_render_attempt_at TEXT,visual_preset TEXT,publish_score INTEGER,publish_tier TEXT,ops_status TEXT,ops_updated_at TEXT)',
    selectSql: 'SELECT * FROM video_projects ORDER BY row_order ASC',
    insertSql: 'INSERT INTO video_projects (id,row_order,owner_user_id,tutorial_id,topic_id,script_id,status,template,title,aspect_ratio,created_at,updated_at,output_path,last_error,last_render_attempt_at,visual_preset,publish_score,publish_tier,ops_status,ops_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    fromRow: (r): VideoProject => ({ id: r.id, ownerUserId: r.owner_user_id ?? undefined, tutorialId: r.tutorial_id, topicId: r.topic_id, scriptId: r.script_id, status: r.status, template: r.template, title: r.title, aspectRatio: r.aspect_ratio, createdAt: r.created_at, updatedAt: r.updated_at, outputPath: r.output_path ?? undefined, lastError: r.last_error ?? undefined, lastRenderAttemptAt: r.last_render_attempt_at ?? undefined, visualPreset: r.visual_preset ?? undefined, publishScore: typeof r.publish_score === 'number' ? r.publish_score : undefined, publishTier: r.publish_tier ?? undefined, opsStatus: r.ops_status ?? undefined, opsUpdatedAt: r.ops_updated_at ?? undefined }),
    toParams: (i: VideoProject, o) => [i.id, o, i.ownerUserId ?? null, i.tutorialId, i.topicId, i.scriptId, i.status, i.template, i.title, i.aspectRatio, i.createdAt, i.updatedAt, i.outputPath ?? null, i.lastError ?? null, i.lastRenderAttemptAt ?? null, i.visualPreset ?? null, i.publishScore ?? null, i.publishTier ?? null, i.opsStatus ?? null, i.opsUpdatedAt ?? null]
  },
  video_scenes: {
    file: 'data/video-scenes.json',
    createSql: 'CREATE TABLE IF NOT EXISTS video_scenes (id TEXT PRIMARY KEY,row_order INTEGER NOT NULL,project_id TEXT NOT NULL,scene_order INTEGER NOT NULL,shot_type TEXT NOT NULL,visual_type TEXT NOT NULL,visual_prompt TEXT NOT NULL,voiceover TEXT NOT NULL,subtitle TEXT NOT NULL,duration_sec INTEGER NOT NULL,layout TEXT,headline TEXT,emphasis TEXT,keywords_json TEXT,cards_json TEXT,chart_data_json TEXT,transition TEXT)',
    selectSql: 'SELECT * FROM video_scenes ORDER BY row_order ASC',
    insertSql: 'INSERT INTO video_scenes (id,row_order,project_id,scene_order,shot_type,visual_type,visual_prompt,voiceover,subtitle,duration_sec,layout,headline,emphasis,keywords_json,cards_json,chart_data_json,transition) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    fromRow: (r): VideoScene => ({
      id: r.id,
      projectId: r.project_id,
      order: r.scene_order,
      shotType: r.shot_type,
      visualType: r.visual_type,
      visualPrompt: r.visual_prompt,
      voiceover: r.voiceover,
      subtitle: r.subtitle,
      durationSec: r.duration_sec,
      layout: r.layout ?? undefined,
      headline: r.headline ?? undefined,
      emphasis: r.emphasis ?? undefined,
      keywords: r.keywords_json ? JSON.parse(r.keywords_json) : undefined,
      cards: r.cards_json ? JSON.parse(r.cards_json) : undefined,
      chartData: r.chart_data_json ? JSON.parse(r.chart_data_json) : undefined,
      transition: r.transition ?? undefined
    }),
    toParams: (i: VideoScene, o) => [
      i.id,
      o,
      i.projectId,
      i.order,
      i.shotType,
      i.visualType,
      i.visualPrompt,
      i.voiceover,
      i.subtitle,
      i.durationSec,
      i.layout ?? null,
      i.headline ?? null,
      i.emphasis ?? null,
      i.keywords?.length ? JSON.stringify(i.keywords) : null,
      i.cards?.length ? JSON.stringify(i.cards) : null,
      i.chartData?.length ? JSON.stringify(i.chartData) : null,
      i.transition ?? null
    ]
  },
  video_assets: {
    file: 'data/video-assets.json',
    createSql: 'CREATE TABLE IF NOT EXISTS video_assets (id TEXT PRIMARY KEY,row_order INTEGER NOT NULL,project_id TEXT NOT NULL,scene_id TEXT NOT NULL,asset_type TEXT NOT NULL,path TEXT NOT NULL,status TEXT NOT NULL)',
    selectSql: 'SELECT * FROM video_assets ORDER BY row_order ASC',
    insertSql: 'INSERT INTO video_assets (id,row_order,project_id,scene_id,asset_type,path,status) VALUES (?,?,?,?,?,?,?)',
    fromRow: (r): VideoAsset => ({ id: r.id, projectId: r.project_id, sceneId: r.scene_id, assetType: r.asset_type, path: r.path, status: r.status }),
    toParams: (i: VideoAsset, o) => [i.id, o, i.projectId, i.sceneId, i.assetType, i.path, i.status]
  },
  render_jobs: {
    file: 'data/render-jobs.json',
    createSql: 'CREATE TABLE IF NOT EXISTS render_jobs (id TEXT PRIMARY KEY,row_order INTEGER NOT NULL,owner_user_id TEXT,credit_reservation_id TEXT,project_id TEXT NOT NULL,status TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 2,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,started_at TEXT,completed_at TEXT,error TEXT,output_path TEXT,stage TEXT,progress INTEGER)',
    selectSql: 'SELECT * FROM render_jobs ORDER BY row_order ASC',
    insertSql: 'INSERT INTO render_jobs (id,row_order,owner_user_id,credit_reservation_id,project_id,status,attempt,max_attempts,created_at,updated_at,started_at,completed_at,error,output_path,stage,progress) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    fromRow: (r): RenderJob => ({ id: r.id, ownerUserId: r.owner_user_id ?? undefined, creditReservationId: r.credit_reservation_id ?? undefined, projectId: r.project_id, status: r.status, attempt: r.attempt ?? 0, maxAttempts: r.max_attempts ?? 2, createdAt: r.created_at, updatedAt: r.updated_at, startedAt: r.started_at ?? undefined, completedAt: r.completed_at ?? undefined, error: r.error ?? undefined, outputPath: r.output_path ?? undefined, stage: r.stage ?? undefined, progress: typeof r.progress === 'number' ? r.progress : undefined }),
    toParams: (i: RenderJob, o) => [i.id, o, i.ownerUserId ?? null, i.creditReservationId ?? null, i.projectId, i.status, i.attempt ?? 0, i.maxAttempts ?? 2, i.createdAt, i.updatedAt, i.startedAt ?? null, i.completedAt ?? null, i.error ?? null, i.outputPath ?? null, i.stage ?? null, i.progress ?? null]
  },
  quality_reviews: {
    file: 'data/quality-reviews.json',
    createSql: 'CREATE TABLE IF NOT EXISTS quality_reviews (id TEXT PRIMARY KEY,row_order INTEGER NOT NULL,project_id TEXT NOT NULL,reviewer TEXT NOT NULL,round TEXT NOT NULL,visual_score INTEGER NOT NULL,subtitle_score INTEGER NOT NULL,rhythm_score INTEGER NOT NULL,publish_decision TEXT NOT NULL,notes TEXT NOT NULL,issue_tags_json TEXT NOT NULL,recommendations_json TEXT NOT NULL,created_at TEXT NOT NULL)',
    selectSql: 'SELECT * FROM quality_reviews ORDER BY row_order ASC',
    insertSql: 'INSERT INTO quality_reviews (id,row_order,project_id,reviewer,round,visual_score,subtitle_score,rhythm_score,publish_decision,notes,issue_tags_json,recommendations_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    fromRow: (r): QualityReview => ({ id: r.id, projectId: r.project_id, reviewer: r.reviewer, round: r.round, visualScore: r.visual_score, subtitleScore: r.subtitle_score, rhythmScore: r.rhythm_score, publishDecision: r.publish_decision, notes: r.notes, issueTags: r.issue_tags_json ? JSON.parse(r.issue_tags_json) : [], recommendations: r.recommendations_json ? JSON.parse(r.recommendations_json) : [], createdAt: r.created_at }),
    toParams: (i: QualityReview, o) => [i.id, o, i.projectId, i.reviewer, i.round, i.visualScore, i.subtitleScore, i.rhythmScore, i.publishDecision, i.notes, JSON.stringify(i.issueTags ?? []), JSON.stringify(i.recommendations ?? []), i.createdAt]
  },
  users: {
    file: 'data/users.json',
    createSql: 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,row_order INTEGER NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,created_at TEXT NOT NULL,disabled_at TEXT,last_login_at TEXT,failed_login_attempts INTEGER,locked_until TEXT,must_change_password INTEGER)',
    selectSql: 'SELECT * FROM users ORDER BY row_order ASC',
    insertSql: 'INSERT INTO users (id,row_order,name,email,password_hash,role,created_at,disabled_at,last_login_at,failed_login_attempts,locked_until,must_change_password) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    fromRow: (r): UserAccount => ({ id: r.id, name: r.name, email: r.email, passwordHash: r.password_hash, role: r.role, createdAt: r.created_at, disabledAt: r.disabled_at ?? undefined, lastLoginAt: r.last_login_at ?? undefined, failedLoginAttempts: typeof r.failed_login_attempts === 'number' ? r.failed_login_attempts : undefined, lockedUntil: r.locked_until ?? undefined, mustChangePassword: Boolean(r.must_change_password) }),
    toParams: (i: UserAccount, o) => [i.id, o, i.name, i.email, i.passwordHash, i.role, i.createdAt, i.disabledAt ?? null, i.lastLoginAt ?? null, i.failedLoginAttempts ?? null, i.lockedUntil ?? null, i.mustChangePassword ? 1 : 0]
  },
  sessions: {
    file: 'data/sessions.json',
    createSql: 'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,row_order INTEGER NOT NULL,user_id TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL)',
    selectSql: 'SELECT * FROM sessions ORDER BY row_order ASC',
    insertSql: 'INSERT INTO sessions (id,row_order,user_id,created_at,expires_at) VALUES (?,?,?,?,?)',
    fromRow: (r): UserSession => ({ id: r.id, userId: r.user_id, createdAt: r.created_at, expiresAt: r.expires_at }),
    toParams: (i: UserSession, o) => [i.id, o, i.userId, i.createdAt, i.expiresAt]
  },
  audit_logs: {
    file: 'data/audit-logs.json',
    createSql: 'CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY,row_order INTEGER NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,actor_role TEXT NOT NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,summary TEXT NOT NULL,created_at TEXT NOT NULL)',
    selectSql: 'SELECT * FROM audit_logs ORDER BY row_order ASC',
    insertSql: 'INSERT INTO audit_logs (id,row_order,actor_id,actor_name,actor_role,action,target_type,target_id,summary,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    fromRow: (r): AuditLog => ({ id: r.id, actorId: r.actor_id, actorName: r.actor_name, actorRole: r.actor_role, action: r.action, targetType: r.target_type, targetId: r.target_id, summary: r.summary, createdAt: r.created_at }),
    toParams: (i: AuditLog, o) => [i.id, o, i.actorId, i.actorName, i.actorRole, i.action, i.targetType, i.targetId, i.summary, i.createdAt]
  }
};

async function loadDatabaseSync(): Promise<DatabaseSyncConstructor | null> {
  if (sqliteUnavailable) return null;
  try {
    const runtimeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    const sqlite = await runtimeImport('node:sqlite');
    return sqlite.DatabaseSync || null;
  } catch {
    sqliteUnavailable = true;
    return null;
  }
}

async function getDb() {
  if (!db) {
    const DatabaseSync = await loadDatabaseSync();
    if (!DatabaseSync) throw new Error('node:sqlite is not available in this runtime');
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
  }
  return db;
}

function tableFromPath(relativePath: string): TableName | null {
  const normalized = relativePath.replace(/\\/g, '/');
  for (const [name, table] of Object.entries(tables) as [TableName, TableConfig<any>][]) {
    if (table.file === normalized) return name;
  }
  return null;
}

function ensureOwnerColumn(database: any, tableName: 'tutorials' | 'topics') {
  const existingColumns = new Set((database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((row) => row.name));
  if (!existingColumns.has('owner_user_id')) database.exec(`ALTER TABLE ${tableName} ADD COLUMN owner_user_id TEXT`);
}

function ensureScriptColumns(database: any) {
  const existingColumns = new Set((database.prepare('PRAGMA table_info(scripts)').all() as Array<{ name: string }>).map((row) => row.name));
  if (!existingColumns.has('owner_user_id')) database.exec('ALTER TABLE scripts ADD COLUMN owner_user_id TEXT');
  if (!existingColumns.has('version')) database.exec('ALTER TABLE scripts ADD COLUMN version INTEGER');
  if (!existingColumns.has('source_script_id')) database.exec('ALTER TABLE scripts ADD COLUMN source_script_id TEXT');
}

function ensureVideoProjectColumns(database: any) {  const existingColumns = new Set((database.prepare('PRAGMA table_info(video_projects)').all() as Array<{ name: string }>).map((row) => row.name));
  if (!existingColumns.has('owner_user_id')) database.exec('ALTER TABLE video_projects ADD COLUMN owner_user_id TEXT');
  if (!existingColumns.has('visual_preset')) database.exec('ALTER TABLE video_projects ADD COLUMN visual_preset TEXT');
  if (!existingColumns.has('publish_score')) database.exec('ALTER TABLE video_projects ADD COLUMN publish_score INTEGER');
  if (!existingColumns.has('publish_tier')) database.exec('ALTER TABLE video_projects ADD COLUMN publish_tier TEXT');
  if (!existingColumns.has('ops_status')) database.exec("ALTER TABLE video_projects ADD COLUMN ops_status TEXT");
  if (!existingColumns.has('ops_updated_at')) database.exec("ALTER TABLE video_projects ADD COLUMN ops_updated_at TEXT");
}

function ensureVideoSceneColumns(database: any) {
  const existingColumns = new Set((database.prepare('PRAGMA table_info(video_scenes)').all() as Array<{ name: string }>).map((row) => row.name));
  if (!existingColumns.has('layout')) database.exec('ALTER TABLE video_scenes ADD COLUMN layout TEXT');
  if (!existingColumns.has('headline')) database.exec('ALTER TABLE video_scenes ADD COLUMN headline TEXT');
  if (!existingColumns.has('emphasis')) database.exec('ALTER TABLE video_scenes ADD COLUMN emphasis TEXT');
  if (!existingColumns.has('keywords_json')) database.exec('ALTER TABLE video_scenes ADD COLUMN keywords_json TEXT');
  if (!existingColumns.has('cards_json')) database.exec('ALTER TABLE video_scenes ADD COLUMN cards_json TEXT');
  if (!existingColumns.has('chart_data_json')) database.exec('ALTER TABLE video_scenes ADD COLUMN chart_data_json TEXT');
  if (!existingColumns.has('transition')) database.exec('ALTER TABLE video_scenes ADD COLUMN transition TEXT');
}

function ensureQualityReviewColumns(database: any) {
  const existingColumns = new Set((database.prepare('PRAGMA table_info(quality_reviews)').all() as Array<{ name: string }>).map((row) => row.name));
  if (!existingColumns.has('issue_tags_json')) database.exec("ALTER TABLE quality_reviews ADD COLUMN issue_tags_json TEXT NOT NULL DEFAULT '[]'");
  if (!existingColumns.has('recommendations_json')) database.exec("ALTER TABLE quality_reviews ADD COLUMN recommendations_json TEXT NOT NULL DEFAULT '[]'");
}

function ensureRenderJobColumns(database: any) {
  const existingColumns = new Set((database.prepare('PRAGMA table_info(render_jobs)').all() as Array<{ name: string }>).map((row) => row.name));
  if (!existingColumns.has('owner_user_id')) database.exec('ALTER TABLE render_jobs ADD COLUMN owner_user_id TEXT');
  if (!existingColumns.has('credit_reservation_id')) database.exec('ALTER TABLE render_jobs ADD COLUMN credit_reservation_id TEXT');
  if (!existingColumns.has('attempt')) database.exec('ALTER TABLE render_jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0');
  if (!existingColumns.has('max_attempts')) database.exec('ALTER TABLE render_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 2');
  if (!existingColumns.has('stage')) database.exec('ALTER TABLE render_jobs ADD COLUMN stage TEXT');
  if (!existingColumns.has('progress')) database.exec('ALTER TABLE render_jobs ADD COLUMN progress INTEGER');
}

function ensureUserColumns(database: any) {
  const existingColumns = new Set((database.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((row) => row.name));
  if (existingColumns.has('password') && !existingColumns.has('password_hash')) database.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  if (!existingColumns.has('disabled_at')) database.exec('ALTER TABLE users ADD COLUMN disabled_at TEXT');
  if (!existingColumns.has('last_login_at')) database.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT');
  if (!existingColumns.has('failed_login_attempts')) database.exec('ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER');
  if (!existingColumns.has('locked_until')) database.exec('ALTER TABLE users ADD COLUMN locked_until TEXT');
  if (!existingColumns.has('must_change_password')) database.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER');
}

async function writeTable<T>(name: TableName, items: T[]) {  const database = await getDb();
  const table = tables[name];
  const insert = database.prepare(table.insertSql);
  database.exec('BEGIN');
  try {
    database.exec(`DELETE FROM ${name}`);
    items.forEach((item, index) => insert.run(...table.toParams(item, index)));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

async function readTable<T>(name: TableName): Promise<T[]> {
  const table = tables[name];
  const database = await getDb();
  return database.prepare(table.selectSql).all().map((row: any) => table.fromRow(row)) as T[];
}

async function readSeedJsonFile(relativePath: string) {
  try {
    return await readFile(resolveDataPath(relativePath), 'utf-8');
  } catch {
    return readFile(resolveAppPath(relativePath), 'utf-8');
  }
}

export async function ensureDatabaseReady() {
  if (ready) return;
  await mkdir(path.dirname(dbPath), { recursive: true });
  const database = await getDb();
  for (const table of Object.values(tables)) database.exec(table.createSql);
  ensureOwnerColumn(database, 'tutorials');
  ensureOwnerColumn(database, 'topics');
  ensureScriptColumns(database);
  ensureVideoProjectColumns(database);
  ensureVideoSceneColumns(database);
  ensureRenderJobColumns(database);
  ensureQualityReviewColumns(database);
  ensureUserColumns(database);
  for (const [name, table] of Object.entries(tables) as [TableName, TableConfig<any>][]) {
    const count = (database.prepare(`SELECT COUNT(*) as count FROM ${name}`).get() as { count: number }).count;
    if (count > 0) continue;
    try {
      const raw = await readSeedJsonFile(table.file);
      const items = JSON.parse(raw);
      if (Array.isArray(items) && items.length) await writeTable(name, items);
    } catch {}
  }
  ready = true;
}

export async function seedDatabaseFromJson(force = false) {
  await ensureDatabaseReady();
  const database = await getDb();
  for (const [name, table] of Object.entries(tables) as [TableName, TableConfig<any>][]) {
    try {
      const raw = await readSeedJsonFile(table.file);
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) continue;
      const count = (database.prepare(`SELECT COUNT(*) as count FROM ${name}`).get() as { count: number }).count;
      if (force || count === 0) await writeTable(name, items);
    } catch {}
  }
}

export async function readDbBackedJsonFile<T>(relativePath: string): Promise<T> {
  await ensureDatabaseReady();
  const table = tableFromPath(relativePath);
  if (!table) throw new Error(`Unsupported database-backed path: ${relativePath}`);
  return await readTable<T>(table) as T;
}

export async function writeDbBackedJsonFile<T>(relativePath: string, data: T): Promise<void> {
  await ensureDatabaseReady();
  const table = tableFromPath(relativePath);
  if (!table) throw new Error(`Unsupported database-backed path: ${relativePath}`);
  if (!Array.isArray(data)) throw new Error(`Expected array payload for ${relativePath}`);
  await writeTable(table, data);
}
