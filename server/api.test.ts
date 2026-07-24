import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from './app.js'
import { Store } from './db.js'
import { scanSource } from './scanner.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('无请求体管理接口', () => {
  it('可以取消注册项目且不删除真实目录', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-manager-api-'))
    roots.push(root)
    const projectPath = join(root, 'project')
    await mkdir(projectPath)
    const store = new Store(join(root, 'data', 'test.db'))
    const project = store.addProject({
      name: '测试项目',
      path: projectPath,
      skillsDir: join(projectPath, '.codex', 'skills'),
    })
    const app = createApp(store)
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.id}`,
    })
    expect(response.statusCode).toBe(200)
    expect(store.projects()).toHaveLength(0)
    await expect(mkdir(projectPath)).rejects.toThrow()
    await app.close()
  })
})

describe('配置导入导出', () => {
  it('完整恢复项目组、技能偏好、技能组合与项目绑定', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-manager-config-'))
    roots.push(root)
    const projectPath = join(root, 'project')
    const skillPath = join(root, 'skill')
    await mkdir(projectPath)
    await mkdir(skillPath)
    await writeFile(
      join(skillPath, 'SKILL.md'),
      '---\nname: config-skill\ndescription: config round trip\n---',
    )
    const sourceStore = new Store(join(root, 'source-data', 'manager.db'))
    const project = sourceStore.addProject({
      name: '配置项目',
      path: projectPath,
      skillsDir: join(projectPath, '.codex', 'skills'),
    })
    const source = sourceStore.addSource({ name: '配置技能', path: skillPath, mode: 'single' })
    await scanSource(sourceStore, source as any)
    const skill = sourceStore.skills()[0]
    const groupId = crypto.randomUUID()
    sourceStore.run(
      'INSERT INTO project_groups VALUES(?,?,?,?)',
      groupId,
      '研究项目',
      '#34C759',
      new Date().toISOString(),
    )
    sourceStore.run('UPDATE projects SET group_id=? WHERE id=?', groupId, project.id)
    sourceStore.run(
      'UPDATE skills SET alias=?,tags=?,favorite=1 WHERE id=?',
      'config-custom',
      JSON.stringify(['科研', '常用']),
      skill.id,
    )
    const bundleId = crypto.randomUUID()
    sourceStore.run(
      'INSERT INTO bundles VALUES(?,?,?,?)',
      bundleId,
      '科研组合',
      '配置往返测试',
      new Date().toISOString(),
    )
    sourceStore.run('INSERT INTO bundle_skills VALUES(?,?)', bundleId, skill.id)
    sourceStore.run('INSERT INTO project_bundles VALUES(?,?)', project.id, bundleId)
    const sourceApp = createApp(sourceStore)
    const exported = JSON.parse(
      (
        await sourceApp.inject({
          method: 'GET',
          url: '/api/export',
        })
      ).body,
    )
    await sourceApp.close()
    const targetStore = new Store(join(root, 'target-data', 'manager.db'))
    const targetApp = createApp(targetStore)
    const imported = await targetApp.inject({
      method: 'POST',
      url: '/api/import',
      headers: { 'content-type': 'application/json' },
      payload: exported,
    })
    expect(imported.statusCode).toBe(200)
    const restoredProject = targetStore.projects()[0]
    const restoredGroup = targetStore.groups()[0]
    const restoredSkill = targetStore.skills()[0]
    const restoredBundle = targetStore.bundles()[0]
    expect(restoredProject.groupId).toBe(restoredGroup.id)
    expect(restoredSkill).toMatchObject({
      alias: 'config-custom',
      tags: ['科研', '常用'],
      favorite: true,
    })
    expect(restoredBundle.skillIds).toEqual([restoredSkill.id])
    expect(restoredBundle.projectIds).toEqual([restoredProject.id])
    await targetApp.close()
  })
})
