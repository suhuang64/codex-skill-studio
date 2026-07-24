import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Project, Skill, Source } from './types.js'

const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()

export class Store {
  db: DatabaseSync
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT UNIQUE NOT NULL,skills_dir TEXT NOT NULL,group_id TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT UNIQUE NOT NULL,mode TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,relative_path TEXT NOT NULL,path TEXT UNIQUE NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,alias TEXT NOT NULL,tags TEXT NOT NULL DEFAULT '[]',favorite INTEGER NOT NULL DEFAULT 0,fingerprint TEXT NOT NULL,last_seen TEXT NOT NULL,available INTEGER NOT NULL DEFAULT 1,FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS project_groups(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,color TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bundles(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,description TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bundle_skills(bundle_id TEXT NOT NULL,skill_id TEXT NOT NULL,PRIMARY KEY(bundle_id,skill_id),FOREIGN KEY(bundle_id) REFERENCES bundles(id) ON DELETE CASCADE,FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS project_bundles(project_id TEXT NOT NULL,bundle_id TEXT NOT NULL,PRIMARY KEY(project_id,bundle_id),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,FOREIGN KEY(bundle_id) REFERENCES bundles(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL,undone_at TEXT);
    `)
  }
  all<T>(sql: string, ...params: any[]) {
    return this.db.prepare(sql).all(...params) as T[]
  }
  get<T>(sql: string, ...params: any[]) {
    return this.db.prepare(sql).get(...params) as T | undefined
  }
  run(sql: string, ...params: any[]) {
    return this.db.prepare(sql).run(...params)
  }
  projects(): Project[] {
    return this.all<any>('SELECT * FROM projects ORDER BY name').map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      skillsDir: r.skills_dir,
      groupId: r.group_id,
      createdAt: r.created_at,
    }))
  }
  sources(): Source[] {
    return this.all<any>('SELECT * FROM sources ORDER BY name').map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      mode: r.mode,
      createdAt: r.created_at,
    }))
  }
  skills(): Skill[] {
    return this.all<any>('SELECT * FROM skills ORDER BY favorite DESC,name').map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      relativePath: r.relative_path,
      path: r.path,
      name: r.name,
      description: r.description,
      alias: r.alias,
      tags: JSON.parse(r.tags),
      favorite: !!r.favorite,
      fingerprint: r.fingerprint,
      lastSeen: r.last_seen,
      available: !!r.available,
    }))
  }
  addProject(input: { name: string; path: string; skillsDir: string }) {
    const row = { id: id(), ...input, createdAt: now() }
    this.run(
      'INSERT INTO projects VALUES(?,?,?,?,NULL,?)',
      row.id,
      row.name,
      row.path,
      row.skillsDir,
      row.createdAt,
    )
    return row
  }
  addSource(input: { name: string; path: string; mode: string }) {
    const row = { id: id(), ...input, createdAt: now() }
    this.run(
      'INSERT INTO sources VALUES(?,?,?,?,?)',
      row.id,
      row.name,
      row.path,
      row.mode,
      row.createdAt,
    )
    return row
  }
  upsertSkill(s: Omit<Skill, 'tags' | 'favorite'>) {
    const old = this.get<any>('SELECT id,tags,favorite,alias FROM skills WHERE path=?', s.path)
    const sid = old?.id ?? s.id
    this.run(
      `INSERT INTO skills(id,source_id,relative_path,path,name,description,alias,tags,favorite,fingerprint,last_seen,available) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET source_id=excluded.source_id,relative_path=excluded.relative_path,name=excluded.name,description=excluded.description,fingerprint=excluded.fingerprint,last_seen=excluded.last_seen,available=1`,
      sid,
      s.sourceId,
      s.relativePath,
      s.path,
      s.name,
      s.description,
      old?.alias || s.alias,
      old?.tags || '[]',
      old?.favorite || 0,
      s.fingerprint,
      s.lastSeen,
      s.available ? 1 : 0,
    )
  }
  history() {
    return this.all<any>('SELECT * FROM operations ORDER BY created_at DESC LIMIT 100').map(
      (r) => ({ ...r, details: JSON.parse(r.details) }),
    )
  }
  record(kind: string, status: string, details: unknown) {
    const oid = id()
    this.run(
      'INSERT INTO operations VALUES(?,?,?,?,?,NULL)',
      oid,
      kind,
      status,
      JSON.stringify(details),
      now(),
    )
    return oid
  }
  groups() {
    return this.all<any>('SELECT * FROM project_groups ORDER BY name')
  }
  bundles() {
    return this.all<any>(`SELECT b.* FROM bundles b ORDER BY b.name`).map((r) => ({
      ...r,
      skillIds: this.all<any>('SELECT skill_id FROM bundle_skills WHERE bundle_id=?', r.id).map(
        (x) => x.skill_id,
      ),
      projectIds: this.all<any>(
        'SELECT project_id FROM project_bundles WHERE bundle_id=?',
        r.id,
      ).map((x) => x.project_id),
    }))
  }
}
