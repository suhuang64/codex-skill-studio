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
const loading = ref(true), tab = ref('overview'), query = ref(''), statusFilter = ref('all'), selectedProject = ref(''), statuses = ref([]), selectedSkills = ref([]);
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
const filteredSkills = computed(() => {
    const q = query.value.toLowerCase();
    return statuses.value.filter((s) => (statusFilter.value === 'all' || s.status === statusFilter.value) &&
        (!q ||
            `${s.name} ${s.description} ${s.path} ${s.tags.join(' ')}`.toLowerCase().includes(q)));
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
    let __VLS_181;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_182 = __VLS_asFunctionalComponent1(__VLS_181, new __VLS_181({
        ...{ 'onClick': {} },
    }));
    const __VLS_183 = __VLS_182({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_182));
    let __VLS_186;
    const __VLS_187 = {
        /** @type {typeof __VLS_186.click} */
        onClick: (...[$event]) => {
            if (!!(__VLS_ctx.tab === 'overview'))
                throw 0;
            if (!!(__VLS_ctx.tab === 'projects'))
                throw 0;
            if (!(__VLS_ctx.tab === 'skills'))
                throw 0;
            return (__VLS_ctx.stage('link'));
            // @ts-ignore
            [query, Search, statusFilter, selectedSkills, selectedSkills, stage,];
        },
    };
    const { default: __VLS_188 } = __VLS_184.slots;
    // @ts-ignore
    [];
    var __VLS_184;
    var __VLS_185;
    let __VLS_189;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_190 = __VLS_asFunctionalComponent1(__VLS_189, new __VLS_189({
        ...{ 'onClick': {} },
    }));
    const __VLS_191 = __VLS_190({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_190));
    let __VLS_194;
    const __VLS_195 = {
        /** @type {typeof __VLS_194.click} */
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
    const { default: __VLS_196 } = __VLS_192.slots;
    // @ts-ignore
    [];
    var __VLS_192;
    var __VLS_193;
    let __VLS_197;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_198 = __VLS_asFunctionalComponent1(__VLS_197, new __VLS_197({
        ...{ 'onClick': {} },
        type: "danger",
        plain: true,
    }));
    const __VLS_199 = __VLS_198({
        ...{ 'onClick': {} },
        type: "danger",
        plain: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_198));
    let __VLS_202;
    const __VLS_203 = {
        /** @type {typeof __VLS_202.click} */
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
    const { default: __VLS_204 } = __VLS_200.slots;
    // @ts-ignore
    [];
    var __VLS_200;
    var __VLS_201;
    let __VLS_205;
    /** @ts-ignore @type { | typeof __VLS_components.elTable | typeof __VLS_components.ElTable | typeof __VLS_components['el-table'] | typeof __VLS_components.elTable | typeof __VLS_components.ElTable | typeof __VLS_components['el-table']} */
    elTable;
    // @ts-ignore
    const __VLS_206 = __VLS_asFunctionalComponent1(__VLS_205, new __VLS_205({
        ...{ 'onSelectionChange': {} },
        data: (__VLS_ctx.filteredSkills),
        rowKey: "id",
        height: "560",
        emptyText: "当前筛选没有技能",
    }));
    const __VLS_207 = __VLS_206({
        ...{ 'onSelectionChange': {} },
        data: (__VLS_ctx.filteredSkills),
        rowKey: "id",
        height: "560",
        emptyText: "当前筛选没有技能",
    }, ...__VLS_functionalComponentArgsRest(__VLS_206));
    let __VLS_210;
    const __VLS_211 = {
        /** @type {typeof __VLS_210.selectionChange} */
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
    const { default: __VLS_212 } = __VLS_208.slots;
    let __VLS_213;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_214 = __VLS_asFunctionalComponent1(__VLS_213, new __VLS_213({
        type: "selection",
        width: "48",
    }));
    const __VLS_215 = __VLS_214({
        type: "selection",
        width: "48",
    }, ...__VLS_functionalComponentArgsRest(__VLS_214));
    let __VLS_218;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_219 = __VLS_asFunctionalComponent1(__VLS_218, new __VLS_218({
        label: "技能",
        minWidth: "240",
    }));
    const __VLS_220 = __VLS_219({
        label: "技能",
        minWidth: "240",
    }, ...__VLS_functionalComponentArgsRest(__VLS_219));
    const { default: __VLS_223 } = __VLS_221.slots;
    {
        const { default: __VLS_224 } = __VLS_221.slots;
        const [{ row }] = __VLS_vSlot(__VLS_224);
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
        let __VLS_225;
        /** @ts-ignore @type { | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon'] | typeof __VLS_components.elIcon | typeof __VLS_components.ElIcon | typeof __VLS_components['el-icon']} */
        elIcon;
        // @ts-ignore
        const __VLS_226 = __VLS_asFunctionalComponent1(__VLS_225, new __VLS_225({
            ...{ class: ({ on: row.favorite }) },
        }));
        const __VLS_227 = __VLS_226({
            ...{ class: ({ on: row.favorite }) },
        }, ...__VLS_functionalComponentArgsRest(__VLS_226));
        /** @type {__VLS_StyleScopedClasses['on']} */ ;
        const { default: __VLS_230 } = __VLS_228.slots;
        let __VLS_231;
        /** @ts-ignore @type { | typeof __VLS_components.Star} */
        Star;
        // @ts-ignore
        const __VLS_232 = __VLS_asFunctionalComponent1(__VLS_231, new __VLS_231({}));
        const __VLS_233 = __VLS_232({}, ...__VLS_functionalComponentArgsRest(__VLS_232));
        // @ts-ignore
        [];
        var __VLS_228;
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
    var __VLS_221;
    let __VLS_236;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_237 = __VLS_asFunctionalComponent1(__VLS_236, new __VLS_236({
        prop: "alias",
        label: "链接名",
        width: "150",
    }));
    const __VLS_238 = __VLS_237({
        prop: "alias",
        label: "链接名",
        width: "150",
    }, ...__VLS_functionalComponentArgsRest(__VLS_237));
    let __VLS_241;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_242 = __VLS_asFunctionalComponent1(__VLS_241, new __VLS_241({
        label: "状态",
        width: "120",
    }));
    const __VLS_243 = __VLS_242({
        label: "状态",
        width: "120",
    }, ...__VLS_functionalComponentArgsRest(__VLS_242));
    const { default: __VLS_246 } = __VLS_244.slots;
    {
        const { default: __VLS_247 } = __VLS_244.slots;
        const [{ row }] = __VLS_vSlot(__VLS_247);
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
    var __VLS_244;
    let __VLS_248;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_249 = __VLS_asFunctionalComponent1(__VLS_248, new __VLS_248({
        label: "标签",
        width: "150",
    }));
    const __VLS_250 = __VLS_249({
        label: "标签",
        width: "150",
    }, ...__VLS_functionalComponentArgsRest(__VLS_249));
    const { default: __VLS_253 } = __VLS_251.slots;
    {
        const { default: __VLS_254 } = __VLS_251.slots;
        const [{ row }] = __VLS_vSlot(__VLS_254);
        for (const [t] of __VLS_vFor((row.tags.slice(0, 2)))) {
            let __VLS_255;
            /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
            elTag;
            // @ts-ignore
            const __VLS_256 = __VLS_asFunctionalComponent1(__VLS_255, new __VLS_255({
                key: (t),
                round: true,
            }));
            const __VLS_257 = __VLS_256({
                key: (t),
                round: true,
            }, ...__VLS_functionalComponentArgsRest(__VLS_256));
            const { default: __VLS_260 } = __VLS_258.slots;
            (t);
            // @ts-ignore
            [];
            var __VLS_258;
            // @ts-ignore
            [];
        }
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_251;
    let __VLS_261;
    /** @ts-ignore @type { | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column'] | typeof __VLS_components.elTableColumn | typeof __VLS_components.ElTableColumn | typeof __VLS_components['el-table-column']} */
    elTableColumn;
    // @ts-ignore
    const __VLS_262 = __VLS_asFunctionalComponent1(__VLS_261, new __VLS_261({
        label: "",
        width: "74",
    }));
    const __VLS_263 = __VLS_262({
        label: "",
        width: "74",
    }, ...__VLS_functionalComponentArgsRest(__VLS_262));
    const { default: __VLS_266 } = __VLS_264.slots;
    {
        const { default: __VLS_267 } = __VLS_264.slots;
        const [{ row }] = __VLS_vSlot(__VLS_267);
        let __VLS_268;
        /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
        elButton;
        // @ts-ignore
        const __VLS_269 = __VLS_asFunctionalComponent1(__VLS_268, new __VLS_268({
            ...{ 'onClick': {} },
            text: true,
        }));
        const __VLS_270 = __VLS_269({
            ...{ 'onClick': {} },
            text: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_269));
        let __VLS_273;
        const __VLS_274 = {
            /** @type {typeof __VLS_273.click} */
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
        const { default: __VLS_275 } = __VLS_271.slots;
        // @ts-ignore
        [];
        var __VLS_271;
        var __VLS_272;
        // @ts-ignore
        [];
    }
    // @ts-ignore
    [];
    var __VLS_264;
    // @ts-ignore
    [];
    var __VLS_208;
    var __VLS_209;
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
    for (const [s] of __VLS_vFor((__VLS_ctx.data.sources))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            key: (s.id),
            ...{ class: "source-row" },
        });
        /** @type {__VLS_StyleScopedClasses['source-row']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (s.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (s.mode === 'pack' ? '技能包' : '单个技能');
        (__VLS_ctx.data.skills.filter((k) => k.sourceId === s.id).length);
        let __VLS_276;
        /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
        elButton;
        // @ts-ignore
        const __VLS_277 = __VLS_asFunctionalComponent1(__VLS_276, new __VLS_276({
            ...{ 'onClick': {} },
            text: true,
            type: "danger",
        }));
        const __VLS_278 = __VLS_277({
            ...{ 'onClick': {} },
            text: true,
            type: "danger",
        }, ...__VLS_functionalComponentArgsRest(__VLS_277));
        let __VLS_281;
        const __VLS_282 = {
            /** @type {typeof __VLS_281.click} */
            onClick: (...[$event]) => {
                if (!!(__VLS_ctx.tab === 'overview'))
                    throw 0;
                if (!!(__VLS_ctx.tab === 'projects'))
                    throw 0;
                if (!(__VLS_ctx.tab === 'skills'))
                    throw 0;
                return (__VLS_ctx.confirmDelete('sources', s));
                // @ts-ignore
                [data, data, data, confirmDelete,];
            },
        };
        const { default: __VLS_283 } = __VLS_279.slots;
        // @ts-ignore
        [];
        var __VLS_279;
        var __VLS_280;
        // @ts-ignore
        [];
    }
    let __VLS_284;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_285 = __VLS_asFunctionalComponent1(__VLS_284, new __VLS_284({
        ...{ 'onClick': {} },
        ...{ class: "full" },
        plain: true,
        icon: (__VLS_ctx.Plus),
    }));
    const __VLS_286 = __VLS_285({
        ...{ 'onClick': {} },
        ...{ class: "full" },
        plain: true,
        icon: (__VLS_ctx.Plus),
    }, ...__VLS_functionalComponentArgsRest(__VLS_285));
    let __VLS_289;
    const __VLS_290 = {
        /** @type {typeof __VLS_289.click} */
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
    const { default: __VLS_291 } = __VLS_287.slots;
    // @ts-ignore
    [];
    var __VLS_287;
    var __VLS_288;
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
    let __VLS_292;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_293 = __VLS_asFunctionalComponent1(__VLS_292, new __VLS_292({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.Plus),
    }));
    const __VLS_294 = __VLS_293({
        ...{ 'onClick': {} },
        type: "primary",
        icon: (__VLS_ctx.Plus),
    }, ...__VLS_functionalComponentArgsRest(__VLS_293));
    let __VLS_297;
    const __VLS_298 = {
        /** @type {typeof __VLS_297.click} */
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
    const { default: __VLS_299 } = __VLS_295.slots;
    // @ts-ignore
    [];
    var __VLS_295;
    var __VLS_296;
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
        let __VLS_300;
        /** @ts-ignore @type { | typeof __VLS_components.Collection} */
        Collection;
        // @ts-ignore
        const __VLS_301 = __VLS_asFunctionalComponent1(__VLS_300, new __VLS_300({}));
        const __VLS_302 = __VLS_301({}, ...__VLS_functionalComponentArgsRest(__VLS_301));
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        (b.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (b.description || '暂无说明');
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "bundle-skills" },
        });
        /** @type {__VLS_StyleScopedClasses['bundle-skills']} */ ;
        for (const [sid] of __VLS_vFor((b.skillIds.slice(0, 5)))) {
            let __VLS_305;
            /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
            elTag;
            // @ts-ignore
            const __VLS_306 = __VLS_asFunctionalComponent1(__VLS_305, new __VLS_305({
                key: (sid),
                round: true,
            }));
            const __VLS_307 = __VLS_306({
                key: (sid),
                round: true,
            }, ...__VLS_functionalComponentArgsRest(__VLS_306));
            const { default: __VLS_310 } = __VLS_308.slots;
            (__VLS_ctx.data.skills.find((s) => s.id === sid)?.name);
            // @ts-ignore
            [data, data,];
            var __VLS_308;
            // @ts-ignore
            [];
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.footer, __VLS_intrinsics.footer)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (b.skillIds.length);
        (b.projectIds.length);
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        let __VLS_311;
        /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
        elButton;
        // @ts-ignore
        const __VLS_312 = __VLS_asFunctionalComponent1(__VLS_311, new __VLS_311({
            ...{ 'onClick': {} },
            text: true,
        }));
        const __VLS_313 = __VLS_312({
            ...{ 'onClick': {} },
            text: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_312));
        let __VLS_316;
        const __VLS_317 = {
            /** @type {typeof __VLS_316.click} */
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
            text: true,
            type: "danger",
        }));
        const __VLS_321 = __VLS_320({
            ...{ 'onClick': {} },
            text: true,
            type: "danger",
        }, ...__VLS_functionalComponentArgsRest(__VLS_320));
        let __VLS_324;
        const __VLS_325 = {
            /** @type {typeof __VLS_324.click} */
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
        const { default: __VLS_326 } = __VLS_322.slots;
        // @ts-ignore
        [];
        var __VLS_322;
        var __VLS_323;
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
    let __VLS_327;
    /** @ts-ignore @type { | typeof __VLS_components.Plus} */
    Plus;
    // @ts-ignore
    const __VLS_328 = __VLS_asFunctionalComponent1(__VLS_327, new __VLS_327({}));
    const __VLS_329 = __VLS_328({}, ...__VLS_functionalComponentArgsRest(__VLS_328));
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
    let __VLS_332;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_333 = __VLS_asFunctionalComponent1(__VLS_332, new __VLS_332({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.Refresh),
    }));
    const __VLS_334 = __VLS_333({
        ...{ 'onClick': {} },
        icon: (__VLS_ctx.Refresh),
    }, ...__VLS_functionalComponentArgsRest(__VLS_333));
    let __VLS_337;
    const __VLS_338 = {
        /** @type {typeof __VLS_337.click} */
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
    const { default: __VLS_339 } = __VLS_335.slots;
    // @ts-ignore
    [];
    var __VLS_335;
    var __VLS_336;
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
        let __VLS_340;
        /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
        elTag;
        // @ts-ignore
        const __VLS_341 = __VLS_asFunctionalComponent1(__VLS_340, new __VLS_340({
            type: (a.level === 'error' ? 'danger' : 'warning'),
            round: true,
        }));
        const __VLS_342 = __VLS_341({
            type: (a.level === 'error' ? 'danger' : 'warning'),
            round: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_341));
        const { default: __VLS_345 } = __VLS_343.slots;
        (a.type);
        // @ts-ignore
        [data,];
        var __VLS_343;
        // @ts-ignore
        [];
    }
    if (!__VLS_ctx.data.audit.length) {
        let __VLS_346;
        /** @ts-ignore @type { | typeof __VLS_components.elEmpty | typeof __VLS_components.ElEmpty | typeof __VLS_components['el-empty']} */
        elEmpty;
        // @ts-ignore
        const __VLS_347 = __VLS_asFunctionalComponent1(__VLS_346, new __VLS_346({
            description: "没有发现问题，当前状态健康",
        }));
        const __VLS_348 = __VLS_347({
            description: "没有发现问题，当前状态健康",
        }, ...__VLS_functionalComponentArgsRest(__VLS_347));
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
        let __VLS_351;
        /** @ts-ignore @type { | typeof __VLS_components.Clock} */
        Clock;
        // @ts-ignore
        const __VLS_352 = __VLS_asFunctionalComponent1(__VLS_351, new __VLS_351({}));
        const __VLS_353 = __VLS_352({}, ...__VLS_functionalComponentArgsRest(__VLS_352));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.b, __VLS_intrinsics.b)({});
        (h.kind === 'apply' ? '应用软链接变更' : '系统操作');
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (new Date(h.created_at).toLocaleString());
        (h.details?.completed?.length || 0);
        let __VLS_356;
        /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
        elTag;
        // @ts-ignore
        const __VLS_357 = __VLS_asFunctionalComponent1(__VLS_356, new __VLS_356({
            type: (h.status === 'success' ? 'success' : 'warning'),
            round: true,
        }));
        const __VLS_358 = __VLS_357({
            type: (h.status === 'success' ? 'success' : 'warning'),
            round: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_357));
        const { default: __VLS_361 } = __VLS_359.slots;
        (h.undone_at ? '已撤销' : h.status);
        // @ts-ignore
        [tab, data, data,];
        var __VLS_359;
        if (h.status === 'success' && !h.undone_at) {
            let __VLS_362;
            /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
            elButton;
            // @ts-ignore
            const __VLS_363 = __VLS_asFunctionalComponent1(__VLS_362, new __VLS_362({
                ...{ 'onClick': {} },
            }));
            const __VLS_364 = __VLS_363({
                ...{ 'onClick': {} },
            }, ...__VLS_functionalComponentArgsRest(__VLS_363));
            let __VLS_367;
            const __VLS_368 = {
                /** @type {typeof __VLS_367.click} */
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
            const { default: __VLS_369 } = __VLS_365.slots;
            // @ts-ignore
            [];
            var __VLS_365;
            var __VLS_366;
        }
        // @ts-ignore
        [];
    }
    if (!__VLS_ctx.data.history.length) {
        let __VLS_370;
        /** @ts-ignore @type { | typeof __VLS_components.elEmpty | typeof __VLS_components.ElEmpty | typeof __VLS_components['el-empty']} */
        elEmpty;
        // @ts-ignore
        const __VLS_371 = __VLS_asFunctionalComponent1(__VLS_370, new __VLS_370({
            description: "还没有操作记录",
        }));
        const __VLS_372 = __VLS_371({
            description: "还没有操作记录",
        }, ...__VLS_functionalComponentArgsRest(__VLS_371));
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
    let __VLS_375;
    /** @ts-ignore @type { | typeof __VLS_components.Monitor} */
    Monitor;
    // @ts-ignore
    const __VLS_376 = __VLS_asFunctionalComponent1(__VLS_375, new __VLS_375({}));
    const __VLS_377 = __VLS_376({}, ...__VLS_functionalComponentArgsRest(__VLS_376));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_380;
    /** @ts-ignore @type { | typeof __VLS_components.elSegmented | typeof __VLS_components.ElSegmented | typeof __VLS_components['el-segmented']} */
    elSegmented;
    // @ts-ignore
    const __VLS_381 = __VLS_asFunctionalComponent1(__VLS_380, new __VLS_380({
        modelValue: (__VLS_ctx.themeMode),
        options: (__VLS_ctx.themeOptions),
        'aria-label': "外观模式",
    }));
    const __VLS_382 = __VLS_381({
        modelValue: (__VLS_ctx.themeMode),
        options: (__VLS_ctx.themeOptions),
        'aria-label': "外观模式",
    }, ...__VLS_functionalComponentArgsRest(__VLS_381));
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "setting-card glass" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-icon']} */ ;
    let __VLS_385;
    /** @ts-ignore @type { | typeof __VLS_components.Download} */
    Download;
    // @ts-ignore
    const __VLS_386 = __VLS_asFunctionalComponent1(__VLS_385, new __VLS_385({}));
    const __VLS_387 = __VLS_386({}, ...__VLS_functionalComponentArgsRest(__VLS_386));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_390;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_391 = __VLS_asFunctionalComponent1(__VLS_390, new __VLS_390({
        ...{ 'onClick': {} },
    }));
    const __VLS_392 = __VLS_391({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_391));
    let __VLS_395;
    const __VLS_396 = {
        /** @type {typeof __VLS_395.click} */
        onClick: (__VLS_ctx.exportConfig),
    };
    const { default: __VLS_397 } = __VLS_393.slots;
    // @ts-ignore
    [data, themeMode, themeOptions, exportConfig,];
    var __VLS_393;
    var __VLS_394;
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "setting-card glass" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-icon']} */ ;
    let __VLS_398;
    /** @ts-ignore @type { | typeof __VLS_components.Upload} */
    Upload;
    // @ts-ignore
    const __VLS_399 = __VLS_asFunctionalComponent1(__VLS_398, new __VLS_398({}));
    const __VLS_400 = __VLS_399({}, ...__VLS_functionalComponentArgsRest(__VLS_399));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_403;
    /** @ts-ignore @type { | typeof __VLS_components.elUpload | typeof __VLS_components.ElUpload | typeof __VLS_components['el-upload'] | typeof __VLS_components.elUpload | typeof __VLS_components.ElUpload | typeof __VLS_components['el-upload']} */
    elUpload;
    // @ts-ignore
    const __VLS_404 = __VLS_asFunctionalComponent1(__VLS_403, new __VLS_403({
        showFileList: (false),
        accept: "application/json",
        beforeUpload: (__VLS_ctx.importConfig),
    }));
    const __VLS_405 = __VLS_404({
        showFileList: (false),
        accept: "application/json",
        beforeUpload: (__VLS_ctx.importConfig),
    }, ...__VLS_functionalComponentArgsRest(__VLS_404));
    const { default: __VLS_408 } = __VLS_406.slots;
    let __VLS_409;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_410 = __VLS_asFunctionalComponent1(__VLS_409, new __VLS_409({}));
    const __VLS_411 = __VLS_410({}, ...__VLS_functionalComponentArgsRest(__VLS_410));
    const { default: __VLS_414 } = __VLS_412.slots;
    // @ts-ignore
    [importConfig,];
    var __VLS_412;
    // @ts-ignore
    [];
    var __VLS_406;
}
let __VLS_415;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_416 = __VLS_asFunctionalComponent1(__VLS_415, new __VLS_415({
    modelValue: (__VLS_ctx.projectDialog),
    title: "添加项目",
    width: "560",
}));
const __VLS_417 = __VLS_416({
    modelValue: (__VLS_ctx.projectDialog),
    title: "添加项目",
    width: "560",
}, ...__VLS_functionalComponentArgsRest(__VLS_416));
const { default: __VLS_420 } = __VLS_418.slots;
let __VLS_421;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_422 = __VLS_asFunctionalComponent1(__VLS_421, new __VLS_421({
    labelPosition: "top",
}));
const __VLS_423 = __VLS_422({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_422));
const { default: __VLS_426 } = __VLS_424.slots;
let __VLS_427;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_428 = __VLS_asFunctionalComponent1(__VLS_427, new __VLS_427({
    label: "项目目录",
}));
const __VLS_429 = __VLS_428({
    label: "项目目录",
}, ...__VLS_functionalComponentArgsRest(__VLS_428));
const { default: __VLS_432 } = __VLS_430.slots;
let __VLS_433;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input'] | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_434 = __VLS_asFunctionalComponent1(__VLS_433, new __VLS_433({
    modelValue: (__VLS_ctx.projectForm.path),
    placeholder: "选择任意本地项目目录",
}));
const __VLS_435 = __VLS_434({
    modelValue: (__VLS_ctx.projectForm.path),
    placeholder: "选择任意本地项目目录",
}, ...__VLS_functionalComponentArgsRest(__VLS_434));
const { default: __VLS_438 } = __VLS_436.slots;
{
    const { append: __VLS_439 } = __VLS_436.slots;
    let __VLS_440;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_441 = __VLS_asFunctionalComponent1(__VLS_440, new __VLS_440({
        ...{ 'onClick': {} },
    }));
    const __VLS_442 = __VLS_441({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_441));
    let __VLS_445;
    const __VLS_446 = {
        /** @type {typeof __VLS_445.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.choose(__VLS_ctx.projectForm, '选择要管理的项目目录'));
            // @ts-ignore
            [projectDialog, projectForm, projectForm, choose,];
        },
    };
    const { default: __VLS_447 } = __VLS_443.slots;
    // @ts-ignore
    [];
    var __VLS_443;
    var __VLS_444;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_436;
// @ts-ignore
[];
var __VLS_430;
let __VLS_448;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_449 = __VLS_asFunctionalComponent1(__VLS_448, new __VLS_448({
    label: "显示名称（可选）",
}));
const __VLS_450 = __VLS_449({
    label: "显示名称（可选）",
}, ...__VLS_functionalComponentArgsRest(__VLS_449));
const { default: __VLS_453 } = __VLS_451.slots;
let __VLS_454;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_455 = __VLS_asFunctionalComponent1(__VLS_454, new __VLS_454({
    modelValue: (__VLS_ctx.projectForm.name),
    placeholder: "默认使用目录名",
}));
const __VLS_456 = __VLS_455({
    modelValue: (__VLS_ctx.projectForm.name),
    placeholder: "默认使用目录名",
}, ...__VLS_functionalComponentArgsRest(__VLS_455));
// @ts-ignore
[projectForm,];
var __VLS_451;
// @ts-ignore
[];
var __VLS_424;
{
    const { footer: __VLS_459 } = __VLS_418.slots;
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
            return (__VLS_ctx.projectDialog = false);
            // @ts-ignore
            [projectDialog,];
        },
    };
    const { default: __VLS_467 } = __VLS_463.slots;
    // @ts-ignore
    [];
    var __VLS_463;
    var __VLS_464;
    let __VLS_468;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_469 = __VLS_asFunctionalComponent1(__VLS_468, new __VLS_468({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.projectForm.path),
    }));
    const __VLS_470 = __VLS_469({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.projectForm.path),
    }, ...__VLS_functionalComponentArgsRest(__VLS_469));
    let __VLS_473;
    const __VLS_474 = {
        /** @type {typeof __VLS_473.click} */
        onClick: (__VLS_ctx.addProject),
    };
    const { default: __VLS_475 } = __VLS_471.slots;
    // @ts-ignore
    [projectForm, addProject,];
    var __VLS_471;
    var __VLS_472;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_418;
let __VLS_476;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_477 = __VLS_asFunctionalComponent1(__VLS_476, new __VLS_476({
    modelValue: (__VLS_ctx.sourceDialog),
    title: "添加技能源",
    width: "560",
}));
const __VLS_478 = __VLS_477({
    modelValue: (__VLS_ctx.sourceDialog),
    title: "添加技能源",
    width: "560",
}, ...__VLS_functionalComponentArgsRest(__VLS_477));
const { default: __VLS_481 } = __VLS_479.slots;
let __VLS_482;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_483 = __VLS_asFunctionalComponent1(__VLS_482, new __VLS_482({
    labelPosition: "top",
}));
const __VLS_484 = __VLS_483({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_483));
const { default: __VLS_487 } = __VLS_485.slots;
let __VLS_488;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_489 = __VLS_asFunctionalComponent1(__VLS_488, new __VLS_488({
    label: "来源类型",
}));
const __VLS_490 = __VLS_489({
    label: "来源类型",
}, ...__VLS_functionalComponentArgsRest(__VLS_489));
const { default: __VLS_493 } = __VLS_491.slots;
let __VLS_494;
/** @ts-ignore @type { | typeof __VLS_components.elRadioGroup | typeof __VLS_components.ElRadioGroup | typeof __VLS_components['el-radio-group'] | typeof __VLS_components.elRadioGroup | typeof __VLS_components.ElRadioGroup | typeof __VLS_components['el-radio-group']} */
elRadioGroup;
// @ts-ignore
const __VLS_495 = __VLS_asFunctionalComponent1(__VLS_494, new __VLS_494({
    modelValue: (__VLS_ctx.sourceForm.mode),
}));
const __VLS_496 = __VLS_495({
    modelValue: (__VLS_ctx.sourceForm.mode),
}, ...__VLS_functionalComponentArgsRest(__VLS_495));
const { default: __VLS_499 } = __VLS_497.slots;
let __VLS_500;
/** @ts-ignore @type { | typeof __VLS_components.elRadioButton | typeof __VLS_components.ElRadioButton | typeof __VLS_components['el-radio-button'] | typeof __VLS_components.elRadioButton | typeof __VLS_components.ElRadioButton | typeof __VLS_components['el-radio-button']} */
elRadioButton;
// @ts-ignore
const __VLS_501 = __VLS_asFunctionalComponent1(__VLS_500, new __VLS_500({
    value: "pack",
}));
const __VLS_502 = __VLS_501({
    value: "pack",
}, ...__VLS_functionalComponentArgsRest(__VLS_501));
const { default: __VLS_505 } = __VLS_503.slots;
// @ts-ignore
[sourceDialog, sourceForm,];
var __VLS_503;
let __VLS_506;
/** @ts-ignore @type { | typeof __VLS_components.elRadioButton | typeof __VLS_components.ElRadioButton | typeof __VLS_components['el-radio-button'] | typeof __VLS_components.elRadioButton | typeof __VLS_components.ElRadioButton | typeof __VLS_components['el-radio-button']} */
elRadioButton;
// @ts-ignore
const __VLS_507 = __VLS_asFunctionalComponent1(__VLS_506, new __VLS_506({
    value: "single",
}));
const __VLS_508 = __VLS_507({
    value: "single",
}, ...__VLS_functionalComponentArgsRest(__VLS_507));
const { default: __VLS_511 } = __VLS_509.slots;
// @ts-ignore
[];
var __VLS_509;
// @ts-ignore
[];
var __VLS_497;
// @ts-ignore
[];
var __VLS_491;
let __VLS_512;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_513 = __VLS_asFunctionalComponent1(__VLS_512, new __VLS_512({
    label: "目录",
}));
const __VLS_514 = __VLS_513({
    label: "目录",
}, ...__VLS_functionalComponentArgsRest(__VLS_513));
const { default: __VLS_517 } = __VLS_515.slots;
let __VLS_518;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input'] | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_519 = __VLS_asFunctionalComponent1(__VLS_518, new __VLS_518({
    modelValue: (__VLS_ctx.sourceForm.path),
    placeholder: "选择含 SKILL.md 的技能或技能包",
}));
const __VLS_520 = __VLS_519({
    modelValue: (__VLS_ctx.sourceForm.path),
    placeholder: "选择含 SKILL.md 的技能或技能包",
}, ...__VLS_functionalComponentArgsRest(__VLS_519));
const { default: __VLS_523 } = __VLS_521.slots;
{
    const { append: __VLS_524 } = __VLS_521.slots;
    let __VLS_525;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_526 = __VLS_asFunctionalComponent1(__VLS_525, new __VLS_525({
        ...{ 'onClick': {} },
    }));
    const __VLS_527 = __VLS_526({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_526));
    let __VLS_530;
    const __VLS_531 = {
        /** @type {typeof __VLS_530.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.choose(__VLS_ctx.sourceForm, '选择技能或技能包目录'));
            // @ts-ignore
            [choose, sourceForm, sourceForm,];
        },
    };
    const { default: __VLS_532 } = __VLS_528.slots;
    // @ts-ignore
    [];
    var __VLS_528;
    var __VLS_529;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_521;
// @ts-ignore
[];
var __VLS_515;
let __VLS_533;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_534 = __VLS_asFunctionalComponent1(__VLS_533, new __VLS_533({
    label: "来源名称（可选）",
}));
const __VLS_535 = __VLS_534({
    label: "来源名称（可选）",
}, ...__VLS_functionalComponentArgsRest(__VLS_534));
const { default: __VLS_538 } = __VLS_536.slots;
let __VLS_539;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_540 = __VLS_asFunctionalComponent1(__VLS_539, new __VLS_539({
    modelValue: (__VLS_ctx.sourceForm.name),
    placeholder: "默认使用目录名",
}));
const __VLS_541 = __VLS_540({
    modelValue: (__VLS_ctx.sourceForm.name),
    placeholder: "默认使用目录名",
}, ...__VLS_functionalComponentArgsRest(__VLS_540));
// @ts-ignore
[sourceForm,];
var __VLS_536;
// @ts-ignore
[];
var __VLS_485;
{
    const { footer: __VLS_544 } = __VLS_479.slots;
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
            return (__VLS_ctx.sourceDialog = false);
            // @ts-ignore
            [sourceDialog,];
        },
    };
    const { default: __VLS_552 } = __VLS_548.slots;
    // @ts-ignore
    [];
    var __VLS_548;
    var __VLS_549;
    let __VLS_553;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_554 = __VLS_asFunctionalComponent1(__VLS_553, new __VLS_553({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.sourceForm.path),
    }));
    const __VLS_555 = __VLS_554({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.sourceForm.path),
    }, ...__VLS_functionalComponentArgsRest(__VLS_554));
    let __VLS_558;
    const __VLS_559 = {
        /** @type {typeof __VLS_558.click} */
        onClick: (__VLS_ctx.addSource),
    };
    const { default: __VLS_560 } = __VLS_556.slots;
    // @ts-ignore
    [sourceForm, addSource,];
    var __VLS_556;
    var __VLS_557;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_479;
let __VLS_561;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_562 = __VLS_asFunctionalComponent1(__VLS_561, new __VLS_561({
    modelValue: (__VLS_ctx.bundleDialog),
    title: "新建技能组合",
    width: "620",
}));
const __VLS_563 = __VLS_562({
    modelValue: (__VLS_ctx.bundleDialog),
    title: "新建技能组合",
    width: "620",
}, ...__VLS_functionalComponentArgsRest(__VLS_562));
const { default: __VLS_566 } = __VLS_564.slots;
let __VLS_567;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_568 = __VLS_asFunctionalComponent1(__VLS_567, new __VLS_567({
    labelPosition: "top",
}));
const __VLS_569 = __VLS_568({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_568));
const { default: __VLS_572 } = __VLS_570.slots;
let __VLS_573;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_574 = __VLS_asFunctionalComponent1(__VLS_573, new __VLS_573({
    label: "组合名称",
}));
const __VLS_575 = __VLS_574({
    label: "组合名称",
}, ...__VLS_functionalComponentArgsRest(__VLS_574));
const { default: __VLS_578 } = __VLS_576.slots;
let __VLS_579;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_580 = __VLS_asFunctionalComponent1(__VLS_579, new __VLS_579({
    modelValue: (__VLS_ctx.bundleForm.name),
}));
const __VLS_581 = __VLS_580({
    modelValue: (__VLS_ctx.bundleForm.name),
}, ...__VLS_functionalComponentArgsRest(__VLS_580));
// @ts-ignore
[bundleDialog, bundleForm,];
var __VLS_576;
let __VLS_584;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_585 = __VLS_asFunctionalComponent1(__VLS_584, new __VLS_584({
    label: "说明",
}));
const __VLS_586 = __VLS_585({
    label: "说明",
}, ...__VLS_functionalComponentArgsRest(__VLS_585));
const { default: __VLS_589 } = __VLS_587.slots;
let __VLS_590;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_591 = __VLS_asFunctionalComponent1(__VLS_590, new __VLS_590({
    modelValue: (__VLS_ctx.bundleForm.description),
    type: "textarea",
}));
const __VLS_592 = __VLS_591({
    modelValue: (__VLS_ctx.bundleForm.description),
    type: "textarea",
}, ...__VLS_functionalComponentArgsRest(__VLS_591));
// @ts-ignore
[bundleForm,];
var __VLS_587;
let __VLS_595;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_596 = __VLS_asFunctionalComponent1(__VLS_595, new __VLS_595({
    label: "包含技能",
}));
const __VLS_597 = __VLS_596({
    label: "包含技能",
}, ...__VLS_functionalComponentArgsRest(__VLS_596));
const { default: __VLS_600 } = __VLS_598.slots;
let __VLS_601;
/** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
elSelect;
// @ts-ignore
const __VLS_602 = __VLS_asFunctionalComponent1(__VLS_601, new __VLS_601({
    modelValue: (__VLS_ctx.bundleForm.skillIds),
    multiple: true,
    filterable: true,
    collapseTags: true,
    placeholder: "选择技能",
    ...{ style: {} },
}));
const __VLS_603 = __VLS_602({
    modelValue: (__VLS_ctx.bundleForm.skillIds),
    multiple: true,
    filterable: true,
    collapseTags: true,
    placeholder: "选择技能",
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_602));
const { default: __VLS_606 } = __VLS_604.slots;
for (const [s] of __VLS_vFor((__VLS_ctx.data.skills))) {
    let __VLS_607;
    /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
    elOption;
    // @ts-ignore
    const __VLS_608 = __VLS_asFunctionalComponent1(__VLS_607, new __VLS_607({
        key: (s.id),
        label: (s.name),
        value: (s.id),
    }));
    const __VLS_609 = __VLS_608({
        key: (s.id),
        label: (s.name),
        value: (s.id),
    }, ...__VLS_functionalComponentArgsRest(__VLS_608));
    // @ts-ignore
    [data, bundleForm,];
}
// @ts-ignore
[];
var __VLS_604;
// @ts-ignore
[];
var __VLS_598;
// @ts-ignore
[];
var __VLS_570;
{
    const { footer: __VLS_612 } = __VLS_564.slots;
    let __VLS_613;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_614 = __VLS_asFunctionalComponent1(__VLS_613, new __VLS_613({
        ...{ 'onClick': {} },
    }));
    const __VLS_615 = __VLS_614({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_614));
    let __VLS_618;
    const __VLS_619 = {
        /** @type {typeof __VLS_618.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.bundleDialog = false);
            // @ts-ignore
            [bundleDialog,];
        },
    };
    const { default: __VLS_620 } = __VLS_616.slots;
    // @ts-ignore
    [];
    var __VLS_616;
    var __VLS_617;
    let __VLS_621;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_622 = __VLS_asFunctionalComponent1(__VLS_621, new __VLS_621({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleForm.name),
    }));
    const __VLS_623 = __VLS_622({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleForm.name),
    }, ...__VLS_functionalComponentArgsRest(__VLS_622));
    let __VLS_626;
    const __VLS_627 = {
        /** @type {typeof __VLS_626.click} */
        onClick: (__VLS_ctx.createBundle),
    };
    const { default: __VLS_628 } = __VLS_624.slots;
    // @ts-ignore
    [bundleForm, createBundle,];
    var __VLS_624;
    var __VLS_625;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_564;
