import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { execFile } from 'node:child_process'
import { access, realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { basename, join, resolve } from 'node:path'
import { z } from 'zod'
import { Store } from './db.js'
import { audit, applyPlan, makePlan, status, undo } from './linker.js'
import { isDirectory, scanSource } from './scanner.js'
import type { Plan, Source } from './types.js'

const run = promisify(execFile)
const pathInput = z.object({ path: z.string().min(1), name: z.string().trim().optional() })
export function createApp(store: Store, options: { staticRoot?: string } = {}) {
  const app = Fastify({ logger: false })
  const plans = new Map<string, Plan>()
  app.setErrorHandler((error, _req, reply) =>
    reply
      .code((error as any).statusCode || 400)
      .send({ error: error instanceof Error ? error.message : String(error) }),
  )
  app.get('/api/bootstrap', async () => ({
    projects: store.projects(),
    sources: store.sources(),
    skills: store.skills(),
    groups: store.groups(),
    bundles: store.bundles(),
    history: store.history(),
    audit: await audit(store),
  }))
  app.post('/api/dialog/directory', async (req) => {
    const title = String((req.body as any)?.title || '选择目录').replace(/["\\]/g, '')
    try {
      const { stdout } = await run('/usr/bin/osascript', [
        '-e',
        `POSIX path of (choose folder with prompt "${title}")`,
      ])
      return { path: stdout.trim().replace(/\/$/, '') }
    } catch {
      return { cancelled: true }
    }
  })
  app.post('/api/projects', async (req) => {
    const input = pathInput.parse(req.body)
    const path = await realpath(input.path)
    if (!(await isDirectory(path))) throw new Error('项目路径不是目录')
    return store.addProject({
      name: input.name || basename(path),
      path,
      skillsDir: join(path, '.codex', 'skills'),
    })
  })
  app.delete('/api/projects/:id', async (req) => {
    store.run('DELETE FROM projects WHERE id=?', (req.params as any).id)
    return { ok: true }
  })
  app.post('/api/sources', async (req) => {
    const input = pathInput.extend({ mode: z.enum(['single', 'pack']) }).parse(req.body)
    const path = await realpath(input.path)
    if (!(await isDirectory(path))) throw new Error('技能源路径不是目录')
    if (input.mode === 'single') await access(join(path, 'SKILL.md'))
    const source = store.addSource({ name: input.name || basename(path), path, mode: input.mode })
    const count = await scanSource(store, source as any)
    return { source, count }
  })
  app.delete('/api/sources/:id', async (req) => {
    store.run('DELETE FROM sources WHERE id=?', (req.params as any).id)
    return { ok: true }
  })
  app.post('/api/scan', async () => {
    let count = 0
    for (const s of store.sources())
      try {
        count += await scanSource(store, s)
      } catch {
        store.run('UPDATE skills SET available=0 WHERE source_id=?', s.id)
      }
    return { count }
  })
  app.patch('/api/skills/:id', async (req) => {
    const body = z
      .object({
        alias: z.string().trim().min(1).optional(),
        favorite: z.boolean().optional(),
        tags: z.array(z.string().trim().min(1)).optional(),
      })
      .parse(req.body)
    const sid = (req.params as any).id
    if (body.alias) store.run('UPDATE skills SET alias=? WHERE id=?', body.alias, sid)
    if (body.favorite !== undefined)
      store.run('UPDATE skills SET favorite=? WHERE id=?', body.favorite ? 1 : 0, sid)
    if (body.tags) store.run('UPDATE skills SET tags=? WHERE id=?', JSON.stringify(body.tags), sid)
    return { ok: true }
  })
  app.get('/api/projects/:id/status', async (req) => {
    const project = store.projects().find((p) => p.id === (req.params as any).id)
    if (!project) throw new Error('项目不存在')
    return Promise.all(store.skills().map(async (s) => ({ ...s, ...(await status(project, s)) })))
  })
  app.post('/api/plans', async (req) => {
    const body = z
      .object({
        projectIds: z.array(z.string()).min(1),
        skillIds: z.array(z.string()).min(1),
        action: z.enum(['link', 'replace', 'remove']),
        bundleId: z.string().optional(),
      })
      .parse(req.body)
    const plan = await makePlan(store, body.projectIds, body.skillIds, body.action)
    plan.bundleId = body.bundleId
    plans.set(plan.id, plan)
    return plan
  })
  app.post('/api/plans/:id/apply', async (req) => {
    const plan = plans.get((req.params as any).id)
    if (!plan) throw new Error('变更计划已过期')
    const result = await applyPlan(store, plan)
    if (plan.bundleId)
      for (const pid of plan.projectIds || [])
        store.run('INSERT OR IGNORE INTO project_bundles VALUES(?,?)', pid, plan.bundleId)
    plans.delete(plan.id)
    return result
  })
  app.post('/api/operations/:id/undo', async (req) => {
    await undo(store, (req.params as any).id)
    return { ok: true }
  })
  app.post('/api/groups', async (req) => {
    const b = z
      .object({
        name: z.string().trim().min(1),
        color: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .default('#007AFF'),
      })
      .parse(req.body)
    const id = crypto.randomUUID()
    store.run(
      'INSERT INTO project_groups VALUES(?,?,?,?)',
      id,
      b.name,
      b.color,
      new Date().toISOString(),
    )
    return { id, ...b }
  })
  app.patch('/api/groups/:id', async (req) => {
    const id = (req.params as any).id
    const group = store.get<any>('SELECT id FROM project_groups WHERE id=?', id)
    if (!group) throw new Error('项目组不存在')
    const body = z
      .object({
        name: z.string().trim().min(1),
        color: z.string().regex(/^#[0-9a-f]{6}$/i),
      })
      .parse(req.body)
    store.run('UPDATE project_groups SET name=?,color=? WHERE id=?', body.name, body.color, id)
    return { id, ...body }
  })
  app.delete('/api/groups/:id', async (req) => {
    const id = (req.params as any).id
    const group = store.get<any>('SELECT id FROM project_groups WHERE id=?', id)
    if (!group) throw new Error('项目组不存在')
    store.db.exec('BEGIN')
    try {
      store.run('UPDATE projects SET group_id=NULL WHERE group_id=?', id)
      store.run('DELETE FROM project_groups WHERE id=?', id)
      store.db.exec('COMMIT')
    } catch (error) {
      store.db.exec('ROLLBACK')
      throw error
    }
    return { ok: true }
  })
  app.patch('/api/projects/:id/group', async (req) => {
    const groupId = z.object({ groupId: z.string().nullable() }).parse(req.body).groupId
    if (groupId && !store.get('SELECT id FROM project_groups WHERE id=?', groupId))
      throw new Error('项目组不存在')
    store.run('UPDATE projects SET group_id=? WHERE id=?', groupId, (req.params as any).id)
    return { ok: true }
  })
  app.post('/api/bundles', async (req) => {
    const b = z
      .object({
        name: z.string().trim().min(1),
        description: z.string().default(''),
        skillIds: z.array(z.string()).default([]),
      })
      .parse(req.body)
    const id = crypto.randomUUID()
    store.db.exec('BEGIN')
    try {
      store.run(
        'INSERT INTO bundles VALUES(?,?,?,?)',
        id,
        b.name,
        b.description,
        new Date().toISOString(),
      )
      for (const sid of b.skillIds) store.run('INSERT INTO bundle_skills VALUES(?,?)', id, sid)
      store.db.exec('COMMIT')
    } catch (e) {
      store.db.exec('ROLLBACK')
      throw e
    }
    return { id, ...b }
  })
  app.delete('/api/bundles/:id', async (req) => {
    store.run('DELETE FROM bundles WHERE id=?', (req.params as any).id)
    return { ok: true }
  })
  app.delete('/api/bundles/:bundleId/projects/:projectId', async (req) => {
    const p = req.params as any
    store.run(
      'DELETE FROM project_bundles WHERE bundle_id=? AND project_id=?',
      p.bundleId,
      p.projectId,
    )
    return { ok: true }
  })
  app.get('/api/export', async () => {
    const projects = store.projects()
    const skills = store.skills()
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      projects,
      sources: store.sources(),
      groups: store.groups(),
      bundles: store.bundles().map((bundle) => ({
        ...bundle,
        skillPaths: bundle.skillIds
          .map((id: string) => skills.find((skill) => skill.id === id)?.path)
          .filter((path: string | undefined): path is string => Boolean(path)),
        projectPaths: bundle.projectIds
          .map((id: string) => projects.find((project) => project.id === id)?.path)
          .filter((path: string | undefined): path is string => Boolean(path)),
      })),
      skillPreferences: skills.map(({ id, path, alias, tags, favorite }) => ({
        id,
        path,
        alias,
        tags,
        favorite,
      })),
    }
  })
  app.post('/api/import', async (req) => {
    const body = req.body as any
    if (!body || body.version !== 1) throw new Error('不支持的配置格式')
    const counts = { groups: 0, projects: 0, sources: 0, preferences: 0, bundles: 0 }
    const groupIds = new Map<string, string>()
    const projectIds = new Map<string, string>()
    for (const group of body.groups || []) {
      let current = store.get<any>('SELECT id FROM project_groups WHERE name=?', group.name)
      if (!current) {
        const id = crypto.randomUUID()
        store.run(
          'INSERT INTO project_groups VALUES(?,?,?,?)',
          id,
          group.name,
          group.color || '#007AFF',
          new Date().toISOString(),
        )
        current = { id }
        counts.groups++
      }
      if (group.id) groupIds.set(group.id, current.id)
    }
    for (const project of body.projects || []) {
      let current = store.get<any>('SELECT id FROM projects WHERE path=?', project.path)
      if (!current) {
        const added = store.addProject({
          name: project.name,
          path: project.path,
          skillsDir: project.skillsDir || join(project.path, '.codex', 'skills'),
        })
        current = { id: added.id }
        counts.projects++
      }
      if (project.id) projectIds.set(project.id, current.id)
      const groupId = groupIds.get(project.groupId)
      if (groupId) store.run('UPDATE projects SET group_id=? WHERE id=?', groupId, current.id)
    }
    for (const sourceInput of body.sources || []) {
      const existing = store.sources().find((item) => item.path === sourceInput.path)
      const source: Source =
        existing ||
        (store.addSource({
          name: sourceInput.name,
          path: sourceInput.path,
          mode: sourceInput.mode,
        }) as Source)
      if (!existing) counts.sources++
      try {
        await scanSource(store, source)
      } catch {
        store.run('UPDATE skills SET available=0 WHERE source_id=?', source.id)
      }
    }
    const preferenceIds = new Map<string, string>()
    for (const preference of body.skillPreferences || []) {
      const skill = store.skills().find((item) => item.path === preference.path)
      if (!skill) continue
      store.run(
        'UPDATE skills SET alias=?,tags=?,favorite=? WHERE id=?',
        preference.alias || skill.alias,
        JSON.stringify(Array.isArray(preference.tags) ? preference.tags : []),
        preference.favorite ? 1 : 0,
        skill.id,
      )
      if (preference.id) preferenceIds.set(preference.id, skill.id)
      counts.preferences++
    }
    const currentSkills = store.skills()
    const currentProjects = store.projects()
    for (const bundleInput of body.bundles || []) {
      let bundle = store.get<any>('SELECT id FROM bundles WHERE name=?', bundleInput.name)
      if (!bundle) {
        const id = crypto.randomUUID()
        store.run(
          'INSERT INTO bundles VALUES(?,?,?,?)',
          id,
          bundleInput.name,
          bundleInput.description || '',
          new Date().toISOString(),
        )
        bundle = { id }
        counts.bundles++
      }
      const skillIds = (bundleInput.skillPaths || [])
        .map((path: string) => currentSkills.find((skill) => skill.path === path)?.id)
        .filter(Boolean)
      for (const oldId of bundleInput.skillIds || []) {
        const mapped = preferenceIds.get(oldId)
        if (mapped && !skillIds.includes(mapped)) skillIds.push(mapped)
      }
      for (const skillId of skillIds)
        store.run('INSERT OR IGNORE INTO bundle_skills VALUES(?,?)', bundle.id, skillId)
      const importedProjectIds = (bundleInput.projectPaths || [])
        .map((path: string) => currentProjects.find((project) => project.path === path)?.id)
        .filter(Boolean)
      for (const oldId of bundleInput.projectIds || []) {
        const mapped = projectIds.get(oldId)
        if (mapped && !importedProjectIds.includes(mapped)) importedProjectIds.push(mapped)
      }
      for (const projectId of importedProjectIds)
        store.run('INSERT OR IGNORE INTO project_bundles VALUES(?,?)', projectId, bundle.id)
    }
    return { added: Object.values(counts).reduce((sum, count) => sum + count, 0), counts }
  })
  if (options.staticRoot)
    app
      .register(fastifyStatic, { root: resolve(options.staticRoot), wildcard: false })
      .after(() =>
        app.setNotFoundHandler((req, reply) =>
          req.url.startsWith('/api')
            ? reply.code(404).send({ error: '接口不存在' })
            : reply.sendFile('index.html'),
        ),
      )
  return app
}
