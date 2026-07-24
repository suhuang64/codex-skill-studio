import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { FolderAdd, Plus, Refresh, Search, Setting, Collection, Link, Warning, Clock, House, Star, Download, Upload } from '@element-plus/icons-vue';
import { api, patch, post, remove } from './api';
const data = reactive({ projects: [], sources: [], skills: [], groups: [], bundles: [], audit: [], history: [] });
const loading = ref(true), tab = ref('overview'), query = ref(''), statusFilter = ref('all'), selectedProject = ref(''), statuses = ref([]), selectedSkills = ref([]);
const projectDialog = ref(false), sourceDialog = ref(false), bundleDialog = ref(false), planDialog = ref(false), groupDialog = ref(false), skillDialog = ref(false), bundleApplyDialog = ref(false);
const projectForm = reactive({ name: '', path: '' }), sourceForm = reactive({ name: '', path: '', mode: 'pack' }), bundleForm = reactive({ name: '', description: '', skillIds: [] });
const groupForm = reactive({ name: '', color: '#007AFF' }), skillForm = reactive({ id: '', alias: '', tags: '' }), bundleApply = reactive({ bundleId: '', projectId: '' });
const currentPlan = ref(null), applying = ref(false);
const nav = [['overview', '总览', House], ['projects', '项目', FolderAdd], ['skills', '技能库', Collection], ['bundles', '技能组合', Link], ['audit', '健康检查', Warning], ['history', '操作历史', Clock], ['settings', '设置', Setting]];
async function refresh(message = false) { loading.value = true; try {
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
} }
async function loadStatus() { if (!selectedProject.value) {
    statuses.value = [];
    return;
} statuses.value = await api(`/projects/${selectedProject.value}/status`); }
watch(selectedProject, loadStatus);
const filteredSkills = computed(() => { const q = query.value.toLowerCase(); return statuses.value.filter(s => (statusFilter.value === 'all' || s.status === statusFilter.value) && (!q || `${s.name} ${s.description} ${s.path} ${s.tags.join(' ')}`.toLowerCase().includes(q))); });
const linkedCount = computed(() => statuses.value.filter(s => s.status === 'linked').length);
const errors = computed(() => data.audit.filter(a => a.level === 'error').length);
async function choose(target, title) { const r = await post('/dialog/directory', { title }); if (r.path)
    target.path = r.path; }
async function addProject() { try {
    await post('/projects', projectForm);
    projectDialog.value = false;
    Object.assign(projectForm, { name: '', path: '' });
    await refresh();
    ElMessage.success('项目已添加');
}
catch (e) {
    ElMessage.error(e.message);
} }
async function addSource() { try {
    const r = await post('/sources', sourceForm);
    sourceDialog.value = false;
    Object.assign(sourceForm, { name: '', path: '', mode: 'pack' });
    await refresh();
    ElMessage.success(`已发现 ${r.count} 个技能`);
}
catch (e) {
    ElMessage.error(e.message);
} }
async function rescan() { try {
    const r = await post('/scan');
    await refresh();
    ElMessage.success(`扫描完成，共识别 ${r.count} 个技能`);
}
catch (e) {
    ElMessage.error(e.message);
} }
async function confirmDelete(kind, row) { try {
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
} }
async function toggleFavorite(row) { await patch(`/skills/${row.id}`, { favorite: !row.favorite }); await refresh(); }
async function stage(action) { if (!selectedProject.value || !selectedSkills.value.length)
    return ElMessage.warning('请先选择项目并勾选技能'); try {
    currentPlan.value = await post('/plans', { projectIds: [selectedProject.value], skillIds: selectedSkills.value.map(s => s.id), action });
    planDialog.value = true;
}
catch (e) {
    ElMessage.error(e.message);
} }
async function applyPlan() { if (!currentPlan.value)
    return; applying.value = true; try {
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
} }
async function undo(row) { await ElMessageBox.confirm('撤销将恢复本次操作之前的软链接状态。', '撤销操作', { type: 'warning' }); try {
    await post(`/operations/${row.id}/undo`);
    await refresh();
    ElMessage.success('已撤销');
}
catch (e) {
    ElMessage.error(e.message);
} }
async function createBundle() { try {
    await post('/bundles', bundleForm);
    bundleDialog.value = false;
    Object.assign(bundleForm, { name: '', description: '', skillIds: [] });
    await refresh();
    ElMessage.success('技能组合已创建');
}
catch (e) {
    ElMessage.error(e.message);
} }
async function createGroup() { try {
    await post('/groups', groupForm);
    groupDialog.value = false;
    groupForm.name = '';
    await refresh();
    ElMessage.success('项目组已创建');
}
catch (e) {
    ElMessage.error(e.message);
} }
async function assignGroup(project, groupId) { await patch(`/projects/${project.id}/group`, { groupId }); await refresh(); }
function editSkill(row) { Object.assign(skillForm, { id: row.id, alias: row.alias, tags: row.tags.join(', ') }); skillDialog.value = true; }
async function saveSkill() { try {
    await patch(`/skills/${skillForm.id}`, { alias: skillForm.alias, tags: skillForm.tags.split(/[,，]/).map(s => s.trim()).filter(Boolean) });
    skillDialog.value = false;
    await refresh();
    ElMessage.success('技能信息已更新');
}
catch (e) {
    ElMessage.error(e.message);
} }
function openBundleApply(bundle) { Object.assign(bundleApply, { bundleId: bundle.id, projectId: data.projects[0]?.id || '' }); bundleApplyDialog.value = true; }
async function stageBundle() { const bundle = data.bundles.find(b => b.id === bundleApply.bundleId); if (!bundle || !bundleApply.projectId)
    return; currentPlan.value = await post('/plans', { projectIds: [bundleApply.projectId], skillIds: bundle.skillIds, action: 'link', bundleId: bundle.id }); bundleApplyDialog.value = false; planDialog.value = true; }
