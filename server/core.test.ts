import { afterEach, describe, expect, it } from 'vitest'
import { lstat, mkdtemp, mkdir, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './db.js'
import { scanSource } from './scanner.js'
import { applyPlan, audit, makePlan, status, undo } from './linker.js'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'skill-manager-'))
  roots.push(root)
  const store = new Store(join(root, 'data', 'test.db'))
  return { root, store }
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('技能发现', () => {
  it('递归识别任意嵌套目录中的 SKILL.md 并解析元数据', async () => {
    const { root, store } = await fixture()
    const pack = join(root, 'vendor')
    const nested = join(pack, '.claude', 'skills', 'visual')
    await mkdir(nested, { recursive: true })
    await writeFile(
      join(nested, 'SKILL.md'),
      '---\nname: visual-pro\ndescription: 高级视觉技能\n---\n# fallback',
    )
    const source = store.addSource({ name: 'vendor', path: pack, mode: 'pack' }) as any
    expect(await scanSource(store, source)).toBe(1)
    expect(store.skills()[0]).toMatchObject({
      name: 'visual-pro',
      description: '高级视觉技能',
      relativePath: '.claude/skills/visual',
    })
  })
})

describe('软链接安全事务', () => {
  it('创建链接后可以完整撤销', async () => {
    const { root, store } = await fixture()
    const projectPath = join(root, 'project')
    const skillPath = join(root, 'skill')
    await mkdir(projectPath, { recursive: true })
    await mkdir(skillPath)
    await writeFile(join(skillPath, 'SKILL.md'), '---\nname: demo\ndescription: demo\n---')
    const project = store.addProject({
      name: 'P',
      path: projectPath,
      skillsDir: join(projectPath, '.codex', 'skills'),
    }) as any
    const source = store.addSource({ name: 'S', path: skillPath, mode: 'single' }) as any
    await scanSource(store, source)
    const skill = store.skills()[0]
    const plan = await makePlan(store, [project.id], [skill.id], 'link')
    const result = await applyPlan(store, plan)
    expect((await lstat(plan.items[0].target)).isSymbolicLink()).toBe(true)
    expect(await readlink(plan.items[0].target)).toBe(skill.path)
    await undo(store, result.operationId)
    await expect(lstat(plan.items[0].target)).rejects.toThrow()
  })
  it('只给选中的项目创建技能链接', async () => {
    const { root, store } = await fixture()
    const projectAPath = join(root, 'project-a')
    const projectBPath = join(root, 'project-b')
    const skillPath = join(root, 'skill')
    await mkdir(projectAPath)
    await mkdir(projectBPath)
    await mkdir(skillPath)
    await writeFile(
      join(skillPath, 'SKILL.md'),
      '---\nname: isolated-skill\ndescription: project isolation\n---',
    )
    const projectA = store.addProject({
      name: 'A',
      path: projectAPath,
      skillsDir: join(projectAPath, '.codex', 'skills'),
    }) as any
    const projectB = store.addProject({
      name: 'B',
      path: projectBPath,
      skillsDir: join(projectBPath, '.codex', 'skills'),
    }) as any
    const source = store.addSource({ name: 'S', path: skillPath, mode: 'single' }) as any
    await scanSource(store, source)
    const skill = store.skills()[0]
    const plan = await makePlan(store, [projectA.id], [skill.id], 'link')
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].projectId).toBe(projectA.id)
    await applyPlan(store, plan)
    expect((await status(projectA, skill)).status).toBe('linked')
    expect((await status(projectB, skill)).status).toBe('missing')
    await expect(lstat(join(projectB.skillsDir, skill.alias))).rejects.toThrow()
  })
  it('真实目录冲突永远不会进入替换计划', async () => {
    const { root, store } = await fixture()
    const projectPath = join(root, 'project')
    const skillPath = join(root, 'skill')
    await mkdir(join(projectPath, '.codex', 'skills', 'skill'), { recursive: true })
    await mkdir(skillPath)
    await writeFile(join(skillPath, 'SKILL.md'), '# skill')
    const project = store.addProject({
      name: 'P',
      path: projectPath,
      skillsDir: join(projectPath, '.codex', 'skills'),
    }) as any
    const source = store.addSource({ name: 'S', path: skillPath, mode: 'single' }) as any
    await scanSource(store, source)
    const skill = store.skills()[0]
    expect((await status(project, skill)).status).toBe('conflict')
    expect((await makePlan(store, [project.id], [skill.id], 'replace')).items).toHaveLength(0)
  })
})

describe('健康检查', () => {
  it('忽略技能目录中的 macOS .DS_Store 文件', async () => {
    const { root, store } = await fixture()
    const projectPath = join(root, 'project')
    const skillsDir = join(projectPath, '.codex', 'skills')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(join(skillsDir, '.DS_Store'), 'metadata')
    store.addProject({ name: 'P', path: projectPath, skillsDir })
    expect(await audit(store)).toEqual([])
  })
})
