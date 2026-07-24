# Skill Studio · Codex 技能管理器

仅面向 macOS 的本地网页应用，用于注册任意项目和技能源，并安全管理项目 `.codex/skills` 下的软链接。

## 启动

要求 Node.js 24 或更高版本。依赖已局部安装在项目目录内。

```bash
npm start
```

启动后服务只监听 `127.0.0.1:8765`，并自动打开默认浏览器。终端按 `Ctrl+C` 停止。

开发模式：

```bash
npm run dev
```

## 功能

- 使用 macOS 原生目录选择器注册任意项目、单个技能或技能包。
- 递归识别任意层级中直接包含 `SKILL.md` 的目录，并解析 `name`、`description`。
- 搜索、筛选、多选、收藏、标签和链接别名。
- 变更计划、二次确认、批量应用、失败回滚、操作历史和撤销。
- 项目组、技能组合、组合与项目关联、配置漂移检测。
- 失效来源、失效链接、其他链接、真实目录冲突、外部链接和重复技能审计。
- 配置 JSON 导入与导出。

## 安全边界

- 永不删除真实技能目录或项目目录。
- 永不覆盖或移除普通文件、真实目录。
- 只有明确的替换操作才会替换现有软链接。
- 所有写操作先生成计划，确认后应用；批量失败会回滚已完成项。
- 数据保存在 `~/Library/Application Support/Codex Skill Manager/manager.db`。

## 测试

```bash
npm test
npm run typecheck
npm run build
```