function exportConfig() { api('/export').then(obj => { const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `skill-manager-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url); }); }
async function importConfig(file) { try {
    await post('/import', JSON.parse(await file.text()));
    await refresh();
    ElMessage.success('配置已导入');
}
catch (e) {
    ElMessage.error(e.message);
} return false; }
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
    (__VLS_ctx.data.audit.length ? `共 ${__VLS_ctx.data.audit.length} 条提示，所有真实目录仍受保护。` : '未发现失效链接或来源冲突。');
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
        const __VLS_92 = __VLS_asFunctionalComponent1(__VLS_91, new __VLS_91({}));
        const __VLS_93 = __VLS_92({}, ...__VLS_functionalComponentArgsRest(__VLS_92));
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
                __VLS_ctx.selectedProject = p.id;
                __VLS_ctx.tab = 'skills';
                // @ts-ignore
                [tab, selectedProject,];
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
        options: ([{ label: '全部', value: 'all' }, { label: '已链接', value: 'linked' }, { label: '未链接', value: 'missing' }, { label: '异常', value: 'broken' }]),
    }));
    const __VLS_178 = __VLS_177({
        modelValue: (__VLS_ctx.statusFilter),
        options: ([{ label: '全部', value: 'all' }, { label: '已链接', value: 'linked' }, { label: '未链接', value: 'missing' }, { label: '异常', value: 'broken' }]),
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
        ({ linked: '已链接', missing: '未链接', broken: '已失效', other_link: '其他链接', conflict: '真实冲突' }[row.status]);
        // @ts-ignore
        [];
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
        (__VLS_ctx.data.skills.filter(k => k.sourceId === s.id).length);
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
            (__VLS_ctx.data.skills.find(s => s.id === sid)?.name);
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
        ...{ class: "setting-card glass" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-icon']} */ ;
    let __VLS_375;
    /** @ts-ignore @type { | typeof __VLS_components.Download} */
    Download;
    // @ts-ignore
    const __VLS_376 = __VLS_asFunctionalComponent1(__VLS_375, new __VLS_375({}));
    const __VLS_377 = __VLS_376({}, ...__VLS_functionalComponentArgsRest(__VLS_376));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_380;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_381 = __VLS_asFunctionalComponent1(__VLS_380, new __VLS_380({
        ...{ 'onClick': {} },
    }));
    const __VLS_382 = __VLS_381({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_381));
    let __VLS_385;
    const __VLS_386 = {
        /** @type {typeof __VLS_385.click} */
        onClick: (__VLS_ctx.exportConfig),
    };
    const { default: __VLS_387 } = __VLS_383.slots;
    // @ts-ignore
    [data, exportConfig,];
    var __VLS_383;
    var __VLS_384;
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "setting-card glass" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['glass']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "setting-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['setting-icon']} */ ;
    let __VLS_388;
    /** @ts-ignore @type { | typeof __VLS_components.Upload} */
    Upload;
    // @ts-ignore
    const __VLS_389 = __VLS_asFunctionalComponent1(__VLS_388, new __VLS_388({}));
    const __VLS_390 = __VLS_389({}, ...__VLS_functionalComponentArgsRest(__VLS_389));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_393;
    /** @ts-ignore @type { | typeof __VLS_components.elUpload | typeof __VLS_components.ElUpload | typeof __VLS_components['el-upload'] | typeof __VLS_components.elUpload | typeof __VLS_components.ElUpload | typeof __VLS_components['el-upload']} */
    elUpload;
    // @ts-ignore
    const __VLS_394 = __VLS_asFunctionalComponent1(__VLS_393, new __VLS_393({
        showFileList: (false),
        accept: "application/json",
        beforeUpload: (__VLS_ctx.importConfig),
    }));
    const __VLS_395 = __VLS_394({
        showFileList: (false),
        accept: "application/json",
        beforeUpload: (__VLS_ctx.importConfig),
    }, ...__VLS_functionalComponentArgsRest(__VLS_394));
    const { default: __VLS_398 } = __VLS_396.slots;
    let __VLS_399;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_400 = __VLS_asFunctionalComponent1(__VLS_399, new __VLS_399({}));
    const __VLS_401 = __VLS_400({}, ...__VLS_functionalComponentArgsRest(__VLS_400));
    const { default: __VLS_404 } = __VLS_402.slots;
    // @ts-ignore
    [importConfig,];
    var __VLS_402;
    // @ts-ignore
    [];
    var __VLS_396;
}
let __VLS_405;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_406 = __VLS_asFunctionalComponent1(__VLS_405, new __VLS_405({
    modelValue: (__VLS_ctx.projectDialog),
    title: "添加项目",
    width: "560",
}));
const __VLS_407 = __VLS_406({
    modelValue: (__VLS_ctx.projectDialog),
    title: "添加项目",
    width: "560",
}, ...__VLS_functionalComponentArgsRest(__VLS_406));
const { default: __VLS_410 } = __VLS_408.slots;
let __VLS_411;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_412 = __VLS_asFunctionalComponent1(__VLS_411, new __VLS_411({
    labelPosition: "top",
}));
const __VLS_413 = __VLS_412({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_412));
const { default: __VLS_416 } = __VLS_414.slots;
let __VLS_417;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_418 = __VLS_asFunctionalComponent1(__VLS_417, new __VLS_417({
    label: "项目目录",
}));
const __VLS_419 = __VLS_418({
    label: "项目目录",
}, ...__VLS_functionalComponentArgsRest(__VLS_418));
const { default: __VLS_422 } = __VLS_420.slots;
let __VLS_423;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input'] | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_424 = __VLS_asFunctionalComponent1(__VLS_423, new __VLS_423({
    modelValue: (__VLS_ctx.projectForm.path),
    placeholder: "选择任意本地项目目录",
}));
const __VLS_425 = __VLS_424({
    modelValue: (__VLS_ctx.projectForm.path),
    placeholder: "选择任意本地项目目录",
}, ...__VLS_functionalComponentArgsRest(__VLS_424));
const { default: __VLS_428 } = __VLS_426.slots;
{
    const { append: __VLS_429 } = __VLS_426.slots;
    let __VLS_430;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_431 = __VLS_asFunctionalComponent1(__VLS_430, new __VLS_430({
        ...{ 'onClick': {} },
    }));
    const __VLS_432 = __VLS_431({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_431));
    let __VLS_435;
    const __VLS_436 = {
        /** @type {typeof __VLS_435.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.choose(__VLS_ctx.projectForm, '选择要管理的项目目录'));
            // @ts-ignore
            [projectDialog, projectForm, projectForm, choose,];
        },
    };
    const { default: __VLS_437 } = __VLS_433.slots;
    // @ts-ignore
    [];
    var __VLS_433;
    var __VLS_434;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_426;
// @ts-ignore
[];
var __VLS_420;
let __VLS_438;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_439 = __VLS_asFunctionalComponent1(__VLS_438, new __VLS_438({
    label: "显示名称（可选）",
}));
const __VLS_440 = __VLS_439({
    label: "显示名称（可选）",
}, ...__VLS_functionalComponentArgsRest(__VLS_439));
const { default: __VLS_443 } = __VLS_441.slots;
let __VLS_444;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_445 = __VLS_asFunctionalComponent1(__VLS_444, new __VLS_444({
    modelValue: (__VLS_ctx.projectForm.name),
    placeholder: "默认使用目录名",
}));
const __VLS_446 = __VLS_445({
    modelValue: (__VLS_ctx.projectForm.name),
    placeholder: "默认使用目录名",
}, ...__VLS_functionalComponentArgsRest(__VLS_445));
// @ts-ignore
[projectForm,];
var __VLS_441;
// @ts-ignore
[];
var __VLS_414;
{
    const { footer: __VLS_449 } = __VLS_408.slots;
    let __VLS_450;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_451 = __VLS_asFunctionalComponent1(__VLS_450, new __VLS_450({
        ...{ 'onClick': {} },
    }));
    const __VLS_452 = __VLS_451({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_451));
    let __VLS_455;
    const __VLS_456 = {
        /** @type {typeof __VLS_455.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.projectDialog = false);
            // @ts-ignore
            [projectDialog,];
        },
    };
    const { default: __VLS_457 } = __VLS_453.slots;
    // @ts-ignore
    [];
    var __VLS_453;
    var __VLS_454;
    let __VLS_458;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_459 = __VLS_asFunctionalComponent1(__VLS_458, new __VLS_458({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.projectForm.path),
    }));
    const __VLS_460 = __VLS_459({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.projectForm.path),
    }, ...__VLS_functionalComponentArgsRest(__VLS_459));
    let __VLS_463;
    const __VLS_464 = {
        /** @type {typeof __VLS_463.click} */
        onClick: (__VLS_ctx.addProject),
    };
    const { default: __VLS_465 } = __VLS_461.slots;
    // @ts-ignore
    [projectForm, addProject,];
    var __VLS_461;
    var __VLS_462;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_408;
let __VLS_466;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_467 = __VLS_asFunctionalComponent1(__VLS_466, new __VLS_466({
    modelValue: (__VLS_ctx.sourceDialog),
    title: "添加技能源",
    width: "560",
}));
const __VLS_468 = __VLS_467({
    modelValue: (__VLS_ctx.sourceDialog),
    title: "添加技能源",
    width: "560",
}, ...__VLS_functionalComponentArgsRest(__VLS_467));
const { default: __VLS_471 } = __VLS_469.slots;
let __VLS_472;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_473 = __VLS_asFunctionalComponent1(__VLS_472, new __VLS_472({
    labelPosition: "top",
}));
const __VLS_474 = __VLS_473({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_473));
const { default: __VLS_477 } = __VLS_475.slots;
let __VLS_478;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_479 = __VLS_asFunctionalComponent1(__VLS_478, new __VLS_478({
    label: "来源类型",
}));
const __VLS_480 = __VLS_479({
    label: "来源类型",
}, ...__VLS_functionalComponentArgsRest(__VLS_479));
const { default: __VLS_483 } = __VLS_481.slots;
let __VLS_484;
/** @ts-ignore @type { | typeof __VLS_components.elRadioGroup | typeof __VLS_components.ElRadioGroup | typeof __VLS_components['el-radio-group'] | typeof __VLS_components.elRadioGroup | typeof __VLS_components.ElRadioGroup | typeof __VLS_components['el-radio-group']} */
elRadioGroup;
// @ts-ignore
const __VLS_485 = __VLS_asFunctionalComponent1(__VLS_484, new __VLS_484({
    modelValue: (__VLS_ctx.sourceForm.mode),
}));
const __VLS_486 = __VLS_485({
    modelValue: (__VLS_ctx.sourceForm.mode),
}, ...__VLS_functionalComponentArgsRest(__VLS_485));
const { default: __VLS_489 } = __VLS_487.slots;
let __VLS_490;
/** @ts-ignore @type { | typeof __VLS_components.elRadioButton | typeof __VLS_components.ElRadioButton | typeof __VLS_components['el-radio-button'] | typeof __VLS_components.elRadioButton | typeof __VLS_components.ElRadioButton | typeof __VLS_components['el-radio-button']} */
elRadioButton;
// @ts-ignore
const __VLS_491 = __VLS_asFunctionalComponent1(__VLS_490, new __VLS_490({
    value: "pack",
}));
const __VLS_492 = __VLS_491({
    value: "pack",
}, ...__VLS_functionalComponentArgsRest(__VLS_491));
const { default: __VLS_495 } = __VLS_493.slots;
// @ts-ignore
[sourceDialog, sourceForm,];
var __VLS_493;
let __VLS_496;
/** @ts-ignore @type { | typeof __VLS_components.elRadioButton | typeof __VLS_components.ElRadioButton | typeof __VLS_components['el-radio-button'] | typeof __VLS_components.elRadioButton | typeof __VLS_components.ElRadioButton | typeof __VLS_components['el-radio-button']} */
elRadioButton;
// @ts-ignore
const __VLS_497 = __VLS_asFunctionalComponent1(__VLS_496, new __VLS_496({
    value: "single",
}));
const __VLS_498 = __VLS_497({
    value: "single",
}, ...__VLS_functionalComponentArgsRest(__VLS_497));
const { default: __VLS_501 } = __VLS_499.slots;
// @ts-ignore
[];
var __VLS_499;
// @ts-ignore
[];
var __VLS_487;
// @ts-ignore
[];
var __VLS_481;
let __VLS_502;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_503 = __VLS_asFunctionalComponent1(__VLS_502, new __VLS_502({
    label: "目录",
}));
const __VLS_504 = __VLS_503({
    label: "目录",
}, ...__VLS_functionalComponentArgsRest(__VLS_503));
const { default: __VLS_507 } = __VLS_505.slots;
let __VLS_508;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input'] | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_509 = __VLS_asFunctionalComponent1(__VLS_508, new __VLS_508({
    modelValue: (__VLS_ctx.sourceForm.path),
    placeholder: "选择含 SKILL.md 的技能或技能包",
}));
const __VLS_510 = __VLS_509({
    modelValue: (__VLS_ctx.sourceForm.path),
    placeholder: "选择含 SKILL.md 的技能或技能包",
}, ...__VLS_functionalComponentArgsRest(__VLS_509));
const { default: __VLS_513 } = __VLS_511.slots;
{
    const { append: __VLS_514 } = __VLS_511.slots;
    let __VLS_515;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_516 = __VLS_asFunctionalComponent1(__VLS_515, new __VLS_515({
        ...{ 'onClick': {} },
    }));
    const __VLS_517 = __VLS_516({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_516));
    let __VLS_520;
    const __VLS_521 = {
        /** @type {typeof __VLS_520.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.choose(__VLS_ctx.sourceForm, '选择技能或技能包目录'));
            // @ts-ignore
            [choose, sourceForm, sourceForm,];
        },
    };
    const { default: __VLS_522 } = __VLS_518.slots;
    // @ts-ignore
    [];
    var __VLS_518;
    var __VLS_519;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_511;
// @ts-ignore
[];
var __VLS_505;
let __VLS_523;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_524 = __VLS_asFunctionalComponent1(__VLS_523, new __VLS_523({
    label: "来源名称（可选）",
}));
const __VLS_525 = __VLS_524({
    label: "来源名称（可选）",
}, ...__VLS_functionalComponentArgsRest(__VLS_524));
const { default: __VLS_528 } = __VLS_526.slots;
let __VLS_529;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_530 = __VLS_asFunctionalComponent1(__VLS_529, new __VLS_529({
    modelValue: (__VLS_ctx.sourceForm.name),
    placeholder: "默认使用目录名",
}));
const __VLS_531 = __VLS_530({
    modelValue: (__VLS_ctx.sourceForm.name),
    placeholder: "默认使用目录名",
}, ...__VLS_functionalComponentArgsRest(__VLS_530));
// @ts-ignore
[sourceForm,];
var __VLS_526;
// @ts-ignore
[];
var __VLS_475;
{
    const { footer: __VLS_534 } = __VLS_469.slots;
    let __VLS_535;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_536 = __VLS_asFunctionalComponent1(__VLS_535, new __VLS_535({
        ...{ 'onClick': {} },
    }));
    const __VLS_537 = __VLS_536({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_536));
    let __VLS_540;
    const __VLS_541 = {
        /** @type {typeof __VLS_540.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.sourceDialog = false);
            // @ts-ignore
            [sourceDialog,];
        },
    };
    const { default: __VLS_542 } = __VLS_538.slots;
    // @ts-ignore
    [];
    var __VLS_538;
    var __VLS_539;
    let __VLS_543;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_544 = __VLS_asFunctionalComponent1(__VLS_543, new __VLS_543({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.sourceForm.path),
    }));
    const __VLS_545 = __VLS_544({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.sourceForm.path),
    }, ...__VLS_functionalComponentArgsRest(__VLS_544));
    let __VLS_548;
    const __VLS_549 = {
        /** @type {typeof __VLS_548.click} */
        onClick: (__VLS_ctx.addSource),
    };
    const { default: __VLS_550 } = __VLS_546.slots;
    // @ts-ignore
    [sourceForm, addSource,];
    var __VLS_546;
    var __VLS_547;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_469;
let __VLS_551;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_552 = __VLS_asFunctionalComponent1(__VLS_551, new __VLS_551({
    modelValue: (__VLS_ctx.bundleDialog),
    title: "新建技能组合",
    width: "620",
}));
const __VLS_553 = __VLS_552({
    modelValue: (__VLS_ctx.bundleDialog),
    title: "新建技能组合",
    width: "620",
}, ...__VLS_functionalComponentArgsRest(__VLS_552));
const { default: __VLS_556 } = __VLS_554.slots;
let __VLS_557;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_558 = __VLS_asFunctionalComponent1(__VLS_557, new __VLS_557({
    labelPosition: "top",
}));
const __VLS_559 = __VLS_558({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_558));
const { default: __VLS_562 } = __VLS_560.slots;
let __VLS_563;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_564 = __VLS_asFunctionalComponent1(__VLS_563, new __VLS_563({
    label: "组合名称",
}));
const __VLS_565 = __VLS_564({
    label: "组合名称",
}, ...__VLS_functionalComponentArgsRest(__VLS_564));
const { default: __VLS_568 } = __VLS_566.slots;
let __VLS_569;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_570 = __VLS_asFunctionalComponent1(__VLS_569, new __VLS_569({
    modelValue: (__VLS_ctx.bundleForm.name),
}));
const __VLS_571 = __VLS_570({
    modelValue: (__VLS_ctx.bundleForm.name),
}, ...__VLS_functionalComponentArgsRest(__VLS_570));
// @ts-ignore
[bundleDialog, bundleForm,];
var __VLS_566;
let __VLS_574;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_575 = __VLS_asFunctionalComponent1(__VLS_574, new __VLS_574({
    label: "说明",
}));
const __VLS_576 = __VLS_575({
    label: "说明",
}, ...__VLS_functionalComponentArgsRest(__VLS_575));
const { default: __VLS_579 } = __VLS_577.slots;
let __VLS_580;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_581 = __VLS_asFunctionalComponent1(__VLS_580, new __VLS_580({
    modelValue: (__VLS_ctx.bundleForm.description),
    type: "textarea",
}));
const __VLS_582 = __VLS_581({
    modelValue: (__VLS_ctx.bundleForm.description),
    type: "textarea",
}, ...__VLS_functionalComponentArgsRest(__VLS_581));
// @ts-ignore
[bundleForm,];
var __VLS_577;
let __VLS_585;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_586 = __VLS_asFunctionalComponent1(__VLS_585, new __VLS_585({
    label: "包含技能",
}));
const __VLS_587 = __VLS_586({
    label: "包含技能",
}, ...__VLS_functionalComponentArgsRest(__VLS_586));
const { default: __VLS_590 } = __VLS_588.slots;
let __VLS_591;
/** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
elSelect;
// @ts-ignore
const __VLS_592 = __VLS_asFunctionalComponent1(__VLS_591, new __VLS_591({
    modelValue: (__VLS_ctx.bundleForm.skillIds),
    multiple: true,
    filterable: true,
    collapseTags: true,
    placeholder: "选择技能",
    ...{ style: {} },
}));
const __VLS_593 = __VLS_592({
    modelValue: (__VLS_ctx.bundleForm.skillIds),
    multiple: true,
    filterable: true,
    collapseTags: true,
    placeholder: "选择技能",
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_592));
const { default: __VLS_596 } = __VLS_594.slots;
for (const [s] of __VLS_vFor((__VLS_ctx.data.skills))) {
    let __VLS_597;
    /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
    elOption;
    // @ts-ignore
    const __VLS_598 = __VLS_asFunctionalComponent1(__VLS_597, new __VLS_597({
        key: (s.id),
        label: (s.name),
        value: (s.id),
    }));
    const __VLS_599 = __VLS_598({
        key: (s.id),
        label: (s.name),
        value: (s.id),
    }, ...__VLS_functionalComponentArgsRest(__VLS_598));
    // @ts-ignore
    [data, bundleForm,];
}
// @ts-ignore
[];
var __VLS_594;
// @ts-ignore
[];
var __VLS_588;
// @ts-ignore
[];
var __VLS_560;
{
    const { footer: __VLS_602 } = __VLS_554.slots;
    let __VLS_603;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_604 = __VLS_asFunctionalComponent1(__VLS_603, new __VLS_603({
        ...{ 'onClick': {} },
    }));
    const __VLS_605 = __VLS_604({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_604));
    let __VLS_608;
    const __VLS_609 = {
        /** @type {typeof __VLS_608.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.bundleDialog = false);
            // @ts-ignore
            [bundleDialog,];
        },
    };
    const { default: __VLS_610 } = __VLS_606.slots;
    // @ts-ignore
    [];
    var __VLS_606;
    var __VLS_607;
    let __VLS_611;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_612 = __VLS_asFunctionalComponent1(__VLS_611, new __VLS_611({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleForm.name),
    }));
    const __VLS_613 = __VLS_612({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleForm.name),
    }, ...__VLS_functionalComponentArgsRest(__VLS_612));
    let __VLS_616;
    const __VLS_617 = {
        /** @type {typeof __VLS_616.click} */
        onClick: (__VLS_ctx.createBundle),
    };
    const { default: __VLS_618 } = __VLS_614.slots;
    // @ts-ignore
    [bundleForm, createBundle,];
    var __VLS_614;
    var __VLS_615;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_554;
let __VLS_619;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_620 = __VLS_asFunctionalComponent1(__VLS_619, new __VLS_619({
    modelValue: (__VLS_ctx.groupDialog),
    title: "新建项目组",
    width: "480",
}));
const __VLS_621 = __VLS_620({
    modelValue: (__VLS_ctx.groupDialog),
    title: "新建项目组",
    width: "480",
}, ...__VLS_functionalComponentArgsRest(__VLS_620));
const { default: __VLS_624 } = __VLS_622.slots;
let __VLS_625;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_626 = __VLS_asFunctionalComponent1(__VLS_625, new __VLS_625({
    labelPosition: "top",
}));
const __VLS_627 = __VLS_626({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_626));
const { default: __VLS_630 } = __VLS_628.slots;
let __VLS_631;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_632 = __VLS_asFunctionalComponent1(__VLS_631, new __VLS_631({
    label: "项目组名称",
}));
const __VLS_633 = __VLS_632({
    label: "项目组名称",
}, ...__VLS_functionalComponentArgsRest(__VLS_632));
const { default: __VLS_636 } = __VLS_634.slots;
let __VLS_637;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_638 = __VLS_asFunctionalComponent1(__VLS_637, new __VLS_637({
    modelValue: (__VLS_ctx.groupForm.name),
}));
const __VLS_639 = __VLS_638({
    modelValue: (__VLS_ctx.groupForm.name),
}, ...__VLS_functionalComponentArgsRest(__VLS_638));
// @ts-ignore
[groupDialog, groupForm,];
var __VLS_634;
let __VLS_642;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_643 = __VLS_asFunctionalComponent1(__VLS_642, new __VLS_642({
    label: "标识颜色",
}));
const __VLS_644 = __VLS_643({
    label: "标识颜色",
}, ...__VLS_functionalComponentArgsRest(__VLS_643));
const { default: __VLS_647 } = __VLS_645.slots;
let __VLS_648;
/** @ts-ignore @type { | typeof __VLS_components.elColorPicker | typeof __VLS_components.ElColorPicker | typeof __VLS_components['el-color-picker']} */
elColorPicker;
// @ts-ignore
const __VLS_649 = __VLS_asFunctionalComponent1(__VLS_648, new __VLS_648({
    modelValue: (__VLS_ctx.groupForm.color),
}));
const __VLS_650 = __VLS_649({
    modelValue: (__VLS_ctx.groupForm.color),
}, ...__VLS_functionalComponentArgsRest(__VLS_649));
// @ts-ignore
[groupForm,];
var __VLS_645;
// @ts-ignore
[];
var __VLS_628;
{
    const { footer: __VLS_653 } = __VLS_622.slots;
    let __VLS_654;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_655 = __VLS_asFunctionalComponent1(__VLS_654, new __VLS_654({
        ...{ 'onClick': {} },
    }));
    const __VLS_656 = __VLS_655({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_655));
    let __VLS_659;
    const __VLS_660 = {
        /** @type {typeof __VLS_659.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.groupDialog = false);
            // @ts-ignore
            [groupDialog,];
        },
    };
    const { default: __VLS_661 } = __VLS_657.slots;
    // @ts-ignore
    [];
    var __VLS_657;
    var __VLS_658;
    let __VLS_662;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_663 = __VLS_asFunctionalComponent1(__VLS_662, new __VLS_662({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.groupForm.name),
    }));
    const __VLS_664 = __VLS_663({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.groupForm.name),
    }, ...__VLS_functionalComponentArgsRest(__VLS_663));
    let __VLS_667;
    const __VLS_668 = {
        /** @type {typeof __VLS_667.click} */
        onClick: (__VLS_ctx.createGroup),
    };
    const { default: __VLS_669 } = __VLS_665.slots;
    // @ts-ignore
    [groupForm, createGroup,];
    var __VLS_665;
    var __VLS_666;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_622;
let __VLS_670;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_671 = __VLS_asFunctionalComponent1(__VLS_670, new __VLS_670({
    modelValue: (__VLS_ctx.skillDialog),
    title: "编辑技能",
    width: "520",
}));
const __VLS_672 = __VLS_671({
    modelValue: (__VLS_ctx.skillDialog),
    title: "编辑技能",
    width: "520",
}, ...__VLS_functionalComponentArgsRest(__VLS_671));
const { default: __VLS_675 } = __VLS_673.slots;
let __VLS_676;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_677 = __VLS_asFunctionalComponent1(__VLS_676, new __VLS_676({
    labelPosition: "top",
}));
const __VLS_678 = __VLS_677({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_677));
const { default: __VLS_681 } = __VLS_679.slots;
let __VLS_682;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_683 = __VLS_asFunctionalComponent1(__VLS_682, new __VLS_682({
    label: "项目内链接名",
}));
const __VLS_684 = __VLS_683({
    label: "项目内链接名",
}, ...__VLS_functionalComponentArgsRest(__VLS_683));
const { default: __VLS_687 } = __VLS_685.slots;
let __VLS_688;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_689 = __VLS_asFunctionalComponent1(__VLS_688, new __VLS_688({
    modelValue: (__VLS_ctx.skillForm.alias),
}));
const __VLS_690 = __VLS_689({
    modelValue: (__VLS_ctx.skillForm.alias),
}, ...__VLS_functionalComponentArgsRest(__VLS_689));
__VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
    ...{ class: "el-form-item__description" },
});
/** @type {__VLS_StyleScopedClasses['el-form-item__description']} */ ;
// @ts-ignore
[skillDialog, skillForm,];
var __VLS_685;
let __VLS_693;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_694 = __VLS_asFunctionalComponent1(__VLS_693, new __VLS_693({
    label: "标签",
}));
const __VLS_695 = __VLS_694({
    label: "标签",
}, ...__VLS_functionalComponentArgsRest(__VLS_694));
const { default: __VLS_698 } = __VLS_696.slots;
let __VLS_699;
/** @ts-ignore @type { | typeof __VLS_components.elInput | typeof __VLS_components.ElInput | typeof __VLS_components['el-input']} */
elInput;
// @ts-ignore
const __VLS_700 = __VLS_asFunctionalComponent1(__VLS_699, new __VLS_699({
    modelValue: (__VLS_ctx.skillForm.tags),
    placeholder: "用逗号分隔，例如：论文, 前端, 常用",
}));
const __VLS_701 = __VLS_700({
    modelValue: (__VLS_ctx.skillForm.tags),
    placeholder: "用逗号分隔，例如：论文, 前端, 常用",
}, ...__VLS_functionalComponentArgsRest(__VLS_700));
// @ts-ignore
[skillForm,];
var __VLS_696;
// @ts-ignore
[];
var __VLS_679;
{
    const { footer: __VLS_704 } = __VLS_673.slots;
    let __VLS_705;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_706 = __VLS_asFunctionalComponent1(__VLS_705, new __VLS_705({
        ...{ 'onClick': {} },
    }));
    const __VLS_707 = __VLS_706({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_706));
    let __VLS_710;
    const __VLS_711 = {
        /** @type {typeof __VLS_710.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.skillDialog = false);
            // @ts-ignore
            [skillDialog,];
        },
    };
    const { default: __VLS_712 } = __VLS_708.slots;
    // @ts-ignore
    [];
    var __VLS_708;
    var __VLS_709;
    let __VLS_713;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_714 = __VLS_asFunctionalComponent1(__VLS_713, new __VLS_713({
        ...{ 'onClick': {} },
        type: "primary",
    }));
    const __VLS_715 = __VLS_714({
        ...{ 'onClick': {} },
        type: "primary",
    }, ...__VLS_functionalComponentArgsRest(__VLS_714));
    let __VLS_718;
    const __VLS_719 = {
        /** @type {typeof __VLS_718.click} */
        onClick: (__VLS_ctx.saveSkill),
    };
    const { default: __VLS_720 } = __VLS_716.slots;
    // @ts-ignore
    [saveSkill,];
    var __VLS_716;
    var __VLS_717;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_673;
let __VLS_721;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_722 = __VLS_asFunctionalComponent1(__VLS_721, new __VLS_721({
    modelValue: (__VLS_ctx.bundleApplyDialog),
    title: "应用技能组合",
    width: "520",
}));
const __VLS_723 = __VLS_722({
    modelValue: (__VLS_ctx.bundleApplyDialog),
    title: "应用技能组合",
    width: "520",
}, ...__VLS_functionalComponentArgsRest(__VLS_722));
const { default: __VLS_726 } = __VLS_724.slots;
let __VLS_727;
/** @ts-ignore @type { | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form'] | typeof __VLS_components.elForm | typeof __VLS_components.ElForm | typeof __VLS_components['el-form']} */
elForm;
// @ts-ignore
const __VLS_728 = __VLS_asFunctionalComponent1(__VLS_727, new __VLS_727({
    labelPosition: "top",
}));
const __VLS_729 = __VLS_728({
    labelPosition: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_728));
const { default: __VLS_732 } = __VLS_730.slots;
let __VLS_733;
/** @ts-ignore @type { | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item'] | typeof __VLS_components.elFormItem | typeof __VLS_components.ElFormItem | typeof __VLS_components['el-form-item']} */
elFormItem;
// @ts-ignore
const __VLS_734 = __VLS_asFunctionalComponent1(__VLS_733, new __VLS_733({
    label: "目标项目",
}));
const __VLS_735 = __VLS_734({
    label: "目标项目",
}, ...__VLS_functionalComponentArgsRest(__VLS_734));
const { default: __VLS_738 } = __VLS_736.slots;
let __VLS_739;
/** @ts-ignore @type { | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select'] | typeof __VLS_components.elSelect | typeof __VLS_components.ElSelect | typeof __VLS_components['el-select']} */
elSelect;
// @ts-ignore
const __VLS_740 = __VLS_asFunctionalComponent1(__VLS_739, new __VLS_739({
    modelValue: (__VLS_ctx.bundleApply.projectId),
    ...{ style: {} },
}));
const __VLS_741 = __VLS_740({
    modelValue: (__VLS_ctx.bundleApply.projectId),
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_740));
const { default: __VLS_744 } = __VLS_742.slots;
for (const [p] of __VLS_vFor((__VLS_ctx.data.projects))) {
    let __VLS_745;
    /** @ts-ignore @type { | typeof __VLS_components.elOption | typeof __VLS_components.ElOption | typeof __VLS_components['el-option']} */
    elOption;
    // @ts-ignore
    const __VLS_746 = __VLS_asFunctionalComponent1(__VLS_745, new __VLS_745({
        key: (p.id),
        label: (p.name),
        value: (p.id),
    }));
    const __VLS_747 = __VLS_746({
        key: (p.id),
        label: (p.name),
        value: (p.id),
    }, ...__VLS_functionalComponentArgsRest(__VLS_746));
    // @ts-ignore
    [data, bundleApplyDialog, bundleApply,];
}
// @ts-ignore
[];
var __VLS_742;
// @ts-ignore
[];
var __VLS_736;
// @ts-ignore
[];
var __VLS_730;
let __VLS_750;
/** @ts-ignore @type { | typeof __VLS_components.elAlert | typeof __VLS_components.ElAlert | typeof __VLS_components['el-alert']} */
elAlert;
// @ts-ignore
const __VLS_751 = __VLS_asFunctionalComponent1(__VLS_750, new __VLS_750({
    title: "应用后会持续检查该项目与组合之间的配置漂移。",
    type: "info",
    closable: (false),
}));
const __VLS_752 = __VLS_751({
    title: "应用后会持续检查该项目与组合之间的配置漂移。",
    type: "info",
    closable: (false),
}, ...__VLS_functionalComponentArgsRest(__VLS_751));
{
    const { footer: __VLS_755 } = __VLS_724.slots;
    let __VLS_756;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_757 = __VLS_asFunctionalComponent1(__VLS_756, new __VLS_756({
        ...{ 'onClick': {} },
    }));
    const __VLS_758 = __VLS_757({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_757));
    let __VLS_761;
    const __VLS_762 = {
        /** @type {typeof __VLS_761.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.bundleApplyDialog = false);
            // @ts-ignore
            [bundleApplyDialog,];
        },
    };
    const { default: __VLS_763 } = __VLS_759.slots;
    // @ts-ignore
    [];
    var __VLS_759;
    var __VLS_760;
    let __VLS_764;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_765 = __VLS_asFunctionalComponent1(__VLS_764, new __VLS_764({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleApply.projectId),
    }));
    const __VLS_766 = __VLS_765({
        ...{ 'onClick': {} },
        type: "primary",
        disabled: (!__VLS_ctx.bundleApply.projectId),
    }, ...__VLS_functionalComponentArgsRest(__VLS_765));
    let __VLS_769;
    const __VLS_770 = {
        /** @type {typeof __VLS_769.click} */
        onClick: (__VLS_ctx.stageBundle),
    };
    const { default: __VLS_771 } = __VLS_767.slots;
    // @ts-ignore
    [bundleApply, stageBundle,];
    var __VLS_767;
    var __VLS_768;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_724;
let __VLS_772;
/** @ts-ignore @type { | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog'] | typeof __VLS_components.elDialog | typeof __VLS_components.ElDialog | typeof __VLS_components['el-dialog']} */
elDialog;
// @ts-ignore
const __VLS_773 = __VLS_asFunctionalComponent1(__VLS_772, new __VLS_772({
    modelValue: (__VLS_ctx.planDialog),
    title: "确认变更计划",
    width: "720",
}));
const __VLS_774 = __VLS_773({
    modelValue: (__VLS_ctx.planDialog),
    title: "确认变更计划",
    width: "720",
}, ...__VLS_functionalComponentArgsRest(__VLS_773));
const { default: __VLS_777 } = __VLS_775.slots;
if (__VLS_ctx.currentPlan?.warnings.length) {
    let __VLS_778;
    /** @ts-ignore @type { | typeof __VLS_components.elAlert | typeof __VLS_components.ElAlert | typeof __VLS_components['el-alert']} */
    elAlert;
    // @ts-ignore
    const __VLS_779 = __VLS_asFunctionalComponent1(__VLS_778, new __VLS_778({
        title: (`${__VLS_ctx.currentPlan.warnings.length} 项被安全跳过`),
        type: "warning",
        showIcon: true,
        closable: (false),
    }));
    const __VLS_780 = __VLS_779({
        title: (`${__VLS_ctx.currentPlan.warnings.length} 项被安全跳过`),
        type: "warning",
        showIcon: true,
        closable: (false),
    }, ...__VLS_functionalComponentArgsRest(__VLS_779));
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
    let __VLS_783;
    /** @ts-ignore @type { | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag'] | typeof __VLS_components.elTag | typeof __VLS_components.ElTag | typeof __VLS_components['el-tag']} */
    elTag;
    // @ts-ignore
    const __VLS_784 = __VLS_asFunctionalComponent1(__VLS_783, new __VLS_783({
        round: true,
    }));
    const __VLS_785 = __VLS_784({
        round: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_784));
    const { default: __VLS_788 } = __VLS_786.slots;
    ({ link: '新增', replace: '替换', remove: '移除' }[i.action]);
    // @ts-ignore
    [planDialog, currentPlan, currentPlan, currentPlan, currentPlan,];
    var __VLS_786;
    __VLS_asFunctionalElement1(__VLS_intrinsics.code, __VLS_intrinsics.code)({});
    (i.target);
    // @ts-ignore
    [];
}
{
    const { footer: __VLS_789 } = __VLS_775.slots;
    let __VLS_790;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_791 = __VLS_asFunctionalComponent1(__VLS_790, new __VLS_790({
        ...{ 'onClick': {} },
    }));
    const __VLS_792 = __VLS_791({
        ...{ 'onClick': {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_791));
    let __VLS_795;
    const __VLS_796 = {
        /** @type {typeof __VLS_795.click} */
        onClick: (...[$event]) => {
            return (__VLS_ctx.planDialog = false);
            // @ts-ignore
            [planDialog,];
        },
    };
    const { default: __VLS_797 } = __VLS_793.slots;
    // @ts-ignore
    [];
    var __VLS_793;
    var __VLS_794;
    let __VLS_798;
    /** @ts-ignore @type { | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button'] | typeof __VLS_components.elButton | typeof __VLS_components.ElButton | typeof __VLS_components['el-button']} */
    elButton;
    // @ts-ignore
    const __VLS_799 = __VLS_asFunctionalComponent1(__VLS_798, new __VLS_798({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.applying),
        disabled: (!__VLS_ctx.currentPlan?.items.length && !__VLS_ctx.currentPlan?.bundleId),
    }));
    const __VLS_800 = __VLS_799({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.applying),
        disabled: (!__VLS_ctx.currentPlan?.items.length && !__VLS_ctx.currentPlan?.bundleId),
    }, ...__VLS_functionalComponentArgsRest(__VLS_799));
    let __VLS_803;
    const __VLS_804 = {
        /** @type {typeof __VLS_803.click} */
        onClick: (__VLS_ctx.applyPlan),
    };
    const { default: __VLS_805 } = __VLS_801.slots;
    // @ts-ignore
    [currentPlan, currentPlan, applying, applyPlan,];
    var __VLS_801;
    var __VLS_802;
    // @ts-ignore
    [];
}
// @ts-ignore
[];
var __VLS_775;
// @ts-ignore
[];
const __VLS_export = (await import('vue')).defineComponent({});
export default {};
