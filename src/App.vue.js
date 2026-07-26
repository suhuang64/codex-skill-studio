import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { FolderAdd, Plus, Refresh, Search, Setting, Collection, Link, Warning, Clock, House, Star, Download, Upload, Monitor, ArrowDown, EditPen, Delete, MagicStick, Filter, Sort, Tools, MoreFilled, FolderOpened, } from '@element-plus/icons-vue';
import { api, patch, post, remove } from './api';
import { renderMarkdown } from './markdown';
const THEME_STORAGE_KEY = 'skill-studio-theme';
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
const themeMode = ref(savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system'
    ? savedTheme
    : 'system');
const systemDark = ref(systemTheme.matches);
const resolvedTheme = computed(() => themeMode.value === 'system' ? (systemDark.value ? 'dark' : 'light') : themeMode.value);
const themeOptions = [
    { label: '跟随系统', value: 'system' },
    { label: '浅色', value: 'light' },
    { label: '深色', value: 'dark' },
];
const groupColorPresets = [
    '#007AFF',
    '#34C759',
    '#FF9500',
    '#FF3B30',
    '#AF52DE',
    '#5AC8FA',
    '#8E8E93',
];
const linkStatusText = {
    linked: '已链接',
    missing: '未链接',
    broken: '已失效',
    other_link: '其他链接',
    conflict: '真实冲突',
};
const planActionText = {
    link: '新增',
    replace: '替换',
    remove: '移除',
};
function applyTheme() {
    const theme = resolvedTheme.value;
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, themeMode.value);
}
function handleSystemTheme(event) {
    systemDark.value = event.matches;
}
watch([themeMode, systemDark], applyTheme, { immediate: true });
systemTheme.addEventListener('change', handleSystemTheme);
onBeforeUnmount(() => systemTheme.removeEventListener('change', handleSystemTheme));
const data = reactive({ projects: [], sources: [], skills: [], groups: [], bundles: [], audit: [], history: [] });
const loading = ref(true), tab = ref('overview'), query = ref(''), statusFilter = ref('all'), sourceFilter = ref('all'), projectGroupFilter = ref('all'), projectGroupSort = ref('name'), groupBatchSourceFilter = ref('all'), bundleSourceFilter = ref('all'), selectedProject = ref(''), statuses = ref([]), selectedSkills = ref([]), collapsedGroups = ref([]);
const projectDialog = ref(false), sourceDialog = ref(false), bundleDialog = ref(false), planDialog = ref(false), groupDialog = ref(false), groupSkillsDialog = ref(false), skillDialog = ref(false), skillDetailDialog = ref(false), bundleApplyDialog = ref(false);
const projectForm = reactive({ name: '', path: '' }), sourceForm = reactive({ name: '', path: '', mode: 'pack' }), bundleForm = reactive({ name: '', description: '', skillIds: [] });
const groupForm = reactive({ name: '', color: '#007AFF' }), groupBatch = reactive({
    groupId: '',
    skillIds: [],
    action: 'link',
}), skillForm = reactive({ id: '', alias: '', tags: '' }), bundleApply = reactive({ bundleId: '', projectId: '' });
const currentPlan = ref(null), bundleSkillTable = ref(), groupBatchSkillTable = ref(), applying = ref(false), groupSaving = ref(false), groupBatchLoading = ref(false), skillDetailLoading = ref(false), skillDetail = ref(null), skillDetailContent = ref(''), editingGroupId = ref(''), planScopeLabel = ref('');
const nav = [
    ['overview', '总览', House],
    ['projects', '项目', FolderAdd],
    ['skills', '技能库', Collection],
    ['bundles', '技能组合', Link],
    ['audit', '健康检查', Warning],
    ['history', '操作历史', Clock],
    ['settings', '设置', Setting],
];
async function refresh(message = false) {
    loading.value = true;
    try {
        Object.assign(data, await api('/bootstrap'));
        if (!selectedProject.value && data.projects[0])
            selectedProject.value = data.projects[0].id;
        if (selectedProject.value)
            await loadStatus();
        if (message)
            ElMessage.success('状态已刷新');
    }
    catch (e) {
        ElMessage.error(e.message);
    }
    finally {
        loading.value = false;
    }
}
async function loadStatus() {
    if (!selectedProject.value) {
        statuses.value = [];
        return;
    }
    statuses.value = await api(`/projects/${selectedProject.value}/status`);
}
watch(selectedProject, loadStatus);
const sourceById = computed(() => new Map(data.sources.map((source) => [source.id, source])));
const sourceOptions = computed(() => [
    { label: '全部技能源', value: 'all' },
    ...data.sources.map((source) => ({
        label: source.name +
            '（' +
            data.skills.filter((skill) => skill.sourceId === source.id).length +
            '）',
        value: source.id,
    })),
]);
function sourceName(row) {
    return sourceById.value.get(row.sourceId)?.name || '未知来源';
}
function sourceMode(row) {
    return sourceById.value.get(row.sourceId)?.mode === 'single' ? '单个技能' : '技能包';
}
const filteredSkills = computed(() => {
    const q = query.value.toLowerCase();
    return statuses.value.filter((s) => (statusFilter.value === 'all' || s.status === statusFilter.value) &&
        (sourceFilter.value === 'all' || s.sourceId === sourceFilter.value) &&
        (!q ||
            `${s.name} ${s.description} ${sourceName(s)} ${s.path} ${s.tags.join(' ')}`
                .toLowerCase()
                .includes(q)));
});
const filteredGroupBatchSkills = computed(() => data.skills.filter((skill) => groupBatchSourceFilter.value === 'all' || skill.sourceId === groupBatchSourceFilter.value));
const filteredBundleSkills = computed(() => data.skills.filter((skill) => bundleSourceFilter.value === 'all' || skill.sourceId === bundleSourceFilter.value));
const linkedCount = computed(() => statuses.value.filter((s) => s.status === 'linked').length);
const skillDetailHtml = computed(() => renderMarkdown(skillDetailContent.value));
const errors = computed(() => data.audit.filter((a) => a.level === 'error').length);
const groupById = computed(() => new Map(data.groups.map((group) => [group.id, group])));
const projectGroupSections = computed(() => {
    const sections = data.groups.map((group) => ({
        ...group,
        projects: data.projects.filter((project) => project.groupId === group.id),
        managed: true,
    }));
    const ungrouped = {
        id: 'ungrouped',
        name: '未分组',
        color: '#94A3B8',
        created_at: '',
        projects: data.projects.filter((project) => !project.groupId),
        managed: false,
    };
    if (ungrouped.projects.length)
        sections.push(ungrouped);
    const filtered = projectGroupFilter.value === 'all'
        ? sections
        : sections.filter((section) => section.id === projectGroupFilter.value);
    return [...filtered].sort((a, b) => {
        if (!a.managed)
            return 1;
        if (!b.managed)
            return -1;
        if (projectGroupSort.value === 'count')
            return b.projects.length - a.projects.length || a.name.localeCompare(b.name, 'zh-CN');
        if (projectGroupSort.value === 'created')
            return String(b.created_at).localeCompare(String(a.created_at));
        return a.name.localeCompare(b.name, 'zh-CN');
    });
});
const projectSelectGroups = computed(() => {
    const sections = data.groups.map((group) => ({
        ...group,
        projects: data.projects.filter((project) => project.groupId === group.id),
    }));
    const ungrouped = data.projects.filter((project) => !project.groupId);
    if (ungrouped.length)
        sections.push({ id: 'ungrouped', name: '未分组', color: '#94A3B8', projects: ungrouped });
    return sections.filter((section) => section.projects.length);
});
const activeGroupBatch = computed(() => groupById.value.get(groupBatch.groupId));
function groupForProject(project) {
    return groupById.value.get(project.groupId);
}
function isGroupCollapsed(id) {
    return collapsedGroups.value.includes(id);
}
function toggleGroup(id) {
    collapsedGroups.value = isGroupCollapsed(id)
        ? collapsedGroups.value.filter((groupId) => groupId !== id)
        : [...collapsedGroups.value, id];
}
async function choose(target, title) {
    const r = await post('/dialog/directory', { title });
    if (r.path)
        target.path = r.path;
}
async function addProject() {
    try {
        await post('/projects', projectForm);
        projectDialog.value = false;
        Object.assign(projectForm, { name: '', path: '' });
        await refresh();
        ElMessage.success('项目已添加');
    }
    catch (e) {
        ElMessage.error(e.message);
    }
}
function openProjectSkills(project) {
    selectedProject.value = project.id;
    tab.value = 'skills';
}
async function addSource() {
    try {
        const r = await post('/sources', sourceForm);
        sourceDialog.value = false;
        Object.assign(sourceForm, { name: '', path: '', mode: 'pack' });
        await refresh();
        ElMessage.success(`已发现 ${r.count} 个技能`);
    }
    catch (e) {
        ElMessage.error(e.message);
    }
}
async function rescan() {
    try {
        const r = await post('/scan');
        await refresh();
        ElMessage.success(`扫描完成，共识别 ${r.count} 个技能`);
    }
    catch (e) {
        ElMessage.error(e.message);
    }
}
async function confirmDelete(kind, row) {
    try {
        await ElMessageBox.confirm(`只会取消注册“${row.name}”，不会删除磁盘上的真实目录。`, '确认取消注册', { type: 'warning', confirmButtonText: '取消注册', cancelButtonText: '保留' });
        await remove(`/${kind}/${row.id}`);
        if (selectedProject.value === row.id)
            selectedProject.value = '';
        await refresh();
        ElMessage.success('已取消注册');
    }
    catch (e) {
        if (e === 'cancel' || e === 'close')
            return;
        ElMessage.error(`取消注册失败：${e?.message || e}`);
    }
}
async function toggleFavorite(row) {
    const favorite = !row.favorite;
    await patch(`/skills/${row.id}`, { favorite });
    if (skillDetail.value?.id === row.id)
        skillDetail.value = { ...skillDetail.value, favorite };
    await refresh();
}
async function openSkillDetail(row, _column, event) {
    const target = event?.target;
    if (target instanceof Element &&
        target.closest('button, .el-checkbox, .el-table__selection-column'))
        return;
    skillDetail.value = { ...row };
    skillDetailContent.value = '';
    skillDetailDialog.value = true;
    skillDetailLoading.value = true;
    try {
        const detail = await api(`/skills/${row.id}/detail`);
        if (skillDetail.value?.id === row.id)
            skillDetailContent.value = detail.content || '';
    }
    catch (e) {
        ElMessage.error(`读取技能详情失败：${e.message}`);
    }
    finally {
        if (skillDetail.value?.id === row.id)
            skillDetailLoading.value = false;
    }
}
async function stage(action) {
    if (!selectedProject.value || !selectedSkills.value.length)
        return ElMessage.warning('请先选择项目并勾选技能');
    try {
        currentPlan.value = await post('/plans', {
            projectIds: [selectedProject.value],
            skillIds: selectedSkills.value.map((s) => s.id),
            action,
        });
        planScopeLabel.value =
            data.projects.find((project) => project.id === selectedProject.value)?.name || '';
        planDialog.value = true;
    }
    catch (e) {
        ElMessage.error(e.message);
    }
}
async function applyPlan() {
    if (!currentPlan.value)
        return;
    applying.value = true;
    try {
        const r = await post(`/plans/${currentPlan.value.id}/apply`);
        planDialog.value = false;
        currentPlan.value = null;
        planScopeLabel.value = '';
        selectedSkills.value = [];
        await refresh();
        ElMessage.success(`已安全应用 ${r.completed} 项变更`);
    }
    catch (e) {
        ElMessage.error(`应用失败，已回滚：${e.message}`);
    }
    finally {
        applying.value = false;
    }
}
async function undo(row) {
    await ElMessageBox.confirm('撤销将恢复本次操作之前的软链接状态。', '撤销操作', {
        type: 'warning',
    });
    try {
        await post(`/operations/${row.id}/undo`);
        await refresh();
        ElMessage.success('已撤销');
    }
    catch (e) {
        ElMessage.error(e.message);
    }
}
async function createBundle() {
    try {
        await post('/bundles', bundleForm);
        bundleDialog.value = false;
        Object.assign(bundleForm, { name: '', description: '', skillIds: [] });
        await refresh();
        ElMessage.success('技能组合已创建');
    }
    catch (e) {
        ElMessage.error(e.message);
    }
}
function openBundleDialog() {
    Object.assign(bundleForm, { name: '', description: '', skillIds: [] });
    bundleSourceFilter.value = 'all';
    bundleDialog.value = true;
    nextTick(() => bundleSkillTable.value?.clearSelection());
}
function handleBundleSkillSelection(rows) {
    bundleForm.skillIds = rows.map((row) => row.id);
}
function openCreateGroup() {
    editingGroupId.value = '';
    Object.assign(groupForm, { name: '', color: '#007AFF' });
    groupDialog.value = true;
}
function openEditGroup(group) {
    editingGroupId.value = group.id;
    Object.assign(groupForm, { name: group.name, color: group.color });
    groupDialog.value = true;
}
async function saveGroup() {
    groupSaving.value = true;
    try {
        if (editingGroupId.value)
            await patch(`/groups/${editingGroupId.value}`, groupForm);
        else
            await post('/groups', groupForm);
        groupDialog.value = false;
        await refresh();
        ElMessage.success(editingGroupId.value ? '项目组已更新' : '项目组已创建');
    }
    catch (e) {
        ElMessage.error(e.message);
    }
    finally {
        groupSaving.value = false;
    }
}
async function confirmDeleteGroup(group) {
    const count = data.projects.filter((project) => project.groupId === group.id).length;
    try {
        await ElMessageBox.confirm(`删除“${group.name}”后，${count} 个成员项目将变为未分组。项目目录和技能链接不会被删除。`, '删除项目组', { type: 'warning', confirmButtonText: '删除项目组', cancelButtonText: '保留' });
        await remove(`/groups/${group.id}`);
        if (projectGroupFilter.value === group.id)
            projectGroupFilter.value = 'all';
        collapsedGroups.value = collapsedGroups.value.filter((id) => id !== group.id);
        await refresh();
        ElMessage.success('项目组已删除，成员项目已移至未分组');
    }
    catch (e) {
        if (e === 'cancel' || e === 'close')
            return;
        ElMessage.error(`删除项目组失败：${e?.message || e}`);
    }
}
async function assignGroup(project, groupId) {
    try {
        await patch(`/projects/${project.id}/group`, { groupId });
        await refresh();
        ElMessage.success(groupId ? '项目分组已更新' : '项目已移至未分组');
    }
    catch (e) {
        ElMessage.error(e.message);
    }
}
function openGroupSkills(group) {
    const projectCount = data.projects.filter((project) => project.groupId === group.id).length;
    if (!projectCount)
        return ElMessage.warning('该项目组中还没有项目');
    Object.assign(groupBatch, { groupId: group.id, skillIds: [], action: 'link' });
    groupBatchSourceFilter.value = 'all';
    groupSkillsDialog.value = true;
    nextTick(() => groupBatchSkillTable.value?.clearSelection());
}
function handleGroupBatchSkillSelection(rows) {
    groupBatch.skillIds = rows.map((row) => row.id);
}
function isGroupBatchSkillSelectable(row) {
    return !!row.available;
}
async function stageGroupSkills() {
    const group = activeGroupBatch.value;
    const projectIds = data.projects
        .filter((project) => project.groupId === groupBatch.groupId)
        .map((project) => project.id);
    if (!group || !projectIds.length || !groupBatch.skillIds.length)
        return ElMessage.warning('请选择至少一个技能');
    groupBatchLoading.value = true;
    try {
        currentPlan.value = await post('/plans', {
            projectIds,
            skillIds: groupBatch.skillIds,
            action: groupBatch.action,
        });
        planScopeLabel.value = `${group.name} · ${projectIds.length} 个项目`;
        groupSkillsDialog.value = false;
        planDialog.value = true;
    }
    catch (e) {
        ElMessage.error(e.message);
    }
    finally {
        groupBatchLoading.value = false;
    }
}
function editSkill(row) {
    Object.assign(skillForm, { id: row.id, alias: row.alias, tags: row.tags.join(', ') });
    skillDialog.value = true;
}
function editSkillFromDetail() {
    if (!skillDetail.value)
        return;
    skillDetailDialog.value = false;
    editSkill(skillDetail.value);
}
async function saveSkill() {
    try {
        await patch(`/skills/${skillForm.id}`, {
            alias: skillForm.alias,
            tags: skillForm.tags
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter(Boolean),
        });
        skillDialog.value = false;
        await refresh();
        ElMessage.success('技能信息已更新');
    }
    catch (e) {
        ElMessage.error(e.message);
    }
}
function openBundleApply(bundle) {
    Object.assign(bundleApply, { bundleId: bundle.id, projectId: data.projects[0]?.id || '' });
    bundleApplyDialog.value = true;
}
async function stageBundle() {
    const bundle = data.bundles.find((b) => b.id === bundleApply.bundleId);
    if (!bundle || !bundleApply.projectId)
        return;
    currentPlan.value = await post('/plans', {
        projectIds: [bundleApply.projectId],
        skillIds: bundle.skillIds,
        action: 'link',
        bundleId: bundle.id,
    });
    planScopeLabel.value =
        data.projects.find((project) => project.id === bundleApply.projectId)?.name || '';
    bundleApplyDialog.value = false;
    planDialog.value = true;
}
function exportConfig() {
    api('/export').then((obj) => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `skill-manager-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });
}
async function importConfig(file) {
    try {
        await post('/import', JSON.parse(await file.text()));
        await refresh();
        ElMessage.success('配置已导入');
    }
    catch (e) {
        ElMessage.error(e.message);
    }
    return false;
}
onMounted(refresh);
const __VLS_ctx = {
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "ambient ambient-one" },
});
/** @type {__VLS_StyleScopedClasses['ambient']} */ ;
/** @type {__VLS_StyleScopedClasses['ambient-one']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "ambient ambient-two" },
});
/** @type {__VLS_StyleScopedClasses['ambient']} */ ;
/** @type {__VLS_StyleScopedClasses['ambient-two']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "app-shell" },
});
__VLS_asFunctionalDirective(__VLS_directives.vLoading, {})(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.loading), }, null, null);
/** @type {__VLS_StyleScopedClasses['app-shell']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.header, __VLS_intrinsics.header)({
    ...{ class: "topbar glass" },
});
/** @type {__VLS_StyleScopedClasses['topbar']} */ ;
/** @type {__VLS_StyleScopedClasses['glass']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "brand" },
});
/** @type {__VLS_StyleScopedClasses['brand']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "brand-mark" },
});
/** @type {__VLS_StyleScopedClasses['brand-mark']} */ ;
let __VLS_0;
/** @ts-ignore @type { | typeof __VLS_components.Link} */
Link;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({}));
const __VLS_2 = __VLS_1({}, ...__VLS_functionalComponentArgsRest(__VLS_1));
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.nav, __VLS_intrinsics.nav)({
    ...{ class: "tabs" },
    'aria-label': "主导航",
});
/** @type {__VLS_StyleScopedClasses['tabs']} */ ;
for (const [[key, label, icon]] of __VLS_vFor((__VLS_ctx.nav))) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                return (__VLS_ctx.tab = key);
                // @ts-ignore
                [vLoading, loading, nav, tab,];
            } },
        key: (key),
        ...{ class: ({ active: __VLS_ctx.tab === key }) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    let __VLS_5;
    /** @ts-ignore @type { | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon'] | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon']} */
    elIcon;
    // @ts-ignore
    const __VLS_6 = __VLS_asFunctionalComponent1(__VLS_5, new __VLS_5({}));
    const __VLS_7 = __VLS_6({}, ...__VLS_functionalComponentArgsRest(__VLS_6));
    const { default: __VLS_10 } = __VLS_8.slots;
    const __VLS_11 = (icon);
    // @ts-ignore
    const __VLS_12 = __VLS_asFunctionalComponent1(__VLS_11, new __VLS_11({}));
    const __VLS_13 = __VLS_12({}, ...__VLS_functionalComponentArgsRest(__VLS_12));
    // @ts-ignore
    [tab,];
    var __VLS_8;
    (label);
    if (key === 'audit' && __VLS_ctx.data.audit.length) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
            ...{ class: "nav-badge" },
        });
        /** @type {__VLS_StyleScopedClasses['nav-badge']} */ ;
        (__VLS_ctx.data.audit.length);
    }
    // @ts-ignore
    [data, data,];
}
let __VLS_16;
/** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
elButton;
// @ts-ignore
const __VLS_17 = __VLS_asFunctionalComponent1(__VLS_16, new __VLS_16({
    ...{ 'onClick': {} },
    circle: true,
    icon: (__VLS_ctx.Refresh),
    'aria-label': "刷新",
}));
const __VLS_18 = __VLS_17({
    ...{ 'onClick': {} },
    circle: true,
    icon: (__VLS_ctx.Refresh),
    'aria-label': "刷新",
}, ...__VLS_functionalComponentArgsRest(__VLS_17));
let __VLS_21;
const __VLS_22 = {
    /** @type {typeof __VLS_21.click} */
    onClick: (...[$event]) => {
        return (__VLS_ctx.refresh(true));
        // @ts-ignore
        [Refresh, refresh,];
    },
};
var __VLS_19;
var __VLS_20;
__VLS_asFunctionalElement1(__VLS_intrinsics.main, __VLS_intrinsics.main)({});
if (__VLS_ctx.tab === 'overview') {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "page" },
    });
    /** @type {__VLS_StyleScopedClasses['page']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "hero glass" },
    });
    /** @type {__VLS_StyleScopedClasses['hero']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "hero-actions" },
    });
    /** @type {__VLS_StyleScopedClasses['hero-actions']} */ ;
    let __VLS_23;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_24 = __VLS_asFunctionalComponent1(__VLS_23, new __VLS_23({
        ...{ 'onClick': {} },
        type: "primary",
        size: "large",
        icon: (__VLS_ctx.FolderAdd),
    }));
    const __VLS_25 = __VLS_24({
        ...{ 'onClick': {} },
        type: "primary",
        size: "large",
        icon: (__VLS_ctx.FolderAdd),
    }, ...__VLS_functionalComponentArgsRest(__VLS_24));
    let __VLS_28;
    const __VLS_29 = {
        /** @type {typeof __VLS_28.click} */
        onClick: (...[$event]) => {
            if (!(__VLS_ctx.tab === 'overview'))
                throw 0;
            return (__VLS_ctx.projectDialog = true);
            // @ts-ignore
            [tab, FolderAdd, projectDialog,];
        },
    };
    const { default: __VLS_30 } = __VLS_26.slots;
    // @ts-ignore
    [];
    var __VLS_26;
    var __VLS_27;
    let __VLS_31;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_32 = __VLS_asFunctionalComponent1(__VLS_31, new __VLS_31({
        ...{ 'onClick': {} },
        size: "large",
        icon: (__VLS_ctx.Plus),
    }));
    const __VLS_33 = __VLS_32({
        ...{ 'onClick': {} },
        size: "large",
        icon: (__VLS_ctx.Plus),
    }, ...__VLS_functionalComponentArgsRest(__VLS_32));
    let __VLS_36;
    const __VLS_37 = {
        /** @type {typeof __VLS_36.click} */
        onClick: (...[$event]) => {
            if (!(__VLS_ctx.tab === 'overview'))
                throw 0;
            return (__VLS_ctx.sourceDialog = true);
            // @ts-ignore
            [Plus, sourceDialog,];
        },
    };
    const { default: __VLS_38 } = __VLS_34.slots;
    // @ts-ignore
    [];
    var __VLS_34;
    var __VLS_35;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "orb" },
    });
    /** @type {__VLS_StyleScopedClasses['orb']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (__VLS_ctx.data.skills.length);
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "metric-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['metric-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "metric glass" },
    });
    /** @type {__VLS_StyleScopedClasses['metric']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.data.projects.length);
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "metric glass" },
    });
    /** @type {__VLS_StyleScopedClasses['metric']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.data.sources.length);
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "metric glass" },
    });
    /** @type {__VLS_StyleScopedClasses['metric']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.data.bundles.length);
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "metric glass" },
        ...{ class: ({ danger: __VLS_ctx.errors }) },
    });
    /** @type {__VLS_StyleScopedClasses['metric']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    /** @type {__VLS_StyleScopedClasses['danger']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.errors);
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    (__VLS_ctx.data.audit.length);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "overview-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['overview-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "panel glass" },
    });
    /** @type {__VLS_StyleScopedClasses['panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "panel-head" },
    });
    /** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_39;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_40 = __VLS_asFunctionalComponent1(__VLS_39, new __VLS_39({
        ...{ 'onClick': {} },
        text: true,
    }));
    const __VLS_41 = __VLS_40({
        ...{ 'onClick': {} },
        text: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_40));
    let __VLS_44;
    const __VLS_45 = {
        /** @type {typeof __VLS_44.click} */
        onClick: (...[$event]) => {
            if (!(__VLS_ctx.tab === 'overview'))
                throw 0;
            return (__VLS_ctx.tab = 'projects');
            // @ts-ignore
            [tab, data, data, data, data, data, errors, errors,];
        },
    };
    const { default: __VLS_46 } = __VLS_42.slots;
    // @ts-ignore
    [];
    var __VLS_42;
    var __VLS_43;
    if (__VLS_ctx.data.projects.length) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "card-list" },
        });
        /** @type {__VLS_StyleScopedClasses['card-list']} */ ;
        for (const [p] of __VLS_vFor((__VLS_ctx.data.projects.slice(0, 4)))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                key: (p.id),
                ...{ class: "mini-card" },
            });
            /** @type {__VLS_StyleScopedClasses['mini-card']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "folder-icon project-folder-icon" },
                ...{ style: ({ '--group-color': __VLS_ctx.groupForProject(p)?.color || '#94A3B8' }) },
            });
            /** @type {__VLS_StyleScopedClasses['folder-icon']} */ ;
            /** @type {__VLS_StyleScopedClasses['project-folder-icon']} */ ;
            let __VLS_47;
            /** @ts-ignore @type { | typeof __VLS_components.FolderAdd} */
            FolderAdd;
            // @ts-ignore
            const __VLS_48 = __VLS_asFunctionalComponent1(__VLS_47, new __VLS_47({}));
            const __VLS_49 = __VLS_48({}, ...__VLS_functionalComponentArgsRest(__VLS_48));
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "mini-card-title" },
            });
            /** @type {__VLS_StyleScopedClasses['mini-card-title']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (p.name);
            if (__VLS_ctx.groupForProject(p)) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                    ...{ class: "group-badge" },
                });
                /** @type {__VLS_StyleScopedClasses['group-badge']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
                    ...{ style: ({ background: __VLS_ctx.groupForProject(p)?.color }) },
                });
                (__VLS_ctx.groupForProject(p)?.name);
            }
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            (p.path);
            // @ts-ignore
            [data, data, groupForProject, groupForProject, groupForProject, groupForProject,];
        }
    }
    else {
        let __VLS_52;
        /** @ts-ignore @type { | typeof __VLS_components.elEmpty | typeof __VLS_components.ElEmpty | typeof __VLS_components['el-empty']} */
        elEmpty;
        // @ts-ignore
        const __VLS_53 = __VLS_asFunctionalComponent1(__VLS_52, new __VLS_52({
            description: "还没有添加项目",
        }));
        const __VLS_54 = __VLS_53({
            description: "还没有添加项目",
        }, ...__VLS_functionalComponentArgsRest(__VLS_53));
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "panel glass" },
    });
    /** @type {__VLS_StyleScopedClasses['panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "panel-head" },
    });
    /** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_57;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_58 = __VLS_asFunctionalComponent1(__VLS_57, new __VLS_57({
        ...{ 'onClick': {} },
        text: true,
    }));
    const __VLS_59 = __VLS_58({
        ...{ 'onClick': {} },
        text: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_58));
    let __VLS_62;
    const __VLS_63 = {
        /** @type {typeof __VLS_62.click} */
        onClick: (...[$event]) => {
            if (!(__VLS_ctx.tab === 'overview'))
                throw 0;
            return (__VLS_ctx.tab = 'audit');
            // @ts-ignore
            [tab,];
        },
    };
    const { default: __VLS_64 } = __VLS_60.slots;
    // @ts-ignore
    [];
    var __VLS_60;
    var __VLS_61;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "health" },
    });
    /** @type {__VLS_StyleScopedClasses['health']} */ ;
    let __VLS_65;
    /** @ts-ignore @type { | typeof __VLS_components.elProgress | typeof __VLS_components.ElProgress | typeof __VLS_components['el-progress']} */
    elProgress;
    // @ts-ignore
    const __VLS_66 = __VLS_asFunctionalComponent1(__VLS_65, new __VLS_65({
        type: "dashboard",
        strokeWidth: (10),
        percentage: (__VLS_ctx.data.audit.length ? Math.max(0, 100 - __VLS_ctx.data.audit.length * 8) : 100),
        color: (__VLS_ctx.data.audit.length ? '#ff9f0a' : '#34c759'),
    }));
    const __VLS_67 = __VLS_66({
        type: "dashboard",
        strokeWidth: (10),
        percentage: (__VLS_ctx.data.audit.length ? Math.max(0, 100 - __VLS_ctx.data.audit.length * 8) : 100),
        color: (__VLS_ctx.data.audit.length ? '#ff9f0a' : '#34c759'),
    }, ...__VLS_functionalComponentArgsRest(__VLS_66));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (__VLS_ctx.data.audit.length ? '发现需要关注的项目' : '一切运行良好');
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.data.audit.length
        ? `共 ${__VLS_ctx.data.audit.length} 条提示，所有真实目录仍受保护。`
        : '未发现失效链接或来源冲突。');
}
else if (__VLS_ctx.tab === 'projects') {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "page" },
    });
    /** @type {__VLS_StyleScopedClasses['page']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "page-title" },
    });
    /** @type {__VLS_StyleScopedClasses['page-title']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    let __VLS_70;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_71 = __VLS_asFunctionalComponent1(__VLS_70, new __VLS_70({
        ...{ 'onClick': {} },
    }));
    const __VLS_72 = __VLS_71({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_71));
    let __VLS_75;
    const __VLS_76 = {
        /** @type {typeof __VLS_75.click} */
        onClick: (__VLS_ctx.openCreateGroup),
    };
    const { default: __VLS_77 } = __VLS_73.slots;
    // @ts-ignore
    [tab, data, data, data, data, data, data, openCreateGroup,];
    var __VLS_73;
    var __VLS_74;
    let __VLS_78;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_79 = __VLS_asFunctionalComponent1(__VLS_78, new __VLS_78({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.FolderAdd),
    }));
    const __VLS_80 = __VLS_79({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.FolderAdd),
    }, ...__VLS_functionalComponentArgsRest(__VLS_79));
    let __VLS_83;
    const __VLS_84 = {
        /** @type {typeof __VLS_83.click} */
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.tab === 'overview'))
                throw 0;
            if (!(__VLS_ctx.tab === 'projects'))
                throw 0;
            return (__VLS_ctx.projectDialog = true);
            // @ts-ignore
            [FolderAdd, projectDialog,];
        },
    };
    const { default: __VLS_85 } = __VLS_81.slots;
    // @ts-ignore
    [];
    var __VLS_81;
    var __VLS_82;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "content-frame project-frame glass" },
    });
    /** @type {__VLS_StyleScopedClasses['content-frame']} */ ;
    /** @type {__VLS_StyleScopedClasses['project-frame']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "project-controls" },
    });
    /** @type {__VLS_StyleScopedClasses['project-controls']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "project-control-strip" },
        role: "group",
        'aria-label': "项目视图控制",
    });
    /** @type {__VLS_StyleScopedClasses['project-control-strip']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "apple-select project-filter-select" },
    });
    /** @type {__VLS_StyleScopedClasses['apple-select']} */ ;
    /** @type {__VLS_StyleScopedClasses['project-filter-select']} */ ;
    let __VLS_86;
    /** @ts-ignore @type { | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon'] | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon']} */
    elIcon;
    // @ts-ignore
    const __VLS_87 = __VLS_asFunctionalComponent1(__VLS_86, new __VLS_86({}));
    const __VLS_88 = __VLS_87({}, ...__VLS_functionalComponentArgsRest(__VLS_87));
    const { default: __VLS_91 } = __VLS_89.slots;
    let __VLS_92;
    /** @ts-ignore @type { | typeof __VLS_components.Filter} */
    Filter;
    // @ts-ignore
    const __VLS_93 = __VLS_asFunctionalComponent1(__VLS_92, new __VLS_92({}));
    const __VLS_94 = __VLS_93({}, ...__VLS_functionalComponentArgsRest(__VLS_93));
    // @ts-ignore
    [];
    var __VLS_89;
    let __VLS_97;
    /** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
    elSelect;
    // @ts-ignore
    const __VLS_98 = __VLS_asFunctionalComponent1(__VLS_97, new __VLS_97({
        modelValue: (__VLS_ctx.projectGroupFilter),
        'aria-label': "筛选项目组",
        popperClass: "apple-select-popper",
    }));
    const __VLS_99 = __VLS_98({
        modelValue: (__VLS_ctx.projectGroupFilter),
        'aria-label': "筛选项目组",
        popperClass: "apple-select-popper",
    }, ...__VLS_functionalComponentArgsRest(__VLS_98));
    const { default: __VLS_102 } = __VLS_100.slots;
    let __VLS_103;
    /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
    elOption;
    // @ts-ignore
    const __VLS_104 = __VLS_asFunctionalComponent1(__VLS_103, new __VLS_103({
        label: "全部项目组",
        value: "all",
    }));
    const __VLS_105 = __VLS_104({
        label: "全部项目组",
        value: "all",
    }, ...__VLS_functionalComponentArgsRest(__VLS_104));
    for (const [group] of __VLS_vFor((__VLS_ctx.data.groups))) {
        let __VLS_108;
        /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option'] | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
        elOption;
        // @ts-ignore
        const __VLS_109 = __VLS_asFunctionalComponent1(__VLS_108, new __VLS_108({
            key: (group.id),
            label: (group.name),
            value: (group.id),
        }));
        const __VLS_110 = __VLS_109({
            key: (group.id),
            label: (group.name),
            value: (group.id),
        }, ...__VLS_functionalComponentArgsRest(__VLS_109));
        const { default: __VLS_113 } = __VLS_111.slots;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "group-option" },
        });
        /** @type {__VLS_StyleScopedClasses['group-option']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
            ...{ style: ({ background: group.color }) },
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (group.name);
        // @ts-ignore
        [data, projectGroupFilter,];
        var __VLS_111;
        // @ts-ignore
        [];
    }
    if (__VLS_ctx.data.projects.some((project) => !project.groupId)) {
        let __VLS_114;
        /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option'] | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
        elOption;
        // @ts-ignore
        const __VLS_115 = __VLS_asFunctionalComponent1(__VLS_114, new __VLS_114({
            label: "未分组",
            value: "ungrouped",
        }));
        const __VLS_116 = __VLS_115({
            label: "未分组",
            value: "ungrouped",
        }, ...__VLS_functionalComponentArgsRest(__VLS_115));
        const { default: __VLS_119 } = __VLS_117.slots;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "group-option" },
        });
        /** @type {__VLS_StyleScopedClasses['group-option']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
            ...{ style: {} },
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        // @ts-ignore
        [data,];
        var __VLS_117;
    }
    // @ts-ignore
    [];
    var __VLS_100;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "apple-select project-sort-select" },
    });
    /** @type {__VLS_StyleScopedClasses['apple-select']} */ ;
    /** @type {__VLS_StyleScopedClasses['project-sort-select']} */ ;
    let __VLS_120;
    /** @ts-ignore @type { | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon'] | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon']} */
    elIcon;
    // @ts-ignore
    const __VLS_121 = __VLS_asFunctionalComponent1(__VLS_120, new __VLS_120({}));
    const __VLS_122 = __VLS_121({}, ...__VLS_functionalComponentArgsRest(__VLS_121));
    const { default: __VLS_125 } = __VLS_123.slots;
    let __VLS_126;
    /** @ts-ignore @type { | typeof __VLS_components.Sort} */
    Sort;
    // @ts-ignore
    const __VLS_127 = __VLS_asFunctionalComponent1(__VLS_126, new __VLS_126({}));
    const __VLS_128 = __VLS_127({}, ...__VLS_functionalComponentArgsRest(__VLS_127));
    // @ts-ignore
    [];
    var __VLS_123;
    let __VLS_131;
    /** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
    elSelect;
    // @ts-ignore
    const __VLS_132 = __VLS_asFunctionalComponent1(__VLS_131, new __VLS_131({
        modelValue: (__VLS_ctx.projectGroupSort),
        'aria-label': "项目组排序",
        popperClass: "apple-select-popper",
    }));
    const __VLS_133 = __VLS_132({
        modelValue: (__VLS_ctx.projectGroupSort),
        'aria-label': "项目组排序",
        popperClass: "apple-select-popper",
    }, ...__VLS_functionalComponentArgsRest(__VLS_132));
    const { default: __VLS_136 } = __VLS_134.slots;
    let __VLS_137;
    /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
    elOption;
    // @ts-ignore
    const __VLS_138 = __VLS_asFunctionalComponent1(__VLS_137, new __VLS_137({
        label: "按名称排序",
        value: "name",
    }));
    const __VLS_139 = __VLS_138({
        label: "按名称排序",
        value: "name",
    }, ...__VLS_functionalComponentArgsRest(__VLS_138));
    let __VLS_142;
    /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
    elOption;
    // @ts-ignore
    const __VLS_143 = __VLS_asFunctionalComponent1(__VLS_142, new __VLS_142({
        label: "按项目数排序",
        value: "count",
    }));
    const __VLS_144 = __VLS_143({
        label: "按项目数排序",
        value: "count",
    }, ...__VLS_functionalComponentArgsRest(__VLS_143));
    let __VLS_147;
    /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
    elOption;
    // @ts-ignore
    const __VLS_148 = __VLS_asFunctionalComponent1(__VLS_147, new __VLS_147({
        label: "按创建时间排序",
        value: "created",
    }));
    const __VLS_149 = __VLS_148({
        label: "按创建时间排序",
        value: "created",
    }, ...__VLS_functionalComponentArgsRest(__VLS_148));
    // @ts-ignore
    [projectGroupSort,];
    var __VLS_134;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (__VLS_ctx.data.groups.length);
    (__VLS_ctx.data.projects.length);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "project-groups scroll-list" },
    });
    /** @type {__VLS_StyleScopedClasses['project-groups']} */ ;
    /** @type {__VLS_StyleScopedClasses['scroll-list']} */ ;
    for (const [group] of __VLS_vFor((__VLS_ctx.projectGroupSections))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            key: (group.id),
            ...{ class: "project-group" },
        });
        /** @type {__VLS_StyleScopedClasses['project-group']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.header, __VLS_intrinsics.header)({
            ...{ class: "project-group-head" },
        });
        /** @type {__VLS_StyleScopedClasses['project-group-head']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.tab === 'overview'))
                        throw 0;
                    if (!(__VLS_ctx.tab === 'projects'))
                        throw 0;
                    return (__VLS_ctx.toggleGroup(group.id));
                    // @ts-ignore
                    [data, data, projectGroupSections, toggleGroup,];
                } },
            ...{ class: "group-toggle" },
            type: "button",
            'aria-expanded': (!__VLS_ctx.isGroupCollapsed(group.id)),
        });
        /** @type {__VLS_StyleScopedClasses['group-toggle']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
            ...{ class: "group-swatch" },
            ...{ style: ({ background: group.color }) },
        });
        /** @type {__VLS_StyleScopedClasses['group-swatch']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (group.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (group.projects.length);
        let __VLS_152;
        /** @ts-ignore @type { | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon'] | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon']} */
        elIcon;
        // @ts-ignore
        const __VLS_153 = __VLS_asFunctionalComponent1(__VLS_152, new __VLS_152({
            ...{ class: ({ collapsed: __VLS_ctx.isGroupCollapsed(group.id) }) },
        }));
        const __VLS_154 = __VLS_153({
            ...{ class: ({ collapsed: __VLS_ctx.isGroupCollapsed(group.id) }) },
        }, ...__VLS_functionalComponentArgsRest(__VLS_153));
        /** @type {__VLS_StyleScopedClasses['collapsed']} */ ;
        const { default: __VLS_157 } = __VLS_155.slots;
        let __VLS_158;
        /** @ts-ignore @type { | typeof __VLS_components.ArrowDown} */
        ArrowDown;
        // @ts-ignore
        const __VLS_159 = __VLS_asFunctionalComponent1(__VLS_158, new __VLS_158({}));
        const __VLS_160 = __VLS_159({}, ...__VLS_functionalComponentArgsRest(__VLS_159));
        // @ts-ignore
        [isGroupCollapsed, isGroupCollapsed,];
        var __VLS_155;
        if (group.managed) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "group-actions" },
            });
            /** @type {__VLS_StyleScopedClasses['group-actions']} */ ;
            let __VLS_163;
            /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
            elButton;
            // @ts-ignore
            const __VLS_164 = __VLS_asFunctionalComponent1(__VLS_163, new __VLS_163({
                ...{ 'onClick': {} },
                icon: (__VLS_ctx.MagicStick),
                'aria-label': (`批量配置项目组 ${group.name} 的技能`),
                disabled: (!group.projects.length),
            }));
            const __VLS_165 = __VLS_164({
                ...{ 'onClick': {} },
                icon: (__VLS_ctx.MagicStick),
                'aria-label': (`批量配置项目组 ${group.name} 的技能`),
                disabled: (!group.projects.length),
            }, ...__VLS_functionalComponentArgsRest(__VLS_164));
            let __VLS_168;
            const __VLS_169 = {
                /** @type {typeof __VLS_168.click} */
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.tab === 'overview'))
                        throw 0;
                    if (!(__VLS_ctx.tab === 'projects'))
                        throw 0;
                    if (!(group.managed))
                        throw 0;
                    return (__VLS_ctx.openGroupSkills(group));
                    // @ts-ignore
                    [MagicStick, openGroupSkills,];
                },
            };
            const { default: __VLS_170 } = __VLS_166.slots;
            // @ts-ignore
            [];
            var __VLS_166;
            var __VLS_167;
            let __VLS_171;
            /** @ts-ignore @type { | typeof __VLS_components.elTooltip | typeof __VLS_components.ElTooltip | typeof __VLS_components['el-tooltip'] | typeof __VLS_components.elTooltip | typeof __VLS_components.ElTooltip | typeof __VLS_components['el-tooltip']} */
            elTooltip;
            // @ts-ignore
            const __VLS_172 = __VLS_asFunctionalComponent1(__VLS_171, new __VLS_171({
                content: "编辑项目组",
            }));
            const __VLS_173 = __VLS_172({
                content: "编辑项目组",
            }, ...__VLS_functionalComponentArgsRest(__VLS_172));
            const { default: __VLS_176 } = __VLS_174.slots;
            let __VLS_177;
            /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
            elButton;
            // @ts-ignore
            const __VLS_178 = __VLS_asFunctionalComponent1(__VLS_177, new __VLS_177({
                ...{ 'onClick': {} },
                circle: true,
                icon: (__VLS_ctx.EditPen),
                'aria-label': (`编辑项目组 ${group.name}`),
            }));
            const __VLS_179 = __VLS_178({
                ...{ 'onClick': {} },
                circle: true,
                icon: (__VLS_ctx.EditPen),
                'aria-label': (`编辑项目组 ${group.name}`),
            }, ...__VLS_functionalComponentArgsRest(__VLS_178));
            let __VLS_182;
            const __VLS_183 = {
                /** @type {typeof __VLS_182.click} */
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.tab === 'overview'))
                        throw 0;
                    if (!(__VLS_ctx.tab === 'projects'))
                        throw 0;
                    if (!(group.managed))
                        throw 0;
                    return (__VLS_ctx.openEditGroup(group));
                    // @ts-ignore
                    [EditPen, openEditGroup,];
                },
            };
            var __VLS_180;
            var __VLS_181;
            // @ts-ignore
            [];
            var __VLS_174;
            let __VLS_184;
            /** @ts-ignore @type { | typeof __VLS_components.elTooltip | typeof __VLS_components.ElTooltip | typeof __VLS_components['el-tooltip'] | typeof __VLS_components.elTooltip | typeof __VLS_components.ElTooltip | typeof __VLS_components['el-tooltip']} */
            elTooltip;
            // @ts-ignore
            const __VLS_185 = __VLS_asFunctionalComponent1(__VLS_184, new __VLS_184({
                content: "删除项目组",
            }));
            const __VLS_186 = __VLS_185({
                content: "删除项目组",
            }, ...__VLS_functionalComponentArgsRest(__VLS_185));
            const { default: __VLS_189 } = __VLS_187.slots;
            let __VLS_190;
            /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
            elButton;
            // @ts-ignore
            const __VLS_191 = __VLS_asFunctionalComponent1(__VLS_190, new __VLS_190({
                ...{ 'onClick': {} },
                circle: true,
                plain: true,
                type: "danger",
                icon: (__VLS_ctx.Delete),
                'aria-label': (`删除项目组 ${group.name}`),
            }));
            const __VLS_192 = __VLS_191({
                ...{ 'onClick': {} },
                circle: true,
                plain: true,
                type: "danger",
                icon: (__VLS_ctx.Delete),
                'aria-label': (`删除项目组 ${group.name}`),
            }, ...__VLS_functionalComponentArgsRest(__VLS_191));
            let __VLS_195;
            const __VLS_196 = {
                /** @type {typeof __VLS_195.click} */
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.tab === 'overview'))
                        throw 0;
                    if (!(__VLS_ctx.tab === 'projects'))
                        throw 0;
                    if (!(group.managed))
                        throw 0;
                    return (__VLS_ctx.confirmDeleteGroup(group));
                    // @ts-ignore
                    [Delete, confirmDeleteGroup,];
                },
            };
            var __VLS_193;
            var __VLS_194;
            // @ts-ignore
            [];
            var __VLS_187;
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "project-group-list" },
        });
        __VLS_asFunctionalDirective(__VLS_directives.vShow, {})(null, { ...__VLS_directiveBindingRestFields, value: (!__VLS_ctx.isGroupCollapsed(group.id)), }, null, null);
        /** @type {__VLS_StyleScopedClasses['project-group-list']} */ ;
        for (const [p] of __VLS_vFor((group.projects))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
                key: (p.id),
                ...{ class: "entity-row project-row" },
            });
            /** @type {__VLS_StyleScopedClasses['entity-row']} */ ;
            /** @type {__VLS_StyleScopedClasses['project-row']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "folder-icon project-folder-icon" },
                ...{ style: ({ '--group-color': group.color }) },
            });
            /** @type {__VLS_StyleScopedClasses['folder-icon']} */ ;
            /** @type {__VLS_StyleScopedClasses['project-folder-icon']} */ ;
            let __VLS_197;
            /** @ts-ignore @type { | typeof __VLS_components.FolderAdd} */
            FolderAdd;
            // @ts-ignore
            const __VLS_198 = __VLS_asFunctionalComponent1(__VLS_197, new __VLS_197({}));
            const __VLS_199 = __VLS_198({}, ...__VLS_functionalComponentArgsRest(__VLS_198));
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "entity-main" },
            });
            /** @type {__VLS_StyleScopedClasses['entity-main']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "entity-title-line" },
            });
            /** @type {__VLS_StyleScopedClasses['entity-title-line']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
            (p.name);
            __VLS_asFunctionalElement1(__VLS_intrinsics.code, __VLS_intrinsics.code)({});
            (p.path);
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "project-row-controls" },
            });
            /** @type {__VLS_StyleScopedClasses['project-row-controls']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "apple-select row-group-select" },
            });
            /** @type {__VLS_StyleScopedClasses['apple-select']} */ ;
            /** @type {__VLS_StyleScopedClasses['row-group-select']} */ ;
            let __VLS_202;
            /** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
            elSelect;
            // @ts-ignore
            const __VLS_203 = __VLS_asFunctionalComponent1(__VLS_202, new __VLS_202({
                ...{ 'onChange': {} },
                modelValue: (p.groupId),
                'aria-label': (`${p.name} 所属项目组`),
                clearable: true,
                placeholder: "未分组",
                popperClass: "apple-select-popper",
            }));
            const __VLS_204 = __VLS_203({
                ...{ 'onChange': {} },
                modelValue: (p.groupId),
                'aria-label': (`${p.name} 所属项目组`),
                clearable: true,
                placeholder: "未分组",
                popperClass: "apple-select-popper",
            }, ...__VLS_functionalComponentArgsRest(__VLS_203));
            let __VLS_207;
            const __VLS_208 = {
                /** @type {typeof __VLS_207.change} */
                onChange: (...[$event]) => {
                    if (!!(__VLS_ctx.tab === 'overview'))
                        throw 0;
                    if (!(__VLS_ctx.tab === 'projects'))
                        throw 0;
                    return (__VLS_ctx.assignGroup(p, $event || null));
                    // @ts-ignore
                    [isGroupCollapsed, assignGroup,];
                },
            };
            const { default: __VLS_209 } = __VLS_205.slots;
            for (const [option] of __VLS_vFor((__VLS_ctx.data.groups))) {
                let __VLS_210;
                /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option'] | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
                elOption;
                // @ts-ignore
                const __VLS_211 = __VLS_asFunctionalComponent1(__VLS_210, new __VLS_210({
                    key: (option.id),
                    label: (option.name),
                    value: (option.id),
                }));
                const __VLS_212 = __VLS_211({
                    key: (option.id),
                    label: (option.name),
                    value: (option.id),
                }, ...__VLS_functionalComponentArgsRest(__VLS_211));
                const { default: __VLS_215 } = __VLS_213.slots;
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "group-option" },
                });
                /** @type {__VLS_StyleScopedClasses['group-option']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
                    ...{ style: ({ background: option.color }) },
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                (option.name);
                // @ts-ignore
                [data,];
                var __VLS_213;
                // @ts-ignore
                [];
            }
            // @ts-ignore
            [];
            var __VLS_205;
            var __VLS_206;
            let __VLS_216;
            /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
            elButton;
            // @ts-ignore
            const __VLS_217 = __VLS_asFunctionalComponent1(__VLS_216, new __VLS_216({
                ...{ 'onClick': {} },
                ...{ class: "apple-row-button" },
                icon: (__VLS_ctx.Tools),
                'aria-label': (`管理项目 ${p.name} 的技能`),
            }));
            const __VLS_218 = __VLS_217({
                ...{ 'onClick': {} },
                ...{ class: "apple-row-button" },
                icon: (__VLS_ctx.Tools),
                'aria-label': (`管理项目 ${p.name} 的技能`),
            }, ...__VLS_functionalComponentArgsRest(__VLS_217));
            let __VLS_221;
            const __VLS_222 = {
                /** @type {typeof __VLS_221.click} */
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.tab === 'overview'))
                        throw 0;
                    if (!(__VLS_ctx.tab === 'projects'))
                        throw 0;
                    return (__VLS_ctx.openProjectSkills(p));
                    // @ts-ignore
                    [Tools, openProjectSkills,];
                },
            };
            /** @type {__VLS_StyleScopedClasses['apple-row-button']} */ ;
            const { default: __VLS_223 } = __VLS_219.slots;
            // @ts-ignore
            [];
            var __VLS_219;
            var __VLS_220;
            let __VLS_224;
            /** @ts-ignore @type { | typeof __VLS_components.elDropdown | typeof __VLS_components.ElDropdown | typeof __VLS_components['el-dropdown'] | typeof __VLS_components.elDropdown | typeof __VLS_components.ElDropdown | typeof __VLS_components['el-dropdown']} */
            elDropdown;
            // @ts-ignore
            const __VLS_225 = __VLS_asFunctionalComponent1(__VLS_224, new __VLS_224({
                trigger: "click",
            }));
            const __VLS_226 = __VLS_225({
                trigger: "click",
            }, ...__VLS_functionalComponentArgsRest(__VLS_225));
            const { default: __VLS_229 } = __VLS_227.slots;
            let __VLS_230;
            /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
            elButton;
            // @ts-ignore
            const __VLS_231 = __VLS_asFunctionalComponent1(__VLS_230, new __VLS_230({
                ...{ class: "apple-icon-button" },
                icon: (__VLS_ctx.MoreFilled),
                'aria-label': (`${p.name} 的更多操作`),
                text: true,
            }));
            const __VLS_232 = __VLS_231({
                ...{ class: "apple-icon-button" },
                icon: (__VLS_ctx.MoreFilled),
                'aria-label': (`${p.name} 的更多操作`),
                text: true,
            }, ...__VLS_functionalComponentArgsRest(__VLS_231));
            /** @type {__VLS_StyleScopedClasses['apple-icon-button']} */ ;
            {
                const { dropdown: __VLS_235 } = __VLS_227.slots;
                let __VLS_236;
                /** @ts-ignore @type { | typeof __VLS_components.elDropdownMenu | typeof __VLS_components.ElDropdownMenu | typeof __VLS_components['el-dropdown-menu'] | typeof __VLS_components.elDropdownMenu | typeof __VLS_components.ElDropdownMenu | typeof __VLS_components['el-dropdown-menu']} */
                elDropdownMenu;
                // @ts-ignore
                const __VLS_237 = __VLS_asFunctionalComponent1(__VLS_236, new __VLS_236({}));
                const __VLS_238 = __VLS_237({}, ...__VLS_functionalComponentArgsRest(__VLS_237));
                const { default: __VLS_241 } = __VLS_239.slots;
                let __VLS_242;
                /** @ts-ignore @type { | typeof __VLS_components.elDropdownItem | typeof __VLS_components.ElDropdownItem | typeof __VLS_components['el-dropdown-item'] | typeof __VLS_components.elDropdownItem | typeof __VLS_components.ElDropdownItem | typeof __VLS_components['el-dropdown-item']} */
                elDropdownItem;
                // @ts-ignore
                const __VLS_243 = __VLS_asFunctionalComponent1(__VLS_242, new __VLS_242({
                    ...{ 'onClick': {} },
                }));
                const __VLS_244 = __VLS_243({
                    ...{ 'onClick': {} },
                }, ...__VLS_functionalComponentArgsRest(__VLS_243));
                let __VLS_247;
                const __VLS_248 = {
                    /** @type {typeof __VLS_247.click} */
                    onClick: (...[$event]) => {
                        if (!!(__VLS_ctx.tab === 'overview'))
                            throw 0;
                        if (!(__VLS_ctx.tab === 'projects'))
                            throw 0;
                        return (__VLS_ctx.confirmDelete('projects', p));
                        // @ts-ignore
                        [MoreFilled, confirmDelete,];
                    },
                };
                const { default: __VLS_249 } = __VLS_245.slots;
                // @ts-ignore
                [];
                var __VLS_245;
                var __VLS_246;
                // @ts-ignore
                [];
                var __VLS_239;
                // @ts-ignore
                [];
            }
            // @ts-ignore
            [];
            var __VLS_227;
            // @ts-ignore
            [];
        }
        if (!group.projects.length) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "empty-group" },
            });
            /** @type {__VLS_StyleScopedClasses['empty-group']} */ ;
        }
        // @ts-ignore
        [];
    }
    if (!__VLS_ctx.projectGroupSections.length) {
        let __VLS_250;
        /** @ts-ignore @type { | typeof __VLS_components.elEmpty | typeof __VLS_components.ElEmpty | typeof __VLS_components['el-empty']} */
        elEmpty;
        // @ts-ignore
        const __VLS_251 = __VLS_asFunctionalComponent1(__VLS_250, new __VLS_250({
            description: "当前筛选没有项目组",
        }));
        const __VLS_252 = __VLS_251({
            description: "当前筛选没有项目组",
        }, ...__VLS_functionalComponentArgsRest(__VLS_251));
    }
}
else if (__VLS_ctx.tab === 'skills') {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "page" },
    });
    /** @type {__VLS_StyleScopedClasses['page']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "page-title" },
    });
    /** @type {__VLS_StyleScopedClasses['page-title']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    let __VLS_255;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_256 = __VLS_asFunctionalComponent1(__VLS_255, new __VLS_255({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.Refresh),
    }));
    const __VLS_257 = __VLS_256({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.Refresh),
    }, ...__VLS_functionalComponentArgsRest(__VLS_256));
    let __VLS_260;
    const __VLS_261 = {
        /** @type {typeof __VLS_260.click} */
        onClick: (__VLS_ctx.rescan),
    };
    const { default: __VLS_262 } = __VLS_258.slots;
    // @ts-ignore
    [tab, Refresh, projectGroupSections, rescan,];
    var __VLS_258;
    var __VLS_259;
    let __VLS_263;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_264 = __VLS_asFunctionalComponent1(__VLS_263, new __VLS_263({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.Plus),
    }));
    const __VLS_265 = __VLS_264({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.Plus),
    }, ...__VLS_functionalComponentArgsRest(__VLS_264));
    let __VLS_268;
    const __VLS_269 = {
        /** @type {typeof __VLS_268.click} */
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.tab === 'overview'))
                throw 0;
            if (!!(__VLS_ctx.tab === 'projects'))
                throw 0;
            if (!(__VLS_ctx.tab === 'skills'))
                throw 0;
            return (__VLS_ctx.sourceDialog = true);
            // @ts-ignore
            [Plus, sourceDialog,];
        },
    };
    const { default: __VLS_270 } = __VLS_266.slots;
    // @ts-ignore
    [];
    var __VLS_266;
    var __VLS_267;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "toolbar glass" },
    });
    /** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    let __VLS_271;
    /** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
    elSelect;
    // @ts-ignore
    const __VLS_272 = __VLS_asFunctionalComponent1(__VLS_271, new __VLS_271({
        modelValue: (__VLS_ctx.selectedProject),
        'aria-label': "选择项目",
        placeholder: "选择项目",
        ...{ style: {} },
    }));
    const __VLS_273 = __VLS_272({
        modelValue: (__VLS_ctx.selectedProject),
        'aria-label': "选择项目",
        placeholder: "选择项目",
        ...{ style: {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_272));
    const { default: __VLS_276 } = __VLS_274.slots;
    for (const [group] of __VLS_vFor((__VLS_ctx.projectSelectGroups))) {
        let __VLS_277;
        /** @ts-ignore @type { | typeof __VLS_components.elOptionGroup | typeof __VLS_components.ElOptionGroup | typeof __VLS_components['el-option-group'] | typeof __VLS_components.elOptionGroup | typeof __VLS_components.ElOptionGroup | typeof __VLS_components['el-option-group']} */
        elOptionGroup;
        // @ts-ignore
        const __VLS_278 = __VLS_asFunctionalComponent1(__VLS_277, new __VLS_277({
            key: (group.id),
            label: (group.name),
        }));
        const __VLS_279 = __VLS_278({
            key: (group.id),
            label: (group.name),
        }, ...__VLS_functionalComponentArgsRest(__VLS_278));
        const { default: __VLS_282 } = __VLS_280.slots;
        for (const [p] of __VLS_vFor((group.projects))) {
            let __VLS_283;
            /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
            elOption;
            // @ts-ignore
            const __VLS_284 = __VLS_asFunctionalComponent1(__VLS_283, new __VLS_283({
                key: (p.id),
                label: (p.name),
                value: (p.id),
            }));
            const __VLS_285 = __VLS_284({
                key: (p.id),
                label: (p.name),
                value: (p.id),
            }, ...__VLS_functionalComponentArgsRest(__VLS_284));
            // @ts-ignore
            [selectedProject, projectSelectGroups,];
        }
        // @ts-ignore
        [];
        var __VLS_280;
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_274;
    let __VLS_288;
    /** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
    elInput;
    // @ts-ignore
    const __VLS_289 = __VLS_asFunctionalComponent1(__VLS_288, new __VLS_288({
        modelValue: (__VLS_ctx.query),
        prefixIcon: (__VLS_ctx.Search),
        placeholder: "搜索名称、描述、标签或路径",
        clearable: true,
    }));
    const __VLS_290 = __VLS_289({
        modelValue: (__VLS_ctx.query),
        prefixIcon: (__VLS_ctx.Search),
        placeholder: "搜索名称、描述、标签或路径",
        clearable: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_289));
    let __VLS_293;
    /** @ts-ignore @type { | typeof __VLS_components.elSegmented | typeof __VLS_components.ElSegmented | typeof __VLS_components['el-segmented']} */
    elSegmented;
    // @ts-ignore
    const __VLS_294 = __VLS_asFunctionalComponent1(__VLS_293, new __VLS_293({
        modelValue: (__VLS_ctx.statusFilter),
        ...{ class: "apple-segmented" },
        'aria-label': "技能链接状态",
        options: ([
            { label: '全部', value: 'all' },
            { label: '已链接', value: 'linked' },
            { label: '未链接', value: 'missing' },
            { label: '异常', value: 'broken' },
        ]),
    }));
    const __VLS_295 = __VLS_294({
        modelValue: (__VLS_ctx.statusFilter),
        ...{ class: "apple-segmented" },
        'aria-label': "技能链接状态",
        options: ([
            { label: '全部', value: 'all' },
            { label: '已链接', value: 'linked' },
            { label: '未链接', value: 'missing' },
            { label: '异常', value: 'broken' },
        ]),
    }, ...__VLS_functionalComponentArgsRest(__VLS_294));
    /** @type {__VLS_StyleScopedClasses['apple-segmented']} */ ;
    let __VLS_298;
    /** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
    elSelect;
    // @ts-ignore
    const __VLS_299 = __VLS_asFunctionalComponent1(__VLS_298, new __VLS_298({
        ...{ 'onClear': {} },
        modelValue: (__VLS_ctx.sourceFilter),
        'aria-label': "筛选技能源",
        placeholder: "筛选技能源",
        clearable: true,
        ...{ style: {} },
    }));
    const __VLS_300 = __VLS_299({
        ...{ 'onClear': {} },
        modelValue: (__VLS_ctx.sourceFilter),
        'aria-label': "筛选技能源",
        placeholder: "筛选技能源",
        clearable: true,
        ...{ style: {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_299));
    let __VLS_303;
    const __VLS_304 = {
        /** @type {typeof __VLS_303.clear} */
        onClear: (...[$event]) => {
            if (!!(__VLS_ctx.tab === 'overview'))
                throw 0;
            if (!!(__VLS_ctx.tab === 'projects'))
                throw 0;
            if (!(__VLS_ctx.tab === 'skills'))
                throw 0;
            return (__VLS_ctx.sourceFilter = 'all');
            // @ts-ignore
            [query, Search, statusFilter, sourceFilter, sourceFilter,];
        },
    };
    const { default: __VLS_305 } = __VLS_301.slots;
    for (const [option] of __VLS_vFor((__VLS_ctx.sourceOptions))) {
        let __VLS_306;
        /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
        elOption;
        // @ts-ignore
        const __VLS_307 = __VLS_asFunctionalComponent1(__VLS_306, new __VLS_306({
            key: (option.value),
            label: (option.label),
            value: (option.value),
        }));
        const __VLS_308 = __VLS_307({
            key: (option.value),
            label: (option.label),
            value: (option.value),
        }, ...__VLS_functionalComponentArgsRest(__VLS_307));
        // @ts-ignore
        [sourceOptions,];
    }
    // @ts-ignore
    [];
    var __VLS_301;
    var __VLS_302;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "library-layout" },
    });
    /** @type {__VLS_StyleScopedClasses['library-layout']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "table-panel glass" },
    });
    /** @type {__VLS_StyleScopedClasses['table-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "selection-bar" },
        ...{ class: ({ visible: __VLS_ctx.selectedSkills.length }) },
    });
    /** @type {__VLS_StyleScopedClasses['selection-bar']} */ ;
    /** @type {__VLS_StyleScopedClasses['visible']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (__VLS_ctx.selectedSkills.length);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    let __VLS_311;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_312 = __VLS_asFunctionalComponent1(__VLS_311, new __VLS_311({
        ...{ 'onClick': {} },
    }));
    const __VLS_313 = __VLS_312({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_312));
    let __VLS_316;
    const __VLS_317 = {
        /** @type {typeof __VLS_316.click} */
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.tab === 'overview'))
                throw 0;
            if (!!(__VLS_ctx.tab === 'projects'))
                throw 0;
            if (!(__VLS_ctx.tab === 'skills'))
                throw 0;
            return (__VLS_ctx.stage('link'));
            // @ts-ignore
            [selectedSkills, selectedSkills, stage,];
        },
    };
    const { default: __VLS_318 } = __VLS_314.slots;
    // @ts-ignore
    [];
    var __VLS_314;
    var __VLS_315;
    let __VLS_319;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_320 = __VLS_asFunctionalComponent1(__VLS_319, new __VLS_319({
        ...{ 'onClick': {} },
    }));
    const __VLS_321 = __VLS_320({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_320));
    let __VLS_324;
    const __VLS_325 = {
        /** @type {typeof __VLS_324.click} */
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.tab === 'overview'))
                throw 0;
            if (!!(__VLS_ctx.tab === 'projects'))
                throw 0;
            if (!(__VLS_ctx.tab === 'skills'))
                throw 0;
            return (__VLS_ctx.stage('replace'));
            // @ts-ignore
            [stage,];
        },
    };
    const { default: __VLS_326 } = __VLS_322.slots;
    // @ts-ignore
    [];
    var __VLS_322;
    var __VLS_323;
    let __VLS_327;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_328 = __VLS_asFunctionalComponent1(__VLS_327, new __VLS_327({
        ...{ 'onClick': {} },
        type: "danger",
        plain: true,
    }));
    const __VLS_329 = __VLS_328({
        ...{ 'onClick': {} },
        type: "danger",
        plain: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_328));
    let __VLS_332;
    const __VLS_333 = {
        /** @type {typeof __VLS_332.click} */
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.tab === 'overview'))
                throw 0;
            if (!!(__VLS_ctx.tab === 'projects'))
                throw 0;
            if (!(__VLS_ctx.tab === 'skills'))
                throw 0;
            return (__VLS_ctx.stage('remove'));
            // @ts-ignore
            [stage,];
        },
    };
    const { default: __VLS_334 } = __VLS_330.slots;
    // @ts-ignore
    [];
    var __VLS_330;
    var __VLS_331;
    let __VLS_335;
    /** @ts-ignore @type { | typeof __VLS_components.elTable | typeof __VLS_components.ElTable | typeof __VLS_components['el-table'] | typeof __VLS_components.elTable | typeof __VLS_components.ElTable | typeof __VLS_components['el-table']} */
    elTable;
    // @ts-ignore
    const __VLS_336 = __VLS_asFunctionalComponent1(__VLS_335, new __VLS_335({
        ...{ 'onSelectionChange': {} },
        ...{ 'onRowClick': {} },
        ...{ class: "skill-library-table" },
        data: (__VLS_ctx.filteredSkills),
        rowKey: "id",
        height: "100%",
        emptyText: "当前筛选没有技能",
    }));
    const __VLS_337 = __VLS_336({
        ...{ 'onSelectionChange': {} },
        ...{ 'onRowClick': {} },
        ...{ class: "skill-library-table" },
        data: (__VLS_ctx.filteredSkills),
        rowKey: "id",
        height: "100%",
        emptyText: "当前筛选没有技能",
    }, ...__VLS_functionalComponentArgsRest(__VLS_336));
    let __VLS_340;
    const __VLS_341 = {
        /** @type {typeof __VLS_340.selectionChange} */
        onSelectionChange: (...[$event]) => {
            if (!!(__VLS_ctx.tab === 'overview'))
                throw 0;
            if (!!(__VLS_ctx.tab === 'projects'))
                throw 0;
            if (!(__VLS_ctx.tab === 'skills'))
                throw 0;
            return (__VLS_ctx.selectedSkills = $event);
            // @ts-ignore
            [selectedSkills, filteredSkills,];
        },
    };
    const __VLS_342 = {
        /** @type {typeof __VLS_340.rowClick} */
        onRowClick: (__VLS_ctx.openSkillDetail),
    };
    /** @type {__VLS_StyleScopedClasses['skill-library-table']} */ ;
    const { default: __VLS_343 } = __VLS_338.slots;
    let __VLS_344;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_345 = __VLS_asFunctionalComponent1(__VLS_344, new __VLS_344({
        type: "selection",
        width: "48",
        reserveSelection: (true),
    }));
    const __VLS_346 = __VLS_345({
        type: "selection",
        width: "48",
        reserveSelection: (true),
    }, ...__VLS_functionalComponentArgsRest(__VLS_345));
    let __VLS_349;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_350 = __VLS_asFunctionalComponent1(__VLS_349, new __VLS_349({
        label: "技能",
        minWidth: "240",
    }));
    const __VLS_351 = __VLS_350({
        label: "技能",
        minWidth: "240",
    }, ...__VLS_functionalComponentArgsRest(__VLS_350));
    const { default: __VLS_354 } = __VLS_352.slots;
    {
        const { default: __VLS_355 } = __VLS_352.slots;
        const [{ row }] = __VLS_vSlot(__VLS_355);
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "skill-name" },
        });
        /** @type {__VLS_StyleScopedClasses['skill-name']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.tab === 'overview'))
                        throw 0;
                    if (!!(__VLS_ctx.tab === 'projects'))
                        throw 0;
                    if (!(__VLS_ctx.tab === 'skills'))
                        throw 0;
                    return (__VLS_ctx.toggleFavorite(row));
                    // @ts-ignore
                    [openSkillDetail, toggleFavorite,];
                } },
            ...{ class: "star" },
            type: "button",
            'aria-label': (`${row.favorite ? '取消收藏' : '收藏'}技能 ${row.name}`),
            'aria-pressed': (row.favorite),
        });
        /** @type {__VLS_StyleScopedClasses['star']} */ ;
        let __VLS_356;
        /** @ts-ignore @type { | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon'] | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon']} */
        elIcon;
        // @ts-ignore
        const __VLS_357 = __VLS_asFunctionalComponent1(__VLS_356, new __VLS_356({
            ...{ class: ({ on: row.favorite }) },
        }));
        const __VLS_358 = __VLS_357({
            ...{ class: ({ on: row.favorite }) },
        }, ...__VLS_functionalComponentArgsRest(__VLS_357));
        /** @type {__VLS_StyleScopedClasses['on']} */ ;
        const { default: __VLS_361 } = __VLS_359.slots;
        let __VLS_362;
        /** @ts-ignore @type { | typeof __VLS_components.Star} */
        Star;
        // @ts-ignore
        const __VLS_363 = __VLS_asFunctionalComponent1(__VLS_362, new __VLS_362({}));
        const __VLS_364 = __VLS_363({}, ...__VLS_functionalComponentArgsRest(__VLS_363));
        // @ts-ignore
        [];
        var __VLS_359;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.tab === 'overview'))
                        throw 0;
                    if (!!(__VLS_ctx.tab === 'projects'))
                        throw 0;
                    if (!(__VLS_ctx.tab === 'skills'))
                        throw 0;
                    return (__VLS_ctx.openSkillDetail(row));
                    // @ts-ignore
                    [openSkillDetail,];
                } },
            ...{ class: "skill-detail-trigger" },
            type: "button",
            title: (row.name),
        });
        /** @type {__VLS_StyleScopedClasses['skill-detail-trigger']} */ ;
        (row.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (row.description);
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_352;
    let __VLS_367;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_368 = __VLS_asFunctionalComponent1(__VLS_367, new __VLS_367({
        label: "技能源",
        width: "190",
    }));
    const __VLS_369 = __VLS_368({
        label: "技能源",
        width: "190",
    }, ...__VLS_functionalComponentArgsRest(__VLS_368));
    const { default: __VLS_372 } = __VLS_370.slots;
    {
        const { default: __VLS_373 } = __VLS_370.slots;
        const [{ row }] = __VLS_vSlot(__VLS_373);
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "source-text" },
        });
        /** @type {__VLS_StyleScopedClasses['source-text']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (__VLS_ctx.sourceName(row));
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (__VLS_ctx.sourceMode(row));
        // @ts-ignore
        [sourceName, sourceMode,];
    }
    // @ts-ignore
    [];
    var __VLS_370;
    let __VLS_374;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_375 = __VLS_asFunctionalComponent1(__VLS_374, new __VLS_374({
        prop: "alias",
        label: "链接名",
        width: "150",
    }));
    const __VLS_376 = __VLS_375({
        prop: "alias",
        label: "链接名",
        width: "150",
    }, ...__VLS_functionalComponentArgsRest(__VLS_375));
    let __VLS_379;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_380 = __VLS_asFunctionalComponent1(__VLS_379, new __VLS_379({
        label: "状态",
        width: "120",
    }));
    const __VLS_381 = __VLS_380({
        label: "状态",
        width: "120",
    }, ...__VLS_functionalComponentArgsRest(__VLS_380));
    const { default: __VLS_384 } = __VLS_382.slots;
    {
        const { default: __VLS_385 } = __VLS_382.slots;
        const [{ row }] = __VLS_vSlot(__VLS_385);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "status" },
            ...{ class: (row.status) },
        });
        /** @type {__VLS_StyleScopedClasses['status']} */ ;
        (__VLS_ctx.linkStatusText[row.status]);
        // @ts-ignore
        [linkStatusText,];
    }
    // @ts-ignore
    [];
    var __VLS_382;
    let __VLS_386;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_387 = __VLS_asFunctionalComponent1(__VLS_386, new __VLS_386({
        label: "标签",
        width: "150",
    }));
    const __VLS_388 = __VLS_387({
        label: "标签",
        width: "150",
    }, ...__VLS_functionalComponentArgsRest(__VLS_387));
    const { default: __VLS_391 } = __VLS_389.slots;
    {
        const { default: __VLS_392 } = __VLS_389.slots;
        const [{ row }] = __VLS_vSlot(__VLS_392);
        for (const [t] of __VLS_vFor((row.tags.slice(0, 2)))) {
            let __VLS_393;
            /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
            elTag;
            // @ts-ignore
            const __VLS_394 = __VLS_asFunctionalComponent1(__VLS_393, new __VLS_393({
                key: (t),
                round: true,
            }));
            const __VLS_395 = __VLS_394({
                key: (t),
                round: true,
            }, ...__VLS_functionalComponentArgsRest(__VLS_394));
            const { default: __VLS_398 } = __VLS_396.slots;
            (t);
            // @ts-ignore
            [];
            var __VLS_396;
            // @ts-ignore
            [];
        }
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_389;
    let __VLS_399;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_400 = __VLS_asFunctionalComponent1(__VLS_399, new __VLS_399({
        label: "",
        width: "92",
        align: "center",
    }));
    const __VLS_401 = __VLS_400({
        label: "",
        width: "92",
        align: "center",
    }, ...__VLS_functionalComponentArgsRest(__VLS_400));
    const { default: __VLS_404 } = __VLS_402.slots;
    {
        const { default: __VLS_405 } = __VLS_402.slots;
        const [{ row }] = __VLS_vSlot(__VLS_405);
        let __VLS_406;
        /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
        elButton;
        // @ts-ignore
        const __VLS_407 = __VLS_asFunctionalComponent1(__VLS_406, new __VLS_406({
            ...{ 'onClick': {} },
            text: true,
            'aria-label': (`编辑技能 ${row.name}`),
        }));
        const __VLS_408 = __VLS_407({
            ...{ 'onClick': {} },
            text: true,
            'aria-label': (`编辑技能 ${row.name}`),
        }, ...__VLS_functionalComponentArgsRest(__VLS_407));
        let __VLS_411;
        const __VLS_412 = {
            /** @type {typeof __VLS_411.click} */
            onClick: (...[$event]) => {
                if (!!(__VLS_ctx.tab === 'overview'))
                    throw 0;
                if (!!(__VLS_ctx.tab === 'projects'))
                    throw 0;
                if (!(__VLS_ctx.tab === 'skills'))
                    throw 0;
                return (__VLS_ctx.editSkill(row));
                // @ts-ignore
                [editSkill,];
            },
        };
        const { default: __VLS_413 } = __VLS_409.slots;
        // @ts-ignore
        [];
        var __VLS_409;
        var __VLS_410;
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_402;
    // @ts-ignore
    [];
    var __VLS_338;
    var __VLS_339;
    __VLS_asFunctionalElement1(__VLS_intrinsics.aside, __VLS_intrinsics.aside)({
        ...{ class: "source-panel glass" },
    });
    /** @type {__VLS_StyleScopedClasses['source-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "panel-head" },
    });
    /** @type {__VLS_StyleScopedClasses['panel-head']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.data.sources.length);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "source-list" },
    });
    /** @type {__VLS_StyleScopedClasses['source-list']} */ ;
    for (const [s] of __VLS_vFor((__VLS_ctx.data.sources))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            key: (s.id),
            ...{ class: "source-row" },
            ...{ class: ({ active: __VLS_ctx.sourceFilter === s.id }) },
        });
        /** @type {__VLS_StyleScopedClasses['source-row']} */ ;
        /** @type {__VLS_StyleScopedClasses['active']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (s.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (s.mode === 'pack' ? '技能包' : '单个技能');
        (__VLS_ctx.data.skills.filter((k) => k.sourceId === s.id).length);
        let __VLS_414;
        /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
        elButton;
        // @ts-ignore
        const __VLS_415 = __VLS_asFunctionalComponent1(__VLS_414, new __VLS_414({
            ...{ 'onClick': {} },
            text: true,
            type: "danger",
            'aria-label': (`移除技能源 ${s.name}`),
        }));
        const __VLS_416 = __VLS_415({
            ...{ 'onClick': {} },
            text: true,
            type: "danger",
            'aria-label': (`移除技能源 ${s.name}`),
        }, ...__VLS_functionalComponentArgsRest(__VLS_415));
        let __VLS_419;
        const __VLS_420 = {
            /** @type {typeof __VLS_419.click} */
            onClick: (...[$event]) => {
                if (!!(__VLS_ctx.tab === 'overview'))
                    throw 0;
                if (!!(__VLS_ctx.tab === 'projects'))
                    throw 0;
                if (!(__VLS_ctx.tab === 'skills'))
                    throw 0;
                return (__VLS_ctx.confirmDelete('sources', s));
                // @ts-ignore
                [data, data, data, confirmDelete, sourceFilter,];
            },
        };
        const { default: __VLS_421 } = __VLS_417.slots;
        // @ts-ignore
        [];
        var __VLS_417;
        var __VLS_418;
        // @ts-ignore
        [];
    }
    let __VLS_422;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_423 = __VLS_asFunctionalComponent1(__VLS_422, new __VLS_422({
        ...{ 'onClick': {} },
        ...{ class: "full" },
        plain: true,
        icon: (__VLS_ctx.Plus),
    }));
    const __VLS_424 = __VLS_423({
        ...{ 'onClick': {} },
        ...{ class: "full" },
        plain: true,
        icon: (__VLS_ctx.Plus),
    }, ...__VLS_functionalComponentArgsRest(__VLS_423));
    let __VLS_427;
    const __VLS_428 = {
        /** @type {typeof __VLS_427.click} */
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.tab === 'overview'))
                throw 0;
            if (!!(__VLS_ctx.tab === 'projects'))
                throw 0;
            if (!(__VLS_ctx.tab === 'skills'))
                throw 0;
            return (__VLS_ctx.sourceDialog = true);
            // @ts-ignore
            [Plus, sourceDialog,];
        },
    };
    /** @type {__VLS_StyleScopedClasses['full']} */ ;
    const { default: __VLS_429 } = __VLS_425.slots;
    // @ts-ignore
    [];
    var __VLS_425;
    var __VLS_426;
}
else if (__VLS_ctx.tab === 'bundles') {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "page" },
    });
    /** @type {__VLS_StyleScopedClasses['page']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "page-title" },
    });
    /** @type {__VLS_StyleScopedClasses['page-title']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_430;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_431 = __VLS_asFunctionalComponent1(__VLS_430, new __VLS_430({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.Plus),
    }));
    const __VLS_432 = __VLS_431({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.Plus),
    }, ...__VLS_functionalComponentArgsRest(__VLS_431));
    let __VLS_435;
    const __VLS_436 = {
        /** @type {typeof __VLS_435.click} */
        onClick: (__VLS_ctx.openBundleDialog),
    };
    const { default: __VLS_437 } = __VLS_433.slots;
    // @ts-ignore
    [tab, Plus, openBundleDialog,];
    var __VLS_433;
    var __VLS_434;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "content-frame glass" },
    });
    /** @type {__VLS_StyleScopedClasses['content-frame']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "entity-list scroll-list" },
    });
    /** @type {__VLS_StyleScopedClasses['entity-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['scroll-list']} */ ;
    for (const [b] of __VLS_vFor((__VLS_ctx.data.bundles))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            key: (b.id),
            ...{ class: "entity-row bundle-row" },
        });
        /** @type {__VLS_StyleScopedClasses['entity-row']} */ ;
        /** @type {__VLS_StyleScopedClasses['bundle-row']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "bundle-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['bundle-icon']} */ ;
        let __VLS_438;
        /** @ts-ignore @type { | typeof __VLS_components.Collection} */
        Collection;
        // @ts-ignore
        const __VLS_439 = __VLS_asFunctionalComponent1(__VLS_438, new __VLS_438({}));
        const __VLS_440 = __VLS_439({}, ...__VLS_functionalComponentArgsRest(__VLS_439));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "entity-main" },
        });
        /** @type {__VLS_StyleScopedClasses['entity-main']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "entity-title-line" },
        });
        /** @type {__VLS_StyleScopedClasses['entity-title-line']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        (b.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (b.description || '暂无说明');
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "bundle-skills" },
        });
        /** @type {__VLS_StyleScopedClasses['bundle-skills']} */ ;
        for (const [sid] of __VLS_vFor((b.skillIds.slice(0, 5)))) {
            let __VLS_443;
            /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
            elTag;
            // @ts-ignore
            const __VLS_444 = __VLS_asFunctionalComponent1(__VLS_443, new __VLS_443({
                key: (sid),
                round: true,
            }));
            const __VLS_445 = __VLS_444({
                key: (sid),
                round: true,
            }, ...__VLS_functionalComponentArgsRest(__VLS_444));
            const { default: __VLS_448 } = __VLS_446.slots;
            (__VLS_ctx.data.skills.find((s) => s.id === sid)?.name);
            // @ts-ignore
            [data, data,];
            var __VLS_446;
            // @ts-ignore
            [];
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "entity-meta" },
        });
        /** @type {__VLS_StyleScopedClasses['entity-meta']} */ ;
        (b.skillIds.length);
        (b.projectIds.length);
        let __VLS_449;
        /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
        elButton;
        // @ts-ignore
        const __VLS_450 = __VLS_asFunctionalComponent1(__VLS_449, new __VLS_449({
            ...{ 'onClick': {} },
            'aria-label': (`应用技能组合 ${b.name} 到项目`),
        }));
        const __VLS_451 = __VLS_450({
            ...{ 'onClick': {} },
            'aria-label': (`应用技能组合 ${b.name} 到项目`),
        }, ...__VLS_functionalComponentArgsRest(__VLS_450));
        let __VLS_454;
        const __VLS_455 = {
            /** @type {typeof __VLS_454.click} */
            onClick: (...[$event]) => {
                if (!!(__VLS_ctx.tab === 'overview'))
                    throw 0;
                if (!!(__VLS_ctx.tab === 'projects'))
                    throw 0;
                if (!!(__VLS_ctx.tab === 'skills'))
                    throw 0;
                if (!(__VLS_ctx.tab === 'bundles'))
                    throw 0;
                return (__VLS_ctx.openBundleApply(b));
                // @ts-ignore
                [openBundleApply,];
            },
        };
        const { default: __VLS_456 } = __VLS_452.slots;
        // @ts-ignore
        [];
        var __VLS_452;
        var __VLS_453;
        let __VLS_457;
        /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
        elButton;
        // @ts-ignore
        const __VLS_458 = __VLS_asFunctionalComponent1(__VLS_457, new __VLS_457({
            ...{ 'onClick': {} },
            text: true,
            type: "danger",
            'aria-label': (`删除技能组合 ${b.name}`),
        }));
        const __VLS_459 = __VLS_458({
            ...{ 'onClick': {} },
            text: true,
            type: "danger",
            'aria-label': (`删除技能组合 ${b.name}`),
        }, ...__VLS_functionalComponentArgsRest(__VLS_458));
        let __VLS_462;
        const __VLS_463 = {
            /** @type {typeof __VLS_462.click} */
            onClick: (...[$event]) => {
                if (!!(__VLS_ctx.tab === 'overview'))
                    throw 0;
                if (!!(__VLS_ctx.tab === 'projects'))
                    throw 0;
                if (!!(__VLS_ctx.tab === 'skills'))
                    throw 0;
                if (!(__VLS_ctx.tab === 'bundles'))
                    throw 0;
                return (__VLS_ctx.confirmDelete('bundles', b));
                // @ts-ignore
                [confirmDelete,];
            },
        };
        const { default: __VLS_464 } = __VLS_460.slots;
        // @ts-ignore
        [];
        var __VLS_460;
        var __VLS_461;
        // @ts-ignore
        [];
    }
}
else if (__VLS_ctx.tab === 'audit') {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "page" },
    });
    /** @type {__VLS_StyleScopedClasses['page']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "page-title" },
    });
    /** @type {__VLS_StyleScopedClasses['page-title']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_465;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_466 = __VLS_asFunctionalComponent1(__VLS_465, new __VLS_465({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.Refresh),
    }));
    const __VLS_467 = __VLS_466({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.Refresh),
    }, ...__VLS_functionalComponentArgsRest(__VLS_466));
    let __VLS_470;
    const __VLS_471 = {
        /** @type {typeof __VLS_470.click} */
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.tab === 'overview'))
                throw 0;
            if (!!(__VLS_ctx.tab === 'projects'))
                throw 0;
            if (!!(__VLS_ctx.tab === 'skills'))
                throw 0;
            if (!!(__VLS_ctx.tab === 'bundles'))
                throw 0;
            if (!(__VLS_ctx.tab === 'audit'))
                throw 0;
            return (__VLS_ctx.refresh(true));
            // @ts-ignore
            [tab, Refresh, refresh,];
        },
    };
    const { default: __VLS_472 } = __VLS_468.slots;
    // @ts-ignore
    [];
    var __VLS_468;
    var __VLS_469;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "audit-list glass" },
    });
    /** @type {__VLS_StyleScopedClasses['audit-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    for (const [a] of __VLS_vFor((__VLS_ctx.data.audit))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            key: (a.type + a.detail),
            ...{ class: "audit-row" },
        });
        /** @type {__VLS_StyleScopedClasses['audit-row']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "audit-dot" },
            ...{ class: (a.level) },
        });
        /** @type {__VLS_StyleScopedClasses['audit-dot']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (a.title);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (a.detail);
        let __VLS_473;
        /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
        elTag;
        // @ts-ignore
        const __VLS_474 = __VLS_asFunctionalComponent1(__VLS_473, new __VLS_473({
            type: (a.level === 'error' ? 'danger' : 'warning'),
            round: true,
        }));
        const __VLS_475 = __VLS_474({
            type: (a.level === 'error' ? 'danger' : 'warning'),
            round: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_474));
        const { default: __VLS_478 } = __VLS_476.slots;
        (a.type);
        // @ts-ignore
        [data,];
        var __VLS_476;
        // @ts-ignore
        [];
    }
    if (!__VLS_ctx.data.audit.length) {
        let __VLS_479;
        /** @ts-ignore @type { | typeof __VLS_components.elEmpty | typeof __VLS_components.ElEmpty | typeof __VLS_components['el-empty']} */
        elEmpty;
        // @ts-ignore
        const __VLS_480 = __VLS_asFunctionalComponent1(__VLS_479, new __VLS_479({
            description: "没有发现问题，当前状态健康",
        }));
        const __VLS_481 = __VLS_480({
            description: "没有发现问题，当前状态健康",
        }, ...__VLS_functionalComponentArgsRest(__VLS_480));
    }
}
else if (__VLS_ctx.tab === 'history') {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "page" },
    });
    /** @type {__VLS_StyleScopedClasses['page']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "page-title" },
    });
    /** @type {__VLS_StyleScopedClasses['page-title']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "history-list glass" },
    });
    /** @type {__VLS_StyleScopedClasses['history-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    for (const [h] of __VLS_vFor((__VLS_ctx.data.history))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            key: (h.id),
            ...{ class: "history-row" },
        });
        /** @type {__VLS_StyleScopedClasses['history-row']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "history-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['history-icon']} */ ;
        let __VLS_484;
        /** @ts-ignore @type { | typeof __VLS_components.Clock} */
        Clock;
        // @ts-ignore
        const __VLS_485 = __VLS_asFunctionalComponent1(__VLS_484, new __VLS_484({}));
        const __VLS_486 = __VLS_485({}, ...__VLS_functionalComponentArgsRest(__VLS_485));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (h.kind === 'apply' ? '应用软链接变更' : '系统操作');
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (new Date(h.created_at).toLocaleString());
        (h.details?.completed?.length || 0);
        let __VLS_489;
        /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
        elTag;
        // @ts-ignore
        const __VLS_490 = __VLS_asFunctionalComponent1(__VLS_489, new __VLS_489({
            type: (h.status === 'success' ? 'success' : 'warning'),
            round: true,
        }));
        const __VLS_491 = __VLS_490({
            type: (h.status === 'success' ? 'success' : 'warning'),
            round: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_490));
        const { default: __VLS_494 } = __VLS_492.slots;
        (h.undone_at ? '已撤销' : h.status);
        // @ts-ignore
        [tab, data, data,];
        var __VLS_492;
        if (h.status === 'success' && !h.undone_at) {
            let __VLS_495;
            /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
            elButton;
            // @ts-ignore
            const __VLS_496 = __VLS_asFunctionalComponent1(__VLS_495, new __VLS_495({
                ...{ 'onClick': {} },
            }));
            const __VLS_497 = __VLS_496({
                ...{ 'onClick': {} },
            }, ...__VLS_functionalComponentArgsRest(__VLS_496));
            let __VLS_500;
            const __VLS_501 = {
                /** @type {typeof __VLS_500.click} */
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.tab === 'overview'))
                        throw 0;
                    if (!!(__VLS_ctx.tab === 'projects'))
                        throw 0;
                    if (!!(__VLS_ctx.tab === 'skills'))
                        throw 0;
                    if (!!(__VLS_ctx.tab === 'bundles'))
                        throw 0;
                    if (!!(__VLS_ctx.tab === 'audit'))
                        throw 0;
                    if (!(__VLS_ctx.tab === 'history'))
                        throw 0;
                    if (!(h.status === 'success' && !h.undone_at))
                        throw 0;
                    return (__VLS_ctx.undo(h));
                    // @ts-ignore
                    [undo,];
                },
            };
            const { default: __VLS_502 } = __VLS_498.slots;
            // @ts-ignore
            [];
            var __VLS_498;
            var __VLS_499;
        }
        // @ts-ignore
        [];
    }
    if (!__VLS_ctx.data.history.length) {
        let __VLS_503;
        /** @ts-ignore @type { | typeof __VLS_components.elEmpty | typeof __VLS_components.ElEmpty | typeof __VLS_components['el-empty']} */
        elEmpty;
        // @ts-ignore
        const __VLS_504 = __VLS_asFunctionalComponent1(__VLS_503, new __VLS_503({
            description: "还没有操作记录",
        }));
        const __VLS_505 = __VLS_504({
            description: "还没有操作记录",
        }, ...__VLS_functionalComponentArgsRest(__VLS_504));
    }
}
else {
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "page" },
    });
    /** @type {__VLS_StyleScopedClasses['page']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "page-title" },
    });
    /** @type {__VLS_StyleScopedClasses['page-title']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h1, __VLS_intrinsics.h1)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "settings-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['settings-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "setting-card theme-setting glass" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['theme-setting']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-icon']} */ ;
    let __VLS_508;
    /** @ts-ignore @type { | typeof __VLS_components.Monitor} */
    Monitor;
    // @ts-ignore
    const __VLS_509 = __VLS_asFunctionalComponent1(__VLS_508, new __VLS_508({}));
    const __VLS_510 = __VLS_509({}, ...__VLS_functionalComponentArgsRest(__VLS_509));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_513;
    /** @ts-ignore @type { | typeof __VLS_components.elSegmented | typeof __VLS_components.ElSegmented | typeof __VLS_components['el-segmented']} */
    elSegmented;
    // @ts-ignore
    const __VLS_514 = __VLS_asFunctionalComponent1(__VLS_513, new __VLS_513({
        modelValue: (__VLS_ctx.themeMode),
        ...{ class: "apple-segmented" },
        options: (__VLS_ctx.themeOptions),
        'aria-label': "外观模式",
    }));
    const __VLS_515 = __VLS_514({
        modelValue: (__VLS_ctx.themeMode),
        ...{ class: "apple-segmented" },
        options: (__VLS_ctx.themeOptions),
        'aria-label': "外观模式",
    }, ...__VLS_functionalComponentArgsRest(__VLS_514));
    /** @type {__VLS_StyleScopedClasses['apple-segmented']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "setting-card glass" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-icon']} */ ;
    let __VLS_518;
    /** @ts-ignore @type { | typeof __VLS_components.Download} */
    Download;
    // @ts-ignore
    const __VLS_519 = __VLS_asFunctionalComponent1(__VLS_518, new __VLS_518({}));
    const __VLS_520 = __VLS_519({}, ...__VLS_functionalComponentArgsRest(__VLS_519));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_523;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_524 = __VLS_asFunctionalComponent1(__VLS_523, new __VLS_523({
        ...{ 'onClick': {} },
    }));
    const __VLS_525 = __VLS_524({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_524));
    let __VLS_528;
    const __VLS_529 = {
        /** @type {typeof __VLS_528.click} */
        onClick: (__VLS_ctx.exportConfig),
    };
    const { default: __VLS_530 } = __VLS_526.slots;
    // @ts-ignore
    [data, themeMode, themeOptions, exportConfig,];
    var __VLS_526;
    var __VLS_527;
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "setting-card glass" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-icon']} */ ;
    let __VLS_531;
    /** @ts-ignore @type { | typeof __VLS_components.Upload} */
    Upload;
    // @ts-ignore
    const __VLS_532 = __VLS_asFunctionalComponent1(__VLS_531, new __VLS_531({}));
    const __VLS_533 = __VLS_532({}, ...__VLS_functionalComponentArgsRest(__VLS_532));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_536;
    /** @ts-ignore @type { | typeof __VLS_components.elUpload | typeof __VLS_components.ElUpload | typeof __VLS_components['el-upload'] | typeof __VLS_components.elUpload | typeof __VLS_components.ElUpload | typeof __VLS_components['el-upload']} */
    elUpload;
    // @ts-ignore
    const __VLS_537 = __VLS_asFunctionalComponent1(__VLS_536, new __VLS_536({
        showFileList: (false),
        accept: "application/json",
        beforeUpload: (__VLS_ctx.importConfig),
    }));
    const __VLS_538 = __VLS_537({
        showFileList: (false),
        accept: "application/json",
        beforeUpload: (__VLS_ctx.importConfig),
    }, ...__VLS_functionalComponentArgsRest(__VLS_537));
    const { default: __VLS_541 } = __VLS_539.slots;
    let __VLS_542;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_543 = __VLS_asFunctionalComponent1(__VLS_542, new __VLS_542({}));
    const __VLS_544 = __VLS_543({}, ...__VLS_functionalComponentArgsRest(__VLS_543));
    const { default: __VLS_547 } = __VLS_545.slots;
    // @ts-ignore
    [importConfig,];
    var __VLS_545;
    // @ts-ignore
    [];
    var __VLS_539;
}
let __VLS_548;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_549 = __VLS_asFunctionalComponent1(__VLS_548, new __VLS_548({
    modelValue: (__VLS_ctx.projectDialog),
    title: "添加项目",
    width: "560",
}));
const __VLS_550 = __VLS_549({
    modelValue: (__VLS_ctx.projectDialog),
    title: "添加项目",
    width: "560",
}, ...__VLS_functionalComponentArgsRest(__VLS_549));
const { default: __VLS_553 } = __VLS_551.slots;
let __VLS_554;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_555 = __VLS_asFunctionalComponent1(__VLS_554, new __VLS_554({
    ...{ class: "apple-dialog-form project-form" },
    labelPosition: "top",
}));
const __VLS_556 = __VLS_555({
    ...{ class: "apple-dialog-form project-form" },
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_555));
/** @type {__VLS_StyleScopedClasses['apple-dialog-form']} */ ;
/** @type {__VLS_StyleScopedClasses['project-form']} */ ;
const { default: __VLS_559 } = __VLS_557.slots;
let __VLS_560;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_561 = __VLS_asFunctionalComponent1(__VLS_560, new __VLS_560({
    label: "项目目录",
}));
const __VLS_562 = __VLS_561({
    label: "项目目录",
}, ...__VLS_functionalComponentArgsRest(__VLS_561));
const { default: __VLS_565 } = __VLS_563.slots;
let __VLS_566;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input'] | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_567 = __VLS_asFunctionalComponent1(__VLS_566, new __VLS_566({
    modelValue: (__VLS_ctx.projectForm.path),
    ...{ class: "apple-dialog-input project-path-input" },
    placeholder: "选择任意本地项目目录",
}));
const __VLS_568 = __VLS_567({
    modelValue: (__VLS_ctx.projectForm.path),
    ...{ class: "apple-dialog-input project-path-input" },
    placeholder: "选择任意本地项目目录",
}, ...__VLS_functionalComponentArgsRest(__VLS_567));
/** @type {__VLS_StyleScopedClasses['apple-dialog-input']} */ ;
/** @type {__VLS_StyleScopedClasses['project-path-input']} */ ;
const { default: __VLS_571 } = __VLS_569.slots;
{
    const { append: __VLS_572 } = __VLS_569.slots;
    let __VLS_573;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_574 = __VLS_asFunctionalComponent1(__VLS_573, new __VLS_573({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.FolderOpened),
    }));
    const __VLS_575 = __VLS_574({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.FolderOpened),
    }, ...__VLS_functionalComponentArgsRest(__VLS_574));
    let __VLS_578;
    const __VLS_579 = {
        /** @type {typeof __VLS_578.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.choose(__VLS_ctx.projectForm, '选择要管理的项目目录'));
            // @ts-ignore
            [projectDialog, projectForm, projectForm, FolderOpened, choose,];
        },
    };
    const { default: __VLS_580 } = __VLS_576.slots;
    // @ts-ignore
    [];
    var __VLS_576;
    var __VLS_577;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_569;
// @ts-ignore
[];
var __VLS_563;
let __VLS_581;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_582 = __VLS_asFunctionalComponent1(__VLS_581, new __VLS_581({
    label: "显示名称（可选）",
}));
const __VLS_583 = __VLS_582({
    label: "显示名称（可选）",
}, ...__VLS_functionalComponentArgsRest(__VLS_582));
const { default: __VLS_586 } = __VLS_584.slots;
let __VLS_587;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_588 = __VLS_asFunctionalComponent1(__VLS_587, new __VLS_587({
    modelValue: (__VLS_ctx.projectForm.name),
    ...{ class: "apple-dialog-input" },
    placeholder: "默认使用目录名",
}));
const __VLS_589 = __VLS_588({
    modelValue: (__VLS_ctx.projectForm.name),
    ...{ class: "apple-dialog-input" },
    placeholder: "默认使用目录名",
}, ...__VLS_functionalComponentArgsRest(__VLS_588));
/** @type {__VLS_StyleScopedClasses['apple-dialog-input']} */ ;
// @ts-ignore
[projectForm,];
var __VLS_584;
// @ts-ignore
[];
var __VLS_557;
{
    const { footer: __VLS_592 } = __VLS_551.slots;
    let __VLS_593;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_594 = __VLS_asFunctionalComponent1(__VLS_593, new __VLS_593({
        ...{ 'onClick': {} },
    }));
    const __VLS_595 = __VLS_594({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_594));
    let __VLS_598;
    const __VLS_599 = {
        /** @type {typeof __VLS_598.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.projectDialog = false);
            // @ts-ignore
            [projectDialog,];
        },
    };
    const { default: __VLS_600 } = __VLS_596.slots;
    // @ts-ignore
    [];
    var __VLS_596;
    var __VLS_597;
    let __VLS_601;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_602 = __VLS_asFunctionalComponent1(__VLS_601, new __VLS_601({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.projectForm.path),
    }));
    const __VLS_603 = __VLS_602({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.projectForm.path),
    }, ...__VLS_functionalComponentArgsRest(__VLS_602));
    let __VLS_606;
    const __VLS_607 = {
        /** @type {typeof __VLS_606.click} */
        onClick: (__VLS_ctx.addProject),
    };
    const { default: __VLS_608 } = __VLS_604.slots;
    // @ts-ignore
    [projectForm, addProject,];
    var __VLS_604;
    var __VLS_605;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_551;
let __VLS_609;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_610 = __VLS_asFunctionalComponent1(__VLS_609, new __VLS_609({
    modelValue: (__VLS_ctx.sourceDialog),
    title: "添加技能源",
    width: "560",
}));
const __VLS_611 = __VLS_610({
    modelValue: (__VLS_ctx.sourceDialog),
    title: "添加技能源",
    width: "560",
}, ...__VLS_functionalComponentArgsRest(__VLS_610));
const { default: __VLS_614 } = __VLS_612.slots;
let __VLS_615;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_616 = __VLS_asFunctionalComponent1(__VLS_615, new __VLS_615({
    ...{ class: "apple-dialog-form source-form" },
    labelPosition: "top",
}));
const __VLS_617 = __VLS_616({
    ...{ class: "apple-dialog-form source-form" },
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_616));
/** @type {__VLS_StyleScopedClasses['apple-dialog-form']} */ ;
/** @type {__VLS_StyleScopedClasses['source-form']} */ ;
const { default: __VLS_620 } = __VLS_618.slots;
let __VLS_621;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_622 = __VLS_asFunctionalComponent1(__VLS_621, new __VLS_621({
    label: "来源类型",
}));
const __VLS_623 = __VLS_622({
    label: "来源类型",
}, ...__VLS_functionalComponentArgsRest(__VLS_622));
const { default: __VLS_626 } = __VLS_624.slots;
let __VLS_627;
/** @ts-ignore @type { | typeof __VLS_components.elSegmented | typeof __VLS_components.ElSegmented | typeof __VLS_components['el-segmented']} */
elSegmented;
// @ts-ignore
const __VLS_628 = __VLS_asFunctionalComponent1(__VLS_627, new __VLS_627({
    modelValue: (__VLS_ctx.sourceForm.mode),
    ...{ class: "apple-segmented" },
    options: ([
        { label: '技能包（递归发现）', value: 'pack' },
        { label: '单个技能', value: 'single' },
    ]),
}));
const __VLS_629 = __VLS_628({
    modelValue: (__VLS_ctx.sourceForm.mode),
    ...{ class: "apple-segmented" },
    options: ([
        { label: '技能包（递归发现）', value: 'pack' },
        { label: '单个技能', value: 'single' },
    ]),
}, ...__VLS_functionalComponentArgsRest(__VLS_628));
/** @type {__VLS_StyleScopedClasses['apple-segmented']} */ ;
// @ts-ignore
[sourceDialog, sourceForm,];
var __VLS_624;
let __VLS_632;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_633 = __VLS_asFunctionalComponent1(__VLS_632, new __VLS_632({
    label: "目录",
}));
const __VLS_634 = __VLS_633({
    label: "目录",
}, ...__VLS_functionalComponentArgsRest(__VLS_633));
const { default: __VLS_637 } = __VLS_635.slots;
let __VLS_638;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input'] | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_639 = __VLS_asFunctionalComponent1(__VLS_638, new __VLS_638({
    modelValue: (__VLS_ctx.sourceForm.path),
    ...{ class: "apple-dialog-input" },
    placeholder: "选择含 SKILL.md 的技能或技能包",
}));
const __VLS_640 = __VLS_639({
    modelValue: (__VLS_ctx.sourceForm.path),
    ...{ class: "apple-dialog-input" },
    placeholder: "选择含 SKILL.md 的技能或技能包",
}, ...__VLS_functionalComponentArgsRest(__VLS_639));
/** @type {__VLS_StyleScopedClasses['apple-dialog-input']} */ ;
const { default: __VLS_643 } = __VLS_641.slots;
{
    const { append: __VLS_644 } = __VLS_641.slots;
    let __VLS_645;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_646 = __VLS_asFunctionalComponent1(__VLS_645, new __VLS_645({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.FolderOpened),
    }));
    const __VLS_647 = __VLS_646({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.FolderOpened),
    }, ...__VLS_functionalComponentArgsRest(__VLS_646));
    let __VLS_650;
    const __VLS_651 = {
        /** @type {typeof __VLS_650.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.choose(__VLS_ctx.sourceForm, '选择技能或技能包目录'));
            // @ts-ignore
            [FolderOpened, choose, sourceForm, sourceForm,];
        },
    };
    const { default: __VLS_652 } = __VLS_648.slots;
    // @ts-ignore
    [];
    var __VLS_648;
    var __VLS_649;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_641;
// @ts-ignore
[];
var __VLS_635;
let __VLS_653;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_654 = __VLS_asFunctionalComponent1(__VLS_653, new __VLS_653({
    label: "来源名称（可选）",
}));
const __VLS_655 = __VLS_654({
    label: "来源名称（可选）",
}, ...__VLS_functionalComponentArgsRest(__VLS_654));
const { default: __VLS_658 } = __VLS_656.slots;
let __VLS_659;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_660 = __VLS_asFunctionalComponent1(__VLS_659, new __VLS_659({
    modelValue: (__VLS_ctx.sourceForm.name),
    ...{ class: "apple-dialog-input" },
    placeholder: "默认使用目录名",
}));
const __VLS_661 = __VLS_660({
    modelValue: (__VLS_ctx.sourceForm.name),
    ...{ class: "apple-dialog-input" },
    placeholder: "默认使用目录名",
}, ...__VLS_functionalComponentArgsRest(__VLS_660));
/** @type {__VLS_StyleScopedClasses['apple-dialog-input']} */ ;
// @ts-ignore
[sourceForm,];
var __VLS_656;
// @ts-ignore
[];
var __VLS_618;
{
    const { footer: __VLS_664 } = __VLS_612.slots;
    let __VLS_665;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_666 = __VLS_asFunctionalComponent1(__VLS_665, new __VLS_665({
        ...{ 'onClick': {} },
    }));
    const __VLS_667 = __VLS_666({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_666));
    let __VLS_670;
    const __VLS_671 = {
        /** @type {typeof __VLS_670.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.sourceDialog = false);
            // @ts-ignore
            [sourceDialog,];
        },
    };
    const { default: __VLS_672 } = __VLS_668.slots;
    // @ts-ignore
    [];
    var __VLS_668;
    var __VLS_669;
    let __VLS_673;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_674 = __VLS_asFunctionalComponent1(__VLS_673, new __VLS_673({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.sourceForm.path),
    }));
    const __VLS_675 = __VLS_674({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.sourceForm.path),
    }, ...__VLS_functionalComponentArgsRest(__VLS_674));
    let __VLS_678;
    const __VLS_679 = {
        /** @type {typeof __VLS_678.click} */
        onClick: (__VLS_ctx.addSource),
    };
    const { default: __VLS_680 } = __VLS_676.slots;
    // @ts-ignore
    [sourceForm, addSource,];
    var __VLS_676;
    var __VLS_677;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_612;
let __VLS_681;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_682 = __VLS_asFunctionalComponent1(__VLS_681, new __VLS_681({
    modelValue: (__VLS_ctx.bundleDialog),
    title: "新建技能组合",
    width: "960",
    ...{ class: "apple-workflow-dialog" },
    alignCenter: true,
}));
const __VLS_683 = __VLS_682({
    modelValue: (__VLS_ctx.bundleDialog),
    title: "新建技能组合",
    width: "960",
    ...{ class: "apple-workflow-dialog" },
    alignCenter: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_682));
/** @type {__VLS_StyleScopedClasses['apple-workflow-dialog']} */ ;
const { default: __VLS_686 } = __VLS_684.slots;
let __VLS_687;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_688 = __VLS_asFunctionalComponent1(__VLS_687, new __VLS_687({
    ...{ class: "apple-dialog-form bundle-form" },
    labelPosition: "top",
}));
const __VLS_689 = __VLS_688({
    ...{ class: "apple-dialog-form bundle-form" },
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_688));
/** @type {__VLS_StyleScopedClasses['apple-dialog-form']} */ ;
/** @type {__VLS_StyleScopedClasses['bundle-form']} */ ;
const { default: __VLS_692 } = __VLS_690.slots;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "bundle-meta-grid" },
});
/** @type {__VLS_StyleScopedClasses['bundle-meta-grid']} */ ;
let __VLS_693;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_694 = __VLS_asFunctionalComponent1(__VLS_693, new __VLS_693({
    label: "组合名称",
}));
const __VLS_695 = __VLS_694({
    label: "组合名称",
}, ...__VLS_functionalComponentArgsRest(__VLS_694));
const { default: __VLS_698 } = __VLS_696.slots;
let __VLS_699;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_700 = __VLS_asFunctionalComponent1(__VLS_699, new __VLS_699({
    modelValue: (__VLS_ctx.bundleForm.name),
    ...{ class: "apple-dialog-input" },
}));
const __VLS_701 = __VLS_700({
    modelValue: (__VLS_ctx.bundleForm.name),
    ...{ class: "apple-dialog-input" },
}, ...__VLS_functionalComponentArgsRest(__VLS_700));
/** @type {__VLS_StyleScopedClasses['apple-dialog-input']} */ ;
// @ts-ignore
[bundleDialog, bundleForm,];
var __VLS_696;
let __VLS_704;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_705 = __VLS_asFunctionalComponent1(__VLS_704, new __VLS_704({
    label: "说明",
}));
const __VLS_706 = __VLS_705({
    label: "说明",
}, ...__VLS_functionalComponentArgsRest(__VLS_705));
const { default: __VLS_709 } = __VLS_707.slots;
let __VLS_710;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_711 = __VLS_asFunctionalComponent1(__VLS_710, new __VLS_710({
    modelValue: (__VLS_ctx.bundleForm.description),
    ...{ class: "apple-dialog-input bundle-description-input" },
    type: "textarea",
}));
const __VLS_712 = __VLS_711({
    modelValue: (__VLS_ctx.bundleForm.description),
    ...{ class: "apple-dialog-input bundle-description-input" },
    type: "textarea",
}, ...__VLS_functionalComponentArgsRest(__VLS_711));
/** @type {__VLS_StyleScopedClasses['apple-dialog-input']} */ ;
/** @type {__VLS_StyleScopedClasses['bundle-description-input']} */ ;
// @ts-ignore
[bundleForm,];
var __VLS_707;
let __VLS_715;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_716 = __VLS_asFunctionalComponent1(__VLS_715, new __VLS_715({
    label: "选择技能",
}));
const __VLS_717 = __VLS_716({
    label: "选择技能",
}, ...__VLS_functionalComponentArgsRest(__VLS_716));
const { default: __VLS_720 } = __VLS_718.slots;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "batch-skill-picker" },
});
/** @type {__VLS_StyleScopedClasses['batch-skill-picker']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "apple-select batch-source-select" },
});
/** @type {__VLS_StyleScopedClasses['apple-select']} */ ;
/** @type {__VLS_StyleScopedClasses['batch-source-select']} */ ;
let __VLS_721;
/** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
elSelect;
// @ts-ignore
const __VLS_722 = __VLS_asFunctionalComponent1(__VLS_721, new __VLS_721({
    modelValue: (__VLS_ctx.bundleSourceFilter),
    'aria-label': "筛选技能源",
    popperClass: "apple-select-popper",
}));
const __VLS_723 = __VLS_722({
    modelValue: (__VLS_ctx.bundleSourceFilter),
    'aria-label': "筛选技能源",
    popperClass: "apple-select-popper",
}, ...__VLS_functionalComponentArgsRest(__VLS_722));
const { default: __VLS_726 } = __VLS_724.slots;
for (const [option] of __VLS_vFor((__VLS_ctx.sourceOptions))) {
    let __VLS_727;
    /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
    elOption;
    // @ts-ignore
    const __VLS_728 = __VLS_asFunctionalComponent1(__VLS_727, new __VLS_727({
        key: (option.value),
        label: (option.label),
        value: (option.value),
    }));
    const __VLS_729 = __VLS_728({
        key: (option.value),
        label: (option.label),
        value: (option.value),
    }, ...__VLS_functionalComponentArgsRest(__VLS_728));
    // @ts-ignore
    [sourceOptions, bundleSourceFilter,];
}
// @ts-ignore
[];
var __VLS_724;
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
    ...{ class: "batch-selection-count" },
});
/** @type {__VLS_StyleScopedClasses['batch-selection-count']} */ ;
(__VLS_ctx.bundleForm.skillIds.length);
// @ts-ignore
[bundleForm,];
var __VLS_718;
// @ts-ignore
[];
var __VLS_690;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "batch-skill-table bundle-skill-table glass" },
});
/** @type {__VLS_StyleScopedClasses['batch-skill-table']} */ ;
/** @type {__VLS_StyleScopedClasses['bundle-skill-table']} */ ;
/** @type {__VLS_StyleScopedClasses['glass']} */ ;
let __VLS_732;
/** @ts-ignore @type { | typeof __VLS_components.elTable | typeof __VLS_components.ElTable | typeof __VLS_components['el-table'] | typeof __VLS_components.elTable | typeof __VLS_components.ElTable | typeof __VLS_components['el-table']} */
elTable;
// @ts-ignore
const __VLS_733 = __VLS_asFunctionalComponent1(__VLS_732, new __VLS_732({
    ...{ 'onSelectionChange': {} },
    ref: "bundleSkillTable",
    data: (__VLS_ctx.filteredBundleSkills),
    rowKey: "id",
    height: "360",
    emptyText: "当前筛选没有技能",
}));
const __VLS_734 = __VLS_733({
    ...{ 'onSelectionChange': {} },
    ref: "bundleSkillTable",
    data: (__VLS_ctx.filteredBundleSkills),
    rowKey: "id",
    height: "360",
    emptyText: "当前筛选没有技能",
}, ...__VLS_functionalComponentArgsRest(__VLS_733));
let __VLS_737;
const __VLS_738 = {
    /** @type {typeof __VLS_737.selectionChange} */
    onSelectionChange: (__VLS_ctx.handleBundleSkillSelection),
};
var __VLS_739;
const { default: __VLS_741 } = __VLS_735.slots;
let __VLS_742;
/** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
elTableColumn;
// @ts-ignore
const __VLS_743 = __VLS_asFunctionalComponent1(__VLS_742, new __VLS_742({
    type: "selection",
    width: "48",
    reserveSelection: (true),
    selectable: (__VLS_ctx.isGroupBatchSkillSelectable),
}));
const __VLS_744 = __VLS_743({
    type: "selection",
    width: "48",
    reserveSelection: (true),
    selectable: (__VLS_ctx.isGroupBatchSkillSelectable),
}, ...__VLS_functionalComponentArgsRest(__VLS_743));
let __VLS_747;
/** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
elTableColumn;
// @ts-ignore
const __VLS_748 = __VLS_asFunctionalComponent1(__VLS_747, new __VLS_747({
    label: "技能",
    minWidth: "280",
}));
const __VLS_749 = __VLS_748({
    label: "技能",
    minWidth: "280",
}, ...__VLS_functionalComponentArgsRest(__VLS_748));
const { default: __VLS_752 } = __VLS_750.slots;
{
    const { default: __VLS_753 } = __VLS_750.slots;
    const [{ row }] = __VLS_vSlot(__VLS_753);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "skill-name" },
    });
    /** @type {__VLS_StyleScopedClasses['skill-name']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                return (__VLS_ctx.toggleFavorite(row));
                // @ts-ignore
                [toggleFavorite, filteredBundleSkills, handleBundleSkillSelection, isGroupBatchSkillSelectable,];
            } },
        ...{ class: "star" },
        type: "button",
        'aria-label': (`${row.favorite ? '取消收藏' : '收藏'}技能 ${row.name}`),
        'aria-pressed': (row.favorite),
    });
    /** @type {__VLS_StyleScopedClasses['star']} */ ;
    let __VLS_754;
    /** @ts-ignore @type { | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon'] | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon']} */
    elIcon;
    // @ts-ignore
    const __VLS_755 = __VLS_asFunctionalComponent1(__VLS_754, new __VLS_754({
        ...{ class: ({ on: row.favorite }) },
    }));
    const __VLS_756 = __VLS_755({
        ...{ class: ({ on: row.favorite }) },
    }, ...__VLS_functionalComponentArgsRest(__VLS_755));
    /** @type {__VLS_StyleScopedClasses['on']} */ ;
    const { default: __VLS_759 } = __VLS_757.slots;
    let __VLS_760;
    /** @ts-ignore @type { | typeof __VLS_components.Star} */
    Star;
    // @ts-ignore
    const __VLS_761 = __VLS_asFunctionalComponent1(__VLS_760, new __VLS_760({}));
    const __VLS_762 = __VLS_761({}, ...__VLS_functionalComponentArgsRest(__VLS_761));
    // @ts-ignore
    [];
    var __VLS_757;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({
        title: (row.name),
    });
    (row.name);
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    (row.description || row.path);
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_750;
let __VLS_765;
/** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
elTableColumn;
// @ts-ignore
const __VLS_766 = __VLS_asFunctionalComponent1(__VLS_765, new __VLS_765({
    label: "技能源",
    width: "190",
}));
const __VLS_767 = __VLS_766({
    label: "技能源",
    width: "190",
}, ...__VLS_functionalComponentArgsRest(__VLS_766));
const { default: __VLS_770 } = __VLS_768.slots;
{
    const { default: __VLS_771 } = __VLS_768.slots;
    const [{ row }] = __VLS_vSlot(__VLS_771);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "source-text" },
    });
    /** @type {__VLS_StyleScopedClasses['source-text']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (__VLS_ctx.sourceName(row));
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    (__VLS_ctx.sourceMode(row));
    // @ts-ignore
    [sourceName, sourceMode,];
}
// @ts-ignore
[];
var __VLS_768;
let __VLS_772;
/** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
elTableColumn;
// @ts-ignore
const __VLS_773 = __VLS_asFunctionalComponent1(__VLS_772, new __VLS_772({
    prop: "alias",
    label: "链接名",
    width: "150",
}));
const __VLS_774 = __VLS_773({
    prop: "alias",
    label: "链接名",
    width: "150",
}, ...__VLS_functionalComponentArgsRest(__VLS_773));
let __VLS_777;
/** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
elTableColumn;
// @ts-ignore
const __VLS_778 = __VLS_asFunctionalComponent1(__VLS_777, new __VLS_777({
    label: "状态",
    width: "110",
}));
const __VLS_779 = __VLS_778({
    label: "状态",
    width: "110",
}, ...__VLS_functionalComponentArgsRest(__VLS_778));
const { default: __VLS_782 } = __VLS_780.slots;
{
    const { default: __VLS_783 } = __VLS_780.slots;
    const [{ row }] = __VLS_vSlot(__VLS_783);
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "status" },
        ...{ class: (row.available ? 'linked' : 'broken') },
    });
    /** @type {__VLS_StyleScopedClasses['status']} */ ;
    (row.available ? '可用' : '不可用');
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_780;
let __VLS_784;
/** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
elTableColumn;
// @ts-ignore
const __VLS_785 = __VLS_asFunctionalComponent1(__VLS_784, new __VLS_784({
    label: "标签",
    width: "150",
}));
const __VLS_786 = __VLS_785({
    label: "标签",
    width: "150",
}, ...__VLS_functionalComponentArgsRest(__VLS_785));
const { default: __VLS_789 } = __VLS_787.slots;
{
    const { default: __VLS_790 } = __VLS_787.slots;
    const [{ row }] = __VLS_vSlot(__VLS_790);
    for (const [t] of __VLS_vFor((row.tags.slice(0, 2)))) {
        let __VLS_791;
        /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
        elTag;
        // @ts-ignore
        const __VLS_792 = __VLS_asFunctionalComponent1(__VLS_791, new __VLS_791({
            key: (t),
            round: true,
        }));
        const __VLS_793 = __VLS_792({
            key: (t),
            round: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_792));
        const { default: __VLS_796 } = __VLS_794.slots;
        (t);
        // @ts-ignore
        [];
        var __VLS_794;
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_787;
// @ts-ignore
[];
var __VLS_735;
var __VLS_736;
{
    const { footer: __VLS_797 } = __VLS_684.slots;
    let __VLS_798;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_799 = __VLS_asFunctionalComponent1(__VLS_798, new __VLS_798({
        ...{ 'onClick': {} },
    }));
    const __VLS_800 = __VLS_799({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_799));
    let __VLS_803;
    const __VLS_804 = {
        /** @type {typeof __VLS_803.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.bundleDialog = false);
            // @ts-ignore
            [bundleDialog,];
        },
    };
    const { default: __VLS_805 } = __VLS_801.slots;
    // @ts-ignore
    [];
    var __VLS_801;
    var __VLS_802;
    let __VLS_806;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_807 = __VLS_asFunctionalComponent1(__VLS_806, new __VLS_806({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleForm.name),
    }));
    const __VLS_808 = __VLS_807({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleForm.name),
    }, ...__VLS_functionalComponentArgsRest(__VLS_807));
    let __VLS_811;
    const __VLS_812 = {
        /** @type {typeof __VLS_811.click} */
        onClick: (__VLS_ctx.createBundle),
    };
    const { default: __VLS_813 } = __VLS_809.slots;
    // @ts-ignore
    [bundleForm, createBundle,];
    var __VLS_809;
    var __VLS_810;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_684;
let __VLS_814;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_815 = __VLS_asFunctionalComponent1(__VLS_814, new __VLS_814({
    modelValue: (__VLS_ctx.groupDialog),
    title: (__VLS_ctx.editingGroupId ? '编辑项目组' : '新建项目组'),
    width: "480",
}));
const __VLS_816 = __VLS_815({
    modelValue: (__VLS_ctx.groupDialog),
    title: (__VLS_ctx.editingGroupId ? '编辑项目组' : '新建项目组'),
    width: "480",
}, ...__VLS_functionalComponentArgsRest(__VLS_815));
const { default: __VLS_819 } = __VLS_817.slots;
let __VLS_820;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_821 = __VLS_asFunctionalComponent1(__VLS_820, new __VLS_820({
    ...{ class: "apple-dialog-form group-form" },
    labelPosition: "top",
}));
const __VLS_822 = __VLS_821({
    ...{ class: "apple-dialog-form group-form" },
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_821));
/** @type {__VLS_StyleScopedClasses['apple-dialog-form']} */ ;
/** @type {__VLS_StyleScopedClasses['group-form']} */ ;
const { default: __VLS_825 } = __VLS_823.slots;
let __VLS_826;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_827 = __VLS_asFunctionalComponent1(__VLS_826, new __VLS_826({
    label: "项目组名称",
}));
const __VLS_828 = __VLS_827({
    label: "项目组名称",
}, ...__VLS_functionalComponentArgsRest(__VLS_827));
const { default: __VLS_831 } = __VLS_829.slots;
let __VLS_832;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_833 = __VLS_asFunctionalComponent1(__VLS_832, new __VLS_832({
    modelValue: (__VLS_ctx.groupForm.name),
    modelModifiers: { trim: true, },
    ...{ class: "apple-dialog-input" },
}));
const __VLS_834 = __VLS_833({
    modelValue: (__VLS_ctx.groupForm.name),
    modelModifiers: { trim: true, },
    ...{ class: "apple-dialog-input" },
}, ...__VLS_functionalComponentArgsRest(__VLS_833));
/** @type {__VLS_StyleScopedClasses['apple-dialog-input']} */ ;
// @ts-ignore
[groupDialog, editingGroupId, groupForm,];
var __VLS_829;
let __VLS_837;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_838 = __VLS_asFunctionalComponent1(__VLS_837, new __VLS_837({
    label: "标识颜色",
}));
const __VLS_839 = __VLS_838({
    label: "标识颜色",
}, ...__VLS_functionalComponentArgsRest(__VLS_838));
const { default: __VLS_842 } = __VLS_840.slots;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "apple-color-field" },
});
/** @type {__VLS_StyleScopedClasses['apple-color-field']} */ ;
let __VLS_843;
/** @ts-ignore @type { | typeof __VLS_components.elColorPicker | typeof __VLS_components.ElColorPicker | typeof __VLS_components['el-color-picker']} */
elColorPicker;
// @ts-ignore
const __VLS_844 = __VLS_asFunctionalComponent1(__VLS_843, new __VLS_843({
    modelValue: (__VLS_ctx.groupForm.color),
    predefine: (__VLS_ctx.groupColorPresets),
}));
const __VLS_845 = __VLS_844({
    modelValue: (__VLS_ctx.groupForm.color),
    predefine: (__VLS_ctx.groupColorPresets),
}, ...__VLS_functionalComponentArgsRest(__VLS_844));
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
    ...{ class: "apple-color-value" },
});
/** @type {__VLS_StyleScopedClasses['apple-color-value']} */ ;
(__VLS_ctx.groupForm.color);
// @ts-ignore
[groupForm, groupForm, groupColorPresets,];
var __VLS_840;
// @ts-ignore
[];
var __VLS_823;
{
    const { footer: __VLS_848 } = __VLS_817.slots;
    let __VLS_849;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_850 = __VLS_asFunctionalComponent1(__VLS_849, new __VLS_849({
        ...{ 'onClick': {} },
    }));
    const __VLS_851 = __VLS_850({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_850));
    let __VLS_854;
    const __VLS_855 = {
        /** @type {typeof __VLS_854.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.groupDialog = false);
            // @ts-ignore
            [groupDialog,];
        },
    };
    const { default: __VLS_856 } = __VLS_852.slots;
    // @ts-ignore
    [];
    var __VLS_852;
    var __VLS_853;
    let __VLS_857;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_858 = __VLS_asFunctionalComponent1(__VLS_857, new __VLS_857({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.groupSaving),
        disabled: (!__VLS_ctx.groupForm.name),
    }));
    const __VLS_859 = __VLS_858({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.groupSaving),
        disabled: (!__VLS_ctx.groupForm.name),
    }, ...__VLS_functionalComponentArgsRest(__VLS_858));
    let __VLS_862;
    const __VLS_863 = {
        /** @type {typeof __VLS_862.click} */
        onClick: (__VLS_ctx.saveGroup),
    };
    const { default: __VLS_864 } = __VLS_860.slots;
    (__VLS_ctx.editingGroupId ? '保存' : '创建');
    // @ts-ignore
    [editingGroupId, groupForm, groupSaving, saveGroup,];
    var __VLS_860;
    var __VLS_861;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_817;
let __VLS_865;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_866 = __VLS_asFunctionalComponent1(__VLS_865, new __VLS_865({
    modelValue: (__VLS_ctx.groupSkillsDialog),
    title: (`批量配置技能 · ${__VLS_ctx.activeGroupBatch?.name || ''}`),
    width: "960",
    ...{ class: "apple-workflow-dialog" },
}));
const __VLS_867 = __VLS_866({
    modelValue: (__VLS_ctx.groupSkillsDialog),
    title: (`批量配置技能 · ${__VLS_ctx.activeGroupBatch?.name || ''}`),
    width: "960",
    ...{ class: "apple-workflow-dialog" },
}, ...__VLS_functionalComponentArgsRest(__VLS_866));
/** @type {__VLS_StyleScopedClasses['apple-workflow-dialog']} */ ;
const { default: __VLS_870 } = __VLS_868.slots;
let __VLS_871;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_872 = __VLS_asFunctionalComponent1(__VLS_871, new __VLS_871({
    ...{ class: "apple-dialog-form group-skills-form" },
    labelPosition: "top",
}));
const __VLS_873 = __VLS_872({
    ...{ class: "apple-dialog-form group-skills-form" },
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_872));
/** @type {__VLS_StyleScopedClasses['apple-dialog-form']} */ ;
/** @type {__VLS_StyleScopedClasses['group-skills-form']} */ ;
const { default: __VLS_876 } = __VLS_874.slots;
let __VLS_877;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_878 = __VLS_asFunctionalComponent1(__VLS_877, new __VLS_877({
    label: "操作方式",
}));
const __VLS_879 = __VLS_878({
    label: "操作方式",
}, ...__VLS_functionalComponentArgsRest(__VLS_878));
const { default: __VLS_882 } = __VLS_880.slots;
let __VLS_883;
/** @ts-ignore @type { | typeof __VLS_components.elSegmented | typeof __VLS_components.ElSegmented | typeof __VLS_components['el-segmented']} */
elSegmented;
// @ts-ignore
const __VLS_884 = __VLS_asFunctionalComponent1(__VLS_883, new __VLS_883({
    modelValue: (__VLS_ctx.groupBatch.action),
    ...{ class: "apple-segmented" },
    'aria-label': "批量操作方式",
    options: ([
        { label: '加入链接', value: 'link' },
        { label: '替换异常链接', value: 'replace' },
        { label: '移除链接', value: 'remove' },
    ]),
}));
const __VLS_885 = __VLS_884({
    modelValue: (__VLS_ctx.groupBatch.action),
    ...{ class: "apple-segmented" },
    'aria-label': "批量操作方式",
    options: ([
        { label: '加入链接', value: 'link' },
        { label: '替换异常链接', value: 'replace' },
        { label: '移除链接', value: 'remove' },
    ]),
}, ...__VLS_functionalComponentArgsRest(__VLS_884));
/** @type {__VLS_StyleScopedClasses['apple-segmented']} */ ;
// @ts-ignore
[groupSkillsDialog, activeGroupBatch, groupBatch,];
var __VLS_880;
let __VLS_888;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_889 = __VLS_asFunctionalComponent1(__VLS_888, new __VLS_888({
    label: "选择技能",
}));
const __VLS_890 = __VLS_889({
    label: "选择技能",
}, ...__VLS_functionalComponentArgsRest(__VLS_889));
const { default: __VLS_893 } = __VLS_891.slots;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "batch-skill-picker" },
});
/** @type {__VLS_StyleScopedClasses['batch-skill-picker']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "apple-select batch-source-select" },
});
/** @type {__VLS_StyleScopedClasses['apple-select']} */ ;
/** @type {__VLS_StyleScopedClasses['batch-source-select']} */ ;
let __VLS_894;
/** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
elSelect;
// @ts-ignore
const __VLS_895 = __VLS_asFunctionalComponent1(__VLS_894, new __VLS_894({
    modelValue: (__VLS_ctx.groupBatchSourceFilter),
    'aria-label': "筛选技能源",
    popperClass: "apple-select-popper",
}));
const __VLS_896 = __VLS_895({
    modelValue: (__VLS_ctx.groupBatchSourceFilter),
    'aria-label': "筛选技能源",
    popperClass: "apple-select-popper",
}, ...__VLS_functionalComponentArgsRest(__VLS_895));
const { default: __VLS_899 } = __VLS_897.slots;
for (const [option] of __VLS_vFor((__VLS_ctx.sourceOptions))) {
    let __VLS_900;
    /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
    elOption;
    // @ts-ignore
    const __VLS_901 = __VLS_asFunctionalComponent1(__VLS_900, new __VLS_900({
        key: (option.value),
        label: (option.label),
        value: (option.value),
    }));
    const __VLS_902 = __VLS_901({
        key: (option.value),
        label: (option.label),
        value: (option.value),
    }, ...__VLS_functionalComponentArgsRest(__VLS_901));
    // @ts-ignore
    [sourceOptions, groupBatchSourceFilter,];
}
// @ts-ignore
[];
var __VLS_897;
__VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
    ...{ class: "batch-selection-count" },
});
/** @type {__VLS_StyleScopedClasses['batch-selection-count']} */ ;
(__VLS_ctx.groupBatch.skillIds.length);
// @ts-ignore
[groupBatch,];
var __VLS_891;
// @ts-ignore
[];
var __VLS_874;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "batch-skill-table glass" },
});
/** @type {__VLS_StyleScopedClasses['batch-skill-table']} */ ;
/** @type {__VLS_StyleScopedClasses['glass']} */ ;
let __VLS_905;
/** @ts-ignore @type { | typeof __VLS_components.elTable | typeof __VLS_components.ElTable | typeof __VLS_components['el-table'] | typeof __VLS_components.elTable | typeof __VLS_components.ElTable | typeof __VLS_components['el-table']} */
elTable;
// @ts-ignore
const __VLS_906 = __VLS_asFunctionalComponent1(__VLS_905, new __VLS_905({
    ...{ 'onSelectionChange': {} },
    ref: "groupBatchSkillTable",
    data: (__VLS_ctx.filteredGroupBatchSkills),
    rowKey: "id",
    height: "360",
    emptyText: "当前筛选没有技能",
}));
const __VLS_907 = __VLS_906({
    ...{ 'onSelectionChange': {} },
    ref: "groupBatchSkillTable",
    data: (__VLS_ctx.filteredGroupBatchSkills),
    rowKey: "id",
    height: "360",
    emptyText: "当前筛选没有技能",
}, ...__VLS_functionalComponentArgsRest(__VLS_906));
let __VLS_910;
const __VLS_911 = {
    /** @type {typeof __VLS_910.selectionChange} */
    onSelectionChange: (__VLS_ctx.handleGroupBatchSkillSelection),
};
var __VLS_912;
const { default: __VLS_914 } = __VLS_908.slots;
let __VLS_915;
/** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
elTableColumn;
// @ts-ignore
const __VLS_916 = __VLS_asFunctionalComponent1(__VLS_915, new __VLS_915({
    type: "selection",
    width: "48",
    reserveSelection: (true),
    selectable: (__VLS_ctx.isGroupBatchSkillSelectable),
}));
const __VLS_917 = __VLS_916({
    type: "selection",
    width: "48",
    reserveSelection: (true),
    selectable: (__VLS_ctx.isGroupBatchSkillSelectable),
}, ...__VLS_functionalComponentArgsRest(__VLS_916));
let __VLS_920;
/** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
elTableColumn;
// @ts-ignore
const __VLS_921 = __VLS_asFunctionalComponent1(__VLS_920, new __VLS_920({
    label: "技能",
    minWidth: "280",
}));
const __VLS_922 = __VLS_921({
    label: "技能",
    minWidth: "280",
}, ...__VLS_functionalComponentArgsRest(__VLS_921));
const { default: __VLS_925 } = __VLS_923.slots;
{
    const { default: __VLS_926 } = __VLS_923.slots;
    const [{ row }] = __VLS_vSlot(__VLS_926);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "skill-name" },
    });
    /** @type {__VLS_StyleScopedClasses['skill-name']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                return (__VLS_ctx.toggleFavorite(row));
                // @ts-ignore
                [toggleFavorite, isGroupBatchSkillSelectable, filteredGroupBatchSkills, handleGroupBatchSkillSelection,];
            } },
        ...{ class: "star" },
        type: "button",
        'aria-label': (`${row.favorite ? '取消收藏' : '收藏'}技能 ${row.name}`),
        'aria-pressed': (row.favorite),
    });
    /** @type {__VLS_StyleScopedClasses['star']} */ ;
    let __VLS_927;
    /** @ts-ignore @type { | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon'] | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon']} */
    elIcon;
    // @ts-ignore
    const __VLS_928 = __VLS_asFunctionalComponent1(__VLS_927, new __VLS_927({
        ...{ class: ({ on: row.favorite }) },
    }));
    const __VLS_929 = __VLS_928({
        ...{ class: ({ on: row.favorite }) },
    }, ...__VLS_functionalComponentArgsRest(__VLS_928));
    /** @type {__VLS_StyleScopedClasses['on']} */ ;
    const { default: __VLS_932 } = __VLS_930.slots;
    let __VLS_933;
    /** @ts-ignore @type { | typeof __VLS_components.Star} */
    Star;
    // @ts-ignore
    const __VLS_934 = __VLS_asFunctionalComponent1(__VLS_933, new __VLS_933({}));
    const __VLS_935 = __VLS_934({}, ...__VLS_functionalComponentArgsRest(__VLS_934));
    // @ts-ignore
    [];
    var __VLS_930;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({
        title: (row.name),
    });
    (row.name);
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    (row.description || row.path);
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_923;
let __VLS_938;
/** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
elTableColumn;
// @ts-ignore
const __VLS_939 = __VLS_asFunctionalComponent1(__VLS_938, new __VLS_938({
    label: "技能源",
    width: "190",
}));
const __VLS_940 = __VLS_939({
    label: "技能源",
    width: "190",
}, ...__VLS_functionalComponentArgsRest(__VLS_939));
const { default: __VLS_943 } = __VLS_941.slots;
{
    const { default: __VLS_944 } = __VLS_941.slots;
    const [{ row }] = __VLS_vSlot(__VLS_944);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "source-text" },
    });
    /** @type {__VLS_StyleScopedClasses['source-text']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    (__VLS_ctx.sourceName(row));
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    (__VLS_ctx.sourceMode(row));
    // @ts-ignore
    [sourceName, sourceMode,];
}
// @ts-ignore
[];
var __VLS_941;
let __VLS_945;
/** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
elTableColumn;
// @ts-ignore
const __VLS_946 = __VLS_asFunctionalComponent1(__VLS_945, new __VLS_945({
    prop: "alias",
    label: "链接名",
    width: "150",
}));
const __VLS_947 = __VLS_946({
    prop: "alias",
    label: "链接名",
    width: "150",
}, ...__VLS_functionalComponentArgsRest(__VLS_946));
let __VLS_950;
/** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
elTableColumn;
// @ts-ignore
const __VLS_951 = __VLS_asFunctionalComponent1(__VLS_950, new __VLS_950({
    label: "状态",
    width: "110",
}));
const __VLS_952 = __VLS_951({
    label: "状态",
    width: "110",
}, ...__VLS_functionalComponentArgsRest(__VLS_951));
const { default: __VLS_955 } = __VLS_953.slots;
{
    const { default: __VLS_956 } = __VLS_953.slots;
    const [{ row }] = __VLS_vSlot(__VLS_956);
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "status" },
        ...{ class: (row.available ? 'linked' : 'broken') },
    });
    /** @type {__VLS_StyleScopedClasses['status']} */ ;
    (row.available ? '可用' : '不可用');
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_953;
let __VLS_957;
/** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
elTableColumn;
// @ts-ignore
const __VLS_958 = __VLS_asFunctionalComponent1(__VLS_957, new __VLS_957({
    label: "标签",
    width: "150",
}));
const __VLS_959 = __VLS_958({
    label: "标签",
    width: "150",
}, ...__VLS_functionalComponentArgsRest(__VLS_958));
const { default: __VLS_962 } = __VLS_960.slots;
{
    const { default: __VLS_963 } = __VLS_960.slots;
    const [{ row }] = __VLS_vSlot(__VLS_963);
    for (const [t] of __VLS_vFor((row.tags.slice(0, 2)))) {
        let __VLS_964;
        /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
        elTag;
        // @ts-ignore
        const __VLS_965 = __VLS_asFunctionalComponent1(__VLS_964, new __VLS_964({
            key: (t),
            round: true,
        }));
        const __VLS_966 = __VLS_965({
            key: (t),
            round: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_965));
        const { default: __VLS_969 } = __VLS_967.slots;
        (t);
        // @ts-ignore
        [];
        var __VLS_967;
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_960;
// @ts-ignore
[];
var __VLS_908;
var __VLS_909;
let __VLS_970;
/** @ts-ignore @type { | typeof __VLS_components.elAlert | typeof __VLS_components.ElAlert | typeof __VLS_components['el-alert']} */
elAlert;
// @ts-ignore
const __VLS_971 = __VLS_asFunctionalComponent1(__VLS_970, new __VLS_970({
    ...{ class: "apple-inline-alert" },
    title: (`将为组内 ${__VLS_ctx.data.projects.filter((project) => project.groupId === __VLS_ctx.groupBatch.groupId).length} 个项目生成统一变更计划。`),
    type: "info",
    closable: (false),
}));
const __VLS_972 = __VLS_971({
    ...{ class: "apple-inline-alert" },
    title: (`将为组内 ${__VLS_ctx.data.projects.filter((project) => project.groupId === __VLS_ctx.groupBatch.groupId).length} 个项目生成统一变更计划。`),
    type: "info",
    closable: (false),
}, ...__VLS_functionalComponentArgsRest(__VLS_971));
/** @type {__VLS_StyleScopedClasses['apple-inline-alert']} */ ;
{
    const { footer: __VLS_975 } = __VLS_868.slots;
    let __VLS_976;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_977 = __VLS_asFunctionalComponent1(__VLS_976, new __VLS_976({
        ...{ 'onClick': {} },
    }));
    const __VLS_978 = __VLS_977({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_977));
    let __VLS_981;
    const __VLS_982 = {
        /** @type {typeof __VLS_981.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.groupSkillsDialog = false);
            // @ts-ignore
            [data, groupSkillsDialog, groupBatch,];
        },
    };
    const { default: __VLS_983 } = __VLS_979.slots;
    // @ts-ignore
    [];
    var __VLS_979;
    var __VLS_980;
    let __VLS_984;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_985 = __VLS_asFunctionalComponent1(__VLS_984, new __VLS_984({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.groupBatchLoading),
        disabled: (!__VLS_ctx.groupBatch.skillIds.length),
    }));
    const __VLS_986 = __VLS_985({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.groupBatchLoading),
        disabled: (!__VLS_ctx.groupBatch.skillIds.length),
    }, ...__VLS_functionalComponentArgsRest(__VLS_985));
    let __VLS_989;
    const __VLS_990 = {
        /** @type {typeof __VLS_989.click} */
        onClick: (__VLS_ctx.stageGroupSkills),
    };
    const { default: __VLS_991 } = __VLS_987.slots;
    // @ts-ignore
    [groupBatch, groupBatchLoading, stageGroupSkills,];
    var __VLS_987;
    var __VLS_988;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_868;
let __VLS_992;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_993 = __VLS_asFunctionalComponent1(__VLS_992, new __VLS_992({
    modelValue: (__VLS_ctx.skillDetailDialog),
    title: "技能详情",
    width: "1080",
    ...{ class: "skill-detail-dialog" },
    alignCenter: true,
    destroyOnClose: true,
}));
const __VLS_994 = __VLS_993({
    modelValue: (__VLS_ctx.skillDetailDialog),
    title: "技能详情",
    width: "1080",
    ...{ class: "skill-detail-dialog" },
    alignCenter: true,
    destroyOnClose: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_993));
/** @type {__VLS_StyleScopedClasses['skill-detail-dialog']} */ ;
const { default: __VLS_997 } = __VLS_995.slots;
if (__VLS_ctx.skillDetail) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "skill-detail-layout" },
    });
    /** @type {__VLS_StyleScopedClasses['skill-detail-layout']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "skill-detail-hero" },
    });
    /** @type {__VLS_StyleScopedClasses['skill-detail-hero']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "skill-detail-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['skill-detail-icon']} */ ;
    let __VLS_998;
    /** @ts-ignore @type { | typeof __VLS_components.Collection} */
    Collection;
    // @ts-ignore
    const __VLS_999 = __VLS_asFunctionalComponent1(__VLS_998, new __VLS_998({}));
    const __VLS_1000 = __VLS_999({}, ...__VLS_functionalComponentArgsRest(__VLS_999));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "skill-detail-heading" },
    });
    /** @type {__VLS_StyleScopedClasses['skill-detail-heading']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    (__VLS_ctx.skillDetail.name);
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.skillDetail.description || '暂无描述');
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.skillDetail))
                    throw 0;
                return (__VLS_ctx.toggleFavorite(__VLS_ctx.skillDetail));
                // @ts-ignore
                [toggleFavorite, skillDetailDialog, skillDetail, skillDetail, skillDetail, skillDetail,];
            } },
        ...{ class: "star skill-detail-favorite" },
        type: "button",
        'aria-label': (`${__VLS_ctx.skillDetail.favorite ? '取消收藏' : '收藏'}技能 ${__VLS_ctx.skillDetail.name}`),
        'aria-pressed': (__VLS_ctx.skillDetail.favorite),
    });
    /** @type {__VLS_StyleScopedClasses['star']} */ ;
    /** @type {__VLS_StyleScopedClasses['skill-detail-favorite']} */ ;
    let __VLS_1003;
    /** @ts-ignore @type { | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon'] | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon']} */
    elIcon;
    // @ts-ignore
    const __VLS_1004 = __VLS_asFunctionalComponent1(__VLS_1003, new __VLS_1003({
        ...{ class: ({ on: __VLS_ctx.skillDetail.favorite }) },
    }));
    const __VLS_1005 = __VLS_1004({
        ...{ class: ({ on: __VLS_ctx.skillDetail.favorite }) },
    }, ...__VLS_functionalComponentArgsRest(__VLS_1004));
    /** @type {__VLS_StyleScopedClasses['on']} */ ;
    const { default: __VLS_1008 } = __VLS_1006.slots;
    let __VLS_1009;
    /** @ts-ignore @type { | typeof __VLS_components.Star} */
    Star;
    // @ts-ignore
    const __VLS_1010 = __VLS_asFunctionalComponent1(__VLS_1009, new __VLS_1009({}));
    const __VLS_1011 = __VLS_1010({}, ...__VLS_functionalComponentArgsRest(__VLS_1010));
    // @ts-ignore
    [skillDetail, skillDetail, skillDetail, skillDetail,];
    var __VLS_1006;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "skill-detail-badges" },
    });
    /** @type {__VLS_StyleScopedClasses['skill-detail-badges']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "status" },
        ...{ class: (__VLS_ctx.skillDetail.status) },
    });
    /** @type {__VLS_StyleScopedClasses['status']} */ ;
    (__VLS_ctx.linkStatusText[__VLS_ctx.skillDetail.status] || '状态未知');
    let __VLS_1014;
    /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
    elTag;
    // @ts-ignore
    const __VLS_1015 = __VLS_asFunctionalComponent1(__VLS_1014, new __VLS_1014({
        type: (__VLS_ctx.skillDetail.available ? 'success' : 'danger'),
        round: true,
    }));
    const __VLS_1016 = __VLS_1015({
        type: (__VLS_ctx.skillDetail.available ? 'success' : 'danger'),
        round: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_1015));
    const { default: __VLS_1019 } = __VLS_1017.slots;
    (__VLS_ctx.skillDetail.available ? '来源可用' : '来源不可用');
    // @ts-ignore
    [linkStatusText, skillDetail, skillDetail, skillDetail, skillDetail,];
    var __VLS_1017;
    for (const [tag] of __VLS_vFor((__VLS_ctx.skillDetail.tags))) {
        let __VLS_1020;
        /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
        elTag;
        // @ts-ignore
        const __VLS_1021 = __VLS_asFunctionalComponent1(__VLS_1020, new __VLS_1020({
            key: (tag),
            round: true,
        }));
        const __VLS_1022 = __VLS_1021({
            key: (tag),
            round: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_1021));
        const { default: __VLS_1025 } = __VLS_1023.slots;
        (tag);
        // @ts-ignore
        [skillDetail,];
        var __VLS_1023;
        // @ts-ignore
        [];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.dl, __VLS_intrinsics.dl)({
        ...{ class: "skill-detail-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['skill-detail-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.dt, __VLS_intrinsics.dt)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.dd, __VLS_intrinsics.dd)({});
    (__VLS_ctx.sourceName(__VLS_ctx.skillDetail));
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    (__VLS_ctx.sourceMode(__VLS_ctx.skillDetail));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.dt, __VLS_intrinsics.dt)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.dd, __VLS_intrinsics.dd)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.code, __VLS_intrinsics.code)({});
    (__VLS_ctx.skillDetail.alias);
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "skill-detail-path" },
    });
    /** @type {__VLS_StyleScopedClasses['skill-detail-path']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.dt, __VLS_intrinsics.dt)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.dd, __VLS_intrinsics.dd)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.code, __VLS_intrinsics.code)({
        title: (__VLS_ctx.skillDetail.path),
    });
    (__VLS_ctx.skillDetail.path);
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "skill-detail-document" },
    });
    __VLS_asFunctionalDirective(__VLS_directives.vLoading, {})(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.skillDetailLoading), }, null, null);
    /** @type {__VLS_StyleScopedClasses['skill-detail-document']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.header, __VLS_intrinsics.header)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    if (__VLS_ctx.skillDetailContent) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "skill-detail-markdown" },
        });
        __VLS_asFunctionalDirective(__VLS_directives.vHtml, {})(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.skillDetailHtml), }, null, null);
        /** @type {__VLS_StyleScopedClasses['skill-detail-markdown']} */ ;
    }
    else if (!__VLS_ctx.skillDetailLoading) {
        let __VLS_1026;
        /** @ts-ignore @type { | typeof __VLS_components.elEmpty | typeof __VLS_components.ElEmpty | typeof __VLS_components['el-empty']} */
        elEmpty;
        // @ts-ignore
        const __VLS_1027 = __VLS_asFunctionalComponent1(__VLS_1026, new __VLS_1026({
            imageSize: (52),
            description: "暂无技能正文",
        }));
        const __VLS_1028 = __VLS_1027({
            imageSize: (52),
            description: "暂无技能正文",
        }, ...__VLS_functionalComponentArgsRest(__VLS_1027));
    }
}
{
    const { footer: __VLS_1031 } = __VLS_995.slots;
    let __VLS_1032;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_1033 = __VLS_asFunctionalComponent1(__VLS_1032, new __VLS_1032({
        ...{ 'onClick': {} },
    }));
    const __VLS_1034 = __VLS_1033({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_1033));
    let __VLS_1037;
    const __VLS_1038 = {
        /** @type {typeof __VLS_1037.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.skillDetailDialog = false);
            // @ts-ignore
            [vLoading, sourceName, sourceMode, skillDetailDialog, skillDetail, skillDetail, skillDetail, skillDetail, skillDetail, skillDetailLoading, skillDetailLoading, skillDetailContent, skillDetailHtml,];
        },
    };
    const { default: __VLS_1039 } = __VLS_1035.slots;
    // @ts-ignore
    [];
    var __VLS_1035;
    var __VLS_1036;
    let __VLS_1040;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_1041 = __VLS_asFunctionalComponent1(__VLS_1040, new __VLS_1040({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.EditPen),
    }));
    const __VLS_1042 = __VLS_1041({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.EditPen),
    }, ...__VLS_functionalComponentArgsRest(__VLS_1041));
    let __VLS_1045;
    const __VLS_1046 = {
        /** @type {typeof __VLS_1045.click} */
        onClick: (__VLS_ctx.editSkillFromDetail),
    };
    const { default: __VLS_1047 } = __VLS_1043.slots;
    // @ts-ignore
    [EditPen, editSkillFromDetail,];
    var __VLS_1043;
    var __VLS_1044;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_995;
let __VLS_1048;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_1049 = __VLS_asFunctionalComponent1(__VLS_1048, new __VLS_1048({
    modelValue: (__VLS_ctx.skillDialog),
    title: "编辑技能",
    width: "520",
}));
const __VLS_1050 = __VLS_1049({
    modelValue: (__VLS_ctx.skillDialog),
    title: "编辑技能",
    width: "520",
}, ...__VLS_functionalComponentArgsRest(__VLS_1049));
const { default: __VLS_1053 } = __VLS_1051.slots;
let __VLS_1054;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_1055 = __VLS_asFunctionalComponent1(__VLS_1054, new __VLS_1054({
    ...{ class: "apple-dialog-form skill-form" },
    labelPosition: "top",
}));
const __VLS_1056 = __VLS_1055({
    ...{ class: "apple-dialog-form skill-form" },
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_1055));
/** @type {__VLS_StyleScopedClasses['apple-dialog-form']} */ ;
/** @type {__VLS_StyleScopedClasses['skill-form']} */ ;
const { default: __VLS_1059 } = __VLS_1057.slots;
let __VLS_1060;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_1061 = __VLS_asFunctionalComponent1(__VLS_1060, new __VLS_1060({
    label: "项目内链接名",
}));
const __VLS_1062 = __VLS_1061({
    label: "项目内链接名",
}, ...__VLS_functionalComponentArgsRest(__VLS_1061));
const { default: __VLS_1065 } = __VLS_1063.slots;
let __VLS_1066;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_1067 = __VLS_asFunctionalComponent1(__VLS_1066, new __VLS_1066({
    modelValue: (__VLS_ctx.skillForm.alias),
    ...{ class: "apple-dialog-input" },
}));
const __VLS_1068 = __VLS_1067({
    modelValue: (__VLS_ctx.skillForm.alias),
    ...{ class: "apple-dialog-input" },
}, ...__VLS_functionalComponentArgsRest(__VLS_1067));
/** @type {__VLS_StyleScopedClasses['apple-dialog-input']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "el-form-item__description" },
});
/** @type {__VLS_StyleScopedClasses['el-form-item__description']} */ ;
// @ts-ignore
[skillDialog, skillForm,];
var __VLS_1063;
let __VLS_1071;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_1072 = __VLS_asFunctionalComponent1(__VLS_1071, new __VLS_1071({
    label: "标签",
}));
const __VLS_1073 = __VLS_1072({
    label: "标签",
}, ...__VLS_functionalComponentArgsRest(__VLS_1072));
const { default: __VLS_1076 } = __VLS_1074.slots;
let __VLS_1077;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_1078 = __VLS_asFunctionalComponent1(__VLS_1077, new __VLS_1077({
    modelValue: (__VLS_ctx.skillForm.tags),
    ...{ class: "apple-dialog-input" },
    placeholder: "用逗号分隔，例如：论文, 前端, 常用",
}));
const __VLS_1079 = __VLS_1078({
    modelValue: (__VLS_ctx.skillForm.tags),
    ...{ class: "apple-dialog-input" },
    placeholder: "用逗号分隔，例如：论文, 前端, 常用",
}, ...__VLS_functionalComponentArgsRest(__VLS_1078));
/** @type {__VLS_StyleScopedClasses['apple-dialog-input']} */ ;
// @ts-ignore
[skillForm,];
var __VLS_1074;
// @ts-ignore
[];
var __VLS_1057;
{
    const { footer: __VLS_1082 } = __VLS_1051.slots;
    let __VLS_1083;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_1084 = __VLS_asFunctionalComponent1(__VLS_1083, new __VLS_1083({
        ...{ 'onClick': {} },
    }));
    const __VLS_1085 = __VLS_1084({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_1084));
    let __VLS_1088;
    const __VLS_1089 = {
        /** @type {typeof __VLS_1088.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.skillDialog = false);
            // @ts-ignore
            [skillDialog,];
        },
    };
    const { default: __VLS_1090 } = __VLS_1086.slots;
    // @ts-ignore
    [];
    var __VLS_1086;
    var __VLS_1087;
    let __VLS_1091;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_1092 = __VLS_asFunctionalComponent1(__VLS_1091, new __VLS_1091({
        ...{ 'onClick': {} },
        type: "primary",
    }));
    const __VLS_1093 = __VLS_1092({
        ...{ 'onClick': {} },
        type: "primary",
    }, ...__VLS_functionalComponentArgsRest(__VLS_1092));
    let __VLS_1096;
    const __VLS_1097 = {
        /** @type {typeof __VLS_1096.click} */
        onClick: (__VLS_ctx.saveSkill),
    };
    const { default: __VLS_1098 } = __VLS_1094.slots;
    // @ts-ignore
    [saveSkill,];
    var __VLS_1094;
    var __VLS_1095;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_1051;
let __VLS_1099;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_1100 = __VLS_asFunctionalComponent1(__VLS_1099, new __VLS_1099({
    modelValue: (__VLS_ctx.bundleApplyDialog),
    title: "应用技能组合",
    width: "520",
}));
const __VLS_1101 = __VLS_1100({
    modelValue: (__VLS_ctx.bundleApplyDialog),
    title: "应用技能组合",
    width: "520",
}, ...__VLS_functionalComponentArgsRest(__VLS_1100));
const { default: __VLS_1104 } = __VLS_1102.slots;
let __VLS_1105;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_1106 = __VLS_asFunctionalComponent1(__VLS_1105, new __VLS_1105({
    ...{ class: "apple-dialog-form bundle-apply-form" },
    labelPosition: "top",
}));
const __VLS_1107 = __VLS_1106({
    ...{ class: "apple-dialog-form bundle-apply-form" },
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_1106));
/** @type {__VLS_StyleScopedClasses['apple-dialog-form']} */ ;
/** @type {__VLS_StyleScopedClasses['bundle-apply-form']} */ ;
const { default: __VLS_1110 } = __VLS_1108.slots;
let __VLS_1111;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_1112 = __VLS_asFunctionalComponent1(__VLS_1111, new __VLS_1111({
    label: "目标项目",
}));
const __VLS_1113 = __VLS_1112({
    label: "目标项目",
}, ...__VLS_functionalComponentArgsRest(__VLS_1112));
const { default: __VLS_1116 } = __VLS_1114.slots;
let __VLS_1117;
/** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
elSelect;
// @ts-ignore
const __VLS_1118 = __VLS_asFunctionalComponent1(__VLS_1117, new __VLS_1117({
    modelValue: (__VLS_ctx.bundleApply.projectId),
    ...{ class: "apple-dialog-input full-dialog-select" },
    'aria-label': "目标项目",
    ...{ style: {} },
}));
const __VLS_1119 = __VLS_1118({
    modelValue: (__VLS_ctx.bundleApply.projectId),
    ...{ class: "apple-dialog-input full-dialog-select" },
    'aria-label': "目标项目",
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_1118));
/** @type {__VLS_StyleScopedClasses['apple-dialog-input']} */ ;
/** @type {__VLS_StyleScopedClasses['full-dialog-select']} */ ;
const { default: __VLS_1122 } = __VLS_1120.slots;
for (const [p] of __VLS_vFor((__VLS_ctx.data.projects))) {
    let __VLS_1123;
    /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
    elOption;
    // @ts-ignore
    const __VLS_1124 = __VLS_asFunctionalComponent1(__VLS_1123, new __VLS_1123({
        key: (p.id),
        label: (p.name),
        value: (p.id),
    }));
    const __VLS_1125 = __VLS_1124({
        key: (p.id),
        label: (p.name),
        value: (p.id),
    }, ...__VLS_functionalComponentArgsRest(__VLS_1124));
    // @ts-ignore
    [data, bundleApplyDialog, bundleApply,];
}
// @ts-ignore
[];
var __VLS_1120;
// @ts-ignore
[];
var __VLS_1114;
// @ts-ignore
[];
var __VLS_1108;
let __VLS_1128;
/** @ts-ignore @type { | typeof __VLS_components.elAlert | typeof __VLS_components.ElAlert | typeof __VLS_components['el-alert']} */
elAlert;
// @ts-ignore
const __VLS_1129 = __VLS_asFunctionalComponent1(__VLS_1128, new __VLS_1128({
    title: "应用后会持续检查该项目与组合之间的配置漂移。",
    type: "info",
    closable: (false),
}));
const __VLS_1130 = __VLS_1129({
    title: "应用后会持续检查该项目与组合之间的配置漂移。",
    type: "info",
    closable: (false),
}, ...__VLS_functionalComponentArgsRest(__VLS_1129));
{
    const { footer: __VLS_1133 } = __VLS_1102.slots;
    let __VLS_1134;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_1135 = __VLS_asFunctionalComponent1(__VLS_1134, new __VLS_1134({
        ...{ 'onClick': {} },
    }));
    const __VLS_1136 = __VLS_1135({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_1135));
    let __VLS_1139;
    const __VLS_1140 = {
        /** @type {typeof __VLS_1139.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.bundleApplyDialog = false);
            // @ts-ignore
            [bundleApplyDialog,];
        },
    };
    const { default: __VLS_1141 } = __VLS_1137.slots;
    // @ts-ignore
    [];
    var __VLS_1137;
    var __VLS_1138;
    let __VLS_1142;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_1143 = __VLS_asFunctionalComponent1(__VLS_1142, new __VLS_1142({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleApply.projectId),
    }));
    const __VLS_1144 = __VLS_1143({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleApply.projectId),
    }, ...__VLS_functionalComponentArgsRest(__VLS_1143));
    let __VLS_1147;
    const __VLS_1148 = {
        /** @type {typeof __VLS_1147.click} */
        onClick: (__VLS_ctx.stageBundle),
    };
    const { default: __VLS_1149 } = __VLS_1145.slots;
    // @ts-ignore
    [bundleApply, stageBundle,];
    var __VLS_1145;
    var __VLS_1146;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_1102;
let __VLS_1150;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_1151 = __VLS_asFunctionalComponent1(__VLS_1150, new __VLS_1150({
    modelValue: (__VLS_ctx.planDialog),
    title: "确认变更计划",
    width: "720",
}));
const __VLS_1152 = __VLS_1151({
    modelValue: (__VLS_ctx.planDialog),
    title: "确认变更计划",
    width: "720",
}, ...__VLS_functionalComponentArgsRest(__VLS_1151));
const { default: __VLS_1155 } = __VLS_1153.slots;
if (__VLS_ctx.currentPlan?.warnings.length) {
    let __VLS_1156;
    /** @ts-ignore @type { | typeof __VLS_components.elAlert | typeof __VLS_components.ElAlert | typeof __VLS_components['el-alert']} */
    elAlert;
    // @ts-ignore
    const __VLS_1157 = __VLS_asFunctionalComponent1(__VLS_1156, new __VLS_1156({
        title: (`${__VLS_ctx.currentPlan.warnings.length} 项被安全跳过`),
        type: "warning",
        showIcon: true,
        closable: (false),
    }));
    const __VLS_1158 = __VLS_1157({
        title: (`${__VLS_ctx.currentPlan.warnings.length} 项被安全跳过`),
        type: "warning",
        showIcon: true,
        closable: (false),
    }, ...__VLS_functionalComponentArgsRest(__VLS_1157));
}
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "plan-summary" },
});
/** @type {__VLS_StyleScopedClasses['plan-summary']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
(__VLS_ctx.currentPlan?.items.length || 0);
if (__VLS_ctx.planScopeLabel) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (__VLS_ctx.planScopeLabel);
}
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "plan-items" },
});
/** @type {__VLS_StyleScopedClasses['plan-items']} */ ;
for (const [i] of __VLS_vFor((__VLS_ctx.currentPlan?.items))) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        key: (i.target),
    });
    let __VLS_1161;
    /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
    elTag;
    // @ts-ignore
    const __VLS_1162 = __VLS_asFunctionalComponent1(__VLS_1161, new __VLS_1161({
        round: true,
    }));
    const __VLS_1163 = __VLS_1162({
        round: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_1162));
    const { default: __VLS_1166 } = __VLS_1164.slots;
    (__VLS_ctx.planActionText[i.action]);
    // @ts-ignore
    [planDialog, currentPlan, currentPlan, currentPlan, currentPlan, planScopeLabel, planScopeLabel, planActionText,];
    var __VLS_1164;
    __VLS_asFunctionalElement1(__VLS_intrinsics.code, __VLS_intrinsics.code)({});
    (i.target);
    // @ts-ignore
    [];
}
{
    const { footer: __VLS_1167 } = __VLS_1153.slots;
    let __VLS_1168;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_1169 = __VLS_asFunctionalComponent1(__VLS_1168, new __VLS_1168({
        ...{ 'onClick': {} },
    }));
    const __VLS_1170 = __VLS_1169({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_1169));
    let __VLS_1173;
    const __VLS_1174 = {
        /** @type {typeof __VLS_1173.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.planDialog = false);
            // @ts-ignore
            [planDialog,];
        },
    };
    const { default: __VLS_1175 } = __VLS_1171.slots;
    // @ts-ignore
    [];
    var __VLS_1171;
    var __VLS_1172;
    let __VLS_1176;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_1177 = __VLS_asFunctionalComponent1(__VLS_1176, new __VLS_1176({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.applying),
        disabled: (!__VLS_ctx.currentPlan?.items.length && !__VLS_ctx.currentPlan?.bundleId),
    }));
    const __VLS_1178 = __VLS_1177({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.applying),
        disabled: (!__VLS_ctx.currentPlan?.items.length && !__VLS_ctx.currentPlan?.bundleId),
    }, ...__VLS_functionalComponentArgsRest(__VLS_1177));
    let __VLS_1181;
    const __VLS_1182 = {
        /** @type {typeof __VLS_1181.click} */
        onClick: (__VLS_ctx.applyPlan),
    };
    const { default: __VLS_1183 } = __VLS_1179.slots;
    // @ts-ignore
    [currentPlan, currentPlan, applying, applyPlan,];
    var __VLS_1179;
    var __VLS_1180;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_1153;
// @ts-ignore
var __VLS_740 = __VLS_739, __VLS_913 = __VLS_912;
// @ts-ignore
[];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
