import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { FolderAdd, Plus, Refresh, Search, Setting, Collection, Link, Warning, Clock, House, Star, Download, Upload, Monitor, } from '@element-plus/icons-vue';
import { api, patch, post, remove } from './api';
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
const loading = ref(true), tab = ref('overview'), query = ref(''), statusFilter = ref('all'), sourceFilter = ref('all'), selectedProject = ref(''), statuses = ref([]), selectedSkills = ref([]);
const projectDialog = ref(false), sourceDialog = ref(false), bundleDialog = ref(false), planDialog = ref(false), groupDialog = ref(false), skillDialog = ref(false), bundleApplyDialog = ref(false);
const projectForm = reactive({ name: '', path: '' }), sourceForm = reactive({ name: '', path: '', mode: 'pack' }), bundleForm = reactive({ name: '', description: '', skillIds: [] });
const groupForm = reactive({ name: '', color: '#007AFF' }), skillForm = reactive({ id: '', alias: '', tags: '' }), bundleApply = reactive({ bundleId: '', projectId: '' });
const currentPlan = ref(null), applying = ref(false);
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
const linkedCount = computed(() => statuses.value.filter((s) => s.status === 'linked').length);
const errors = computed(() => data.audit.filter((a) => a.level === 'error').length);
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
    await patch(`/skills/${row.id}`, { favorite: !row.favorite });
    await refresh();
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
async function createGroup() {
    try {
        await post('/groups', groupForm);
        groupDialog.value = false;
        groupForm.name = '';
        await refresh();
        ElMessage.success('项目组已创建');
    }
    catch (e) {
        ElMessage.error(e.message);
    }
}
async function assignGroup(project, groupId) {
    await patch(`/projects/${project.id}/group`, { groupId });
    await refresh();
}
function editSkill(row) {
    Object.assign(skillForm, { id: row.id, alias: row.alias, tags: row.tags.join(', ') });
    skillDialog.value = true;
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
                ...{ class: "folder-icon" },
            });
            /** @type {__VLS_StyleScopedClasses['folder-icon']} */ ;
            let __VLS_47;
            /** @ts-ignore @type { | typeof __VLS_components.FolderAdd} */
            FolderAdd;
            // @ts-ignore
            const __VLS_48 = __VLS_asFunctionalComponent1(__VLS_47, new __VLS_47({}));
            const __VLS_49 = __VLS_48({}, ...__VLS_functionalComponentArgsRest(__VLS_48));
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
            (p.name);
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            (p.path);
            // @ts-ignore
            [data, data,];
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
        percentage: (__VLS_ctx.data.audit.length ? Math.max(0, 100 - __VLS_ctx.data.audit.length * 8) : 100),
        color: (__VLS_ctx.data.audit.length ? '#ff9f0a' : '#34c759'),
    }));
    const __VLS_67 = __VLS_66({
        type: "dashboard",
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
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.tab === 'overview'))
                throw 0;
            if (!(__VLS_ctx.tab === 'projects'))
                throw 0;
            return (__VLS_ctx.groupDialog = true);
            // @ts-ignore
            [tab, data, data, data, data, data, data, groupDialog,];
        },
    };
    const { default: __VLS_77 } = __VLS_73.slots;
    // @ts-ignore
    [];
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
        ...{ class: "tile-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['tile-grid']} */ ;
    for (const [p] of __VLS_vFor((__VLS_ctx.data.projects))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            key: (p.id),
            ...{ class: "project-card glass" },
        });
        /** @type {__VLS_StyleScopedClasses['project-card']} */ ;
        /** @type {__VLS_StyleScopedClasses['glass']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "project-top" },
        });
        /** @type {__VLS_StyleScopedClasses['project-top']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "folder-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['folder-icon']} */ ;
        let __VLS_86;
        /** @ts-ignore @type { | typeof __VLS_components.FolderAdd} */
        FolderAdd;
        // @ts-ignore
        const __VLS_87 = __VLS_asFunctionalComponent1(__VLS_86, new __VLS_86({}));
        const __VLS_88 = __VLS_87({}, ...__VLS_functionalComponentArgsRest(__VLS_87));
        let __VLS_91;
        /** @ts-ignore @type { | typeof __VLS_components.elDropdown | typeof __VLS_components.ElDropdown | typeof __VLS_components['el-dropdown'] | typeof __VLS_components.elDropdown | typeof __VLS_components.ElDropdown | typeof __VLS_components['el-dropdown']} */
        elDropdown;
        // @ts-ignore
        const __VLS_92 = __VLS_asFunctionalComponent1(__VLS_91, new __VLS_91({
            trigger: "click",
        }));
        const __VLS_93 = __VLS_92({
            trigger: "click",
        }, ...__VLS_functionalComponentArgsRest(__VLS_92));
        const { default: __VLS_96 } = __VLS_94.slots;
        let __VLS_97;
        /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
        elButton;
        // @ts-ignore
        const __VLS_98 = __VLS_asFunctionalComponent1(__VLS_97, new __VLS_97({
            text: true,
        }));
        const __VLS_99 = __VLS_98({
            text: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_98));
        const { default: __VLS_102 } = __VLS_100.slots;
        // @ts-ignore
        [data,];
        var __VLS_100;
        {
            const { dropdown: __VLS_103 } = __VLS_94.slots;
            let __VLS_104;
            /** @ts-ignore @type { | typeof __VLS_components.elDropdownMenu | typeof __VLS_components.ElDropdownMenu | typeof __VLS_components['el-dropdown-menu'] | typeof __VLS_components.elDropdownMenu | typeof __VLS_components.ElDropdownMenu | typeof __VLS_components['el-dropdown-menu']} */
            elDropdownMenu;
            // @ts-ignore
            const __VLS_105 = __VLS_asFunctionalComponent1(__VLS_104, new __VLS_104({}));
            const __VLS_106 = __VLS_105({}, ...__VLS_functionalComponentArgsRest(__VLS_105));
            const { default: __VLS_109 } = __VLS_107.slots;
            let __VLS_110;
            /** @ts-ignore @type { | typeof __VLS_components.elDropdownItem | typeof __VLS_components.ElDropdownItem | typeof __VLS_components['el-dropdown-item'] | typeof __VLS_components.elDropdownItem | typeof __VLS_components.ElDropdownItem | typeof __VLS_components['el-dropdown-item']} */
            elDropdownItem;
            // @ts-ignore
            const __VLS_111 = __VLS_asFunctionalComponent1(__VLS_110, new __VLS_110({
                ...{ 'onClick': {} },
            }));
            const __VLS_112 = __VLS_111({
                ...{ 'onClick': {} },
            }, ...__VLS_functionalComponentArgsRest(__VLS_111));
            let __VLS_115;
            const __VLS_116 = {
                /** @type {typeof __VLS_115.click} */
                onClick: (...[$event]) => {
                    if (!!(__VLS_ctx.tab === 'overview'))
                        throw 0;
                    if (!(__VLS_ctx.tab === 'projects'))
                        throw 0;
                    return (__VLS_ctx.confirmDelete('projects', p));
                    // @ts-ignore
                    [confirmDelete,];
                },
            };
            const { default: __VLS_117 } = __VLS_113.slots;
            // @ts-ignore
            [];
            var __VLS_113;
            var __VLS_114;
            // @ts-ignore
            [];
            var __VLS_107;
            // @ts-ignore
            [];
        }
        // @ts-ignore
        [];
        var __VLS_94;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        (p.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (p.path);
        let __VLS_118;
        /** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
        elSelect;
        // @ts-ignore
        const __VLS_119 = __VLS_asFunctionalComponent1(__VLS_118, new __VLS_118({
            ...{ 'onChange': {} },
            modelValue: (p.groupId),
            clearable: true,
            placeholder: "未分组",
            ...{ style: {} },
        }));
        const __VLS_120 = __VLS_119({
            ...{ 'onChange': {} },
            modelValue: (p.groupId),
            clearable: true,
            placeholder: "未分组",
            ...{ style: {} },
        }, ...__VLS_functionalComponentArgsRest(__VLS_119));
        let __VLS_123;
        const __VLS_124 = {
            /** @type {typeof __VLS_123.change} */
            onChange: (...[$event]) => {
                if (!!(__VLS_ctx.tab === 'overview'))
                    throw 0;
                if (!(__VLS_ctx.tab === 'projects'))
                    throw 0;
                return (__VLS_ctx.assignGroup(p, $event || null));
                // @ts-ignore
                [assignGroup,];
            },
        };
        const { default: __VLS_125 } = __VLS_121.slots;
        for (const [g] of __VLS_vFor((__VLS_ctx.data.groups))) {
            let __VLS_126;
            /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
            elOption;
            // @ts-ignore
            const __VLS_127 = __VLS_asFunctionalComponent1(__VLS_126, new __VLS_126({
                key: (g.id),
                label: (g.name),
                value: (g.id),
            }));
            const __VLS_128 = __VLS_127({
                key: (g.id),
                label: (g.name),
                value: (g.id),
            }, ...__VLS_functionalComponentArgsRest(__VLS_127));
            // @ts-ignore
            [data,];
        }
        // @ts-ignore
        [];
        var __VLS_121;
        var __VLS_122;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "target" },
        });
        /** @type {__VLS_StyleScopedClasses['target']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.code, __VLS_intrinsics.code)({});
        (p.skillsDir);
        let __VLS_131;
        /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
        elButton;
        // @ts-ignore
        const __VLS_132 = __VLS_asFunctionalComponent1(__VLS_131, new __VLS_131({
            ...{ 'onClick': {} },
        }));
        const __VLS_133 = __VLS_132({
            ...{ 'onClick': {} },
        }, ...__VLS_functionalComponentArgsRest(__VLS_132));
        let __VLS_136;
        const __VLS_137 = {
            /** @type {typeof __VLS_136.click} */
            onClick: (...[$event]) => {
                if (!!(__VLS_ctx.tab === 'overview'))
                    throw 0;
                if (!(__VLS_ctx.tab === 'projects'))
                    throw 0;
                return (__VLS_ctx.openProjectSkills(p));
                // @ts-ignore
                [openProjectSkills,];
            },
        };
        const { default: __VLS_138 } = __VLS_134.slots;
        // @ts-ignore
        [];
        var __VLS_134;
        var __VLS_135;
        // @ts-ignore
        [];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.tab === 'overview'))
                    throw 0;
                if (!(__VLS_ctx.tab === 'projects'))
                    throw 0;
                return (__VLS_ctx.projectDialog = true);
                // @ts-ignore
                [projectDialog,];
            } },
        ...{ class: "add-card glass" },
    });
    /** @type {__VLS_StyleScopedClasses['add-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    let __VLS_139;
    /** @ts-ignore @type { | typeof __VLS_components.Plus} */
    Plus;
    // @ts-ignore
    const __VLS_140 = __VLS_asFunctionalComponent1(__VLS_139, new __VLS_139({}));
    const __VLS_141 = __VLS_140({}, ...__VLS_functionalComponentArgsRest(__VLS_140));
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
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
    let __VLS_144;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_145 = __VLS_asFunctionalComponent1(__VLS_144, new __VLS_144({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.Refresh),
    }));
    const __VLS_146 = __VLS_145({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.Refresh),
    }, ...__VLS_functionalComponentArgsRest(__VLS_145));
    let __VLS_149;
    const __VLS_150 = {
        /** @type {typeof __VLS_149.click} */
        onClick: (__VLS_ctx.rescan),
    };
    const { default: __VLS_151 } = __VLS_147.slots;
    // @ts-ignore
    [tab, Refresh, rescan,];
    var __VLS_147;
    var __VLS_148;
    let __VLS_152;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_153 = __VLS_asFunctionalComponent1(__VLS_152, new __VLS_152({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.Plus),
    }));
    const __VLS_154 = __VLS_153({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.Plus),
    }, ...__VLS_functionalComponentArgsRest(__VLS_153));
    let __VLS_157;
    const __VLS_158 = {
        /** @type {typeof __VLS_157.click} */
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
    const { default: __VLS_159 } = __VLS_155.slots;
    // @ts-ignore
    [];
    var __VLS_155;
    var __VLS_156;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "toolbar glass" },
    });
    /** @type {__VLS_StyleScopedClasses['toolbar']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    let __VLS_160;
    /** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
    elSelect;
    // @ts-ignore
    const __VLS_161 = __VLS_asFunctionalComponent1(__VLS_160, new __VLS_160({
        modelValue: (__VLS_ctx.selectedProject),
        placeholder: "选择项目",
        ...{ style: {} },
    }));
    const __VLS_162 = __VLS_161({
        modelValue: (__VLS_ctx.selectedProject),
        placeholder: "选择项目",
        ...{ style: {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_161));
    const { default: __VLS_165 } = __VLS_163.slots;
    for (const [p] of __VLS_vFor((__VLS_ctx.data.projects))) {
        let __VLS_166;
        /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
        elOption;
        // @ts-ignore
        const __VLS_167 = __VLS_asFunctionalComponent1(__VLS_166, new __VLS_166({
            key: (p.id),
            label: (p.name),
            value: (p.id),
        }));
        const __VLS_168 = __VLS_167({
            key: (p.id),
            label: (p.name),
            value: (p.id),
        }, ...__VLS_functionalComponentArgsRest(__VLS_167));
        // @ts-ignore
        [data, selectedProject,];
    }
    // @ts-ignore
    [];
    var __VLS_163;
    let __VLS_171;
    /** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
    elInput;
    // @ts-ignore
    const __VLS_172 = __VLS_asFunctionalComponent1(__VLS_171, new __VLS_171({
        modelValue: (__VLS_ctx.query),
        prefixIcon: (__VLS_ctx.Search),
        placeholder: "搜索名称、描述、标签或路径",
        clearable: true,
    }));
    const __VLS_173 = __VLS_172({
        modelValue: (__VLS_ctx.query),
        prefixIcon: (__VLS_ctx.Search),
        placeholder: "搜索名称、描述、标签或路径",
        clearable: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_172));
    let __VLS_176;
    /** @ts-ignore @type { | typeof __VLS_components.elSegmented | typeof __VLS_components.ElSegmented | typeof __VLS_components['el-segmented']} */
    elSegmented;
    // @ts-ignore
    const __VLS_177 = __VLS_asFunctionalComponent1(__VLS_176, new __VLS_176({
        modelValue: (__VLS_ctx.statusFilter),
        options: ([
            { label: '全部', value: 'all' },
            { label: '已链接', value: 'linked' },
            { label: '未链接', value: 'missing' },
            { label: '异常', value: 'broken' },
        ]),
    }));
    const __VLS_178 = __VLS_177({
        modelValue: (__VLS_ctx.statusFilter),
        options: ([
            { label: '全部', value: 'all' },
            { label: '已链接', value: 'linked' },
            { label: '未链接', value: 'missing' },
            { label: '异常', value: 'broken' },
        ]),
    }, ...__VLS_functionalComponentArgsRest(__VLS_177));
    let __VLS_181;
    /** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
    elSelect;
    // @ts-ignore
    const __VLS_182 = __VLS_asFunctionalComponent1(__VLS_181, new __VLS_181({
        ...{ 'onClear': {} },
        modelValue: (__VLS_ctx.sourceFilter),
        placeholder: "筛选技能源",
        clearable: true,
        ...{ style: {} },
    }));
    const __VLS_183 = __VLS_182({
        ...{ 'onClear': {} },
        modelValue: (__VLS_ctx.sourceFilter),
        placeholder: "筛选技能源",
        clearable: true,
        ...{ style: {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_182));
    let __VLS_186;
    const __VLS_187 = {
        /** @type {typeof __VLS_186.clear} */
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
    const { default: __VLS_188 } = __VLS_184.slots;
    for (const [option] of __VLS_vFor((__VLS_ctx.sourceOptions))) {
        let __VLS_189;
        /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
        elOption;
        // @ts-ignore
        const __VLS_190 = __VLS_asFunctionalComponent1(__VLS_189, new __VLS_189({
            key: (option.value),
            label: (option.label),
            value: (option.value),
        }));
        const __VLS_191 = __VLS_190({
            key: (option.value),
            label: (option.label),
            value: (option.value),
        }, ...__VLS_functionalComponentArgsRest(__VLS_190));
        // @ts-ignore
        [sourceOptions,];
    }
    // @ts-ignore
    [];
    var __VLS_184;
    var __VLS_185;
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
    let __VLS_194;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_195 = __VLS_asFunctionalComponent1(__VLS_194, new __VLS_194({
        ...{ 'onClick': {} },
    }));
    const __VLS_196 = __VLS_195({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_195));
    let __VLS_199;
    const __VLS_200 = {
        /** @type {typeof __VLS_199.click} */
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
    const { default: __VLS_201 } = __VLS_197.slots;
    // @ts-ignore
    [];
    var __VLS_197;
    var __VLS_198;
    let __VLS_202;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_203 = __VLS_asFunctionalComponent1(__VLS_202, new __VLS_202({
        ...{ 'onClick': {} },
    }));
    const __VLS_204 = __VLS_203({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_203));
    let __VLS_207;
    const __VLS_208 = {
        /** @type {typeof __VLS_207.click} */
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
    const { default: __VLS_209 } = __VLS_205.slots;
    // @ts-ignore
    [];
    var __VLS_205;
    var __VLS_206;
    let __VLS_210;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_211 = __VLS_asFunctionalComponent1(__VLS_210, new __VLS_210({
        ...{ 'onClick': {} },
        type: "danger",
        plain: true,
    }));
    const __VLS_212 = __VLS_211({
        ...{ 'onClick': {} },
        type: "danger",
        plain: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_211));
    let __VLS_215;
    const __VLS_216 = {
        /** @type {typeof __VLS_215.click} */
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
    const { default: __VLS_217 } = __VLS_213.slots;
    // @ts-ignore
    [];
    var __VLS_213;
    var __VLS_214;
    let __VLS_218;
    /** @ts-ignore @type { | typeof __VLS_components.elTable | typeof __VLS_components.ElTable | typeof __VLS_components['el-table'] | typeof __VLS_components.elTable | typeof __VLS_components.ElTable | typeof __VLS_components['el-table']} */
    elTable;
    // @ts-ignore
    const __VLS_219 = __VLS_asFunctionalComponent1(__VLS_218, new __VLS_218({
        ...{ 'onSelectionChange': {} },
        data: (__VLS_ctx.filteredSkills),
        rowKey: "id",
        height: "560",
        emptyText: "当前筛选没有技能",
    }));
    const __VLS_220 = __VLS_219({
        ...{ 'onSelectionChange': {} },
        data: (__VLS_ctx.filteredSkills),
        rowKey: "id",
        height: "560",
        emptyText: "当前筛选没有技能",
    }, ...__VLS_functionalComponentArgsRest(__VLS_219));
    let __VLS_223;
    const __VLS_224 = {
        /** @type {typeof __VLS_223.selectionChange} */
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
    const { default: __VLS_225 } = __VLS_221.slots;
    let __VLS_226;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_227 = __VLS_asFunctionalComponent1(__VLS_226, new __VLS_226({
        type: "selection",
        width: "48",
    }));
    const __VLS_228 = __VLS_227({
        type: "selection",
        width: "48",
    }, ...__VLS_functionalComponentArgsRest(__VLS_227));
    let __VLS_231;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_232 = __VLS_asFunctionalComponent1(__VLS_231, new __VLS_231({
        label: "技能",
        minWidth: "240",
    }));
    const __VLS_233 = __VLS_232({
        label: "技能",
        minWidth: "240",
    }, ...__VLS_functionalComponentArgsRest(__VLS_232));
    const { default: __VLS_236 } = __VLS_234.slots;
    {
        const { default: __VLS_237 } = __VLS_234.slots;
        const [{ row }] = __VLS_vSlot(__VLS_237);
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
                    [toggleFavorite,];
                } },
            ...{ class: "star" },
        });
        /** @type {__VLS_StyleScopedClasses['star']} */ ;
        let __VLS_238;
        /** @ts-ignore @type { | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon'] | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon']} */
        elIcon;
        // @ts-ignore
        const __VLS_239 = __VLS_asFunctionalComponent1(__VLS_238, new __VLS_238({
            ...{ class: ({ on: row.favorite }) },
        }));
        const __VLS_240 = __VLS_239({
            ...{ class: ({ on: row.favorite }) },
        }, ...__VLS_functionalComponentArgsRest(__VLS_239));
        /** @type {__VLS_StyleScopedClasses['on']} */ ;
        const { default: __VLS_243 } = __VLS_241.slots;
        let __VLS_244;
        /** @ts-ignore @type { | typeof __VLS_components.Star} */
        Star;
        // @ts-ignore
        const __VLS_245 = __VLS_asFunctionalComponent1(__VLS_244, new __VLS_244({}));
        const __VLS_246 = __VLS_245({}, ...__VLS_functionalComponentArgsRest(__VLS_245));
        // @ts-ignore
        [];
        var __VLS_241;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (row.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (row.description);
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_234;
    let __VLS_249;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_250 = __VLS_asFunctionalComponent1(__VLS_249, new __VLS_249({
        label: "技能源",
        width: "190",
    }));
    const __VLS_251 = __VLS_250({
        label: "技能源",
        width: "190",
    }, ...__VLS_functionalComponentArgsRest(__VLS_250));
    const { default: __VLS_254 } = __VLS_252.slots;
    {
        const { default: __VLS_255 } = __VLS_252.slots;
        const [{ row }] = __VLS_vSlot(__VLS_255);
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
    var __VLS_252;
    let __VLS_256;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_257 = __VLS_asFunctionalComponent1(__VLS_256, new __VLS_256({
        prop: "alias",
        label: "链接名",
        width: "150",
    }));
    const __VLS_258 = __VLS_257({
        prop: "alias",
        label: "链接名",
        width: "150",
    }, ...__VLS_functionalComponentArgsRest(__VLS_257));
    let __VLS_261;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_262 = __VLS_asFunctionalComponent1(__VLS_261, new __VLS_261({
        label: "状态",
        width: "120",
    }));
    const __VLS_263 = __VLS_262({
        label: "状态",
        width: "120",
    }, ...__VLS_functionalComponentArgsRest(__VLS_262));
    const { default: __VLS_266 } = __VLS_264.slots;
    {
        const { default: __VLS_267 } = __VLS_264.slots;
        const [{ row }] = __VLS_vSlot(__VLS_267);
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
    var __VLS_264;
    let __VLS_268;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_269 = __VLS_asFunctionalComponent1(__VLS_268, new __VLS_268({
        label: "标签",
        width: "150",
    }));
    const __VLS_270 = __VLS_269({
        label: "标签",
        width: "150",
    }, ...__VLS_functionalComponentArgsRest(__VLS_269));
    const { default: __VLS_273 } = __VLS_271.slots;
    {
        const { default: __VLS_274 } = __VLS_271.slots;
        const [{ row }] = __VLS_vSlot(__VLS_274);
        for (const [t] of __VLS_vFor((row.tags.slice(0, 2)))) {
            let __VLS_275;
            /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
            elTag;
            // @ts-ignore
            const __VLS_276 = __VLS_asFunctionalComponent1(__VLS_275, new __VLS_275({
                key: (t),
                round: true,
            }));
            const __VLS_277 = __VLS_276({
                key: (t),
                round: true,
            }, ...__VLS_functionalComponentArgsRest(__VLS_276));
            const { default: __VLS_280 } = __VLS_278.slots;
            (t);
            // @ts-ignore
            [];
            var __VLS_278;
            // @ts-ignore
            [];
        }
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_271;
    let __VLS_281;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_282 = __VLS_asFunctionalComponent1(__VLS_281, new __VLS_281({
        label: "",
        width: "74",
    }));
    const __VLS_283 = __VLS_282({
        label: "",
        width: "74",
    }, ...__VLS_functionalComponentArgsRest(__VLS_282));
    const { default: __VLS_286 } = __VLS_284.slots;
    {
        const { default: __VLS_287 } = __VLS_284.slots;
        const [{ row }] = __VLS_vSlot(__VLS_287);
        let __VLS_288;
        /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
        elButton;
        // @ts-ignore
        const __VLS_289 = __VLS_asFunctionalComponent1(__VLS_288, new __VLS_288({
            ...{ 'onClick': {} },
            text: true,
        }));
        const __VLS_290 = __VLS_289({
            ...{ 'onClick': {} },
            text: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_289));
        let __VLS_293;
        const __VLS_294 = {
            /** @type {typeof __VLS_293.click} */
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
        const { default: __VLS_295 } = __VLS_291.slots;
        // @ts-ignore
        [];
        var __VLS_291;
        var __VLS_292;
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_284;
    // @ts-ignore
    [];
    var __VLS_221;
    var __VLS_222;
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
        let __VLS_296;
        /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
        elButton;
        // @ts-ignore
        const __VLS_297 = __VLS_asFunctionalComponent1(__VLS_296, new __VLS_296({
            ...{ 'onClick': {} },
            text: true,
            type: "danger",
        }));
        const __VLS_298 = __VLS_297({
            ...{ 'onClick': {} },
            text: true,
            type: "danger",
        }, ...__VLS_functionalComponentArgsRest(__VLS_297));
        let __VLS_301;
        const __VLS_302 = {
            /** @type {typeof __VLS_301.click} */
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
        const { default: __VLS_303 } = __VLS_299.slots;
        // @ts-ignore
        [];
        var __VLS_299;
        var __VLS_300;
        // @ts-ignore
        [];
    }
    let __VLS_304;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_305 = __VLS_asFunctionalComponent1(__VLS_304, new __VLS_304({
        ...{ 'onClick': {} },
        ...{ class: "full" },
        plain: true,
        icon: (__VLS_ctx.Plus),
    }));
    const __VLS_306 = __VLS_305({
        ...{ 'onClick': {} },
        ...{ class: "full" },
        plain: true,
        icon: (__VLS_ctx.Plus),
    }, ...__VLS_functionalComponentArgsRest(__VLS_305));
    let __VLS_309;
    const __VLS_310 = {
        /** @type {typeof __VLS_309.click} */
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
    const { default: __VLS_311 } = __VLS_307.slots;
    // @ts-ignore
    [];
    var __VLS_307;
    var __VLS_308;
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
    let __VLS_312;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_313 = __VLS_asFunctionalComponent1(__VLS_312, new __VLS_312({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.Plus),
    }));
    const __VLS_314 = __VLS_313({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.Plus),
    }, ...__VLS_functionalComponentArgsRest(__VLS_313));
    let __VLS_317;
    const __VLS_318 = {
        /** @type {typeof __VLS_317.click} */
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.tab === 'overview'))
                throw 0;
            if (!!(__VLS_ctx.tab === 'projects'))
                throw 0;
            if (!!(__VLS_ctx.tab === 'skills'))
                throw 0;
            if (!(__VLS_ctx.tab === 'bundles'))
                throw 0;
            return (__VLS_ctx.bundleDialog = true);
            // @ts-ignore
            [tab, Plus, bundleDialog,];
        },
    };
    const { default: __VLS_319 } = __VLS_315.slots;
    // @ts-ignore
    [];
    var __VLS_315;
    var __VLS_316;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "tile-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['tile-grid']} */ ;
    for (const [b] of __VLS_vFor((__VLS_ctx.data.bundles))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
            key: (b.id),
            ...{ class: "bundle-card glass" },
        });
        /** @type {__VLS_StyleScopedClasses['bundle-card']} */ ;
        /** @type {__VLS_StyleScopedClasses['glass']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "bundle-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['bundle-icon']} */ ;
        let __VLS_320;
        /** @ts-ignore @type { | typeof __VLS_components.Collection} */
        Collection;
        // @ts-ignore
        const __VLS_321 = __VLS_asFunctionalComponent1(__VLS_320, new __VLS_320({}));
        const __VLS_322 = __VLS_321({}, ...__VLS_functionalComponentArgsRest(__VLS_321));
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        (b.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (b.description || '暂无说明');
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "bundle-skills" },
        });
        /** @type {__VLS_StyleScopedClasses['bundle-skills']} */ ;
        for (const [sid] of __VLS_vFor((b.skillIds.slice(0, 5)))) {
            let __VLS_325;
            /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
            elTag;
            // @ts-ignore
            const __VLS_326 = __VLS_asFunctionalComponent1(__VLS_325, new __VLS_325({
                key: (sid),
                round: true,
            }));
            const __VLS_327 = __VLS_326({
                key: (sid),
                round: true,
            }, ...__VLS_functionalComponentArgsRest(__VLS_326));
            const { default: __VLS_330 } = __VLS_328.slots;
            (__VLS_ctx.data.skills.find((s) => s.id === sid)?.name);
            // @ts-ignore
            [data, data,];
            var __VLS_328;
            // @ts-ignore
            [];
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.footer, __VLS_intrinsics.footer)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (b.skillIds.length);
        (b.projectIds.length);
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        let __VLS_331;
        /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
        elButton;
        // @ts-ignore
        const __VLS_332 = __VLS_asFunctionalComponent1(__VLS_331, new __VLS_331({
            ...{ 'onClick': {} },
            text: true,
        }));
        const __VLS_333 = __VLS_332({
            ...{ 'onClick': {} },
            text: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_332));
        let __VLS_336;
        const __VLS_337 = {
            /** @type {typeof __VLS_336.click} */
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
        const { default: __VLS_338 } = __VLS_334.slots;
        // @ts-ignore
        [];
        var __VLS_334;
        var __VLS_335;
        let __VLS_339;
        /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
        elButton;
        // @ts-ignore
        const __VLS_340 = __VLS_asFunctionalComponent1(__VLS_339, new __VLS_339({
            ...{ 'onClick': {} },
            text: true,
            type: "danger",
        }));
        const __VLS_341 = __VLS_340({
            ...{ 'onClick': {} },
            text: true,
            type: "danger",
        }, ...__VLS_functionalComponentArgsRest(__VLS_340));
        let __VLS_344;
        const __VLS_345 = {
            /** @type {typeof __VLS_344.click} */
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
        const { default: __VLS_346 } = __VLS_342.slots;
        // @ts-ignore
        [];
        var __VLS_342;
        var __VLS_343;
        // @ts-ignore
        [];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                if (!!(__VLS_ctx.tab === 'overview'))
                    throw 0;
                if (!!(__VLS_ctx.tab === 'projects'))
                    throw 0;
                if (!!(__VLS_ctx.tab === 'skills'))
                    throw 0;
                if (!(__VLS_ctx.tab === 'bundles'))
                    throw 0;
                return (__VLS_ctx.bundleDialog = true);
                // @ts-ignore
                [bundleDialog,];
            } },
        ...{ class: "add-card glass" },
    });
    /** @type {__VLS_StyleScopedClasses['add-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    let __VLS_347;
    /** @ts-ignore @type { | typeof __VLS_components.Plus} */
    Plus;
    // @ts-ignore
    const __VLS_348 = __VLS_asFunctionalComponent1(__VLS_347, new __VLS_347({}));
    const __VLS_349 = __VLS_348({}, ...__VLS_functionalComponentArgsRest(__VLS_348));
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
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
    let __VLS_352;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_353 = __VLS_asFunctionalComponent1(__VLS_352, new __VLS_352({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.Refresh),
    }));
    const __VLS_354 = __VLS_353({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.Refresh),
    }, ...__VLS_functionalComponentArgsRest(__VLS_353));
    let __VLS_357;
    const __VLS_358 = {
        /** @type {typeof __VLS_357.click} */
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
    const { default: __VLS_359 } = __VLS_355.slots;
    // @ts-ignore
    [];
    var __VLS_355;
    var __VLS_356;
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
        let __VLS_360;
        /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
        elTag;
        // @ts-ignore
        const __VLS_361 = __VLS_asFunctionalComponent1(__VLS_360, new __VLS_360({
            type: (a.level === 'error' ? 'danger' : 'warning'),
            round: true,
        }));
        const __VLS_362 = __VLS_361({
            type: (a.level === 'error' ? 'danger' : 'warning'),
            round: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_361));
        const { default: __VLS_365 } = __VLS_363.slots;
        (a.type);
        // @ts-ignore
        [data,];
        var __VLS_363;
        // @ts-ignore
        [];
    }
    if (!__VLS_ctx.data.audit.length) {
        let __VLS_366;
        /** @ts-ignore @type { | typeof __VLS_components.elEmpty | typeof __VLS_components.ElEmpty | typeof __VLS_components['el-empty']} */
        elEmpty;
        // @ts-ignore
        const __VLS_367 = __VLS_asFunctionalComponent1(__VLS_366, new __VLS_366({
            description: "没有发现问题，当前状态健康",
        }));
        const __VLS_368 = __VLS_367({
            description: "没有发现问题，当前状态健康",
        }, ...__VLS_functionalComponentArgsRest(__VLS_367));
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
        let __VLS_371;
        /** @ts-ignore @type { | typeof __VLS_components.Clock} */
        Clock;
        // @ts-ignore
        const __VLS_372 = __VLS_asFunctionalComponent1(__VLS_371, new __VLS_371({}));
        const __VLS_373 = __VLS_372({}, ...__VLS_functionalComponentArgsRest(__VLS_372));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (h.kind === 'apply' ? '应用软链接变更' : '系统操作');
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (new Date(h.created_at).toLocaleString());
        (h.details?.completed?.length || 0);
        let __VLS_376;
        /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
        elTag;
        // @ts-ignore
        const __VLS_377 = __VLS_asFunctionalComponent1(__VLS_376, new __VLS_376({
            type: (h.status === 'success' ? 'success' : 'warning'),
            round: true,
        }));
        const __VLS_378 = __VLS_377({
            type: (h.status === 'success' ? 'success' : 'warning'),
            round: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_377));
        const { default: __VLS_381 } = __VLS_379.slots;
        (h.undone_at ? '已撤销' : h.status);
        // @ts-ignore
        [tab, data, data,];
        var __VLS_379;
        if (h.status === 'success' && !h.undone_at) {
            let __VLS_382;
            /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
            elButton;
            // @ts-ignore
            const __VLS_383 = __VLS_asFunctionalComponent1(__VLS_382, new __VLS_382({
                ...{ 'onClick': {} },
            }));
            const __VLS_384 = __VLS_383({
                ...{ 'onClick': {} },
            }, ...__VLS_functionalComponentArgsRest(__VLS_383));
            let __VLS_387;
            const __VLS_388 = {
                /** @type {typeof __VLS_387.click} */
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
            const { default: __VLS_389 } = __VLS_385.slots;
            // @ts-ignore
            [];
            var __VLS_385;
            var __VLS_386;
        }
        // @ts-ignore
        [];
    }
    if (!__VLS_ctx.data.history.length) {
        let __VLS_390;
        /** @ts-ignore @type { | typeof __VLS_components.elEmpty | typeof __VLS_components.ElEmpty | typeof __VLS_components['el-empty']} */
        elEmpty;
        // @ts-ignore
        const __VLS_391 = __VLS_asFunctionalComponent1(__VLS_390, new __VLS_390({
            description: "还没有操作记录",
        }));
        const __VLS_392 = __VLS_391({
            description: "还没有操作记录",
        }, ...__VLS_functionalComponentArgsRest(__VLS_391));
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
    let __VLS_395;
    /** @ts-ignore @type { | typeof __VLS_components.Monitor} */
    Monitor;
    // @ts-ignore
    const __VLS_396 = __VLS_asFunctionalComponent1(__VLS_395, new __VLS_395({}));
    const __VLS_397 = __VLS_396({}, ...__VLS_functionalComponentArgsRest(__VLS_396));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_400;
    /** @ts-ignore @type { | typeof __VLS_components.elSegmented | typeof __VLS_components.ElSegmented | typeof __VLS_components['el-segmented']} */
    elSegmented;
    // @ts-ignore
    const __VLS_401 = __VLS_asFunctionalComponent1(__VLS_400, new __VLS_400({
        modelValue: (__VLS_ctx.themeMode),
        options: (__VLS_ctx.themeOptions),
        'aria-label': "外观模式",
    }));
    const __VLS_402 = __VLS_401({
        modelValue: (__VLS_ctx.themeMode),
        options: (__VLS_ctx.themeOptions),
        'aria-label': "外观模式",
    }, ...__VLS_functionalComponentArgsRest(__VLS_401));
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "setting-card glass" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-icon']} */ ;
    let __VLS_405;
    /** @ts-ignore @type { | typeof __VLS_components.Download} */
    Download;
    // @ts-ignore
    const __VLS_406 = __VLS_asFunctionalComponent1(__VLS_405, new __VLS_405({}));
    const __VLS_407 = __VLS_406({}, ...__VLS_functionalComponentArgsRest(__VLS_406));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_410;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_411 = __VLS_asFunctionalComponent1(__VLS_410, new __VLS_410({
        ...{ 'onClick': {} },
    }));
    const __VLS_412 = __VLS_411({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_411));
    let __VLS_415;
    const __VLS_416 = {
        /** @type {typeof __VLS_415.click} */
        onClick: (__VLS_ctx.exportConfig),
    };
    const { default: __VLS_417 } = __VLS_413.slots;
    // @ts-ignore
    [data, themeMode, themeOptions, exportConfig,];
    var __VLS_413;
    var __VLS_414;
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "setting-card glass" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-icon']} */ ;
    let __VLS_418;
    /** @ts-ignore @type { | typeof __VLS_components.Upload} */
    Upload;
    // @ts-ignore
    const __VLS_419 = __VLS_asFunctionalComponent1(__VLS_418, new __VLS_418({}));
    const __VLS_420 = __VLS_419({}, ...__VLS_functionalComponentArgsRest(__VLS_419));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_423;
    /** @ts-ignore @type { | typeof __VLS_components.elUpload | typeof __VLS_components.ElUpload | typeof __VLS_components['el-upload'] | typeof __VLS_components.elUpload | typeof __VLS_components.ElUpload | typeof __VLS_components['el-upload']} */
    elUpload;
    // @ts-ignore
    const __VLS_424 = __VLS_asFunctionalComponent1(__VLS_423, new __VLS_423({
        showFileList: (false),
        accept: "application/json",
        beforeUpload: (__VLS_ctx.importConfig),
    }));
    const __VLS_425 = __VLS_424({
        showFileList: (false),
        accept: "application/json",
        beforeUpload: (__VLS_ctx.importConfig),
    }, ...__VLS_functionalComponentArgsRest(__VLS_424));
    const { default: __VLS_428 } = __VLS_426.slots;
    let __VLS_429;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_430 = __VLS_asFunctionalComponent1(__VLS_429, new __VLS_429({}));
    const __VLS_431 = __VLS_430({}, ...__VLS_functionalComponentArgsRest(__VLS_430));
    const { default: __VLS_434 } = __VLS_432.slots;
    // @ts-ignore
    [importConfig,];
    var __VLS_432;
    // @ts-ignore
    [];
    var __VLS_426;
}
let __VLS_435;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_436 = __VLS_asFunctionalComponent1(__VLS_435, new __VLS_435({
    modelValue: (__VLS_ctx.projectDialog),
    title: "添加项目",
    width: "560",
}));
const __VLS_437 = __VLS_436({
    modelValue: (__VLS_ctx.projectDialog),
    title: "添加项目",
    width: "560",
}, ...__VLS_functionalComponentArgsRest(__VLS_436));
const { default: __VLS_440 } = __VLS_438.slots;
let __VLS_441;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_442 = __VLS_asFunctionalComponent1(__VLS_441, new __VLS_441({
    labelPosition: "top",
}));
const __VLS_443 = __VLS_442({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_442));
const { default: __VLS_446 } = __VLS_444.slots;
let __VLS_447;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_448 = __VLS_asFunctionalComponent1(__VLS_447, new __VLS_447({
    label: "项目目录",
}));
const __VLS_449 = __VLS_448({
    label: "项目目录",
}, ...__VLS_functionalComponentArgsRest(__VLS_448));
const { default: __VLS_452 } = __VLS_450.slots;
let __VLS_453;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input'] | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_454 = __VLS_asFunctionalComponent1(__VLS_453, new __VLS_453({
    modelValue: (__VLS_ctx.projectForm.path),
    placeholder: "选择任意本地项目目录",
}));
const __VLS_455 = __VLS_454({
    modelValue: (__VLS_ctx.projectForm.path),
    placeholder: "选择任意本地项目目录",
}, ...__VLS_functionalComponentArgsRest(__VLS_454));
const { default: __VLS_458 } = __VLS_456.slots;
{
    const { append: __VLS_459 } = __VLS_456.slots;
    let __VLS_460;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_461 = __VLS_asFunctionalComponent1(__VLS_460, new __VLS_460({
        ...{ 'onClick': {} },
    }));
    const __VLS_462 = __VLS_461({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_461));
    let __VLS_465;
    const __VLS_466 = {
        /** @type {typeof __VLS_465.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.choose(__VLS_ctx.projectForm, '选择要管理的项目目录'));
            // @ts-ignore
            [projectDialog, projectForm, projectForm, choose,];
        },
    };
    const { default: __VLS_467 } = __VLS_463.slots;
    // @ts-ignore
    [];
    var __VLS_463;
    var __VLS_464;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_456;
// @ts-ignore
[];
var __VLS_450;
let __VLS_468;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_469 = __VLS_asFunctionalComponent1(__VLS_468, new __VLS_468({
    label: "显示名称（可选）",
}));
const __VLS_470 = __VLS_469({
    label: "显示名称（可选）",
}, ...__VLS_functionalComponentArgsRest(__VLS_469));
const { default: __VLS_473 } = __VLS_471.slots;
let __VLS_474;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_475 = __VLS_asFunctionalComponent1(__VLS_474, new __VLS_474({
    modelValue: (__VLS_ctx.projectForm.name),
    placeholder: "默认使用目录名",
}));
const __VLS_476 = __VLS_475({
    modelValue: (__VLS_ctx.projectForm.name),
    placeholder: "默认使用目录名",
}, ...__VLS_functionalComponentArgsRest(__VLS_475));
// @ts-ignore
[projectForm,];
var __VLS_471;
// @ts-ignore
[];
var __VLS_444;
{
    const { footer: __VLS_479 } = __VLS_438.slots;
    let __VLS_480;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_481 = __VLS_asFunctionalComponent1(__VLS_480, new __VLS_480({
        ...{ 'onClick': {} },
    }));
    const __VLS_482 = __VLS_481({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_481));
    let __VLS_485;
    const __VLS_486 = {
        /** @type {typeof __VLS_485.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.projectDialog = false);
            // @ts-ignore
            [projectDialog,];
        },
    };
    const { default: __VLS_487 } = __VLS_483.slots;
    // @ts-ignore
    [];
    var __VLS_483;
    var __VLS_484;
    let __VLS_488;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_489 = __VLS_asFunctionalComponent1(__VLS_488, new __VLS_488({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.projectForm.path),
    }));
    const __VLS_490 = __VLS_489({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.projectForm.path),
    }, ...__VLS_functionalComponentArgsRest(__VLS_489));
    let __VLS_493;
    const __VLS_494 = {
        /** @type {typeof __VLS_493.click} */
        onClick: (__VLS_ctx.addProject),
    };
    const { default: __VLS_495 } = __VLS_491.slots;
    // @ts-ignore
    [projectForm, addProject,];
    var __VLS_491;
    var __VLS_492;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_438;
let __VLS_496;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_497 = __VLS_asFunctionalComponent1(__VLS_496, new __VLS_496({
    modelValue: (__VLS_ctx.sourceDialog),
    title: "添加技能源",
    width: "560",
}));
const __VLS_498 = __VLS_497({
    modelValue: (__VLS_ctx.sourceDialog),
    title: "添加技能源",
    width: "560",
}, ...__VLS_functionalComponentArgsRest(__VLS_497));
const { default: __VLS_501 } = __VLS_499.slots;
let __VLS_502;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_503 = __VLS_asFunctionalComponent1(__VLS_502, new __VLS_502({
    labelPosition: "top",
}));
const __VLS_504 = __VLS_503({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_503));
const { default: __VLS_507 } = __VLS_505.slots;
let __VLS_508;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_509 = __VLS_asFunctionalComponent1(__VLS_508, new __VLS_508({
    label: "来源类型",
}));
const __VLS_510 = __VLS_509({
    label: "来源类型",
}, ...__VLS_functionalComponentArgsRest(__VLS_509));
const { default: __VLS_513 } = __VLS_511.slots;
let __VLS_514;
/** @ts-ignore @type { | typeof __VLS_components.elRadioGroup | typeof __VLS_components.ElRadioGroup | typeof __VLS_components['el-radio-group'] | typeof __VLS_components.elRadioGroup | typeof __VLS_components.ElRadioGroup | typeof __VLS_components['el-radio-group']} */
elRadioGroup;
// @ts-ignore
const __VLS_515 = __VLS_asFunctionalComponent1(__VLS_514, new __VLS_514({
    modelValue: (__VLS_ctx.sourceForm.mode),
}));
const __VLS_516 = __VLS_515({
    modelValue: (__VLS_ctx.sourceForm.mode),
}, ...__VLS_functionalComponentArgsRest(__VLS_515));
const { default: __VLS_519 } = __VLS_517.slots;
let __VLS_520;
/** @ts-ignore @type { | typeof __VLS_components.elRadioButton | typeof __VLS_components.ElRadioButton | typeof __VLS_components['el-radio-button'] | typeof __VLS_components.elRadioButton | typeof __VLS_components.ElRadioButton | typeof __VLS_components['el-radio-button']} */
elRadioButton;
// @ts-ignore
const __VLS_521 = __VLS_asFunctionalComponent1(__VLS_520, new __VLS_520({
    value: "pack",
}));
const __VLS_522 = __VLS_521({
    value: "pack",
}, ...__VLS_functionalComponentArgsRest(__VLS_521));
const { default: __VLS_525 } = __VLS_523.slots;
// @ts-ignore
[sourceDialog, sourceForm,];
var __VLS_523;
let __VLS_526;
/** @ts-ignore @type { | typeof __VLS_components.elRadioButton | typeof __VLS_components.ElRadioButton | typeof __VLS_components['el-radio-button'] | typeof __VLS_components.elRadioButton | typeof __VLS_components.ElRadioButton | typeof __VLS_components['el-radio-button']} */
elRadioButton;
// @ts-ignore
const __VLS_527 = __VLS_asFunctionalComponent1(__VLS_526, new __VLS_526({
    value: "single",
}));
const __VLS_528 = __VLS_527({
    value: "single",
}, ...__VLS_functionalComponentArgsRest(__VLS_527));
const { default: __VLS_531 } = __VLS_529.slots;
// @ts-ignore
[];
var __VLS_529;
// @ts-ignore
[];
var __VLS_517;
// @ts-ignore
[];
var __VLS_511;
let __VLS_532;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_533 = __VLS_asFunctionalComponent1(__VLS_532, new __VLS_532({
    label: "目录",
}));
const __VLS_534 = __VLS_533({
    label: "目录",
}, ...__VLS_functionalComponentArgsRest(__VLS_533));
const { default: __VLS_537 } = __VLS_535.slots;
let __VLS_538;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input'] | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_539 = __VLS_asFunctionalComponent1(__VLS_538, new __VLS_538({
    modelValue: (__VLS_ctx.sourceForm.path),
    placeholder: "选择含 SKILL.md 的技能或技能包",
}));
const __VLS_540 = __VLS_539({
    modelValue: (__VLS_ctx.sourceForm.path),
    placeholder: "选择含 SKILL.md 的技能或技能包",
}, ...__VLS_functionalComponentArgsRest(__VLS_539));
const { default: __VLS_543 } = __VLS_541.slots;
{
    const { append: __VLS_544 } = __VLS_541.slots;
    let __VLS_545;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_546 = __VLS_asFunctionalComponent1(__VLS_545, new __VLS_545({
        ...{ 'onClick': {} },
    }));
    const __VLS_547 = __VLS_546({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_546));
    let __VLS_550;
    const __VLS_551 = {
        /** @type {typeof __VLS_550.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.choose(__VLS_ctx.sourceForm, '选择技能或技能包目录'));
            // @ts-ignore
            [choose, sourceForm, sourceForm,];
        },
    };
    const { default: __VLS_552 } = __VLS_548.slots;
    // @ts-ignore
    [];
    var __VLS_548;
    var __VLS_549;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_541;
// @ts-ignore
[];
var __VLS_535;
let __VLS_553;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_554 = __VLS_asFunctionalComponent1(__VLS_553, new __VLS_553({
    label: "来源名称（可选）",
}));
const __VLS_555 = __VLS_554({
    label: "来源名称（可选）",
}, ...__VLS_functionalComponentArgsRest(__VLS_554));
const { default: __VLS_558 } = __VLS_556.slots;
let __VLS_559;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_560 = __VLS_asFunctionalComponent1(__VLS_559, new __VLS_559({
    modelValue: (__VLS_ctx.sourceForm.name),
    placeholder: "默认使用目录名",
}));
const __VLS_561 = __VLS_560({
    modelValue: (__VLS_ctx.sourceForm.name),
    placeholder: "默认使用目录名",
}, ...__VLS_functionalComponentArgsRest(__VLS_560));
// @ts-ignore
[sourceForm,];
var __VLS_556;
// @ts-ignore
[];
var __VLS_505;
{
    const { footer: __VLS_564 } = __VLS_499.slots;
    let __VLS_565;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_566 = __VLS_asFunctionalComponent1(__VLS_565, new __VLS_565({
        ...{ 'onClick': {} },
    }));
    const __VLS_567 = __VLS_566({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_566));
    let __VLS_570;
    const __VLS_571 = {
        /** @type {typeof __VLS_570.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.sourceDialog = false);
            // @ts-ignore
            [sourceDialog,];
        },
    };
    const { default: __VLS_572 } = __VLS_568.slots;
    // @ts-ignore
    [];
    var __VLS_568;
    var __VLS_569;
    let __VLS_573;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_574 = __VLS_asFunctionalComponent1(__VLS_573, new __VLS_573({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.sourceForm.path),
    }));
    const __VLS_575 = __VLS_574({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.sourceForm.path),
    }, ...__VLS_functionalComponentArgsRest(__VLS_574));
    let __VLS_578;
    const __VLS_579 = {
        /** @type {typeof __VLS_578.click} */
        onClick: (__VLS_ctx.addSource),
    };
    const { default: __VLS_580 } = __VLS_576.slots;
    // @ts-ignore
    [sourceForm, addSource,];
    var __VLS_576;
    var __VLS_577;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_499;
let __VLS_581;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_582 = __VLS_asFunctionalComponent1(__VLS_581, new __VLS_581({
    modelValue: (__VLS_ctx.bundleDialog),
    title: "新建技能组合",
    width: "620",
}));
const __VLS_583 = __VLS_582({
    modelValue: (__VLS_ctx.bundleDialog),
    title: "新建技能组合",
    width: "620",
}, ...__VLS_functionalComponentArgsRest(__VLS_582));
const { default: __VLS_586 } = __VLS_584.slots;
let __VLS_587;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_588 = __VLS_asFunctionalComponent1(__VLS_587, new __VLS_587({
    labelPosition: "top",
}));
const __VLS_589 = __VLS_588({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_588));
const { default: __VLS_592 } = __VLS_590.slots;
let __VLS_593;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_594 = __VLS_asFunctionalComponent1(__VLS_593, new __VLS_593({
    label: "组合名称",
}));
const __VLS_595 = __VLS_594({
    label: "组合名称",
}, ...__VLS_functionalComponentArgsRest(__VLS_594));
const { default: __VLS_598 } = __VLS_596.slots;
let __VLS_599;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_600 = __VLS_asFunctionalComponent1(__VLS_599, new __VLS_599({
    modelValue: (__VLS_ctx.bundleForm.name),
}));
const __VLS_601 = __VLS_600({
    modelValue: (__VLS_ctx.bundleForm.name),
}, ...__VLS_functionalComponentArgsRest(__VLS_600));
// @ts-ignore
[bundleDialog, bundleForm,];
var __VLS_596;
let __VLS_604;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_605 = __VLS_asFunctionalComponent1(__VLS_604, new __VLS_604({
    label: "说明",
}));
const __VLS_606 = __VLS_605({
    label: "说明",
}, ...__VLS_functionalComponentArgsRest(__VLS_605));
const { default: __VLS_609 } = __VLS_607.slots;
let __VLS_610;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_611 = __VLS_asFunctionalComponent1(__VLS_610, new __VLS_610({
    modelValue: (__VLS_ctx.bundleForm.description),
    type: "textarea",
}));
const __VLS_612 = __VLS_611({
    modelValue: (__VLS_ctx.bundleForm.description),
    type: "textarea",
}, ...__VLS_functionalComponentArgsRest(__VLS_611));
// @ts-ignore
[bundleForm,];
var __VLS_607;
let __VLS_615;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_616 = __VLS_asFunctionalComponent1(__VLS_615, new __VLS_615({
    label: "包含技能",
}));
const __VLS_617 = __VLS_616({
    label: "包含技能",
}, ...__VLS_functionalComponentArgsRest(__VLS_616));
const { default: __VLS_620 } = __VLS_618.slots;
let __VLS_621;
/** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
elSelect;
// @ts-ignore
const __VLS_622 = __VLS_asFunctionalComponent1(__VLS_621, new __VLS_621({
    modelValue: (__VLS_ctx.bundleForm.skillIds),
    multiple: true,
    filterable: true,
    collapseTags: true,
    placeholder: "选择技能",
    ...{ style: {} },
}));
const __VLS_623 = __VLS_622({
    modelValue: (__VLS_ctx.bundleForm.skillIds),
    multiple: true,
    filterable: true,
    collapseTags: true,
    placeholder: "选择技能",
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_622));
const { default: __VLS_626 } = __VLS_624.slots;
for (const [s] of __VLS_vFor((__VLS_ctx.data.skills))) {
    let __VLS_627;
    /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
    elOption;
    // @ts-ignore
    const __VLS_628 = __VLS_asFunctionalComponent1(__VLS_627, new __VLS_627({
        key: (s.id),
        label: (s.name),
        value: (s.id),
    }));
    const __VLS_629 = __VLS_628({
        key: (s.id),
        label: (s.name),
        value: (s.id),
    }, ...__VLS_functionalComponentArgsRest(__VLS_628));
    // @ts-ignore
    [data, bundleForm,];
}
// @ts-ignore
[];
var __VLS_624;
// @ts-ignore
[];
var __VLS_618;
// @ts-ignore
[];
var __VLS_590;
{
    const { footer: __VLS_632 } = __VLS_584.slots;
    let __VLS_633;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_634 = __VLS_asFunctionalComponent1(__VLS_633, new __VLS_633({
        ...{ 'onClick': {} },
    }));
    const __VLS_635 = __VLS_634({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_634));
    let __VLS_638;
    const __VLS_639 = {
        /** @type {typeof __VLS_638.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.bundleDialog = false);
            // @ts-ignore
            [bundleDialog,];
        },
    };
    const { default: __VLS_640 } = __VLS_636.slots;
    // @ts-ignore
    [];
    var __VLS_636;
    var __VLS_637;
    let __VLS_641;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_642 = __VLS_asFunctionalComponent1(__VLS_641, new __VLS_641({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleForm.name),
    }));
    const __VLS_643 = __VLS_642({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleForm.name),
    }, ...__VLS_functionalComponentArgsRest(__VLS_642));
    let __VLS_646;
    const __VLS_647 = {
        /** @type {typeof __VLS_646.click} */
        onClick: (__VLS_ctx.createBundle),
    };
    const { default: __VLS_648 } = __VLS_644.slots;
    // @ts-ignore
    [bundleForm, createBundle,];
    var __VLS_644;
    var __VLS_645;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_584;
