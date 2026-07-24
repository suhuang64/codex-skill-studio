import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import YAML from 'yaml'
import type { Store } from './db.js'
import type { Source } from './types.js'

const ignored = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build'])
async function skillDirs(root: string, single: boolean) {
  if (single) return [root]
  const result: string[] = []
  const queue = [root]
  while (queue.length) {
    const dir = queue.shift()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) result.push(dir)
    for (const e of entries)
      if (e.isDirectory() && !ignored.has(e.name)) queue.push(join(dir, e.name))
  }
  return result
}
function metadata(raw: string, fallback: string) {
  let data: any = {}
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3)
    if (end > 0)
      try {
        data = YAML.parse(raw.slice(3, end)) || {}
      } catch {}
  }
  const heading = raw.match(/^#\s+(.+)$/m)?.[1]
  return {
    name: String(data.name || heading || fallback).trim(),
    description: String(data.description || '暂无描述').trim(),
  }
}
export async function scanSource(store: Store, source: Source) {
  store.run('UPDATE skills SET available=0 WHERE source_id=?', source.id)
  const root = await realpath(source.path)
  const dirs = await skillDirs(root, source.mode === 'single')
  let count = 0
  for (const dir of dirs) {
    try {
      const raw = await readFile(join(dir, 'SKILL.md'), 'utf8')
      const meta = metadata(raw, basename(dir))
      const fingerprint = createHash('sha256').update(raw).digest('hex').slice(0, 16)
      store.upsertSkill({
        id: crypto.randomUUID(),
        sourceId: source.id,
        relativePath: relative(root, dir) || '.',
        path: dir,
        name: meta.name,
        description: meta.description,
        alias: basename(dir),
        fingerprint,
        lastSeen: new Date().toISOString(),
        available: true,
      })
      count++
    } catch {}
  }
  return count
}
export async function isDirectory(path: string) {
  try {
    return (await lstat(path)).isDirectory()
  } catch {
    return false
  }
}
