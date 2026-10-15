/**
 * Client half of dsh-desktop-platform: one Settings section holding three tabs.
 *
 * The three surfaces (用量统计 / 归档历史 / 记忆系统) used to be three Settings
 * entries contributed by two plugins. They are one page now, so the shell lives
 * here: a tab strip over lazily-mounted panels. A panel mounts the first time
 * its tab is opened and stays mounted afterwards — unmounting the memory editor
 * on tab switch would silently drop whatever the user had typed but not saved.
 *
 * All copy goes through `ctx.locale`; nothing reads `navigator.language`, and
 * every colour is a `--dsw-alias-*` token so light and dark themes both come
 * from the host's own palette.
 */
window.__ModuleLoader__.load({
  id: 'dsh-desktop-platform',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    const NS = 'settings.desktopPlatform'
    // A settings section is keyed by the owning Loader entry id since 0.1.7, so
    // this has to match the plugin's `name` (and the patch row id) exactly.
    const SETTINGS_NAMESPACE = 'dsh-desktop-platform'
    const SUMMARY_PATH = '/dsh-desktop/usage-stats/summary'
    const ARCHIVE_LIST_PATH = '/dsh-desktop/shell/archive.list'
    const RESTORE_PATH = '/dsh-desktop/shell/archive.restore'
    const WORKSPACES_PATH = '/dsh-desktop/shell/workspaces'
    const MEMORY_PATH = '/dsh-desktop/shell/memory'
    const CONVENTION_PATH = '/dsh-desktop/shell/convention'
    const HANDOFF_PATH = '/dsh-desktop/shell/handoff'
    const ROOT_STORAGE_KEY = 'dshDesktopMemoryRoot'
    const HANDOFF_AUTO_KEY = 'dshDesktopHandoffAuto'
    const TAB_STORAGE_KEY = 'dshDesktopPlatformTab'
    /** How many recent days the daily chart draws. */
    const DAY_WINDOW = 14

    /**
     * The tab strip, in display order. `id` is also the panel's DOM id, so it
     * has to stay stable and free of characters that are illegal in an id.
     */
    /**
     * Where this section lands in the Settings navigation.
     *
     * The nav is the `settings.section` ledger sorted ascending by `order`, and
     * the tiers are already spaced out: host pages sit at -10/0/10/15/20
     * (account, general, models, plugins, agent presets), and the first
     * installed third-party page (IM机器人) claims 21. Sitting at 900 rather
     * than just past 21 keeps this page last even after the host ships new
     * sections in the 30–200 range.
     */
    const SECTION_ORDER = 900

    const TABS = [
      { id: 'usage', label: 'tab.usage' },
      { id: 'archive', label: 'tab.archive' },
      { id: 'memory', label: 'tab.memory' },
      // Another plugin's settings section, mounted here whole. See ForeignPage.
      { id: 'freemodel', label: 'tab.freemodel', foreign: { sectionId: 'our-free-model', missing: 'freemodel.missing' } }
    ]

    const en = {
      nav: 'Platform',
      "tab.usage": 'Usage',
      "tab.archive": 'Archived sessions',
      "tab.memory": 'Memory',
      "tab.freemodel": 'FreeModel',
      "freemodel.missing": 'The Our Free Model plugin is not installed or has not finished loading, so its pages are not available here. Install or enable it, then reopen this tab.',
      "usage.title": 'Totals',
      intro: 'Token accounting folded from this profile’s stored session logs. Counts come from what each provider reported, so a route that reports no usage contributes none.',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      loading: 'Reading stored sessions…',
      error: 'Usage statistics could not be read: {message}',
      empty: 'No billed requests have been recorded yet.',
      scanned: 'Folded {scanned} of {stored} stored sessions.',
      "stat.sessions": 'Sessions',
      "stat.requests": 'Billed requests',
      "stat.turns": 'Turns',
      "stat.input": 'Input tokens',
      "stat.output": 'Output tokens',
      "stat.cacheRead": 'Cache read',
      "stat.cacheWrite": 'Cache write',
      "stat.reasoning": 'Reasoning tokens',
      "stat.total": 'Total tokens',
      "quota.title": 'Credits and quota',
      "quota.intro": 'Credits are a conversion you configure, not a billed figure — DSH Desktop does not know a deployment’s price list. Leave the rates at 0 to see raw tokens only.',
      "quota.inputRate": 'Credits per 1M input tokens',
      "quota.outputRate": 'Credits per 1M output tokens',
      "quota.limit": 'Credit quota (0 = no quota)',
      "quota.used": 'Credits used',
      "quota.remaining": 'Credits remaining',
      "quota.unset": 'Set a conversion rate to convert tokens into credits.',
      "quota.over": 'Over quota',
      "quota.save": 'Save',
      "quota.saving": 'Saving…',
      "quota.saved": 'Saved.',
      "quota.saveFailed": 'Could not save: {message}',
      "quota.rejected": 'The settings document changed elsewhere; reload to edit again.',
      "model.title": 'By model',
      "model.column": 'Model',
      "model.requests": 'Requests',
      "model.input": 'Input',
      "model.output": 'Output',
      "model.total": 'Total',
      "model.share": 'Share',
      "model.empty": 'No model has reported usage yet.',
      "day.title": 'Last {days} days',
      "day.empty": 'No usage in the last {days} days.',
      "session.title": 'Heaviest sessions',
      "session.column": 'Session',
      "session.empty": 'No session has reported usage yet.',
      failures: '{count} session(s) could not be read and were skipped.',
      "archive.intro": 'Sessions archived from the workspace context menu live here. They are hidden from every list until you restore them; restoring puts the session back where it was.',
      "archive.refresh": 'Refresh',
      "archive.refreshing": 'Refreshing…',
      "archive.loading": 'Loading archived sessions…',
      "archive.error": 'Archived sessions could not be read: {message}',
      "archive.empty": 'Nothing is archived yet. Archive a session from its context menu in the workspace view.',
      "archive.restore": 'Restore',
      "archive.restoring": 'Restoring…',
      "archive.restoreFailed": 'Restore failed: {message}',
      "archive.columnSession": 'Session',
      "archive.columnUpdated": 'Last updated',
      "archive.columnActions": 'Actions',
      "archive.untitled": 'Untitled session',
      "archive.selectAll": 'Select all',
      "archive.selectRow": 'Select {title}',
      "archive.selected": '{count} selected',
      "archive.clearSelection": 'Clear selection',
      "archive.deleteSelected": 'Delete selected ({count})',
      "archive.delete": 'Delete',
      "archive.deleteOneTitle": 'Delete this archived session?',
      "archive.deleteManyTitle": 'Delete {count} selected archived session(s)?',
      "archive.deleteWarn": 'This cannot be undone: the stored session and its archive entry are removed. Workspace files are not touched.',
      "archive.confirmDelete": 'Delete',
      "archive.deleting": 'Deleting…',
      "archive.deleteFailed": 'Delete failed: {message}',
      "archive.deletedOne": 'Deleted 1 archived session.',
      "archive.deletedMany": 'Deleted {count} archived session(s).',
      "archive.more": 'and {count} more…',
      "dialog.cancel": 'Cancel',
      "memory.intro": 'Long-term memory lives in each workspace root as MEMORY.md. The harness feeds it to every session in that workspace as instructions, so what you keep here follows the agent automatically.',
      "memory.workspace": 'Workspace',
      "memory.loading": 'Loading memory…',
      "memory.loadError": 'Memory could not be read: {message}',
      "memory.empty": 'This workspace has no MEMORY.md yet. Save the editor to create it.',
      "memory.save": 'Save',
      "memory.saving": 'Saving…',
      "memory.saved": 'Saved. New sessions in this workspace will read it.',
      "memory.saveFailed": 'Save failed: {message}',
      "memory.import": 'Import',
      "memory.imported": 'Imported into the editor — review and save.',
      "memory.convention": 'Generate conversation memory',
      "memory.conventionHint": 'Writes a marked section into the workspace AGENTS.md telling the agent to record durable facts into MEMORY.md and to follow it at session start. Turning it off removes that section only.',
      "memory.conventionOn": 'On — the agent maintains MEMORY.md in this workspace.',
      "memory.conventionOff": 'Off — MEMORY.md is only read, never written by the agent.',
      "memory.handoff": 'Session handoff',
      "memory.handoffSwitch": 'Generate automatically',
      "memory.handoffHint": 'When you leave a conversation, the harness summarizes it into a marked section of MEMORY.md, so the next session in this workspace opens knowing what was done. Only the marked section is replaced.',
      "memory.handoffOn": 'On — leaving a conversation writes a handoff note.',
      "memory.handoffOff": 'Off — sessions start blank.',
      "memory.handoffGenerate": 'Summarize now',
      "memory.handoffGenerating": 'Summarizing…',
      "memory.handoffSaved": 'Handoff written to MEMORY.md.',
      "memory.handoffEmpty": 'No handoff yet. It is written when you leave a conversation, or with the button below.',
      "memory.handoffTooShort": 'This conversation is too short to hand off yet.',
      "memory.handoffNoModel": 'No default model is configured, so no summary can be generated.',
      "memory.handoffRuntimeDown": 'The model runtime is unavailable right now.',
      "memory.handoffNoSession": 'Open the conversation you want summarized, then run this again.',
      "memory.handoffFailed": 'Handoff failed: {message}',
      "memory.conventionFailed": 'Could not update the convention: {message}',
      "memory.pickWorkspaceFailed": 'No workspace is registered in this profile yet.',
    }

    const zh = {
      nav: '综合平台',
      "tab.usage": '用量统计',
      "tab.archive": '归档历史',
      "tab.memory": '记忆系统',
      "tab.freemodel": 'FreeModel',
      "freemodel.missing": '未找到 Our Free Model 插件的页面（插件未安装或尚未加载完成）。装上/启用它之后重新打开本页签即可。',
      "usage.title": '统计概览',
      intro: '统计来自本 Profile 已存储的会话事件日志。计数取自各服务商实际上报的用量，未上报用量的请求不计入。',
      refresh: '刷新',
      refreshing: '正在刷新…',
      loading: '正在读取已存储会话…',
      error: '无法读取用量统计：{message}',
      empty: '还没有产生已计费的请求记录。',
      scanned: '已统计 {stored} 个会话中的 {scanned} 个。',
      "stat.sessions": '会话数',
      "stat.requests": '计费请求数',
      "stat.turns": '轮次',
      "stat.input": '输入 tokens',
      "stat.output": '输出 tokens',
      "stat.cacheRead": '缓存读取',
      "stat.cacheWrite": '缓存写入',
      "stat.reasoning": '推理 tokens',
      "stat.total": 'tokens 合计',
      "quota.title": '积分与额度',
      "quota.intro": '积分是按你配置的费率折算出来的，不是账单金额——DSH Desktop 并不知道各部署的价格表。费率保持 0 时只展示原始 token。',
      "quota.inputRate": '每百万输入 token 折算积分',
      "quota.outputRate": '每百万输出 token 折算积分',
      "quota.limit": '积分额度（0 表示不设额度）',
      "quota.used": '已用积分',
      "quota.remaining": '剩余积分',
      "quota.unset": '设置折算费率后，token 会折算为积分。',
      "quota.over": '已超出额度',
      "quota.save": '保存',
      "quota.saving": '保存中…',
      "quota.saved": '已保存。',
      "quota.saveFailed": '保存失败：{message}',
      "quota.rejected": '设置文档已在别处修改，请刷新后重试。',
      "model.title": '按模型',
      "model.column": '模型',
      "model.requests": '请求数',
      "model.input": '输入',
      "model.output": '输出',
      "model.total": '合计',
      "model.share": '占比',
      "model.empty": '尚无模型上报用量。',
      "day.title": '最近 {days} 天',
      "day.empty": '最近 {days} 天没有用量。',
      "session.title": '用量最高的会话',
      "session.column": '会话',
      "session.empty": '尚无会话上报用量。',
      failures: '有 {count} 个会话读取失败，已跳过。',
      "archive.intro": '从工作区右键菜单「归档会话」的会话都收在这里，归档后从所有列表隐藏；点「还原」即可放回原处。',
      "archive.refresh": '刷新',
      "archive.refreshing": '正在刷新…',
      "archive.loading": '正在读取归档会话…',
      "archive.error": '无法读取归档会话：{message}',
      "archive.empty": '还没有归档的会话。在工作区视图的会话右键菜单里选择「归档会话」。',
      "archive.restore": '还原',
      "archive.restoring": '正在还原…',
      "archive.restoreFailed": '还原失败：{message}',
      "archive.columnSession": '会话',
      "archive.columnUpdated": '最近更新',
      "archive.columnActions": '操作',
      "archive.untitled": '未命名会话',
      "archive.selectAll": '全选',
      "archive.selectRow": '选择 {title}',
      "archive.selected": '已选 {count} 条',
      "archive.clearSelection": '取消选择',
      "archive.deleteSelected": '删除所选（{count}）',
      "archive.delete": '删除',
      "archive.deleteOneTitle": '删除这条归档会话？',
      "archive.deleteManyTitle": '删除选中的 {count} 条归档会话？',
      "archive.deleteWarn": '删除后无法恢复：存储的会话与归档记录都会被清掉，工作区文件不受影响。',
      "archive.confirmDelete": '删除',
      "archive.deleting": '正在删除…',
      "archive.deleteFailed": '删除失败：{message}',
      "archive.deletedOne": '已删除 1 条归档会话。',
      "archive.deletedMany": '已删除 {count} 条归档会话。',
      "archive.more": '还有 {count} 条…',
      "dialog.cancel": '取消',
      "memory.intro": '长期记忆按工作区根目录存放于 MEMORY.md。harness 会把它作为工作区指令注入该工作区的每个会话，这里维护的内容会自动跟随 Agent。',
      "memory.workspace": '工作区',
      "memory.loading": '正在读取记忆…',
      "memory.loadError": '无法读取记忆：{message}',
      "memory.empty": '该工作区还没有 MEMORY.md，保存编辑器即可创建。',
      "memory.save": '保存',
      "memory.saving": '正在保存…',
      "memory.saved": '已保存。该工作区的新会话会自动读取。',
      "memory.saveFailed": '保存失败：{message}',
      "memory.import": '导入',
      "memory.imported": '已导入编辑器——确认后请保存。',
      "memory.convention": '生成对话记忆',
      "memory.conventionHint": '在工作区 AGENTS.md 写入一段带标记的约定，让 Agent 把值得长期记住的事实沉淀进 MEMORY.md，并在会话开始时先读它。关闭时只移除该段约定，不删除记忆内容。',
      "memory.conventionOn": '已开启——Agent 会维护该工作区的 MEMORY.md。',
      "memory.conventionOff": '已关闭——MEMORY.md 只被读取，Agent 不会写入。',
      "memory.handoff": '会话自动交接',
      "memory.handoffSwitch": '自动生成交接',
      "memory.handoffHint": '离开一个会话时，harness 会把它摘要成 MEMORY.md 里的一段标记内容，新会话因此一开启就知道上次做到哪。只替换标记段落，不动你写的其余记忆。',
      "memory.handoffOn": '已开启——离开会话时自动生成交接。',
      "memory.handoffOff": '已关闭——新会话仍是空白起点。',
      "memory.handoffGenerate": '立即生成',
      "memory.handoffGenerating": '生成中…',
      "memory.handoffSaved": '交接已写入 MEMORY.md。',
      "memory.handoffEmpty": "还没有交接记录。离开会话时会自动生成，也可以点下面的按钮。",
      "memory.handoffTooShort": '这个会话还太短，暂时没有可交接的内容。',
      "memory.handoffNoModel": '还没有配置默认模型，生成不了摘要。',
      "memory.handoffRuntimeDown": '模型运行时当前不可用。',
      "memory.handoffNoSession": '请先把要交接的会话切到前台，再点生成。',
      "memory.handoffFailed": '交接生成失败：{message}',
      "memory.conventionFailed": '无法更新约定：{message}',
      "memory.pickWorkspaceFailed": '当前 Profile 还没有已注册的工作区。',
    }

    const styles = `
.dshPlatform{color:var(--dsw-alias-label-primary);flex-direction:column;gap:16px;display:flex}
.dshPlatformIntro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.dshPlatformBar{align-items:center;gap:8px;display:flex}
.dshPlatformBarSpacer{margin-left:auto}
.dshPlatformButton{box-sizing:border-box;height:32px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border:.5px solid var(--dsw-alias-border-l3);background:0 0;border-radius:16px;align-items:center;justify-content:center;min-width:72px;flex:none;white-space:nowrap;padding:0 14px;font-size:13px;line-height:20px;display:inline-flex}
.dshPlatformButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshPlatformButton:disabled{opacity:.4;cursor:default}
.dshPlatformCard{border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;flex-direction:column;gap:12px;padding:14px 16px;display:flex}
.dshPlatformCardTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;font-weight:500;line-height:22px}
.dshPlatformGrid{grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;display:grid}
.dshPlatformStat{background:var(--dsw-alias-bg-module-platform);border-radius:10px;padding:8px 10px}
.dshPlatformStatLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dshPlatformStatValue{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px;font-variant-numeric:tabular-nums}
.dshPlatformTable{width:100%;border-collapse:collapse;font-size:13px;line-height:20px}
.dshPlatformTable th{color:var(--dsw-alias-label-tertiary);text-align:left;padding:4px 8px 4px 0;font-size:12px;font-weight:500;line-height:18px}
.dshPlatformTable td{color:var(--dsw-alias-label-primary);border-top:.5px solid var(--dsw-alias-border-l4);padding:6px 8px 6px 0;font-variant-numeric:tabular-nums;vertical-align:middle}
.dshPlatformTable td:first-child{overflow-wrap:anywhere}
.dshPlatformMeter{background:var(--dsw-alias-bg-module-platform);border-radius:4px;height:6px;overflow:hidden}
.dshPlatformMeterFill{background:var(--dsw-alias-brand-primary);height:100%;transition:width .2s ease}
.dshPlatformMeterFillOver{background:var(--dsw-alias-state-error-primary);height:100%;transition:width .2s ease}
.dshPlatformFields{grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;display:grid}
.dshPlatformField{flex-direction:column;gap:4px;display:flex}
.dshPlatformFieldLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dshPlatformInput{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:100%;height:32px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:13px;line-height:20px}
.dshPlatformInput:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
.dshPlatformInput:disabled{opacity:.6;cursor:default}
.dshPlatformSelect{box-sizing:border-box;height:32px;max-width:420px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;padding:0 8px;font-size:13px;line-height:20px}
.dshPlatformNote{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.dshPlatformNoteSuccess{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:18px}
.dshPlatformError{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}
.dshPlatformDays{flex-direction:column;gap:6px;display:flex}
.dshPlatformDay{align-items:center;gap:10px;display:flex}
.dshPlatformDayLabel{color:var(--dsw-alias-label-tertiary);flex:none;width:92px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.dshPlatformDayMeter{flex:1;min-width:0}
.dshPlatformDayValue{flex:none;min-width:96px;text-align:right;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.dshPlatformTextarea{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:100%;min-height:220px;font:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:19px;resize:vertical}
.dshPlatformTextarea:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
.dshPlatformTextarea:disabled{opacity:.6;cursor:default}
.dshPlatformSwitchRow{align-items:flex-start;gap:10px;display:flex}
.dshPlatformCheckbox{width:16px;height:16px;margin:2px 0 0;accent-color:var(--dsw-alias-brand-primary);flex:none;cursor:pointer}
.dshPlatformSwitchCopy{flex-direction:column;gap:2px;min-width:0;flex:1;display:flex}
.dshPlatformMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dshPlatformHandoff{white-space:pre-wrap;word-break:break-word;margin:0;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);user-select:text;cursor:text;font-size:12px;line-height:1.6;max-height:280px;overflow:auto}
/* ── Tab strip ─────────────────────────────────────────────────────────── */
.dshPlatformTabs{gap:18px;border-bottom:.5px solid var(--dsw-alias-border-l4);display:flex;overflow-x:auto}
.dshPlatformTab{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:none;border-bottom:2px solid transparent;white-space:nowrap;padding:6px 2px 8px;font-size:13px;line-height:20px;transition:color .15s ease,border-color .15s ease}
.dshPlatformTab:hover{color:var(--dsw-alias-label-primary)}
.dshPlatformTab.isActive{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:500}
.dshPlatformTab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
.dshPlatformPanels{flex-direction:column;gap:16px;display:flex}
/* A hidden panel must stay hidden: the root sets display:flex, which would
   otherwise win over the user agent's [hidden] rule. */
.dshPlatformPanel[hidden]{display:none}
/* 控件文字跟随设置页统一不可选；数值、表格与记忆正文是给人抄走的，保持可选。 */
.dshPlatformStatValue,.dshPlatformTable td,.dshPlatformDayValue,.dshPlatformError,.dshPlatformTextarea,.dshPlatformHandoff{user-select:text;cursor:text}.dshPlatformActions{gap:8px;white-space:nowrap;display:flex}
.dshPlatformCheckLabel{align-items:center;gap:8px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-primary));font-size:13px;line-height:20px;display:flex}
/* The owner's masthead (icon + product title) is redundant here: this tab
   already carries the page name in the tab strip above it. Scoped to this
   panel so the owner's own settings page keeps its header. */
#dshPlatformPanel-freemodel .ofm_navbrand,
#dshPlatformPanel-freemodel .ofm_starlink{display:none}
.dshPlatformDanger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dshPlatformOverlay{position:fixed;z-index:1000;inset:0;background:var(--dsw-alias-bg-base);align-items:center;justify-content:center;padding:24px;display:flex}
.dshPlatformDialog{border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-1);width:100%;max-width:520px;flex-direction:column;gap:12px;padding:20px 22px;display:flex}
.dshPlatformDialogTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:15px;font-weight:600;line-height:22px}
.dshPlatformDialogNote{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.dshPlatformDialogList{border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;background:var(--dsh-alias-bg-layer-2,var(--dsh-alias-bg-layer-2));color:var(--dsh-alias-label-primary);margin:0;padding:8px 10px 8px 26px;max-height:160px;overflow:auto;font-size:12.5px;line-height:19px}
@media (prefers-reduced-motion:reduce){
.dshPlatformTab,.dshPlatformMeterFill,.dshPlatformMeterFillOver{transition:none}
}
`

    function installStyles() {
      if (typeof document === 'undefined' || document.getElementById('dsh-desktop-platform-style') !== null) return
      const tag = document.createElement('style')
      tag.id = 'dsh-desktop-platform-style'
      tag.textContent = styles
      document.head.appendChild(tag)
    }

    /** Any host error into a readable message. */
    function messageOf(failure) {
      return failure instanceof Error ? failure.message : String(failure)
    }

    /** Loopback JSON call shared by every tab. */
    async function platformFetch(path, options) {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || 'HTTP ' + response.status)
      return json
    }

    /** Thousands-separated integer, falling back to a dash for absent values. */
    function formatNumber(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return Math.round(value).toLocaleString()
    }

    /** Two-decimal credits, which is the precision the host stores. */
    function formatCredits(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    }

    function Stat({ label, value }) {
      return React.createElement('div', { className: 'dshPlatformStat' },
        React.createElement('div', { className: 'dshPlatformStatLabel' }, label),
        React.createElement('div', { className: 'dshPlatformStatValue' }, value))
    }

    /** Card wrapper shared by the three tabs. */
    function Card({ title, children }) {
      return React.createElement('section', { className: 'dshPlatformCard' },
        React.createElement('h3', { className: 'dshPlatformCardTitle' }, title),
        children)
    }

    /** Read a remembered tab, ignoring anything this build no longer offers. */
    function storedTab() {
      try {
        const saved = window.localStorage.getItem(TAB_STORAGE_KEY)
        return TABS.some((tab) => tab.id === saved) ? saved : TABS[0].id
      } catch {
        return TABS[0].id
      }
    }

    function rememberTab(id) {
      try { window.localStorage.setItem(TAB_STORAGE_KEY, id) } catch { /* storage is optional */ }
    }

    /**
     * The tab strip.
     *
     * Follows the ARIA tabs pattern: one tab stop for the whole strip (roving
     * tabindex) and arrow keys / Home / End move between tabs, which is what
     * the keyboard contract in the contribution guide asks for.
     */
    function TabBar({ t, active, onSelect }) {
      const nodes = React.useRef(new Map())
      const move = (event) => {
        const index = TABS.findIndex((tab) => tab.id === active)
        let next = null
        if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
        else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = TABS.length - 1
        if (next === null) return
        event.preventDefault()
        onSelect(TABS[next].id)
        nodes.current.get(TABS[next].id)?.focus()
      }
      return React.createElement('div', { className: 'dshPlatformTabs', role: 'tablist', 'aria-label': t('nav'), onKeyDown: move },
        TABS.map((tab) => React.createElement('button', {
          key: tab.id,
          ref: (node) => {
            if (node === null) nodes.current.delete(tab.id)
            else nodes.current.set(tab.id, node)
          },
          type: 'button',
          role: 'tab',
          id: `dshPlatformTab-${tab.id}`,
          className: active === tab.id ? 'dshPlatformTab isActive' : 'dshPlatformTab',
          'aria-selected': active === tab.id,
          'aria-controls': `dshPlatformPanel-${tab.id}`,
          tabIndex: active === tab.id ? 0 : -1,
          onClick: () => onSelect(tab.id)
        }, t(tab.label))))
    }

    function Panel({ id, active, children }) {
      return React.createElement('div', {
        className: 'dshPlatformPanel',
        role: 'tabpanel',
        id: `dshPlatformPanel-${id}`,
        'aria-labelledby': `dshPlatformTab-${id}`,
        hidden: !active
      }, children)
    }

    /* ── 用量统计 ────────────────────────────────────────────────────────────
       The plugin route folds the registry archive set with the stored session
       headers, so titles and timestamps come from one call. This is a read-only
       cache-backed scan: opening the page does not re-walk every stored log. */
    function QuotaCard({ t, summary, scope }) {
      const snapshot = React.useSyncExternalStore(
        (listener) => scope.subscribe(listener),
        () => scope.getSnapshot()
      )
      const quota = summary === null ? null : summary.quota
      const configured = quota === null ? null : snapshot.value ?? {}
      const [rates, setRates] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [saved, setSaved] = React.useState(false)
      const [error, setError] = React.useState('')
      const values = rates ?? {
        creditsPerMillionInput: String(configured?.creditsPerMillionInput ?? 0),
        creditsPerMillionOutput: String(configured?.creditsPerMillionOutput ?? 0),
        quotaCredits: String(configured?.quotaCredits ?? 0)
      }
      React.useEffect(() => {
        setRates(null)
      }, [snapshot.revision])
      const writable = snapshot.writable === true && snapshot.status === 'ready'
      const dirty = rates !== null
      const save = async () => {
        setSaving(true)
        setSaved(false)
        setError('')
        try {
          const parse = (raw) => {
            const parsed = Number(raw)
            return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
          }
          // One atomic write for all three fields: the form controller carries
          // the revision, so a concurrent edit is refused as a whole instead of
          // landing half-applied.
          const accepted = await scope.mutate([
            { op: 'set', path: ['creditsPerMillionInput'], value: parse(values.creditsPerMillionInput) },
            { op: 'set', path: ['creditsPerMillionOutput'], value: parse(values.creditsPerMillionOutput) },
            { op: 'set', path: ['quotaCredits'], value: parse(values.quotaCredits) }
          ])
          if (!accepted) throw new Error(t('quota.rejected'))
          setSaved(true)
        } catch (failure) {
          setError(messageOf(failure))
        } finally {
          setSaving(false)
        }
      }
      const field = (key) => React.createElement('label', { className: 'dshPlatformField' },
        React.createElement('span', { className: 'dshPlatformFieldLabel' }, t(`quota.${key}`)),
        React.createElement('input', {
          className: 'dshPlatformInput',
          type: 'number',
          min: '0',
          step: 'any',
          disabled: !writable || saving,
          value: values[key],
          onChange: (event) => setRates({ ...values, [key]: event.target.value })
        }))

      const ratio = quota === null ? null : quota.ratio
      const over = ratio !== null && ratio > 1
      return React.createElement(Card, { title: t('quota.title') },
        React.createElement('p', { className: 'dshPlatformIntro' }, t('quota.intro')),
        React.createElement('div', { className: 'dshPlatformGrid' },
          React.createElement(Stat, { label: t('quota.used'), value: quota === null ? '—' : formatCredits(quota.usedCredits) }),
          React.createElement(Stat, { label: t('quota.remaining'), value: quota === null || quota.remainingCredits === null ? '—' : formatCredits(quota.remainingCredits) })),
        ratio === null
          ? React.createElement('p', { className: 'dshPlatformNote' }, t('quota.unset'))
          : React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'dshPlatformMeter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.min(100, Math.round(ratio * 100)), 'aria-label': t('quota.used') },
              React.createElement('div', { className: over ? 'dshPlatformMeterFillOver' : 'dshPlatformMeterFill', style: { width: `${Math.min(100, Math.max(0, ratio * 100))}%` } })),
            React.createElement('p', { className: over ? 'dshPlatformError' : 'dshPlatformNote', role: over ? 'alert' : undefined },
              `${Math.round(ratio * 100)}%${over ? ` · ${t('quota.over')}` : ''}`)),
        React.createElement('div', { className: 'dshPlatformFields' },
          field('inputRate'),
          field('outputRate'),
          field('limit')),
        React.createElement('div', { className: 'dshPlatformBar' },
          React.createElement('span', { className: 'dshPlatformBarSpacer' }),
          React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: !writable || saving || !dirty, onClick: () => void save() },
            saving ? t('quota.saving') : t('quota.save'))),
        saved && React.createElement('p', { className: 'dshPlatformNoteSuccess', role: 'status' }, t('quota.saved')),
        error !== '' && React.createElement('p', { className: 'dshPlatformError', role: 'alert' }, t('quota.saveFailed', { message: error })))
    }

    function UsagePanel({ t, scope }) {
      const [summary, setSummary] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const disposedRef = React.useRef(false)
      React.useEffect(() => () => { disposedRef.current = true }, [])
      const load = React.useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const response = await fetch(SUMMARY_PATH, { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
          const payload = await response.json()
          if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
          if (!disposedRef.current) setSummary(payload)
        } catch (failure) {
          if (!disposedRef.current) setError(messageOf(failure))
        } finally {
          if (!disposedRef.current) setBusy(false)
        }
      }, [])
      React.useEffect(() => { void load() }, [load])

      const totals = summary?.totals
      const rows = summary?.byModel ?? []
      const days = (summary?.byDay ?? []).slice(-DAY_WINDOW)
      const peak = days.reduce((max, day) => Math.max(max, day.totalTokens), 0)
      return React.createElement('div', { className: 'dshPlatform' },
        React.createElement('div', { className: 'dshPlatformBar' },
          React.createElement('p', { className: 'dshPlatformIntro' }, t('intro')),
          React.createElement('span', { className: 'dshPlatformBarSpacer' }),
          React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy, onClick: () => void load() },
            busy ? t('refreshing') : t('refresh'))),
        busy && summary === null && React.createElement('p', { className: 'dshPlatformNote', role: 'status' }, t('loading')),
        error !== '' && React.createElement('p', { className: 'dshPlatformError', role: 'alert' }, t('error', { message: error })),
        summary !== null && React.createElement('p', { className: 'dshPlatformNote' }, t('scanned', { scanned: summary.scannedSessions, stored: summary.storedSessions })),
        summary !== null && (summary.failures?.length ?? 0) > 0 && React.createElement('p', { className: 'dshPlatformError', role: 'alert' }, t('failures', { count: summary.failures.length })),
        summary !== null && React.createElement(Card, { title: t('usage.title') },
          React.createElement('div', { className: 'dshPlatformGrid' },
            React.createElement(Stat, { label: t('stat.sessions'), value: formatNumber(summary.storedSessions) }),
            React.createElement(Stat, { label: t('stat.requests'), value: formatNumber(totals.requests) }),
            React.createElement(Stat, { label: t('stat.turns'), value: formatNumber(totals.turns) }),
            React.createElement(Stat, { label: t('stat.input'), value: formatNumber(totals.inputTokens) }),
            React.createElement(Stat, { label: t('stat.output'), value: formatNumber(totals.outputTokens) }),
            React.createElement(Stat, { label: t('stat.cacheRead'), value: formatNumber(totals.cacheReadTokens) }),
            React.createElement(Stat, { label: t('stat.cacheWrite'), value: formatNumber(totals.cacheWriteTokens) }),
            React.createElement(Stat, { label: t('stat.reasoning'), value: formatNumber(totals.reasoningTokens) }),
            React.createElement(Stat, { label: t('stat.total'), value: formatNumber(totals.totalTokens) }))),
        summary !== null && React.createElement(QuotaCard, { t, summary, scope }),
        summary !== null && React.createElement(Card, { title: t('model.title') },
          rows.length === 0
            ? React.createElement('p', { className: 'dshPlatformNote' }, t('model.empty'))
            : React.createElement('table', { className: 'dshPlatformTable' },
              React.createElement('thead', null, React.createElement('tr', null,
                React.createElement('th', { scope: 'col' }, t('model.column')),
                React.createElement('th', { scope: 'col' }, t('model.requests')),
                React.createElement('th', { scope: 'col' }, t('model.input')),
                React.createElement('th', { scope: 'col' }, t('model.output')),
                React.createElement('th', { scope: 'col' }, t('model.total')),
                React.createElement('th', { scope: 'col' }, t('model.share')))),
              React.createElement('tbody', null, rows.map((row) => React.createElement('tr', { key: row.key },
                React.createElement('td', null, row.model === '' ? row.provider : `${row.provider}/${row.model}`),
                React.createElement('td', null, formatNumber(row.requests)),
                React.createElement('td', null, formatNumber(row.inputTokens)),
                React.createElement('td', null, formatNumber(row.outputTokens)),
                React.createElement('td', null, formatNumber(row.totalTokens)),
                React.createElement('td', null, totals.totalTokens > 0 ? `${Math.round((row.totalTokens / totals.totalTokens) * 100)}%` : '—')))))),
        summary !== null && React.createElement(Card, { title: t('day.title', { days: DAY_WINDOW }) },
          days.length === 0
            ? React.createElement('p', { className: 'dshPlatformNote' }, t('day.empty', { days: DAY_WINDOW }))
            : React.createElement('div', { className: 'dshPlatformDays' }, days.map((day) => React.createElement('div', { className: 'dshPlatformDay', key: day.day },
              React.createElement('span', { className: 'dshPlatformDayLabel' }, day.day),
              React.createElement('span', { className: 'dshPlatformDayMeter' },
                React.createElement('span', { className: 'dshPlatformMeter' },
                  React.createElement('span', { className: 'dshPlatformMeterFill', style: { width: peak > 0 ? `${Math.max(2, (day.totalTokens / peak) * 100)}%` : '0%' } }))),
              React.createElement('span', { className: 'dshPlatformDayValue' }, formatNumber(day.totalTokens)))))),
        summary !== null && React.createElement(Card, { title: t('session.title') },
          (summary.sessions?.length ?? 0) === 0
            ? React.createElement('p', { className: 'dshPlatformNote' }, t('session.empty'))
            : React.createElement('table', { className: 'dshPlatformTable' },
              React.createElement('thead', null, React.createElement('tr', null,
                React.createElement('th', { scope: 'col' }, t('session.column')),
                React.createElement('th', { scope: 'col' }, t('model.requests')),
                React.createElement('th', { scope: 'col' }, t('stat.turns')),
                React.createElement('th', { scope: 'col' }, t('model.total')))),
              React.createElement('tbody', null, summary.sessions.map((session) => React.createElement('tr', { key: session.id },
                React.createElement('td', null, session.id),
                React.createElement('td', null, formatNumber(session.requests)),
                React.createElement('td', null, formatNumber(session.turns)),
                React.createElement('td', null, formatNumber(session.totalTokens))))))),
        summary !== null && totals.requests === 0 && React.createElement('p', { className: 'dshPlatformNote' }, t('empty')))
    }

    /**
     * A modal that keeps its own promises: focus moves in on open and is trapped
     * while it is, Esc and the backdrop close it, and neither works while `busy`
     * — cancelling a delete halfway would leave the user unsure whether it ran.
     */
    function ConfirmDialog({ t, title, body, confirmLabel, busy, onCancel, onConfirm }) {
      const nodeRef = React.useRef(null)
      React.useEffect(() => {
        const node = nodeRef.current
        if (node === null) return undefined
        const focusables = () => [...node.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')]
        focusables()[0]?.focus()
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            if (!busy) onCancel()
            return
          }
          if (event.key !== 'Tab') return
          const items = focusables()
          if (items.length === 0) return
          const at = items.indexOf(document.activeElement)
          const next = event.shiftKey
            ? (at <= 0 ? items.length - 1 : at - 1)
            : (at === items.length - 1 || at < 0 ? 0 : at + 1)
          event.preventDefault()
          items[next]?.focus()
        }
        node.addEventListener('keydown', onKeyDown)
        return () => { node.removeEventListener('keydown', onKeyDown) }
      }, [busy, onCancel])
      return React.createElement('div', {
        className: 'dshPlatformOverlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget && !busy) onCancel() }
      },
        React.createElement('div', {
          className: 'dshPlatformDialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dshPlatformDialogTitle',
          ref: nodeRef
        },
          React.createElement('h2', { className: 'dshPlatformDialogTitle', id: 'dshPlatformDialogTitle' }, title),
          body,
          React.createElement('div', { className: 'dshPlatformBar' },
            React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy, onClick: onCancel }, t('dialog.cancel')),
            React.createElement('button', {
              className: 'dshPlatformButton dshPlatformDanger',
              type: 'button',
              disabled: busy,
              onClick: onConfirm
            }, busy ? t('archive.deleting') : confirmLabel))))
    }

    /* ── 归档历史 ────────────────────────────────────────────────────────────
       The desktop sidebar hides archived sessions everywhere — this tab is the
       only surface they appear on. 还原 drops the id from the archive set;
       删除 goes through the Host's own `session.delete` remote, which disposes a
       live agent, deletes the stored log and then updates workspace/archive
       state — the same sequence, with the same guards, as deleting a session
       from the session list. Re-implementing that here would mean re-implementing
       its busy and ownership checks, so the tab calls the Host instead. */
    function ArchivePanel({ t, host }) {
      const [status, setStatus] = React.useState('loading')
      const [items, setItems] = React.useState([])
      const [error, setError] = React.useState('')
      const [note, setNote] = React.useState('')
      const [busyId, setBusyId] = React.useState(null)
      const [selected, setSelected] = React.useState(() => new Set())
      const [confirm, setConfirm] = React.useState(null)
      const disposedRef = React.useRef(false)
      React.useEffect(() => () => { disposedRef.current = true }, [])
      const load = React.useCallback(async () => {
        setStatus('loading')
        setError('')
        try {
          const data = await platformFetch(ARCHIVE_LIST_PATH)
          const rows = (data?.sessions ?? []).map((session) => ({
            sessionId: session.sessionId,
            title: session.title ?? '',
            updatedAt: session.updatedAt
          }))
          if (disposedRef.current) return
          setItems(rows)
          // A selection that outlives its row would delete a session the user can
          // no longer see, so drop whatever the listing no longer carries.
          setSelected((current) => {
            const alive = new Set(rows.map((row) => row.sessionId))
            const kept = new Set([...current].filter((id) => alive.has(id)))
            return kept.size === current.size ? current : kept
          })
          setStatus('ready')
        } catch (failure) {
          if (disposedRef.current) return
          setError(t('archive.error', { message: messageOf(failure) }))
          setStatus('ready')
        }
      }, [t])
      React.useEffect(() => { void load() }, [load])

      const labelOf = (session) => (typeof session.title === 'string' && session.title !== '' ? session.title : t('archive.untitled'))
      const busy = busyId !== null
      const canDelete = host !== null && host.session !== null

      const restore = async (sessionId) => {
        setBusyId(sessionId)
        setError('')
        setNote('')
        try {
          await platformFetch(RESTORE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId })
          })
          await load()
        } catch (failure) {
          if (!disposedRef.current) setError(t('archive.restoreFailed', { message: messageOf(failure) }))
        } finally {
          if (!disposedRef.current) setBusyId(null)
        }
      }

      /**
       * Run the Host delete for every chosen id, then reload once.
       *
       * Every id is attempted even after one fails — a batch that silently
       * stopped halfway would leave the user guessing which rows survived. The
       * reload comes before the outcome message, because a reload clears the
       * error line and would otherwise wipe the failure the user has to read.
       */
      const runDelete = async (ids) => {
        setBusyId('delete')
        setError('')
        setNote('')
        const done = []
        let failure = null
        for (const sessionId of ids) {
          try {
            const result = await host.session.delete({ sessionId })
            if (result?.deleted === true) done.push(sessionId)
          } catch (error) {
            if (failure === null) failure = error
          }
        }
        if (disposedRef.current) return
        setBusyId(null)
        setConfirm(null)
        if (done.length > 0) {
          setSelected((current) => new Set([...current].filter((id) => !done.includes(id))))
        }
        await load()
        if (disposedRef.current) return
        if (failure !== null) {
          setError(t('archive.deleteFailed', { message: messageOf(failure) }))
          return
        }
        if (done.length > 0) {
          setNote(done.length === 1 ? t('archive.deletedOne') : t('archive.deletedMany', { count: done.length }))
        }
      }

      const toggle = (sessionId) => setSelected((current) => {
        const next = new Set(current)
        if (next.has(sessionId)) next.delete(sessionId)
        else next.add(sessionId)
        return next
      })
      const allSelected = items.length > 0 && items.every((row) => selected.has(row.sessionId))
      const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((row) => row.sessionId)))
      const chosen = items.filter((row) => selected.has(row.sessionId))
      const title = (session) => labelOf(session)

      const body = (sessions) => React.createElement(React.Fragment, null,
        React.createElement('p', { className: 'dshPlatformDialogNote', id: 'dshPlatformDialogWarn' }, t('archive.deleteWarn')),
        React.createElement('ul', { className: 'dshPlatformDialogList' }, sessions.slice(0, 5).map((session) =>
          React.createElement('li', { key: session.sessionId }, title(session)))),
        sessions.length > 5 && React.createElement('p', { className: 'dshPlatformDialogNote' }, t('archive.more', { count: sessions.length - 5 })))

      return React.createElement('div', { className: 'dshPlatform' },
        React.createElement('div', { className: 'dshPlatformBar' },
          React.createElement('p', { className: 'dshPlatformIntro' }, t('archive.intro')),
          React.createElement('span', { className: 'dshPlatformBarSpacer' }),
          React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: status === 'loading', onClick: () => void load() },
            status === 'loading' ? t('archive.refreshing') : t('archive.refresh'))),
        status === 'loading' && items.length === 0 && React.createElement('p', { className: 'dshPlatformNote', role: 'status' }, t('archive.loading')),
        error !== '' && React.createElement('p', { className: 'dshPlatformError', role: 'alert' }, error),
        note !== '' && React.createElement('p', { className: 'dshPlatformNoteSuccess', role: 'status' }, note),
        status === 'ready' && error === '' && items.length === 0 && React.createElement('p', { className: 'dshPlatformNote' }, t('archive.empty')),
        items.length > 0 && React.createElement(Card, { title: t('tab.archive') },
          canDelete && React.createElement('div', { className: 'dshPlatformBar' },
            React.createElement('label', { className: 'dshPlatformCheckLabel' },
              React.createElement('input', {
                type: 'checkbox',
                className: 'dshPlatformCheckbox',
                checked: allSelected,
                disabled: busy,
                'aria-label': t('archive.selectAll'),
                onChange: toggleAll
              }),
              React.createElement('span', null, t('archive.selectAll'))),
            React.createElement('span', { className: 'dshPlatformBarSpacer' }),
            selected.size > 0 && React.createElement('span', { className: 'dshPlatformNote', role: 'status' }, t('archive.selected', { count: selected.size })),
            selected.size > 0 && React.createElement('button', {
              className: 'dshPlatformButton',
              type: 'button',
              disabled: busy,
              onClick: () => setSelected(new Set())
            }, t('archive.clearSelection')),
            selected.size > 0 && React.createElement('button', {
              className: 'dshPlatformButton dshPlatformDanger',
              type: 'button',
              disabled: busy,
              onClick: () => setConfirm({ sessions: chosen, ids: chosen.map((row) => row.sessionId) })
            }, busyId === 'delete' ? t('archive.deleting') : t('archive.deleteSelected', { count: selected.size }))),
          React.createElement('table', { className: 'dshPlatformTable' },
            React.createElement('thead', null, React.createElement('tr', null,
              canDelete && React.createElement('th', { scope: 'col' }, React.createElement('input', {
                type: 'checkbox',
                className: 'dshPlatformCheckbox',
                checked: allSelected,
                disabled: busy,
                'aria-label': t('archive.selectAll'),
                onChange: toggleAll
              })),
              React.createElement('th', { scope: 'col' }, t('archive.columnSession')),
              React.createElement('th', { scope: 'col' }, t('archive.columnUpdated')),
              React.createElement('th', { scope: 'col' }, t('archive.columnActions')))),
            React.createElement('tbody', null, items.map((session) => React.createElement('tr', { key: session.sessionId },
              canDelete && React.createElement('td', null, React.createElement('input', {
                type: 'checkbox',
                className: 'dshPlatformCheckbox',
                checked: selected.has(session.sessionId),
                disabled: busy,
                'aria-label': t('archive.selectRow', { title: labelOf(session) }),
                onChange: () => toggle(session.sessionId)
              })),
              React.createElement('td', null, labelOf(session)),
              React.createElement('td', null, typeof session.updatedAt === 'number' ? new Date(session.updatedAt).toLocaleString() : '—'),
              React.createElement('td', { className: 'dshPlatformActions' },
                React.createElement('button', {
                  className: 'dshPlatformButton',
                  type: 'button',
                  disabled: busy,
                  onClick: () => { void restore(session.sessionId) }
                }, busyId === session.sessionId ? t('archive.restoring') : t('archive.restore')),
                canDelete && React.createElement('button', {
                  className: 'dshPlatformButton dshPlatformDanger',
                  type: 'button',
                  disabled: busy,
                  onClick: () => setConfirm({ sessions: [session], ids: [session.sessionId] })
                }, t('archive.delete')))))))),
        confirm !== null && React.createElement(ConfirmDialog, {
          t,
          title: confirm.ids.length === 1
            ? t('archive.deleteOneTitle')
            : t('archive.deleteManyTitle', { count: confirm.ids.length }),
          body: body(confirm.sessions),
          confirmLabel: t('archive.confirmDelete'),
          busy: busyId === 'delete',
          onCancel: () => setConfirm(null),
          onConfirm: () => { void runDelete(confirm.ids) }
        }))
    }

    /* ── 记忆系统 ────────────────────────────────────────────────────────────
       MEMORY.md per workspace root is the memory store; the harness ingests it
       as workspace instructions for every session in that workspace. The
       toggle manages a marked convention block in AGENTS.md that tells the
       agent to maintain the file — removing it never touches memory content. */
    function MemoryPanel({ t }) {
      const [roots, setRoots] = React.useState(null)
      const [root, setRoot] = React.useState(() => {
        try { return window.localStorage.getItem(ROOT_STORAGE_KEY) ?? '' } catch { return '' }
      })
      const [state, setState] = React.useState({ status: 'loading', content: '', exists: false, convention: false })
      const [handoff, setHandoff] = React.useState({ status: 'loading', summary: '', generatedAt: null })
      const [handoffAuto, setHandoffAuto] = React.useState(true)
      const [handoffBusy, setHandoffBusy] = React.useState(false)
      const [dirty, setDirty] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [error, setError] = React.useState('')
      const disposedRef = React.useRef(false)
      React.useEffect(() => () => { disposedRef.current = true }, [])
      const loadRoots = React.useCallback(async () => {
        const data = await platformFetch(WORKSPACES_PATH)
        const list = (data?.workspaces ?? [])
          .map((workspace) => ({ path: workspace.path, title: workspace.title || workspace.path }))
          .filter((workspace) => typeof workspace.path === 'string' && workspace.path.length > 0)
        if (disposedRef.current) return
        setRoots(list)
        setRoot((current) => {
          if (list.some((workspace) => workspace.path === current)) return current
          return list[0]?.path ?? ''
        })
      }, [])
      const loadMemory = React.useCallback(async (target) => {
        if (target === '') return
        setState((current) => ({ ...current, status: 'loading' }))
        setError('')
        setNote('')
        setDirty(false)
        try {
          const data = await platformFetch(MEMORY_PATH + '?root=' + encodeURIComponent(target))
          if (!disposedRef.current) {
            setState({ status: 'ready', content: data.content ?? '', exists: data.exists === true, convention: data.convention === true })
          }
        } catch (failure) {
          if (!disposedRef.current) {
            setError(t('memory.loadError', { message: messageOf(failure) }))
            setState((current) => ({ ...current, status: 'ready' }))
          }
        }
      }, [t])
      const loadHandoff = React.useCallback(async (target) => {
        if (target === '') return
        setHandoff((current) => ({ ...current, status: 'loading' }))
        try {
          const data = await platformFetch(HANDOFF_PATH + '?root=' + encodeURIComponent(target))
          if (!disposedRef.current) {
            setHandoff({ status: 'ready', summary: data?.summary ?? '', generatedAt: data?.generatedAt ?? null })
          }
        } catch (failure) {
          if (!disposedRef.current) setHandoff({ status: 'ready', summary: '', generatedAt: null })
        }
      }, [])
      React.useEffect(() => {
        try { setHandoffAuto(window.localStorage.getItem(HANDOFF_AUTO_KEY) !== 'off') } catch {}
      }, [])
      React.useEffect(() => { loadRoots().catch((failure) => { if (!disposedRef.current) setError(messageOf(failure)) }) }, [loadRoots])
      React.useEffect(() => { void loadMemory(root) }, [root, loadMemory])
      React.useEffect(() => { void loadHandoff(root) }, [root, loadHandoff])
      const toggleHandoff = (event) => {
        const enabled = event.target.checked
        setHandoffAuto(enabled)
        try { window.localStorage.setItem(HANDOFF_AUTO_KEY, enabled ? 'on' : 'off') } catch {}
      }
      const generateHandoff = async () => {
        const bridge = typeof window === 'undefined' ? undefined : window.__dshDesktopHandoff
        const captured = bridge === undefined ? null : bridge.captureNow()
        if (captured === null || typeof captured.transcript !== 'string' || captured.transcript.length === 0) {
          setNote(t('memory.handoffNoSession'))
          return
        }
        setHandoffBusy(true)
        setError('')
        setNote('')
        try {
          const data = await platformFetch(HANDOFF_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ root, sessionId: captured.sessionId, transcript: captured.transcript })
          })
          if (!disposedRef.current) {
            if (data?.ok === true) {
              setHandoff({ status: 'ready', summary: data.summary ?? '', generatedAt: Date.now() })
              // The write happens behind the editor, so reload before saying
              // anything: otherwise the open textarea still holds the pre-write
              // text and the next 保存 would drop the handoff again.
              void loadMemory(root)
              setNote(t('memory.handoffSaved'))
            } else {
              // Known host statuses get their own sentence; anything else keeps
              // the raw code, which is still the fastest way to debug it.
              const status = typeof data?.status === 'string' ? data.status : ''
              const friendly = status === 'too-short' ? t('memory.handoffTooShort')
                : status === 'no-model' ? t('memory.handoffNoModel')
                  : status === 'runtime-unavailable' ? t('memory.handoffRuntimeDown')
                    : ''
              setError(friendly !== '' ? friendly : t('memory.handoffFailed', { message: status || data?.error || 'unknown' }))
            }
          }
        } catch (failure) {
          if (!disposedRef.current) setError(t('memory.handoffFailed', { message: messageOf(failure) }))
        } finally {
          if (!disposedRef.current) setHandoffBusy(false)
        }
      }
      const pickRoot = (path) => {
        setRoot(path)
        try { window.localStorage.setItem(ROOT_STORAGE_KEY, path) } catch {}
      }
      const save = async () => {
        setBusy(true)
        setError('')
        setNote('')
        try {
          await platformFetch(MEMORY_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ root, content: state.content })
          })
          if (!disposedRef.current) {
            setState((current) => ({ ...current, exists: true }))
            setNote(t('memory.saved'))
            setDirty(false)
          }
        } catch (failure) {
          if (!disposedRef.current) setError(t('memory.saveFailed', { message: messageOf(failure) }))
        } finally {
          if (!disposedRef.current) setBusy(false)
        }
      }
      const importFile = async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file === undefined) return
        const text = await file.text()
        if (!disposedRef.current) {
          setState((current) => ({
            ...current,
            content: current.content.trimEnd() + (current.content.trim() === '' ? '' : '\n\n') + text.trim()
          }))
          setNote(t('memory.imported'))
          setDirty(true)
        }
      }
      const toggleConvention = async (event) => {
        const enabled = event.target.checked
        setBusy(true)
        setError('')
        setNote('')
        try {
          await platformFetch(CONVENTION_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ root, enabled })
          })
          if (!disposedRef.current) setState((current) => ({ ...current, convention: enabled }))
        } catch (failure) {
          if (!disposedRef.current) setError(t('memory.conventionFailed', { message: messageOf(failure) }))
        } finally {
          if (!disposedRef.current) setBusy(false)
        }
      }
      if (roots !== null && roots.length === 0) {
        return React.createElement('div', { className: 'dshPlatform' },
          React.createElement('p', { className: 'dshPlatformIntro' }, t('memory.intro')),
          React.createElement('p', { className: 'dshPlatformNote' }, t('memory.pickWorkspaceFailed')))
      }
      return React.createElement('div', { className: 'dshPlatform' },
        React.createElement('p', { className: 'dshPlatformIntro' }, t('memory.intro')),
        React.createElement('div', { className: 'dshPlatformBar' },
          React.createElement('label', { className: 'dshPlatformMeta', htmlFor: 'dshDesktopMemoryRootSelect' }, t('memory.workspace')),
          React.createElement('select', {
            id: 'dshDesktopMemoryRootSelect',
            className: 'dshPlatformSelect',
            value: root,
            onChange: (event) => pickRoot(event.target.value)
          }, (roots ?? []).map((workspace) => React.createElement('option', { key: workspace.path, value: workspace.path }, workspace.title)))),
        state.status === 'loading' && React.createElement('p', { className: 'dshPlatformNote', role: 'status' }, t('memory.loading')),
        state.status === 'ready' && !state.exists && React.createElement('p', { className: 'dshPlatformNote' }, t('memory.empty')),
        error !== '' && React.createElement('p', { className: 'dshPlatformError', role: 'alert' }, error),
        note !== '' && React.createElement('p', { className: 'dshPlatformNoteSuccess', role: 'status' }, note),
        React.createElement('textarea', {
          className: 'dshPlatformTextarea',
          spellCheck: false,
          'aria-label': t('memory.workspace') + ' · MEMORY.md',
          disabled: root === '' || state.status === 'loading',
          value: state.content,
          onChange: (event) => {
            const content = event.target.value
            setState((current) => ({ ...current, content }))
            setDirty(true)
          }
        }),
        React.createElement('div', { className: 'dshPlatformBar' },
          React.createElement('button', {
            className: 'dshPlatformButton',
            type: 'button',
            disabled: busy || root === '' || !dirty,
            onClick: () => { void save() }
          }, busy ? t('memory.saving') : t('memory.save')),
          React.createElement('label', { className: 'dshPlatformButton' },
            t('memory.import'),
            React.createElement('input', { type: 'file', accept: '.md,.txt,text/markdown,text/plain', style: { display: 'none' }, onChange: (event) => { void importFile(event) } }))),
        React.createElement(Card, { title: t('memory.convention') },
          React.createElement('div', { className: 'dshPlatformSwitchRow' },
            React.createElement('input', {
              type: 'checkbox',
              className: 'dshPlatformCheckbox',
              checked: state.convention,
              disabled: busy || root === '',
              onChange: (event) => { void toggleConvention(event) }
            }),
            React.createElement('div', { className: 'dshPlatformSwitchCopy' },
              React.createElement('span', { className: 'dshPlatformMeta' }, t('memory.conventionHint')),
              React.createElement('span', { className: 'dshPlatformMeta' },
                state.convention ? t('memory.conventionOn') : t('memory.conventionOff'))))),
        React.createElement(Card, { title: t('memory.handoff') },
          React.createElement('div', { className: 'dshPlatformSwitchRow' },
            React.createElement('input', {
              type: 'checkbox',
              className: 'dshPlatformCheckbox',
              checked: handoffAuto,
              disabled: root === '',
              onChange: (event) => toggleHandoff(event)
            }),
            React.createElement('div', { className: 'dshPlatformSwitchCopy' },
              React.createElement('span', { className: 'dshPlatformMeta' }, t('memory.handoffHint')),
              React.createElement('span', { className: 'dshPlatformMeta' },
                handoffAuto ? t('memory.handoffOn') : t('memory.handoffOff')))),
          handoff.status === 'ready' && handoff.summary === '' &&
            React.createElement('p', { className: 'dshPlatformNote' }, t('memory.handoffEmpty')),
          handoff.summary !== '' && React.createElement('pre', { className: 'dshPlatformHandoff' }, handoff.summary),
          React.createElement('div', { className: 'dshPlatformBar' },
            React.createElement('button', {
              className: 'dshPlatformButton',
              type: 'button',
              disabled: handoffBusy || root === '',
              onClick: () => { void generateHandoff() }
            }, handoffBusy ? t('memory.handoffGenerating') : t('memory.handoffGenerate')))))
    }

    /**
     * The page: one tab strip over three panels.
     *
     * `visited` is what makes the memory editor safe: a panel mounts the first
     * time its tab is opened and then stays mounted (hidden, not unmounted), so
     * switching tabs and back never discards unsaved text or re-requests what
     * is already on screen.
     */
    function PlatformSection({ t, scope, host, slots, locale }) {
      const [active, setActive] = React.useState(storedTab)
      const [visited, setVisited] = React.useState(() => new Set([storedTab()]))
      const select = (id) => {
        setActive(id)
        rememberTab(id)
        setVisited((current) => (current.has(id) ? current : new Set(current).add(id)))
      }
      const panel = (id, child) =>
        visited.has(id) ? React.createElement(Panel, { id, active: active === id }, child) : null
      const tabPanel = (tab, child) => panel(tab.id, tab.foreign !== undefined
        ? React.createElement(ForeignPage, { t, slots, locale, sectionId: tab.foreign.sectionId, missing: t(tab.foreign.missing) })
        : child)
      return React.createElement('div', { className: 'dshPlatform' },
        React.createElement(TabBar, { t, active, onSelect: select }),
        React.createElement('div', { className: 'dshPlatformPanels' },
          tabPanel(TABS[0], React.createElement(UsagePanel, { t, scope })),
          tabPanel(TABS[1], React.createElement(ArchivePanel, { t, host })),
          tabPanel(TABS[2], React.createElement(MemoryPanel, { t })),
          tabPanel(TABS[3], null)))
    }
    /**
     * A page contributed by another plugin, rendered inside this one.
     *
     * The slot ledger is the one place the shell and the plugins agree on, and
     * `ctx.slots.entries()` hands back each registration together with its
     * component — so a page another plugin already wrote can be mounted here
     * without copying a line of it, and without this plugin having to know
     * anything about that plugin's routes, storage or credentials. If the owner
     * is absent (not installed, or not loaded yet) this degrades to a note
     * rather than an empty page.
     */
    function ForeignPage({ t, slots, locale, sectionId, missing }) {
      // The ledger is the dependency: re-read it whenever any registration
      // changes, because the owner plugin may mount after this page does.
      const version = React.useSyncExternalStore(
        (listener) => slots.subscribe('settings.section', listener),
        () => slots.getVersion('settings.section')
      )
      const entries = slots.entries('settings.section')
      const entry = entries.find((candidate) => candidate.options.id === sectionId)
      if (version !== undefined && entry === undefined) {
        return React.createElement('div', { className: 'dshPlatform' },
          React.createElement('p', { className: 'dshPlatformNote' }, missing))
      }
      const Page = entry.component
      // The shell hands a settings section two things this page must supply
      // itself: `close`, and `t` bound to the registering plugin's own copy
      // namespace. `t` is read on the first line of that page, so omitting it
      // throws during render and the whole tab comes up empty — bind the
      // namespace the registration declares, and fall back to echoing the key
      // rather than throwing when a registration declares none.
      // The registration copies `locale` onto the entry itself, beside
      // `inject` and `store` — `entry.options` only ever carries
      // key/id/order/label/priority.
      const namespace = entry.locale
      const translate = typeof namespace === 'string' && locale !== undefined && locale !== null
        ? locale.bind(namespace)
        : (key) => key
      return React.createElement(Page, { close: () => {}, t: translate })
    }

    const inject = ['slots', 'locale', 'configForms']
    function apply(ctx) {
      installStyles()
      // Permanent deletion goes through the Host's own `session.delete`
      // remote, so a delete inherits the same guards the session list has
      // (live agent, subagent ownership, not-found). It is filled in
      // asynchronously and may never arrive: until it does, the archive tab
      // simply offers no delete, and everything else keeps working.
      const host = { session: null }
      ctx.inject(['remote', 'remote.session'], (child) => { host.session = child.remote.session })
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-desktop-platform: copy dictionaries')
      const t = ctx.locale.bind(NS)
      // `settingsScope` was removed in 0.1.7. Its replacement is `configForms`:
      // one shared form controller per Loader entry id, backed by
      // `remote.settings` — same snapshot shape (`value` / `revision` /
      // `writable` / `status`) and the same write API, but writes resolve to
      // whether the Host accepted them instead of throwing.
      const scope = ctx.configForms.get(SETTINGS_NAMESPACE)
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'desktop-platform',
            order: SECTION_ORDER,
            label: () => t('nav'),
            inject: () => ({ t, scope, host, slots: ctx.slots, locale: ctx.locale })
          },
          PlatformSection
        )
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})