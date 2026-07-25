<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import {
    FolderAdd,
    Plus,
    Refresh,
    Search,
    Setting,
    Collection,
    Link,
    Warning,
    Clock,
    House,
    Star,
    Download,
    Upload,
    Monitor,
    ArrowDown,
    EditPen,
    Delete,
    MagicStick,
    Filter,
    Sort,
    Tools,
    MoreFilled,
    FolderOpened,
  } from '@element-plus/icons-vue'
  import { api, patch, post, remove } from './api'

  type AnyRow = Record<string, any>
  type ProjectGroupSection = AnyRow & { projects: AnyRow[]; managed: boolean }
  type ProjectSelectGroup = AnyRow & { projects: AnyRow[] }
  type ThemeMode = 'system' | 'light' | 'dark'

  const THEME_STORAGE_KEY = 'skill-studio-theme'
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY)
  const themeMode = ref<ThemeMode>(
    savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system'
      ? savedTheme
      : 'system',
  )
  const systemDark = ref(systemTheme.matches)
  const resolvedTheme = computed(() =>
    themeMode.value === 'system' ? (systemDark.value ? 'dark' : 'light') : themeMode.value,
  )
  const themeOptions = [
    { label: '跟随系统', value: 'system' },
    { label: '浅色', value: 'light' },
    { label: '深色', value: 'dark' },
  ]
  const groupColorPresets = [
    '#007AFF',
    '#34C759',
    '#FF9500',
    '#FF3B30',
    '#AF52DE',
    '#5AC8FA',
    '#8E8E93',
  ]
  const linkStatusText: Record<string, string> = {
    linked: '已链接',
    missing: '未链接',
    broken: '已失效',
    other_link: '其他链接',
    conflict: '真实冲突',
  }
  const planActionText: Record<string, string> = {
    link: '新增',
    replace: '替换',
    remove: '移除',
  }

  function applyTheme() {
    const theme = resolvedTheme.value
    document.documentElement.dataset.theme = theme
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    localStorage.setItem(THEME_STORAGE_KEY, themeMode.value)
  }

  function handleSystemTheme(event: MediaQueryListEvent) {
    systemDark.value = event.matches
  }

  watch([themeMode, systemDark], applyTheme, { immediate: true })
  systemTheme.addEventListener('change', handleSystemTheme)
  onBeforeUnmount(() => systemTheme.removeEventListener('change', handleSystemTheme))

  const data = reactive<{
    projects: AnyRow[]
    sources: AnyRow[]
    skills: AnyRow[]
    groups: AnyRow[]
    bundles: AnyRow[]
    audit: AnyRow[]
    history: AnyRow[]
  }>({ projects: [], sources: [], skills: [], groups: [], bundles: [], audit: [], history: [] })
  const loading = ref(true),
    tab = ref('overview'),
    query = ref(''),
    statusFilter = ref('all'),
    sourceFilter = ref('all'),
    projectGroupFilter = ref('all'),
    projectGroupSort = ref<'name' | 'count' | 'created'>('name'),
    groupBatchSourceFilter = ref('all'),
    bundleSourceFilter = ref('all'),
    selectedProject = ref(''),
    statuses = ref<AnyRow[]>([]),
    selectedSkills = ref<AnyRow[]>([]),
    collapsedGroups = ref<string[]>([])
  const projectDialog = ref(false),
    sourceDialog = ref(false),
    bundleDialog = ref(false),
    planDialog = ref(false),
    groupDialog = ref(false),
    groupSkillsDialog = ref(false),
    skillDialog = ref(false),
    bundleApplyDialog = ref(false)
  const projectForm = reactive({ name: '', path: '' }),
    sourceForm = reactive({ name: '', path: '', mode: 'pack' }),
    bundleForm = reactive({ name: '', description: '', skillIds: [] as string[] })
  const groupForm = reactive({ name: '', color: '#007AFF' }),
    groupBatch = reactive({
      groupId: '',
      skillIds: [] as string[],
      action: 'link' as 'link' | 'replace' | 'remove',
    }),
    skillForm = reactive({ id: '', alias: '', tags: '' }),
    bundleApply = reactive({ bundleId: '', projectId: '' })
  const currentPlan = ref<AnyRow | null>(null),
    bundleSkillTable = ref<any>(),
    groupBatchSkillTable = ref<any>(),
    applying = ref(false),
    groupSaving = ref(false),
    groupBatchLoading = ref(false),
    editingGroupId = ref(''),
    planScopeLabel = ref('')
  const nav = [
    ['overview', '总览', House],
    ['projects', '项目', FolderAdd],
    ['skills', '技能库', Collection],
    ['bundles', '技能组合', Link],
    ['audit', '健康检查', Warning],
    ['history', '操作历史', Clock],
    ['settings', '设置', Setting],
  ] as const

  async function refresh(message = false) {
    loading.value = true
    try {
      Object.assign(data, await api('/bootstrap'))
      if (!selectedProject.value && data.projects[0]) selectedProject.value = data.projects[0].id
      if (selectedProject.value) await loadStatus()
      if (message) ElMessage.success('状态已刷新')
    } catch (e: any) {
      ElMessage.error(e.message)
    } finally {
      loading.value = false
    }
  }
  async function loadStatus() {
    if (!selectedProject.value) {
      statuses.value = []
      return
    }
    statuses.value = await api(`/projects/${selectedProject.value}/status`)
  }
  watch(selectedProject, loadStatus)
  const sourceById = computed(() => new Map(data.sources.map((source) => [source.id, source])))
  const sourceOptions = computed(() => [
    { label: '全部技能源', value: 'all' },
    ...data.sources.map((source) => ({
      label:
        source.name +
        '（' +
        data.skills.filter((skill) => skill.sourceId === source.id).length +
        '）',
      value: source.id,
    })),
  ])
  function sourceName(row: AnyRow) {
    return sourceById.value.get(row.sourceId)?.name || '未知来源'
  }
  function sourceMode(row: AnyRow) {
    return sourceById.value.get(row.sourceId)?.mode === 'single' ? '单个技能' : '技能包'
  }
  const filteredSkills = computed(() => {
    const q = query.value.toLowerCase()
    return statuses.value.filter(
      (s) =>
        (statusFilter.value === 'all' || s.status === statusFilter.value) &&
        (sourceFilter.value === 'all' || s.sourceId === sourceFilter.value) &&
        (!q ||
          `${s.name} ${s.description} ${sourceName(s)} ${s.path} ${s.tags.join(' ')}`
            .toLowerCase()
            .includes(q)),
    )
  })
  const filteredGroupBatchSkills = computed(() =>
    data.skills.filter(
      (skill) =>
        groupBatchSourceFilter.value === 'all' || skill.sourceId === groupBatchSourceFilter.value,
    ),
  )
  const filteredBundleSkills = computed(() =>
    data.skills.filter(
      (skill) => bundleSourceFilter.value === 'all' || skill.sourceId === bundleSourceFilter.value,
    ),
  )
  const linkedCount = computed(() => statuses.value.filter((s) => s.status === 'linked').length)
  const errors = computed(() => data.audit.filter((a) => a.level === 'error').length)
  const groupById = computed(() => new Map(data.groups.map((group) => [group.id, group])))
  const projectGroupSections = computed(() => {
    const sections: ProjectGroupSection[] = data.groups.map((group) => ({
      ...group,
      projects: data.projects.filter((project) => project.groupId === group.id),
      managed: true,
    }))
    const ungrouped = {
      id: 'ungrouped',
      name: '未分组',
      color: '#94A3B8',
      created_at: '',
      projects: data.projects.filter((project) => !project.groupId),
      managed: false,
    }
    if (ungrouped.projects.length) sections.push(ungrouped)
    const filtered =
      projectGroupFilter.value === 'all'
        ? sections
        : sections.filter((section) => section.id === projectGroupFilter.value)
    return [...filtered].sort((a, b) => {
      if (!a.managed) return 1
      if (!b.managed) return -1
      if (projectGroupSort.value === 'count')
        return b.projects.length - a.projects.length || a.name.localeCompare(b.name, 'zh-CN')
      if (projectGroupSort.value === 'created')
        return String(b.created_at).localeCompare(String(a.created_at))
      return a.name.localeCompare(b.name, 'zh-CN')
    })
  })
  const projectSelectGroups = computed(() => {
    const sections: ProjectSelectGroup[] = data.groups.map((group) => ({
      ...group,
      projects: data.projects.filter((project) => project.groupId === group.id),
    }))
    const ungrouped = data.projects.filter((project) => !project.groupId)
    if (ungrouped.length)
      sections.push({ id: 'ungrouped', name: '未分组', color: '#94A3B8', projects: ungrouped })
    return sections.filter((section) => section.projects.length)
  })
  const activeGroupBatch = computed(() => groupById.value.get(groupBatch.groupId))
  function groupForProject(project: AnyRow) {
    return groupById.value.get(project.groupId)
  }
  function isGroupCollapsed(id: string) {
    return collapsedGroups.value.includes(id)
  }
  function toggleGroup(id: string) {
    collapsedGroups.value = isGroupCollapsed(id)
      ? collapsedGroups.value.filter((groupId) => groupId !== id)
      : [...collapsedGroups.value, id]
  }
  async function choose(target: { path: string }, title: string) {
    const r = await post('/dialog/directory', { title })
    if (r.path) target.path = r.path
  }
  async function addProject() {
    try {
      await post('/projects', projectForm)
      projectDialog.value = false
      Object.assign(projectForm, { name: '', path: '' })
      await refresh()
      ElMessage.success('项目已添加')
    } catch (e: any) {
      ElMessage.error(e.message)
    }
  }
  function openProjectSkills(project: AnyRow) {
    selectedProject.value = project.id
    tab.value = 'skills'
  }
  async function addSource() {
    try {
      const r = await post('/sources', sourceForm)
      sourceDialog.value = false
      Object.assign(sourceForm, { name: '', path: '', mode: 'pack' })
      await refresh()
      ElMessage.success(`已发现 ${r.count} 个技能`)
    } catch (e: any) {
      ElMessage.error(e.message)
    }
  }
  async function rescan() {
    try {
      const r = await post('/scan')
      await refresh()
      ElMessage.success(`扫描完成，共识别 ${r.count} 个技能`)
    } catch (e: any) {
      ElMessage.error(e.message)
    }
  }
  async function confirmDelete(kind: 'projects' | 'sources' | 'bundles', row: AnyRow) {
    try {
      await ElMessageBox.confirm(
        `只会取消注册“${row.name}”，不会删除磁盘上的真实目录。`,
        '确认取消注册',
        { type: 'warning', confirmButtonText: '取消注册', cancelButtonText: '保留' },
      )
      await remove(`/${kind}/${row.id}`)
      if (selectedProject.value === row.id) selectedProject.value = ''
      await refresh()
      ElMessage.success('已取消注册')
    } catch (e: any) {
      if (e === 'cancel' || e === 'close') return
      ElMessage.error(`取消注册失败：${e?.message || e}`)
    }
  }
  async function toggleFavorite(row: AnyRow) {
    await patch(`/skills/${row.id}`, { favorite: !row.favorite })
    await refresh()
  }
  async function stage(action: 'link' | 'replace' | 'remove') {
    if (!selectedProject.value || !selectedSkills.value.length)
      return ElMessage.warning('请先选择项目并勾选技能')
    try {
      currentPlan.value = await post('/plans', {
        projectIds: [selectedProject.value],
        skillIds: selectedSkills.value.map((s) => s.id),
        action,
      })
      planScopeLabel.value =
        data.projects.find((project) => project.id === selectedProject.value)?.name || ''
      planDialog.value = true
    } catch (e: any) {
      ElMessage.error(e.message)
    }
  }
  async function applyPlan() {
    if (!currentPlan.value) return
    applying.value = true
    try {
      const r = await post(`/plans/${currentPlan.value.id}/apply`)
      planDialog.value = false
      currentPlan.value = null
      planScopeLabel.value = ''
      selectedSkills.value = []
      await refresh()
      ElMessage.success(`已安全应用 ${r.completed} 项变更`)
    } catch (e: any) {
      ElMessage.error(`应用失败，已回滚：${e.message}`)
    } finally {
      applying.value = false
    }
  }
  async function undo(row: AnyRow) {
    await ElMessageBox.confirm('撤销将恢复本次操作之前的软链接状态。', '撤销操作', {
      type: 'warning',
    })
    try {
      await post(`/operations/${row.id}/undo`)
      await refresh()
      ElMessage.success('已撤销')
    } catch (e: any) {
      ElMessage.error(e.message)
    }
  }
  async function createBundle() {
    try {
      await post('/bundles', bundleForm)
      bundleDialog.value = false
      Object.assign(bundleForm, { name: '', description: '', skillIds: [] })
      await refresh()
      ElMessage.success('技能组合已创建')
    } catch (e: any) {
      ElMessage.error(e.message)
    }
  }
  function openBundleDialog() {
    Object.assign(bundleForm, { name: '', description: '', skillIds: [] })
    bundleSourceFilter.value = 'all'
    bundleDialog.value = true
    nextTick(() => bundleSkillTable.value?.clearSelection())
  }
  function handleBundleSkillSelection(rows: AnyRow[]) {
    bundleForm.skillIds = rows.map((row) => row.id)
  }
  function openCreateGroup() {
    editingGroupId.value = ''
    Object.assign(groupForm, { name: '', color: '#007AFF' })
    groupDialog.value = true
  }
  function openEditGroup(group: AnyRow) {
    editingGroupId.value = group.id
    Object.assign(groupForm, { name: group.name, color: group.color })
    groupDialog.value = true
  }
  async function saveGroup() {
    groupSaving.value = true
    try {
      if (editingGroupId.value) await patch(`/groups/${editingGroupId.value}`, groupForm)
      else await post('/groups', groupForm)
      groupDialog.value = false
      await refresh()
      ElMessage.success(editingGroupId.value ? '项目组已更新' : '项目组已创建')
    } catch (e: any) {
      ElMessage.error(e.message)
    } finally {
      groupSaving.value = false
    }
  }
  async function confirmDeleteGroup(group: AnyRow) {
    const count = data.projects.filter((project) => project.groupId === group.id).length
    try {
      await ElMessageBox.confirm(
        `删除“${group.name}”后，${count} 个成员项目将变为未分组。项目目录和技能链接不会被删除。`,
        '删除项目组',
        { type: 'warning', confirmButtonText: '删除项目组', cancelButtonText: '保留' },
      )
      await remove(`/groups/${group.id}`)
      if (projectGroupFilter.value === group.id) projectGroupFilter.value = 'all'
      collapsedGroups.value = collapsedGroups.value.filter((id) => id !== group.id)
      await refresh()
      ElMessage.success('项目组已删除，成员项目已移至未分组')
    } catch (e: any) {
      if (e === 'cancel' || e === 'close') return
      ElMessage.error(`删除项目组失败：${e?.message || e}`)
    }
  }
  async function assignGroup(project: AnyRow, groupId: string | null) {
    try {
      await patch(`/projects/${project.id}/group`, { groupId })
      await refresh()
      ElMessage.success(groupId ? '项目分组已更新' : '项目已移至未分组')
    } catch (e: any) {
      ElMessage.error(e.message)
    }
  }
  function openGroupSkills(group: AnyRow) {
    const projectCount = data.projects.filter((project) => project.groupId === group.id).length
    if (!projectCount) return ElMessage.warning('该项目组中还没有项目')
    Object.assign(groupBatch, { groupId: group.id, skillIds: [], action: 'link' })
    groupBatchSourceFilter.value = 'all'
    groupSkillsDialog.value = true
    nextTick(() => groupBatchSkillTable.value?.clearSelection())
  }
  function handleGroupBatchSkillSelection(rows: AnyRow[]) {
    groupBatch.skillIds = rows.map((row) => row.id)
  }
  function isGroupBatchSkillSelectable(row: AnyRow) {
    return !!row.available
  }
  async function stageGroupSkills() {
    const group = activeGroupBatch.value
    const projectIds = data.projects
      .filter((project) => project.groupId === groupBatch.groupId)
      .map((project) => project.id)
    if (!group || !projectIds.length || !groupBatch.skillIds.length)
      return ElMessage.warning('请选择至少一个技能')
    groupBatchLoading.value = true
    try {
      currentPlan.value = await post('/plans', {
        projectIds,
        skillIds: groupBatch.skillIds,
        action: groupBatch.action,
      })
      planScopeLabel.value = `${group.name} · ${projectIds.length} 个项目`
      groupSkillsDialog.value = false
      planDialog.value = true
    } catch (e: any) {
      ElMessage.error(e.message)
    } finally {
      groupBatchLoading.value = false
    }
  }
  function editSkill(row: AnyRow) {
    Object.assign(skillForm, { id: row.id, alias: row.alias, tags: row.tags.join(', ') })
    skillDialog.value = true
  }
  async function saveSkill() {
    try {
      await patch(`/skills/${skillForm.id}`, {
        alias: skillForm.alias,
        tags: skillForm.tags
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
      })
      skillDialog.value = false
      await refresh()
      ElMessage.success('技能信息已更新')
    } catch (e: any) {
      ElMessage.error(e.message)
    }
  }
  function openBundleApply(bundle: AnyRow) {
    Object.assign(bundleApply, { bundleId: bundle.id, projectId: data.projects[0]?.id || '' })
    bundleApplyDialog.value = true
  }
  async function stageBundle() {
    const bundle = data.bundles.find((b) => b.id === bundleApply.bundleId)
    if (!bundle || !bundleApply.projectId) return
    currentPlan.value = await post('/plans', {
      projectIds: [bundleApply.projectId],
      skillIds: bundle.skillIds,
      action: 'link',
      bundleId: bundle.id,
    })
    planScopeLabel.value =
      data.projects.find((project) => project.id === bundleApply.projectId)?.name || ''
    bundleApplyDialog.value = false
    planDialog.value = true
  }
  function exportConfig() {
    api('/export').then((obj) => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }),
      )
      const a = document.createElement('a')
      a.href = url
      a.download = `skill-manager-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    })
  }
  async function importConfig(file: File) {
    try {
      await post('/import', JSON.parse(await file.text()))
      await refresh()
      ElMessage.success('配置已导入')
    } catch (e: any) {
      ElMessage.error(e.message)
    }
    return false
  }
  onMounted(refresh)
</script>

<template>
  <div class="ambient ambient-one"></div>
  <div class="ambient ambient-two"></div>
  <div class="app-shell" v-loading="loading">
    <header class="topbar glass">
      <div class="brand">
        <div class="brand-mark"><Link /></div>
        <div><strong>Skill Studio</strong><span>Codex 技能管理器</span></div>
      </div>
      <nav class="tabs" aria-label="主导航">
        <button
          v-for="[key, label, icon] in nav"
          :key="key"
          :class="{ active: tab === key }"
          @click="tab = key"
        >
          <el-icon><component :is="icon" /></el-icon>{{ label
          }}<i v-if="key === 'audit' && data.audit.length" class="nav-badge">{{
            data.audit.length
          }}</i>
        </button>
      </nav>
      <el-button circle :icon="Refresh" @click="refresh(true)" aria-label="刷新" />
    </header>

    <main>
      <section v-if="tab === 'overview'" class="page">
        <div class="hero glass">
          <div>
            <span class="eyebrow">LOCAL SKILL ORCHESTRATION</span>
            <h1>让每个项目，只拥有它真正需要的技能。</h1>
            <p>集中注册项目与技能源，安全预览软链接变更，并持续发现失效、冲突与配置漂移。</p>
            <div class="hero-actions">
              <el-button type="primary" size="large" :icon="FolderAdd" @click="projectDialog = true"
                >添加项目</el-button
              ><el-button size="large" :icon="Plus" @click="sourceDialog = true"
                >添加技能源</el-button
              >
            </div>
          </div>
          <div class="orb">
            <span>{{ data.skills.length }}</span
            ><small>已管理技能</small>
          </div>
        </div>
        <div class="metric-grid">
          <article class="metric glass">
            <span>项目</span><strong>{{ data.projects.length }}</strong
            ><small>任意本地目录</small>
          </article>
          <article class="metric glass">
            <span>技能源</span><strong>{{ data.sources.length }}</strong
            ><small>单技能与技能包</small>
          </article>
          <article class="metric glass">
            <span>技能组合</span><strong>{{ data.bundles.length }}</strong
            ><small>可复用的能力方案</small>
          </article>
          <article class="metric glass" :class="{ danger: errors }">
            <span>需要处理</span><strong>{{ errors }}</strong
            ><small>{{ data.audit.length }} 条审计发现</small>
          </article>
        </div>
        <div class="overview-grid">
          <section class="panel glass">
            <div class="panel-head">
              <div>
                <h2>项目概览</h2>
                <p>最近注册的工作区</p>
              </div>
              <el-button text @click="tab = 'projects'">查看全部</el-button>
            </div>
            <div v-if="data.projects.length" class="card-list">
              <div v-for="p in data.projects.slice(0, 4)" :key="p.id" class="mini-card">
                <div class="folder-icon"><FolderAdd /></div>
                <div>
                  <div class="mini-card-title">
                    <b>{{ p.name }}</b>
                    <span v-if="groupForProject(p)" class="group-badge">
                      <i :style="{ background: groupForProject(p)?.color }"></i>
                      {{ groupForProject(p)?.name }}
                    </span>
                  </div>
                  <small>{{ p.path }}</small>
                </div>
              </div>
            </div>
            <el-empty v-else description="还没有添加项目" />
          </section>
          <section class="panel glass">
            <div class="panel-head">
              <div>
                <h2>系统健康</h2>
                <p>持续检查链接和来源</p>
              </div>
              <el-button text @click="tab = 'audit'">打开检查</el-button>
            </div>
            <div class="health">
              <el-progress
                type="dashboard"
                :percentage="data.audit.length ? Math.max(0, 100 - data.audit.length * 8) : 100"
                :color="data.audit.length ? '#ff9f0a' : '#34c759'"
              />
              <div>
                <b>{{ data.audit.length ? '发现需要关注的项目' : '一切运行良好' }}</b>
                <p>
                  {{
                    data.audit.length
                      ? `共 ${data.audit.length} 条提示，所有真实目录仍受保护。`
                      : '未发现失效链接或来源冲突。'
                  }}
                </p>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section v-else-if="tab === 'projects'" class="page">
        <div class="page-title">
          <div>
            <span class="eyebrow">WORKSPACES</span>
            <h1>项目</h1>
            <p>注册任意 macOS 项目目录，技能目标固定为项目内的 .codex/skills。</p>
          </div>
          <div>
            <el-button @click="openCreateGroup">新建项目组</el-button
            ><el-button type="primary" :icon="FolderAdd" @click="projectDialog = true"
              >添加项目</el-button
            >
          </div>
        </div>
        <div class="content-frame project-frame glass">
          <div class="project-controls">
            <div class="project-control-strip" role="group" aria-label="项目视图控制">
              <div class="apple-select project-filter-select">
                <el-icon><Filter /></el-icon>
                <el-select
                  v-model="projectGroupFilter"
                  aria-label="筛选项目组"
                  popper-class="apple-select-popper"
                >
                  <el-option label="全部项目组" value="all" />
                  <el-option
                    v-for="group in data.groups"
                    :key="group.id"
                    :label="group.name"
                    :value="group.id"
                  >
                    <div class="group-option">
                      <i :style="{ background: group.color }"></i><span>{{ group.name }}</span>
                    </div>
                  </el-option>
                  <el-option
                    v-if="data.projects.some((project) => !project.groupId)"
                    label="未分组"
                    value="ungrouped"
                  >
                    <div class="group-option">
                      <i style="background: #94a3b8"></i><span>未分组</span>
                    </div>
                  </el-option>
                </el-select>
              </div>
              <div class="apple-select project-sort-select">
                <el-icon><Sort /></el-icon>
                <el-select
                  v-model="projectGroupSort"
                  aria-label="项目组排序"
                  popper-class="apple-select-popper"
                >
                  <el-option label="按名称排序" value="name" />
                  <el-option label="按项目数排序" value="count" />
                  <el-option label="按创建时间排序" value="created" />
                </el-select>
              </div>
            </div>
            <span>{{ data.groups.length }} 个项目组 · {{ data.projects.length }} 个项目</span>
          </div>
          <div class="project-groups scroll-list">
            <section v-for="group in projectGroupSections" :key="group.id" class="project-group">
              <header class="project-group-head">
                <button
                  class="group-toggle"
                  type="button"
                  :aria-expanded="!isGroupCollapsed(group.id)"
                  @click="toggleGroup(group.id)"
                >
                  <i class="group-swatch" :style="{ background: group.color }"></i>
                  <span>
                    <b>{{ group.name }}</b>
                    <small>{{ group.projects.length }} 个项目</small>
                  </span>
                  <el-icon :class="{ collapsed: isGroupCollapsed(group.id) }"
                    ><ArrowDown
                  /></el-icon>
                </button>
                <div v-if="group.managed" class="group-actions">
                  <el-button
                    :icon="MagicStick"
                    :aria-label="`批量配置项目组 ${group.name} 的技能`"
                    :disabled="!group.projects.length"
                    @click="openGroupSkills(group)"
                    >批量配置技能</el-button
                  >
                  <el-tooltip content="编辑项目组">
                    <el-button
                      circle
                      :icon="EditPen"
                      :aria-label="`编辑项目组 ${group.name}`"
                      @click="openEditGroup(group)"
                    />
                  </el-tooltip>
                  <el-tooltip content="删除项目组">
                    <el-button
                      circle
                      plain
                      type="danger"
                      :icon="Delete"
                      :aria-label="`删除项目组 ${group.name}`"
                      @click="confirmDeleteGroup(group)"
                    />
                  </el-tooltip>
                </div>
              </header>
              <div v-show="!isGroupCollapsed(group.id)" class="project-group-list">
                <article v-for="p in group.projects" :key="p.id" class="entity-row project-row">
                  <div
                    class="folder-icon project-folder-icon"
                    :style="{ '--group-color': group.color }"
                  >
                    <FolderAdd />
                  </div>
                  <div class="entity-main">
                    <div class="entity-title-line">
                      <h3>{{ p.name }}</h3>
                      <code>{{ p.path }}</code>
                    </div>
                  </div>
                  <div class="project-row-controls">
                    <div class="apple-select row-group-select">
                      <el-select
                        :model-value="p.groupId"
                        :aria-label="`${p.name} 所属项目组`"
                        clearable
                        placeholder="未分组"
                        popper-class="apple-select-popper"
                        @change="assignGroup(p, $event || null)"
                      >
                        <el-option
                          v-for="option in data.groups"
                          :key="option.id"
                          :label="option.name"
                          :value="option.id"
                        >
                          <div class="group-option">
                            <i :style="{ background: option.color }"></i
                            ><span>{{ option.name }}</span>
                          </div>
                        </el-option>
                      </el-select>
                    </div>
                    <el-button
                      class="apple-row-button"
                      :icon="Tools"
                      :aria-label="`管理项目 ${p.name} 的技能`"
                      @click="openProjectSkills(p)"
                      >管理技能</el-button
                    >
                    <el-dropdown trigger="click"
                      ><el-button
                        class="apple-icon-button"
                        :icon="MoreFilled"
                        :aria-label="`${p.name} 的更多操作`"
                        text
                      />
                      <template #dropdown
                        ><el-dropdown-menu
                          ><el-dropdown-item @click="confirmDelete('projects', p)"
                            >取消注册</el-dropdown-item
                          ></el-dropdown-menu
                        ></template
                      ></el-dropdown
                    >
                  </div>
                </article>
                <div v-if="!group.projects.length" class="empty-group">暂无项目</div>
              </div>
            </section>
            <el-empty v-if="!projectGroupSections.length" description="当前筛选没有项目组" />
          </div>
        </div>
      </section>

      <section v-else-if="tab === 'skills'" class="page">
        <div class="page-title">
          <div>
            <span class="eyebrow">SKILL LIBRARY</span>
            <h1>技能库</h1>
            <p>搜索、筛选并批量规划链接；勾选不会立即改变磁盘。</p>
          </div>
          <div>
            <el-button :icon="Refresh" @click="rescan">重新扫描</el-button
            ><el-button type="primary" :icon="Plus" @click="sourceDialog = true"
              >添加技能源</el-button
            >
          </div>
        </div>
        <div class="toolbar glass">
          <el-select
            v-model="selectedProject"
            aria-label="选择项目"
            placeholder="选择项目"
            style="width: 240px"
          >
            <el-option-group
              v-for="group in projectSelectGroups"
              :key="group.id"
              :label="group.name"
            >
              <el-option v-for="p in group.projects" :key="p.id" :label="p.name" :value="p.id" />
            </el-option-group>
          </el-select>
          <el-input
            v-model="query"
            :prefix-icon="Search"
            placeholder="搜索名称、描述、标签或路径"
            clearable
          />
          <el-segmented
            v-model="statusFilter"
            class="apple-segmented"
            aria-label="技能链接状态"
            :options="[
              { label: '全部', value: 'all' },
              { label: '已链接', value: 'linked' },
              { label: '未链接', value: 'missing' },
              { label: '异常', value: 'broken' },
            ]"
          />
          <el-select
            v-model="sourceFilter"
            aria-label="筛选技能源"
            placeholder="筛选技能源"
            clearable
            style="width: 230px"
            @clear="sourceFilter = 'all'"
          >
            <el-option
              v-for="option in sourceOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </div>
        <div class="library-layout">
          <section class="table-panel glass">
            <div class="selection-bar" :class="{ visible: selectedSkills.length }">
              <span>已选择 {{ selectedSkills.length }} 项</span>
              <div>
                <el-button @click="stage('link')">加入链接</el-button
                ><el-button @click="stage('replace')">替换软链接</el-button
                ><el-button type="danger" plain @click="stage('remove')">移除链接</el-button>
              </div>
            </div>
            <el-table
              :data="filteredSkills"
              row-key="id"
              @selection-change="selectedSkills = $event"
              height="100%"
              empty-text="当前筛选没有技能"
              ><el-table-column
                type="selection"
                width="48"
                :reserve-selection="true"
              /><el-table-column label="技能" min-width="240"
                ><template #default="{ row }"
                  ><div class="skill-name">
                    <button
                      class="star"
                      type="button"
                      :aria-label="`${row.favorite ? '取消收藏' : '收藏'}技能 ${row.name}`"
                      :aria-pressed="row.favorite"
                      @click.stop="toggleFavorite(row)"
                    >
                      <el-icon :class="{ on: row.favorite }"><Star /></el-icon>
                    </button>
                    <div>
                      <b :title="row.name">{{ row.name }}</b
                      ><small>{{ row.description }}</small>
                    </div>
                  </div></template
                ></el-table-column
              ><el-table-column label="技能源" width="190"
                ><template #default="{ row }"
                  ><div class="source-text">
                    <b>{{ sourceName(row) }}</b
                    ><small>{{ sourceMode(row) }}</small>
                  </div></template
                ></el-table-column
              ><el-table-column prop="alias" label="链接名" width="150" /><el-table-column
                label="状态"
                width="120"
                ><template #default="{ row }"
                  ><span class="status" :class="row.status">{{
                    linkStatusText[row.status]
                  }}</span></template
                ></el-table-column
              ><el-table-column label="标签" width="150"
                ><template #default="{ row }"
                  ><el-tag v-for="t in row.tags.slice(0, 2)" :key="t" round>{{
                    t
                  }}</el-tag></template
                ></el-table-column
              ><el-table-column label="" width="92" align="center"
                ><template #default="{ row }"
                  ><el-button text :aria-label="`编辑技能 ${row.name}`" @click="editSkill(row)"
                    >编辑</el-button
                  ></template
                ></el-table-column
              ></el-table
            >
          </section>
          <aside class="source-panel glass">
            <div class="panel-head">
              <div>
                <h2>技能源</h2>
                <p>{{ data.sources.length }} 个已注册来源</p>
              </div>
            </div>
            <div class="source-list">
              <div
                v-for="s in data.sources"
                :key="s.id"
                class="source-row"
                :class="{ active: sourceFilter === s.id }"
              >
                <div>
                  <b>{{ s.name }}</b
                  ><small
                    >{{ s.mode === 'pack' ? '技能包' : '单个技能' }} ·
                    {{ data.skills.filter((k) => k.sourceId === s.id).length }} 项</small
                  >
                </div>
                <el-button
                  text
                  type="danger"
                  :aria-label="`移除技能源 ${s.name}`"
                  @click="confirmDelete('sources', s)"
                  >移除</el-button
                >
              </div>
            </div>
            <el-button class="full" plain :icon="Plus" @click="sourceDialog = true"
              >添加来源</el-button
            >
          </aside>
        </div>
      </section>

      <section v-else-if="tab === 'bundles'" class="page">
        <div class="page-title">
          <div>
            <span class="eyebrow">COLLECTIONS</span>
            <h1>技能组合</h1>
            <p>把经常一起使用的技能保存成可复用方案，并用于检查项目配置漂移。</p>
          </div>
          <el-button type="primary" :icon="Plus" @click="openBundleDialog">新建组合</el-button>
        </div>
        <div class="content-frame glass">
          <div class="entity-list scroll-list">
            <article v-for="b in data.bundles" :key="b.id" class="entity-row bundle-row">
              <div class="bundle-icon"><Collection /></div>
              <div class="entity-main">
                <div class="entity-title-line">
                  <h3>{{ b.name }}</h3>
                  <span>{{ b.description || '暂无说明' }}</span>
                </div>
                <div class="bundle-skills">
                  <el-tag v-for="sid in b.skillIds.slice(0, 5)" :key="sid" round>{{
                    data.skills.find((s) => s.id === sid)?.name
                  }}</el-tag>
                </div>
              </div>
              <span class="entity-meta"
                >{{ b.skillIds.length }} 个技能 · {{ b.projectIds.length }} 个项目</span
              >
              <el-button :aria-label="`应用技能组合 ${b.name} 到项目`" @click="openBundleApply(b)"
                >应用到项目</el-button
              ><el-button
                text
                type="danger"
                :aria-label="`删除技能组合 ${b.name}`"
                @click="confirmDelete('bundles', b)"
                >删除</el-button
              >
            </article>
          </div>
        </div>
      </section>

      <section v-else-if="tab === 'audit'" class="page">
        <div class="page-title">
          <div>
            <span class="eyebrow">HEALTH CENTER</span>
            <h1>健康检查</h1>
            <p>识别失效来源、失效链接、真实目录冲突和未接管的外部链接。</p>
          </div>
          <el-button :icon="Refresh" @click="refresh(true)">重新检查</el-button>
        </div>
        <div class="audit-list glass">
          <div v-for="a in data.audit" :key="a.type + a.detail" class="audit-row">
            <span class="audit-dot" :class="a.level"></span>
            <div>
              <b>{{ a.title }}</b>
              <p>{{ a.detail }}</p>
            </div>
            <el-tag :type="a.level === 'error' ? 'danger' : 'warning'" round>{{ a.type }}</el-tag>
          </div>
          <el-empty v-if="!data.audit.length" description="没有发现问题，当前状态健康" />
        </div>
      </section>

      <section v-else-if="tab === 'history'" class="page">
        <div class="page-title">
          <div>
            <span class="eyebrow">ACTIVITY</span>
            <h1>操作历史</h1>
            <p>每次批量变更都有记录；成功操作可以撤销。</p>
          </div>
        </div>
        <div class="history-list glass">
          <div v-for="h in data.history" :key="h.id" class="history-row">
            <div class="history-icon"><Clock /></div>
            <div>
              <b>{{ h.kind === 'apply' ? '应用软链接变更' : '系统操作' }}</b>
              <p>
                {{ new Date(h.created_at).toLocaleString() }} ·
                {{ h.details?.completed?.length || 0 }} 项
              </p>
            </div>
            <el-tag :type="h.status === 'success' ? 'success' : 'warning'" round>{{
              h.undone_at ? '已撤销' : h.status
            }}</el-tag
            ><el-button v-if="h.status === 'success' && !h.undone_at" @click="undo(h)"
              >撤销</el-button
            >
          </div>
          <el-empty v-if="!data.history.length" description="还没有操作记录" />
        </div>
      </section>

      <section v-else class="page">
        <div class="page-title">
          <div>
            <span class="eyebrow">PREFERENCES</span>
            <h1>设置</h1>
            <p>管理外观并导出或恢复配置。真实技能目录和项目文件不会被打包。</p>
          </div>
        </div>
        <div class="settings-grid">
          <article class="setting-card theme-setting glass">
            <div class="setting-icon"><Monitor /></div>
            <div>
              <h3>外观</h3>
              <p>跟随系统会在 macOS 外观变化时自动切换。</p>
            </div>
            <el-segmented
              v-model="themeMode"
              class="apple-segmented"
              :options="themeOptions"
              aria-label="外观模式"
            />
          </article>
          <article class="setting-card glass">
            <div class="setting-icon"><Download /></div>
            <div>
              <h3>导出配置</h3>
              <p>导出项目、技能源、组合、标签和别名。</p>
            </div>
            <el-button @click="exportConfig">导出 JSON</el-button>
          </article>
          <article class="setting-card glass">
            <div class="setting-icon"><Upload /></div>
            <div>
              <h3>导入配置</h3>
              <p>合并有效配置，重复路径会安全跳过。</p>
            </div>
            <el-upload
              :show-file-list="false"
              accept="application/json"
              :before-upload="importConfig"
              ><el-button>选择文件</el-button></el-upload
            >
          </article>
        </div>
      </section>
    </main>
  </div>

  <el-dialog v-model="projectDialog" title="添加项目" width="560"
    ><el-form class="apple-dialog-form project-form" label-position="top"
      ><el-form-item label="项目目录"
        ><el-input
          v-model="projectForm.path"
          class="apple-dialog-input project-path-input"
          placeholder="选择任意本地项目目录"
          ><template #append
            ><el-button :icon="FolderOpened" @click="choose(projectForm, '选择要管理的项目目录')"
              >选择…</el-button
            ></template
          ></el-input
        ></el-form-item
      ><el-form-item label="显示名称（可选）"
        ><el-input
          v-model="projectForm.name"
          class="apple-dialog-input"
          placeholder="默认使用目录名" /></el-form-item></el-form
    ><template #footer
      ><el-button @click="projectDialog = false">取消</el-button
      ><el-button type="primary" :disabled="!projectForm.path" @click="addProject"
        >添加项目</el-button
      ></template
    ></el-dialog
  >
  <el-dialog v-model="sourceDialog" title="添加技能源" width="560"
    ><el-form class="apple-dialog-form source-form" label-position="top"
      ><el-form-item label="来源类型"
        ><el-segmented
          v-model="sourceForm.mode"
          class="apple-segmented"
          :options="[
            { label: '技能包（递归发现）', value: 'pack' },
            { label: '单个技能', value: 'single' },
          ]" /></el-form-item
      ><el-form-item label="目录"
        ><el-input
          v-model="sourceForm.path"
          class="apple-dialog-input"
          placeholder="选择含 SKILL.md 的技能或技能包"
          ><template #append
            ><el-button :icon="FolderOpened" @click="choose(sourceForm, '选择技能或技能包目录')"
              >选择…</el-button
            ></template
          ></el-input
        ></el-form-item
      ><el-form-item label="来源名称（可选）"
        ><el-input
          v-model="sourceForm.name"
          class="apple-dialog-input"
          placeholder="默认使用目录名" /></el-form-item></el-form
    ><template #footer
      ><el-button @click="sourceDialog = false">取消</el-button
      ><el-button type="primary" :disabled="!sourceForm.path" @click="addSource"
        >添加并扫描</el-button
      ></template
    ></el-dialog
  >
  <el-dialog v-model="bundleDialog" title="新建技能组合" width="960" class="apple-workflow-dialog">
    <el-form class="apple-dialog-form bundle-form" label-position="top">
      <div class="bundle-meta-grid">
        <el-form-item label="组合名称">
          <el-input v-model="bundleForm.name" class="apple-dialog-input" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input
            v-model="bundleForm.description"
            class="apple-dialog-input bundle-description-input"
            type="textarea"
          />
        </el-form-item>
      </div>
      <el-form-item label="选择技能">
        <div class="batch-skill-picker">
          <div class="apple-select batch-source-select">
            <el-select
              v-model="bundleSourceFilter"
              aria-label="筛选技能源"
              popper-class="apple-select-popper"
            >
              <el-option
                v-for="option in sourceOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </div>
          <span class="batch-selection-count">已选择 {{ bundleForm.skillIds.length }} 项</span>
        </div>
      </el-form-item>
    </el-form>
    <div class="batch-skill-table bundle-skill-table glass">
      <el-table
        ref="bundleSkillTable"
        :data="filteredBundleSkills"
        row-key="id"
        height="360"
        empty-text="当前筛选没有技能"
        @selection-change="handleBundleSkillSelection"
      >
        <el-table-column
          type="selection"
          width="48"
          :reserve-selection="true"
          :selectable="isGroupBatchSkillSelectable"
        />
        <el-table-column label="技能" min-width="280">
          <template #default="{ row }">
            <div class="skill-name">
              <button
                class="star"
                type="button"
                :aria-label="`${row.favorite ? '取消收藏' : '收藏'}技能 ${row.name}`"
                :aria-pressed="row.favorite"
                @click.stop="toggleFavorite(row)"
              >
                <el-icon :class="{ on: row.favorite }"><Star /></el-icon>
              </button>
              <div>
                <b :title="row.name">{{ row.name }}</b>
                <small>{{ row.description || row.path }}</small>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="技能源" width="190">
          <template #default="{ row }">
            <div class="source-text">
              <b>{{ sourceName(row) }}</b>
              <small>{{ sourceMode(row) }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="alias" label="链接名" width="150" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <span class="status" :class="row.available ? 'linked' : 'broken'">{{
              row.available ? '可用' : '不可用'
            }}</span>
          </template>
        </el-table-column>
        <el-table-column label="标签" width="150">
          <template #default="{ row }">
            <el-tag v-for="t in row.tags.slice(0, 2)" :key="t" round>{{ t }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <template #footer>
      <el-button @click="bundleDialog = false">取消</el-button>
      <el-button type="primary" :disabled="!bundleForm.name" @click="createBundle"
        >创建组合</el-button
      >
    </template>
  </el-dialog>
  <el-dialog v-model="groupDialog" :title="editingGroupId ? '编辑项目组' : '新建项目组'" width="480"
    ><el-form class="apple-dialog-form group-form" label-position="top"
      ><el-form-item label="项目组名称"
        ><el-input v-model.trim="groupForm.name" class="apple-dialog-input" /></el-form-item
      ><el-form-item label="标识颜色"
        ><div class="apple-color-field">
          <el-color-picker v-model="groupForm.color" :predefine="groupColorPresets" />
          <span class="apple-color-value">{{ groupForm.color }}</span>
        </div></el-form-item
      ></el-form
    ><template #footer
      ><el-button @click="groupDialog = false">取消</el-button
      ><el-button
        type="primary"
        :loading="groupSaving"
        :disabled="!groupForm.name"
        @click="saveGroup"
        >{{ editingGroupId ? '保存' : '创建' }}</el-button
      ></template
    ></el-dialog
  >
  <el-dialog
    v-model="groupSkillsDialog"
    :title="`批量配置技能 · ${activeGroupBatch?.name || ''}`"
    width="960"
    class="apple-workflow-dialog"
  >
    <el-form class="apple-dialog-form group-skills-form" label-position="top">
      <el-form-item label="操作方式">
        <el-segmented
          v-model="groupBatch.action"
          class="apple-segmented"
          aria-label="批量操作方式"
          :options="[
            { label: '加入链接', value: 'link' },
            { label: '替换异常链接', value: 'replace' },
            { label: '移除链接', value: 'remove' },
          ]"
        />
      </el-form-item>
      <el-form-item label="选择技能">
        <div class="batch-skill-picker">
          <div class="apple-select batch-source-select">
            <el-select
              v-model="groupBatchSourceFilter"
              aria-label="筛选技能源"
              popper-class="apple-select-popper"
            >
              <el-option
                v-for="option in sourceOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </div>
          <span class="batch-selection-count">已选择 {{ groupBatch.skillIds.length }} 项</span>
        </div>
      </el-form-item>
    </el-form>
    <div class="batch-skill-table glass">
      <el-table
        ref="groupBatchSkillTable"
        :data="filteredGroupBatchSkills"
        row-key="id"
        height="360"
        empty-text="当前筛选没有技能"
        @selection-change="handleGroupBatchSkillSelection"
      >
        <el-table-column
          type="selection"
          width="48"
          :reserve-selection="true"
          :selectable="isGroupBatchSkillSelectable"
        />
        <el-table-column label="技能" min-width="280">
          <template #default="{ row }">
            <div class="skill-name">
              <button
                class="star"
                type="button"
                :aria-label="`${row.favorite ? '取消收藏' : '收藏'}技能 ${row.name}`"
                :aria-pressed="row.favorite"
                @click.stop="toggleFavorite(row)"
              >
                <el-icon :class="{ on: row.favorite }"><Star /></el-icon>
              </button>
              <div>
                <b :title="row.name">{{ row.name }}</b>
                <small>{{ row.description || row.path }}</small>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="技能源" width="190">
          <template #default="{ row }">
            <div class="source-text">
              <b>{{ sourceName(row) }}</b>
              <small>{{ sourceMode(row) }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="alias" label="链接名" width="150" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <span class="status" :class="row.available ? 'linked' : 'broken'">{{
              row.available ? '可用' : '不可用'
            }}</span>
          </template>
        </el-table-column>
        <el-table-column label="标签" width="150">
          <template #default="{ row }">
            <el-tag v-for="t in row.tags.slice(0, 2)" :key="t" round>{{ t }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <el-alert
      class="apple-inline-alert"
      :title="`将为组内 ${data.projects.filter((project) => project.groupId === groupBatch.groupId).length} 个项目生成统一变更计划。`"
      type="info"
      :closable="false"
    />
    <template #footer>
      <el-button @click="groupSkillsDialog = false">取消</el-button>
      <el-button
        type="primary"
        :loading="groupBatchLoading"
        :disabled="!groupBatch.skillIds.length"
        @click="stageGroupSkills"
        >预览变更计划</el-button
      >
    </template>
  </el-dialog>
  <el-dialog v-model="skillDialog" title="编辑技能" width="520"
    ><el-form class="apple-dialog-form skill-form" label-position="top"
      ><el-form-item label="项目内链接名"
        ><el-input v-model="skillForm.alias" class="apple-dialog-input" />
        <div class="el-form-item__description">
          仅影响以后创建的软链接名称，不修改技能源目录。
        </div></el-form-item
      ><el-form-item label="标签"
        ><el-input
          v-model="skillForm.tags"
          class="apple-dialog-input"
          placeholder="用逗号分隔，例如：论文, 前端, 常用" /></el-form-item></el-form
    ><template #footer
      ><el-button @click="skillDialog = false">取消</el-button
      ><el-button type="primary" @click="saveSkill">保存</el-button></template
    ></el-dialog
  >
  <el-dialog v-model="bundleApplyDialog" title="应用技能组合" width="520"
    ><el-form class="apple-dialog-form bundle-apply-form" label-position="top"
      ><el-form-item label="目标项目"
        ><el-select
          v-model="bundleApply.projectId"
          class="apple-dialog-input full-dialog-select"
          aria-label="目标项目"
          style="width: 100%"
          ><el-option
            v-for="p in data.projects"
            :key="p.id"
            :label="p.name"
            :value="p.id" /></el-select></el-form-item></el-form
    ><el-alert
      title="应用后会持续检查该项目与组合之间的配置漂移。"
      type="info"
      :closable="false"
    /><template #footer
      ><el-button @click="bundleApplyDialog = false">取消</el-button
      ><el-button type="primary" :disabled="!bundleApply.projectId" @click="stageBundle"
        >生成变更计划</el-button
      ></template
    ></el-dialog
  >
  <el-dialog v-model="planDialog" title="确认变更计划" width="720"
    ><el-alert
      v-if="currentPlan?.warnings.length"
      :title="`${currentPlan.warnings.length} 项被安全跳过`"
      type="warning"
      show-icon
      :closable="false"
    />
    <div class="plan-summary">
      <b>将应用 {{ currentPlan?.items.length || 0 }} 项变更</b>
      <span v-if="planScopeLabel">{{ planScopeLabel }}</span>
      <p>管理器只会创建或移除软链接，真实目录和普通文件绝不会被覆盖。</p>
    </div>
    <div class="plan-items">
      <div v-for="i in currentPlan?.items" :key="i.target">
        <el-tag round>{{ planActionText[i.action] }}</el-tag
        ><code>{{ i.target }}</code>
      </div>
    </div>
    <template #footer
      ><el-button @click="planDialog = false">返回检查</el-button
      ><el-button
        type="primary"
        :loading="applying"
        :disabled="!currentPlan?.items.length && !currentPlan?.bundleId"
        @click="applyPlan"
        >确认并应用</el-button
      ></template
    ></el-dialog
  >
</template>
