export type Project = {
  id: string
  name: string
  path: string
  skillsDir: string
  groupId: string | null
  createdAt: string
}
export type Source = {
  id: string
  name: string
  path: string
  mode: 'single' | 'pack'
  createdAt: string
}
export type Skill = {
  id: string
  sourceId: string
  relativePath: string
  path: string
  name: string
  description: string
  alias: string
  tags: string[]
  favorite: boolean
  fingerprint: string
  lastSeen: string
  available: boolean
}
export type LinkStatus = 'linked' | 'missing' | 'broken' | 'other_link' | 'conflict'
export type SkillStatus = Skill & { status: LinkStatus; target: string; linkTarget?: string }
export type PlanItem = {
  projectId: string
  skillId: string
  action: 'link' | 'replace' | 'remove'
  target: string
  source: string
  before?: string
}
export type Plan = {
  id: string
  createdAt: string
  items: PlanItem[]
  warnings: string[]
  bundleId?: string
  projectIds?: string[]
}
export type AuditItem = {
  level: 'error' | 'warning' | 'info'
  type: string
  title: string
  detail: string
  projectId?: string
  skillId?: string
}
