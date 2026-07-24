import { lstat, mkdir, readlink, readdir, rename, symlink, unlink } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { Store } from './db.js'
import type { AuditItem, LinkStatus, Plan, PlanItem, Project, Skill } from './types.js'

export async function status(
  project: Project,
  skill: Skill,
): Promise<{ status: LinkStatus; target: string; linkTarget?: string }> {
  const target = join(project.skillsDir, skill.alias)
  try {
    const st = await lstat(target)
    if (!st.isSymbolicLink()) return { status: 'conflict', target }
    const raw = await readlink(target)
    const actual = resolve(project.skillsDir, raw)
    try {
      await lstat(actual)
    } catch {
      return { status: 'broken', target, linkTarget: actual }
    }
    return {
      status: actual === resolve(skill.path) ? 'linked' : 'other_link',
      target,
      linkTarget: actual,
    }
  } catch {
    return { status: 'missing', target }
  }
}
export async function makePlan(
  store: Store,
  projectIds: string[],
  skillIds: string[],
  action: PlanItem['action'],
): Promise<Plan> {
  const projects = store.projects().filter((p) => projectIds.includes(p.id))
  const skills = store.skills().filter((s) => skillIds.includes(s.id))
  const items: PlanItem[] = []
  const warnings: string[] = []
  for (const p of projects)
    for (const s of skills) {
      const state = await status(p, s)
      if (action === 'link' && state.status !== 'missing') {
        warnings.push(`${p.name} / ${s.name}：目标不是空缺状态`)
        continue
      }
      if (action === 'replace' && !['other_link', 'broken'].includes(state.status)) {
        warnings.push(`${p.name} / ${s.name}：只有其他软链接或失效链接可替换`)
        continue
      }
      if (action === 'remove' && !['linked', 'other_link', 'broken'].includes(state.status)) {
        warnings.push(`${p.name} / ${s.name}：没有可移除的软链接`)
        continue
      }
      items.push({
        projectId: p.id,
        skillId: s.id,
        action,
        target: state.target,
        source: s.path,
        before: state.linkTarget,
      })
    }
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    items,
    warnings,
    projectIds,
  }
}
export async function applyPlan(store: Store, plan: Plan) {
  const completed: PlanItem[] = []
  try {
    for (const item of plan.items) {
      await mkdir(resolve(item.target, '..'), { recursive: true })
      if (item.action === 'link') await symlink(item.source, item.target)
      else if (item.action === 'remove') await unlink(item.target)
      else {
        await unlink(item.target)
        await symlink(item.source, item.target)
      }
      completed.push(item)
    }
    const operationId = store.record('apply', 'success', { plan, completed })
    return { operationId, completed: completed.length }
  } catch (error) {
    for (const item of completed.reverse())
      try {
        if (item.action === 'link') await unlink(item.target)
        else {
          try {
            await unlink(item.target)
          } catch {}
          if (item.before) await symlink(item.before, item.target)
        }
      } catch {}
    store.record('apply', 'rolled_back', { plan, error: String(error) })
    throw error
  }
}
export async function undo(store: Store, operationId: string) {
  const op = store.get<any>(
    'SELECT * FROM operations WHERE id=? AND undone_at IS NULL',
    operationId,
  )
  if (!op) throw new Error('操作不存在或已撤销')
  const completed: PlanItem[] = JSON.parse(op.details).completed || []
  for (const item of completed.reverse()) {
    if (item.action === 'link') {
      try {
        await unlink(item.target)
      } catch {}
    } else {
      try {
        await unlink(item.target)
      } catch {}
      if (item.before) await symlink(item.before, item.target)
    }
  }
  store.run('UPDATE operations SET undone_at=? WHERE id=?', new Date().toISOString(), operationId)
}
export async function audit(store: Store): Promise<AuditItem[]> {
  const out: AuditItem[] = []
  const skills = store.skills()
  const projects = store.projects()
  for (const s of skills)
    if (!s.available)
      out.push({
        level: 'error',
        type: 'missing_source',
        title: `技能来源失效：${s.name}`,
        detail: s.path,
        skillId: s.id,
      })
  const fingerprints = new Map<string, Skill[]>()
  for (const s of skills) {
    const rows = fingerprints.get(s.fingerprint) || []
    rows.push(s)
    fingerprints.set(s.fingerprint, rows)
  }
  for (const rows of fingerprints.values())
    if (rows.length > 1)
      out.push({
        level: 'info',
        type: 'duplicate',
        title: `发现重复技能内容：${rows[0].name}`,
        detail: rows.map((s) => s.path).join(' ↔ '),
      })
  for (const p of projects) {
    let entries: any[] = []
    try {
      entries = await readdir(p.skillsDir, { withFileTypes: true })
    } catch {}
    for (const e of entries) {
      if (e.name === '.DS_Store') continue
      const target = join(p.skillsDir, e.name)
      if (!e.isSymbolicLink()) {
        out.push({
          level: 'error',
          type: 'conflict',
          title: `真实条目受保护：${e.name}`,
          detail: target,
          projectId: p.id,
        })
        continue
      }
      let linked = ''
      try {
        linked = resolve(p.skillsDir, await readlink(target))
      } catch {}
      if (!skills.some((s) => resolve(s.path) === linked))
        out.push({
          level: 'warning',
          type: 'external_link',
          title: `未接管的外部链接：${e.name}`,
          detail: linked || target,
          projectId: p.id,
        })
    }
    for (const s of skills) {
      const st = await status(p, s)
      if (st.status === 'broken')
        out.push({
          level: 'error',
          type: 'broken',
          title: `失效链接：${p.name} / ${s.name}`,
          detail: st.target,
          projectId: p.id,
          skillId: s.id,
        })
      if (st.status === 'other_link')
        out.push({
          level: 'warning',
          type: 'other_link',
          title: `链接目标不同：${p.name} / ${s.name}`,
          detail: st.linkTarget || '',
          projectId: p.id,
          skillId: s.id,
        })
    }
  }
  for (const bundle of store.bundles())
    for (const projectId of bundle.projectIds) {
      const project = projects.find((p) => p.id === projectId)
      if (!project) continue
      const missing = []
      for (const sid of bundle.skillIds) {
        const skill = skills.find((s) => s.id === sid)
        if (skill && (await status(project, skill)).status !== 'linked') missing.push(skill.name)
      }
      if (missing.length)
        out.push({
          level: 'warning',
          type: 'bundle_drift',
          title: `组合漂移：${project.name} / ${bundle.name}`,
          detail: `缺少：${missing.join('、')}`,
          projectId,
        })
    }
  return out
}