let __VLS_649;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_650 = __VLS_asFunctionalComponent1(__VLS_649, new __VLS_649({
    modelValue: (__VLS_ctx.groupDialog),
    title: "新建项目组",
    width: "480",
}));
const __VLS_651 = __VLS_650({
    modelValue: (__VLS_ctx.groupDialog),
    title: "新建项目组",
    width: "480",
}, ...__VLS_functionalComponentArgsRest(__VLS_650));
const { default: __VLS_654 } = __VLS_652.slots;
let __VLS_655;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_656 = __VLS_asFunctionalComponent1(__VLS_655, new __VLS_655({
    labelPosition: "top",
}));
const __VLS_657 = __VLS_656({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_656));
const { default: __VLS_660 } = __VLS_658.slots;
let __VLS_661;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_662 = __VLS_asFunctionalComponent1(__VLS_661, new __VLS_661({
    label: "项目组名称",
}));
const __VLS_663 = __VLS_662({
    label: "项目组名称",
}, ...__VLS_functionalComponentArgsRest(__VLS_662));
const { default: __VLS_666 } = __VLS_664.slots;
let __VLS_667;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_668 = __VLS_asFunctionalComponent1(__VLS_667, new __VLS_667({
    modelValue: (__VLS_ctx.groupForm.name),
}));
const __VLS_669 = __VLS_668({
    modelValue: (__VLS_ctx.groupForm.name),
}, ...__VLS_functionalComponentArgsRest(__VLS_668));
// @ts-ignore
[groupDialog, groupForm,];
var __VLS_664;
let __VLS_672;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_673 = __VLS_asFunctionalComponent1(__VLS_672, new __VLS_672({
    label: "标识颜色",
}));
const __VLS_674 = __VLS_673({
    label: "标识颜色",
}, ...__VLS_functionalComponentArgsRest(__VLS_673));
const { default: __VLS_677 } = __VLS_675.slots;
let __VLS_678;
/** @ts-ignore @type { | typeof __VLS_components.elColorPicker | typeof __VLS_components.ElColorPicker | typeof __VLS_components['el-color-picker']} */
elColorPicker;
// @ts-ignore
const __VLS_679 = __VLS_asFunctionalComponent1(__VLS_678, new __VLS_678({
    modelValue: (__VLS_ctx.groupForm.color),
}));
const __VLS_680 = __VLS_679({
    modelValue: (__VLS_ctx.groupForm.color),
}, ...__VLS_functionalComponentArgsRest(__VLS_679));
// @ts-ignore
[groupForm,];
var __VLS_675;
// @ts-ignore
[];
var __VLS_658;
{
    const { footer: __VLS_683 } = __VLS_652.slots;
    let __VLS_684;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_685 = __VLS_asFunctionalComponent1(__VLS_684, new __VLS_684({
        ...{ 'onClick': {} },
    }));
    const __VLS_686 = __VLS_685({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_685));
    let __VLS_689;
    const __VLS_690 = {
        /** @type {typeof __VLS_689.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.groupDialog = false);
            // @ts-ignore
            [groupDialog,];
        },
    };
    const { default: __VLS_691 } = __VLS_687.slots;
    // @ts-ignore
    [];
    var __VLS_687;
    var __VLS_688;
    let __VLS_692;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_693 = __VLS_asFunctionalComponent1(__VLS_692, new __VLS_692({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.groupForm.name),
    }));
    const __VLS_694 = __VLS_693({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.groupForm.name),
    }, ...__VLS_functionalComponentArgsRest(__VLS_693));
    let __VLS_697;
    const __VLS_698 = {
        /** @type {typeof __VLS_697.click} */
        onClick: (__VLS_ctx.createGroup),
    };
    const { default: __VLS_699 } = __VLS_695.slots;
    // @ts-ignore
    [groupForm, createGroup,];
    var __VLS_695;
    var __VLS_696;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_652;
let __VLS_700;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_701 = __VLS_asFunctionalComponent1(__VLS_700, new __VLS_700({
    modelValue: (__VLS_ctx.skillDialog),
    title: "编辑技能",
    width: "520",
}));
const __VLS_702 = __VLS_701({
    modelValue: (__VLS_ctx.skillDialog),
    title: "编辑技能",
    width: "520",
}, ...__VLS_functionalComponentArgsRest(__VLS_701));
const { default: __VLS_705 } = __VLS_703.slots;
let __VLS_706;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_707 = __VLS_asFunctionalComponent1(__VLS_706, new __VLS_706({
    labelPosition: "top",
}));
const __VLS_708 = __VLS_707({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_707));
const { default: __VLS_711 } = __VLS_709.slots;
let __VLS_712;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_713 = __VLS_asFunctionalComponent1(__VLS_712, new __VLS_712({
    label: "项目内链接名",
}));
const __VLS_714 = __VLS_713({
    label: "项目内链接名",
}, ...__VLS_functionalComponentArgsRest(__VLS_713));
const { default: __VLS_717 } = __VLS_715.slots;
let __VLS_718;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_719 = __VLS_asFunctionalComponent1(__VLS_718, new __VLS_718({
    modelValue: (__VLS_ctx.skillForm.alias),
}));
const __VLS_720 = __VLS_719({
    modelValue: (__VLS_ctx.skillForm.alias),
}, ...__VLS_functionalComponentArgsRest(__VLS_719));
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "el-form-item__description" },
});
/** @type {__VLS_StyleScopedClasses['el-form-item__description']} */ ;
// @ts-ignore
[skillDialog, skillForm,];
var __VLS_715;
let __VLS_723;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_724 = __VLS_asFunctionalComponent1(__VLS_723, new __VLS_723({
    label: "标签",
}));
const __VLS_725 = __VLS_724({
    label: "标签",
}, ...__VLS_functionalComponentArgsRest(__VLS_724));
const { default: __VLS_728 } = __VLS_726.slots;
let __VLS_729;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_730 = __VLS_asFunctionalComponent1(__VLS_729, new __VLS_729({
    modelValue: (__VLS_ctx.skillForm.tags),
    placeholder: "用逗号分隔，例如：论文, 前端, 常用",
}));
const __VLS_731 = __VLS_730({
    modelValue: (__VLS_ctx.skillForm.tags),
    placeholder: "用逗号分隔，例如：论文, 前端, 常用",
}, ...__VLS_functionalComponentArgsRest(__VLS_730));
// @ts-ignore
[skillForm,];
var __VLS_726;
// @ts-ignore
[];
var __VLS_709;
{
    const { footer: __VLS_734 } = __VLS_703.slots;
    let __VLS_735;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_736 = __VLS_asFunctionalComponent1(__VLS_735, new __VLS_735({
        ...{ 'onClick': {} },
    }));
    const __VLS_737 = __VLS_736({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_736));
    let __VLS_740;
    const __VLS_741 = {
        /** @type {typeof __VLS_740.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.skillDialog = false);
            // @ts-ignore
            [skillDialog,];
        },
    };
    const { default: __VLS_742 } = __VLS_738.slots;
    // @ts-ignore
    [];
    var __VLS_738;
    var __VLS_739;
    let __VLS_743;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_744 = __VLS_asFunctionalComponent1(__VLS_743, new __VLS_743({
        ...{ 'onClick': {} },
        type: "primary",
    }));
    const __VLS_745 = __VLS_744({
        ...{ 'onClick': {} },
        type: "primary",
    }, ...__VLS_functionalComponentArgsRest(__VLS_744));
    let __VLS_748;
    const __VLS_749 = {
        /** @type {typeof __VLS_748.click} */
        onClick: (__VLS_ctx.saveSkill),
    };
    const { default: __VLS_750 } = __VLS_746.slots;
    // @ts-ignore
    [saveSkill,];
    var __VLS_746;
    var __VLS_747;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_703;
let __VLS_751;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_752 = __VLS_asFunctionalComponent1(__VLS_751, new __VLS_751({
    modelValue: (__VLS_ctx.bundleApplyDialog),
    title: "应用技能组合",
    width: "520",
}));
const __VLS_753 = __VLS_752({
    modelValue: (__VLS_ctx.bundleApplyDialog),
    title: "应用技能组合",
    width: "520",
}, ...__VLS_functionalComponentArgsRest(__VLS_752));
const { default: __VLS_756 } = __VLS_754.slots;
let __VLS_757;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_758 = __VLS_asFunctionalComponent1(__VLS_757, new __VLS_757({
    labelPosition: "top",
}));
const __VLS_759 = __VLS_758({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_758));
const { default: __VLS_762 } = __VLS_760.slots;
let __VLS_763;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_764 = __VLS_asFunctionalComponent1(__VLS_763, new __VLS_763({
    label: "目标项目",
}));
const __VLS_765 = __VLS_764({
    label: "目标项目",
}, ...__VLS_functionalComponentArgsRest(__VLS_764));
const { default: __VLS_768 } = __VLS_766.slots;
let __VLS_769;
/** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
elSelect;
// @ts-ignore
const __VLS_770 = __VLS_asFunctionalComponent1(__VLS_769, new __VLS_769({
    modelValue: (__VLS_ctx.bundleApply.projectId),
    ...{ style: {} },
}));
const __VLS_771 = __VLS_770({
    modelValue: (__VLS_ctx.bundleApply.projectId),
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_770));
const { default: __VLS_774 } = __VLS_772.slots;
for (const [p] of __VLS_vFor((__VLS_ctx.data.projects))) {
    let __VLS_775;
    /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
    elOption;
    // @ts-ignore
    const __VLS_776 = __VLS_asFunctionalComponent1(__VLS_775, new __VLS_775({
        key: (p.id),
        label: (p.name),
        value: (p.id),
    }));
    const __VLS_777 = __VLS_776({
        key: (p.id),
        label: (p.name),
        value: (p.id),
    }, ...__VLS_functionalComponentArgsRest(__VLS_776));
    // @ts-ignore
    [data, bundleApplyDialog, bundleApply,];
}
// @ts-ignore
[];
var __VLS_772;
// @ts-ignore
[];
var __VLS_766;
// @ts-ignore
[];
var __VLS_760;
let __VLS_780;
/** @ts-ignore @type { | typeof __VLS_components.elAlert | typeof __VLS_components.ElAlert | typeof __VLS_components['el-alert']} */
elAlert;
// @ts-ignore
const __VLS_781 = __VLS_asFunctionalComponent1(__VLS_780, new __VLS_780({
    title: "应用后会持续检查该项目与组合之间的配置漂移。",
    type: "info",
    closable: (false),
}));
const __VLS_782 = __VLS_781({
    title: "应用后会持续检查该项目与组合之间的配置漂移。",
    type: "info",
    closable: (false),
}, ...__VLS_functionalComponentArgsRest(__VLS_781));
{
    const { footer: __VLS_785 } = __VLS_754.slots;
    let __VLS_786;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_787 = __VLS_asFunctionalComponent1(__VLS_786, new __VLS_786({
        ...{ 'onClick': {} },
    }));
    const __VLS_788 = __VLS_787({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_787));
    let __VLS_791;
    const __VLS_792 = {
        /** @type {typeof __VLS_791.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.bundleApplyDialog = false);
            // @ts-ignore
            [bundleApplyDialog,];
        },
    };
    const { default: __VLS_793 } = __VLS_789.slots;
    // @ts-ignore
    [];
    var __VLS_789;
    var __VLS_790;
    let __VLS_794;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_795 = __VLS_asFunctionalComponent1(__VLS_794, new __VLS_794({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleApply.projectId),
    }));
    const __VLS_796 = __VLS_795({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleApply.projectId),
    }, ...__VLS_functionalComponentArgsRest(__VLS_795));
    let __VLS_799;
    const __VLS_800 = {
        /** @type {typeof __VLS_799.click} */
        onClick: (__VLS_ctx.stageBundle),
    };
    const { default: __VLS_801 } = __VLS_797.slots;
    // @ts-ignore
    [bundleApply, stageBundle,];
    var __VLS_797;
    var __VLS_798;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_754;
let __VLS_802;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_803 = __VLS_asFunctionalComponent1(__VLS_802, new __VLS_802({
    modelValue: (__VLS_ctx.planDialog),
    title: "确认变更计划",
    width: "720",
}));
const __VLS_804 = __VLS_803({
    modelValue: (__VLS_ctx.planDialog),
    title: "确认变更计划",
    width: "720",
}, ...__VLS_functionalComponentArgsRest(__VLS_803));
const { default: __VLS_807 } = __VLS_805.slots;
if (__VLS_ctx.currentPlan?.warnings.length) {
    let __VLS_808;
    /** @ts-ignore @type { | typeof __VLS_components.elAlert | typeof __VLS_components.ElAlert | typeof __VLS_components['el-alert']} */
    elAlert;
    // @ts-ignore
    const __VLS_809 = __VLS_asFunctionalComponent1(__VLS_808, new __VLS_808({
        title: (`${__VLS_ctx.currentPlan.warnings.length} 项被安全跳过`),
        type: "warning",
        showIcon: true,
        closable: (false),
    }));
    const __VLS_810 = __VLS_809({
        title: (`${__VLS_ctx.currentPlan.warnings.length} 项被安全跳过`),
        type: "warning",
        showIcon: true,
        closable: (false),
    }, ...__VLS_functionalComponentArgsRest(__VLS_809));
}
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "plan-summary" },
});
/** @type {__VLS_StyleScopedClasses['plan-summary']} */ ;
__VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
(__VLS_ctx.currentPlan?.items.length || 0);
__VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "plan-items" },
});
/** @type {__VLS_StyleScopedClasses['plan-items']} */ ;
for (const [i] of __VLS_vFor((__VLS_ctx.currentPlan?.items))) {
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        key: (i.target),
    });
    let __VLS_813;
    /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
    elTag;
    // @ts-ignore
    const __VLS_814 = __VLS_asFunctionalComponent1(__VLS_813, new __VLS_813({
        round: true,
    }));
    const __VLS_815 = __VLS_814({
        round: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_814));
    const { default: __VLS_818 } = __VLS_816.slots;
    (__VLS_ctx.planActionText[i.action]);
    // @ts-ignore
    [planDialog, currentPlan, currentPlan, currentPlan, currentPlan, planActionText,];
    var __VLS_816;
    __VLS_asFunctionalElement1(__VLS_intrinsics.code, __VLS_intrinsics.code)({});
    (i.target);
    // @ts-ignore
    [];
}
{
    const { footer: __VLS_819 } = __VLS_805.slots;
    let __VLS_820;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_821 = __VLS_asFunctionalComponent1(__VLS_820, new __VLS_820({
        ...{ 'onClick': {} },
    }));
    const __VLS_822 = __VLS_821({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_821));
    let __VLS_825;
    const __VLS_826 = {
        /** @type {typeof __VLS_825.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.planDialog = false);
            // @ts-ignore
            [planDialog,];
        },
    };
    const { default: __VLS_827 } = __VLS_823.slots;
    // @ts-ignore
    [];
    var __VLS_823;
    var __VLS_824;
    let __VLS_828;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_829 = __VLS_asFunctionalComponent1(__VLS_828, new __VLS_828({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.applying),
        disabled: (!__VLS_ctx.currentPlan?.items.length && !__VLS_ctx.currentPlan?.bundleId),
    }));
    const __VLS_830 = __VLS_829({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.applying),
        disabled: (!__VLS_ctx.currentPlan?.items.length && !__VLS_ctx.currentPlan?.bundleId),
    }, ...__VLS_functionalComponentArgsRest(__VLS_829));
    let __VLS_833;
    const __VLS_834 = {
        /** @type {typeof __VLS_833.click} */
        onClick: (__VLS_ctx.applyPlan),
    };
    const { default: __VLS_835 } = __VLS_831.slots;
    // @ts-ignore
    [currentPlan, currentPlan, applying, applyPlan,];
    var __VLS_831;
    var __VLS_832;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_805;
// @ts-ignore
[];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