let __VLS_629;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_630 = __VLS_asFunctionalComponent1(__VLS_629, new __VLS_629({
    modelValue: (__VLS_ctx.groupDialog),
    title: "新建项目组",
    width: "480",
}));
const __VLS_631 = __VLS_630({
    modelValue: (__VLS_ctx.groupDialog),
    title: "新建项目组",
    width: "480",
}, ...__VLS_functionalComponentArgsRest(__VLS_630));
const { default: __VLS_634 } = __VLS_632.slots;
let __VLS_635;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_636 = __VLS_asFunctionalComponent1(__VLS_635, new __VLS_635({
    labelPosition: "top",
}));
const __VLS_637 = __VLS_636({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_636));
const { default: __VLS_640 } = __VLS_638.slots;
let __VLS_641;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_642 = __VLS_asFunctionalComponent1(__VLS_641, new __VLS_641({
    label: "项目组名称",
}));
const __VLS_643 = __VLS_642({
    label: "项目组名称",
}, ...__VLS_functionalComponentArgsRest(__VLS_642));
const { default: __VLS_646 } = __VLS_644.slots;
let __VLS_647;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_648 = __VLS_asFunctionalComponent1(__VLS_647, new __VLS_647({
    modelValue: (__VLS_ctx.groupForm.name),
}));
const __VLS_649 = __VLS_648({
    modelValue: (__VLS_ctx.groupForm.name),
}, ...__VLS_functionalComponentArgsRest(__VLS_648));
// @ts-ignore
[groupDialog, groupForm,];
var __VLS_644;
let __VLS_652;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_653 = __VLS_asFunctionalComponent1(__VLS_652, new __VLS_652({
    label: "标识颜色",
}));
const __VLS_654 = __VLS_653({
    label: "标识颜色",
}, ...__VLS_functionalComponentArgsRest(__VLS_653));
const { default: __VLS_657 } = __VLS_655.slots;
let __VLS_658;
/** @ts-ignore @type { | typeof __VLS_components.elColorPicker | typeof __VLS_components.ElColorPicker | typeof __VLS_components['el-color-picker']} */
elColorPicker;
// @ts-ignore
const __VLS_659 = __VLS_asFunctionalComponent1(__VLS_658, new __VLS_658({
    modelValue: (__VLS_ctx.groupForm.color),
}));
const __VLS_660 = __VLS_659({
    modelValue: (__VLS_ctx.groupForm.color),
}, ...__VLS_functionalComponentArgsRest(__VLS_659));
// @ts-ignore
[groupForm,];
var __VLS_655;
// @ts-ignore
[];
var __VLS_638;
{
    const { footer: __VLS_663 } = __VLS_632.slots;
    let __VLS_664;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_665 = __VLS_asFunctionalComponent1(__VLS_664, new __VLS_664({
        ...{ 'onClick': {} },
    }));
    const __VLS_666 = __VLS_665({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_665));
    let __VLS_669;
    const __VLS_670 = {
        /** @type {typeof __VLS_669.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.groupDialog = false);
            // @ts-ignore
            [groupDialog,];
        },
    };
    const { default: __VLS_671 } = __VLS_667.slots;
    // @ts-ignore
    [];
    var __VLS_667;
    var __VLS_668;
    let __VLS_672;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_673 = __VLS_asFunctionalComponent1(__VLS_672, new __VLS_672({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.groupForm.name),
    }));
    const __VLS_674 = __VLS_673({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.groupForm.name),
    }, ...__VLS_functionalComponentArgsRest(__VLS_673));
    let __VLS_677;
    const __VLS_678 = {
        /** @type {typeof __VLS_677.click} */
        onClick: (__VLS_ctx.createGroup),
    };
    const { default: __VLS_679 } = __VLS_675.slots;
    // @ts-ignore
    [groupForm, createGroup,];
    var __VLS_675;
    var __VLS_676;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_632;
let __VLS_680;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_681 = __VLS_asFunctionalComponent1(__VLS_680, new __VLS_680({
    modelValue: (__VLS_ctx.skillDialog),
    title: "编辑技能",
    width: "520",
}));
const __VLS_682 = __VLS_681({
    modelValue: (__VLS_ctx.skillDialog),
    title: "编辑技能",
    width: "520",
}, ...__VLS_functionalComponentArgsRest(__VLS_681));
const { default: __VLS_685 } = __VLS_683.slots;
let __VLS_686;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_687 = __VLS_asFunctionalComponent1(__VLS_686, new __VLS_686({
    labelPosition: "top",
}));
const __VLS_688 = __VLS_687({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_687));
const { default: __VLS_691 } = __VLS_689.slots;
let __VLS_692;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_693 = __VLS_asFunctionalComponent1(__VLS_692, new __VLS_692({
    label: "项目内链接名",
}));
const __VLS_694 = __VLS_693({
    label: "项目内链接名",
}, ...__VLS_functionalComponentArgsRest(__VLS_693));
const { default: __VLS_697 } = __VLS_695.slots;
let __VLS_698;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_699 = __VLS_asFunctionalComponent1(__VLS_698, new __VLS_698({
    modelValue: (__VLS_ctx.skillForm.alias),
}));
const __VLS_700 = __VLS_699({
    modelValue: (__VLS_ctx.skillForm.alias),
}, ...__VLS_functionalComponentArgsRest(__VLS_699));
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "el-form-item__description" },
});
/** @type {__VLS_StyleScopedClasses['el-form-item__description']} */ ;
// @ts-ignore
[skillDialog, skillForm,];
var __VLS_695;
let __VLS_703;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_704 = __VLS_asFunctionalComponent1(__VLS_703, new __VLS_703({
    label: "标签",
}));
const __VLS_705 = __VLS_704({
    label: "标签",
}, ...__VLS_functionalComponentArgsRest(__VLS_704));
const { default: __VLS_708 } = __VLS_706.slots;
let __VLS_709;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_710 = __VLS_asFunctionalComponent1(__VLS_709, new __VLS_709({
    modelValue: (__VLS_ctx.skillForm.tags),
    placeholder: "用逗号分隔，例如：论文, 前端, 常用",
}));
const __VLS_711 = __VLS_710({
    modelValue: (__VLS_ctx.skillForm.tags),
    placeholder: "用逗号分隔，例如：论文, 前端, 常用",
}, ...__VLS_functionalComponentArgsRest(__VLS_710));
// @ts-ignore
[skillForm,];
var __VLS_706;
// @ts-ignore
[];
var __VLS_689;
{
    const { footer: __VLS_714 } = __VLS_683.slots;
    let __VLS_715;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_716 = __VLS_asFunctionalComponent1(__VLS_715, new __VLS_715({
        ...{ 'onClick': {} },
    }));
    const __VLS_717 = __VLS_716({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_716));
    let __VLS_720;
    const __VLS_721 = {
        /** @type {typeof __VLS_720.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.skillDialog = false);
            // @ts-ignore
            [skillDialog,];
        },
    };
    const { default: __VLS_722 } = __VLS_718.slots;
    // @ts-ignore
    [];
    var __VLS_718;
    var __VLS_719;
    let __VLS_723;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_724 = __VLS_asFunctionalComponent1(__VLS_723, new __VLS_723({
        ...{ 'onClick': {} },
        type: "primary",
    }));
    const __VLS_725 = __VLS_724({
        ...{ 'onClick': {} },
        type: "primary",
    }, ...__VLS_functionalComponentArgsRest(__VLS_724));
    let __VLS_728;
    const __VLS_729 = {
        /** @type {typeof __VLS_728.click} */
        onClick: (__VLS_ctx.saveSkill),
    };
    const { default: __VLS_730 } = __VLS_726.slots;
    // @ts-ignore
    [saveSkill,];
    var __VLS_726;
    var __VLS_727;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_683;
let __VLS_731;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_732 = __VLS_asFunctionalComponent1(__VLS_731, new __VLS_731({
    modelValue: (__VLS_ctx.bundleApplyDialog),
    title: "应用技能组合",
    width: "520",
}));
const __VLS_733 = __VLS_732({
    modelValue: (__VLS_ctx.bundleApplyDialog),
    title: "应用技能组合",
    width: "520",
}, ...__VLS_functionalComponentArgsRest(__VLS_732));
const { default: __VLS_736 } = __VLS_734.slots;
let __VLS_737;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_738 = __VLS_asFunctionalComponent1(__VLS_737, new __VLS_737({
    labelPosition: "top",
}));
const __VLS_739 = __VLS_738({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_738));
const { default: __VLS_742 } = __VLS_740.slots;
let __VLS_743;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_744 = __VLS_asFunctionalComponent1(__VLS_743, new __VLS_743({
    label: "目标项目",
}));
const __VLS_745 = __VLS_744({
    label: "目标项目",
}, ...__VLS_functionalComponentArgsRest(__VLS_744));
const { default: __VLS_748 } = __VLS_746.slots;
let __VLS_749;
/** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
elSelect;
// @ts-ignore
const __VLS_750 = __VLS_asFunctionalComponent1(__VLS_749, new __VLS_749({
    modelValue: (__VLS_ctx.bundleApply.projectId),
    ...{ style: {} },
}));
const __VLS_751 = __VLS_750({
    modelValue: (__VLS_ctx.bundleApply.projectId),
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_750));
const { default: __VLS_754 } = __VLS_752.slots;
for (const [p] of __VLS_vFor((__VLS_ctx.data.projects))) {
    let __VLS_755;
    /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
    elOption;
    // @ts-ignore
    const __VLS_756 = __VLS_asFunctionalComponent1(__VLS_755, new __VLS_755({
        key: (p.id),
        label: (p.name),
        value: (p.id),
    }));
    const __VLS_757 = __VLS_756({
        key: (p.id),
        label: (p.name),
        value: (p.id),
    }, ...__VLS_functionalComponentArgsRest(__VLS_756));
    // @ts-ignore
    [data, bundleApplyDialog, bundleApply,];
}
// @ts-ignore
[];
var __VLS_752;
// @ts-ignore
[];
var __VLS_746;
// @ts-ignore
[];
var __VLS_740;
let __VLS_760;
/** @ts-ignore @type { | typeof __VLS_components.elAlert | typeof __VLS_components.ElAlert | typeof __VLS_components['el-alert']} */
elAlert;
// @ts-ignore
const __VLS_761 = __VLS_asFunctionalComponent1(__VLS_760, new __VLS_760({
    title: "应用后会持续检查该项目与组合之间的配置漂移。",
    type: "info",
    closable: (false),
}));
const __VLS_762 = __VLS_761({
    title: "应用后会持续检查该项目与组合之间的配置漂移。",
    type: "info",
    closable: (false),
}, ...__VLS_functionalComponentArgsRest(__VLS_761));
{
    const { footer: __VLS_765 } = __VLS_734.slots;
    let __VLS_766;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_767 = __VLS_asFunctionalComponent1(__VLS_766, new __VLS_766({
        ...{ 'onClick': {} },
    }));
    const __VLS_768 = __VLS_767({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_767));
    let __VLS_771;
    const __VLS_772 = {
        /** @type {typeof __VLS_771.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.bundleApplyDialog = false);
            // @ts-ignore
            [bundleApplyDialog,];
        },
    };
    const { default: __VLS_773 } = __VLS_769.slots;
    // @ts-ignore
    [];
    var __VLS_769;
    var __VLS_770;
    let __VLS_774;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_775 = __VLS_asFunctionalComponent1(__VLS_774, new __VLS_774({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleApply.projectId),
    }));
    const __VLS_776 = __VLS_775({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleApply.projectId),
    }, ...__VLS_functionalComponentArgsRest(__VLS_775));
    let __VLS_779;
    const __VLS_780 = {
        /** @type {typeof __VLS_779.click} */
        onClick: (__VLS_ctx.stageBundle),
    };
    const { default: __VLS_781 } = __VLS_777.slots;
    // @ts-ignore
    [bundleApply, stageBundle,];
    var __VLS_777;
    var __VLS_778;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_734;
let __VLS_782;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_783 = __VLS_asFunctionalComponent1(__VLS_782, new __VLS_782({
    modelValue: (__VLS_ctx.planDialog),
    title: "确认变更计划",
    width: "720",
}));
const __VLS_784 = __VLS_783({
    modelValue: (__VLS_ctx.planDialog),
    title: "确认变更计划",
    width: "720",
}, ...__VLS_functionalComponentArgsRest(__VLS_783));
const { default: __VLS_787 } = __VLS_785.slots;
if (__VLS_ctx.currentPlan?.warnings.length) {
    let __VLS_788;
    /** @ts-ignore @type { | typeof __VLS_components.elAlert | typeof __VLS_components.ElAlert | typeof __VLS_components['el-alert']} */
    elAlert;
    // @ts-ignore
    const __VLS_789 = __VLS_asFunctionalComponent1(__VLS_788, new __VLS_788({
        title: (`${__VLS_ctx.currentPlan.warnings.length} 项被安全跳过`),
        type: "warning",
        showIcon: true,
        closable: (false),
    }));
    const __VLS_790 = __VLS_789({
        title: (`${__VLS_ctx.currentPlan.warnings.length} 项被安全跳过`),
        type: "warning",
        showIcon: true,
        closable: (false),
    }, ...__VLS_functionalComponentArgsRest(__VLS_789));
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
    let __VLS_793;
    /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
    elTag;
    // @ts-ignore
    const __VLS_794 = __VLS_asFunctionalComponent1(__VLS_793, new __VLS_793({
        round: true,
    }));
    const __VLS_795 = __VLS_794({
        round: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_794));
    const { default: __VLS_798 } = __VLS_796.slots;
    (__VLS_ctx.planActionText[i.action]);
    // @ts-ignore
    [planDialog, currentPlan, currentPlan, currentPlan, currentPlan, planActionText,];
    var __VLS_796;
    __VLS_asFunctionalElement1(__VLS_intrinsics.code, __VLS_intrinsics.code)({});
    (i.target);
    // @ts-ignore
    [];
}
{
    const { footer: __VLS_799 } = __VLS_785.slots;
    let __VLS_800;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_801 = __VLS_asFunctionalComponent1(__VLS_800, new __VLS_800({
        ...{ 'onClick': {} },
    }));
    const __VLS_802 = __VLS_801({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_801));
    let __VLS_805;
    const __VLS_806 = {
        /** @type {typeof __VLS_805.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.planDialog = false);
            // @ts-ignore
            [planDialog,];
        },
    };
    const { default: __VLS_807 } = __VLS_803.slots;
    // @ts-ignore
    [];
    var __VLS_803;
    var __VLS_804;
    let __VLS_808;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_809 = __VLS_asFunctionalComponent1(__VLS_808, new __VLS_808({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.applying),
        disabled: (!__VLS_ctx.currentPlan?.items.length && !__VLS_ctx.currentPlan?.bundleId),
    }));
    const __VLS_810 = __VLS_809({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.applying),
        disabled: (!__VLS_ctx.currentPlan?.items.length && !__VLS_ctx.currentPlan?.bundleId),
    }, ...__VLS_functionalComponentArgsRest(__VLS_809));
    let __VLS_813;
    const __VLS_814 = {
        /** @type {typeof __VLS_813.click} */
        onClick: (__VLS_ctx.applyPlan),
    };
    const { default: __VLS_815 } = __VLS_811.slots;
    // @ts-ignore
    [currentPlan, currentPlan, applying, applyPlan,];
    var __VLS_811;
    var __VLS_812;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_785;
// @ts-ignore
[];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
