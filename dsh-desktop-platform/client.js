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
      // The FreeModel pages live behind this one tab, under their own nav.
      { id: 'freemodel', label: 'tab.freemodel' }
    ]
    const en = {
      nav: 'Platform',
      "tab.usage": 'Usage',
      "tab.archive": 'Archived sessions',
      "tab.memory": 'Memory',
      "tab.freemodel": 'FreeModel',
      "fm.title": 'FreeModel features',
      "fm.upgrade": 'Upgrade',
      "fm.eac": 'EAC models',
      "fm.aggregate": 'Aggregate',
      "fm.saver": 'Save tokens',
      "fm.routing": 'Routing',
      "fm.dashboard": 'Dashboard',
      "fm.logs": 'Call log',
      "fm.gateway": 'Gateway',
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
      "owner.absent": 'The FreeModel plugin (dsh-our-free-model) is not installed or not loaded, so these pages have nothing to read. Install or enable it, then reload this tab.',
      "owner.loading": 'Reading FreeModel…',
      "owner.failed": 'FreeModel request failed: {message}',
      "owner.retry": 'Retry',
      "owner.show": 'Show',
      "owner.hide": 'Hide',
      "owner.rotate": 'Rotate',
      "owner.noKey": '(not set)',
      "upgrade.intro": 'Upgrade the FreeModel plugin in place: it verifies the download, backs the current copy up, replaces the files and hot-reloads. Every step rolls back on failure.',
      "upgrade.current": 'Current',
      "upgrade.installed": 'Installed',
      "upgrade.latest": 'Latest',
      "upgrade.available": 'Update available: {version}',
      "upgrade.upToDate": 'Up to date',
      "upgrade.applying": 'Upgrading…',
      "upgrade.recovery": 'Recovery required — an upgrade did not finish',
      "upgrade.backup": 'Backup',
      "upgrade.checkedAt": 'Last checked',
      "upgrade.never": 'never',
      "upgrade.check": 'Check for updates',
      "upgrade.checking": 'Checking…',
      "upgrade.checked": 'Checked. The status above is current.',
      "upgrade.apply": 'Upgrade now',
      "upgrade.applied": 'Upgraded and reloaded.',
      "upgrade.reload": 'Hot reload',
      "upgrade.reloading": 'Reloading…',
      "upgrade.reloaded": 'Plugin hot-reloaded.',
      "saver.intro": 'Shrink what goes over the wire: tool output is compressed before the request leaves, and two prompt families change how the assistant answers. Nothing here is sent upstream.',
      "saver.switches": 'Switches',
      "saver.master": 'Token saving',
      "saver.masterHint": 'The master switch governs all three savers below.',
      "saver.rtk": 'Compress tool output',
      "saver.rtkHint": 'Rewrites git diff/status/log, grep, find, ls, tree, build logs and repeated log lines in place before the request is sent.',
      "saver.prompts": 'Prompt shaping',
      "saver.caveman": 'Caveman (terse answers)',
      "saver.ponytail": 'Ponytail (minimal implementation)',
      "saver.local": 'Local answers',
      "saver.kind.quota": 'Quota probe',
      "saver.kindHint.quota": 'Answers “how much is left” locally instead of spending a round trip.',
      "saver.kind.prefix": 'Command prefix',
      "saver.kindHint.prefix": 'Answers the prefix a permission prompt asks for, locally.',
      "saver.kind.title": 'Session title',
      "saver.kindHint.title": 'Generates session titles without a provider call.',
      "saver.kind.suggestion": 'Suggestion mode',
      "saver.kindHint.suggestion": 'Answers an empty suggestion turn locally.',
      "saver.kind.filepath": 'File paths',
      "saver.kindHint.filepath": 'Extracts the paths a command read, locally.',
      "saver.savings": 'Measured savings',
      "saver.noData": 'No measured traffic yet — the numbers appear after a few calls.',
      "saver.bytesBefore": 'Before',
      "saver.bytesAfter": 'After',
      "saver.bytesSaved": 'Saved',
      "saver.blocks": 'Blocks',
      "saver.calls": 'Calls',
      "saver.promptCalls": 'Prompt calls',
      "gateway.intro": 'The FreeModel plugin runs a loopback gateway other tools on this machine can call. These are its current values; the keys only leave the plugin when you ask.',
      "gateway.local": 'Local gateway',
      "gateway.lan": 'LAN relay',
      "gateway.channel": 'Channel gateway',
      "gateway.models": 'Published models',
      "gateway.modelsHint": '{count} model id(s) are published on /v1/models.',
      "gateway.key": 'API key',
      "gateway.lanKey": 'Relay key',
      "gateway.lanPort": 'Relay port',
      "gateway.port": 'Port',
      "gateway.running": 'Running',
      "gateway.stopped": 'Stopped',
      "gateway.noAddress": 'The relay is not publishing an address right now.',
      "routing.intro": 'A chain is one model id that stands for an ordered list. The first candidate that produces output wins, and a link that dies before any output is dropped without the caller seeing it.',
      "routing.chains": 'Chains ({count})',
      "routing.empty": 'No chain yet. Add one to get a combo: model in the selector, combo: in the gateway.',
      "routing.newChain": 'New chain',
      "routing.editChain": 'Edit chain',
      "routing.name": 'Name',
      "routing.strategy": 'Strategy',
      "routing.sticky": 'Sticky rounds',
      "routing.models": 'Models, one per line',
      "routing.available": '{count} model id(s) are currently published; paste the ones you want, in order.',
      "routing.save": 'Save chain',
      "routing.saving": 'Saving…',
      "routing.saved": 'Chain saved.',
      "routing.cancel": 'Cancel',
      "routing.edit": 'Edit',
      "routing.enable": 'Enable',
      "routing.disable": 'Disable',
      "routing.enabled": 'Enabled',
      "routing.disabled": 'Disabled',
      "routing.delete": 'Delete',
"tab.eac": 'FreeModel · EAC models',
      "eac.intro": 'The EAC lane is the co-paid channel: it answers with a GitHub identity you authorise once, and the plugin holds the token — this page only starts the flow, polls it and signs out.',
      "eac.laneReady": 'EAC lane configured',
      "eac.laneMissing": 'EAC lane not configured',
      "eac.laneMissingHint": 'No EAC endpoint is configured in the plugin, so there is nothing to sign in to.',
      "eac.authorized": 'Signed in',
      "eac.unauthorized": 'Not signed in',
      "eac.required": 'required by this endpoint',
      "eac.configured": 'GitHub app installed',
      "eac.starred": 'starred',
      "eac.reason": 'The endpoint said: {reason}',
      "eac.repo": 'Repository: {repo}',
      "eac.login": 'Sign in with GitHub',
      "eac.logout": 'Sign out',
      "eac.working": 'Working…',
      "eac.cancel": 'Cancel sign-in',
      "eac.pendingTitle": 'Waiting for GitHub',
      "eac.pendingHint": 'Open the link below, authorise the app, then come back here. This page checks the result every two seconds.',
      "eac.signedIn": 'Signed in as {login}.',
      "eac.signedOut": 'Signed out.',
      "eac.startFailed": 'The sign-in could not start: {reason}',
      "eac.pollFailed": 'The sign-in did not finish: {reason}',
      "eac.failed": 'EAC request failed: {message}',
      "aggregate.intro": 'The aggregate lane calls providers you bring yourself: paste a key per provider, pick the models you want, and every published model id stays under your own key. The key is stored by the plugin, never here.',
      "aggregate.search": 'Filter providers',
      "aggregate.providers": 'Providers ({count})',
      "aggregate.configure": 'Configure',
      "aggregate.on": 'on',
      "aggregate.off": 'off',
      "aggregate.verified": 'verified',
      "aggregate.empty": 'The owner reported no providers at all.',
      "aggregate.noMatch": 'No provider matches that filter.',
      "aggregate.editing": 'Configure {name}',
      "aggregate.baseUrl": 'Base URL',
      "aggregate.apiKey": 'API key',
      "aggregate.keyPlaceholder": 'Leave empty to keep the stored key',
      "aggregate.models": 'Model ids, comma or newline separated',
      "aggregate.registryModels": '{count} model id(s) configured for this provider.',
      "aggregate.enabled": 'Publish this provider',
      "aggregate.enabledHint": 'A provider that is off contributes no models to the picker.',
      "aggregate.save": 'Save',
      "aggregate.saving": 'Saving…',
      "aggregate.test": 'Test key',
      "aggregate.discover": 'Discover models',
      "aggregate.clearKey": 'Delete stored key',
      "aggregate.remove": 'Remove provider',
      "aggregate.working": 'Working…',
      "aggregate.saved": 'Provider saved.',
      "aggregate.removed": 'Provider removed.',
      "aggregate.testOk": 'The provider answered with its model list.',
      "aggregate.testFailed": 'The provider did not verify (status {status}).',
      "aggregate.lastTestOk": 'Last verified {at}.',
      "aggregate.lastTestFailed": 'Last check failed, {at}.',
      "aggregate.discovered": 'Discovered models ({count})',
      "aggregate.discoveredEmpty": 'The provider published no model list.',
      "dash.intro": 'The owner’s own accounting: what actually went over the wire, folded per model and per day. It counts the calls the plugin made, not the sessions the host stored — the two rarely agree, and each is right about its own thing.',
      "dash.calls": 'Calls',
      "dash.turns": 'Turns',
      "dash.success": 'Success',
      "dash.tokens": 'Tokens',
      "dash.saved": 'Saved',
      "dash.estimated": 'Some of these figures are estimated: the plugin has no lifetime failure count of its own yet, so failures are derived from the per-model rows.',
      "dash.byModel": 'By model',
      "dash.byDay": 'Last 14 days',
      "dash.empty": 'No traffic recorded in these 14 days.',
      "dash.noModels": 'No model has been called yet.',
      "dash.columnModel": 'Model',
      "dash.columnInput": 'Input',
      "dash.columnOutput": 'Output',
      "dash.columnReasoning": 'Reasoning',
      "dash.columnFailed": 'Failed',
      "dash.columnTps": 'tok/s',
      "dash.columnTtft": 'TTFT',
      "log.intro": 'The last 200 calls the plugin made, newest first: what was asked, what came back, and how long it took. A row marked truncated or no-usage is a call the wire cut short — those are the rows to read when a turn vanished.',
      "log.title": 'Recent calls',
      "log.onlyFailed": 'Only failed calls',
      "log.filterModel": 'Model',
      "log.allModels": 'All models',
      "log.pageSize": 'Per page',
      "log.count": '{shown} of {total} calls · page {page} of {pages}',
      "log.columnTime": 'Time',
      "log.columnModel": 'Model',
      "log.columnResult": 'Result',
      "log.columnDecode": 'Decode',
      "log.columnNotes": 'Notes',
      "log.ok": 'ok',
      "log.failed": 'failed',
      "log.truncated": 'cut short',
      "log.noUsage": 'no usage frame',
      "log.empty": 'No call has been recorded yet.',
      "log.noMatch": 'No call matches this filter.',
      "log.prev": 'Previous',
      "log.next": 'Next'
    }


    const zh = {
      nav: '综合平台',
      "tab.usage": '用量统计',
      "tab.archive": '归档历史',
      "tab.memory": '记忆系统',
      "tab.freemodel": 'FreeModel',
      "fm.title": 'FreeModel 功能',
      "fm.upgrade": '插件升级',
      "fm.eac": 'EAC 模型',
      "fm.aggregate": '聚合渠道',
      "fm.saver": '省 Token',
      "fm.routing": '路由',
      "fm.dashboard": '数据看板',
      "fm.logs": '运行日志',
      "fm.gateway": '网关设置',
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
      "memory.handoffEmpty": '还没有交接记录。离开会话时会自动生成，也可以点下面的按钮。',
      "memory.handoffTooShort": '这个会话还太短，暂时没有可交接的内容。',
      "memory.handoffNoModel": '还没有配置默认模型，生成不了摘要。',
      "memory.handoffRuntimeDown": '模型运行时当前不可用。',
      "memory.handoffNoSession": '请先把要交接的会话切到前台，再点生成。',
      "memory.handoffFailed": '交接生成失败：{message}',
      "memory.conventionFailed": '无法更新约定：{message}',
      "memory.pickWorkspaceFailed": '当前 Profile 还没有已注册的工作区。',
      "owner.absent": 'FreeModel 插件（dsh-our-free-model）未安装或尚未加载，这些页面没有数据可读。装上/启用它之后重新打开本页签。',
      "owner.loading": '正在读取 FreeModel…',
      "owner.failed": 'FreeModel 请求失败：{message}',
      "owner.retry": '重试',
      "owner.show": '显示',
      "owner.hide": '隐藏',
      "owner.rotate": '轮换',
      "owner.noKey": '（未设置）',
      "upgrade.intro": '就地升级 FreeModel 插件：校验下载 → 备份当前副本 → 替换文件 → 热重载，任一步失败自动回滚。',
      "upgrade.current": '当前',
      "upgrade.installed": '已安装',
      "upgrade.latest": '最新',
      "upgrade.available": '有新版本：{version}',
      "upgrade.upToDate": '已是最新',
      "upgrade.applying": '正在升级…',
      "upgrade.recovery": '需要恢复——上一次升级没有走完',
      "upgrade.backup": '备份',
      "upgrade.checkedAt": '上次检查',
      "upgrade.never": '从未',
      "upgrade.check": '检查更新',
      "upgrade.checking": '检查中…',
      "upgrade.checked": '已检查，上方状态是最新的。',
      "upgrade.apply": '立即升级',
      "upgrade.applied": '已升级并重载。',
      "upgrade.reload": '热重载',
      "upgrade.reloading": '重载中…',
      "upgrade.reloaded": '插件已热重载。',
      "saver.intro": '减少真正发出去的内容：工具输出在请求前被就地压缩，另有两族提示词改变助手说话的方式。这些都不额外上行。',
      "saver.switches": '开关',
      "saver.master": '省 Token 总开关',
      "saver.masterHint": '总开关统管下面三处设置。',
      "saver.rtk": '压缩工具输出',
      "saver.rtkHint": '在请求发出前重写 git diff/status/log、grep、find、ls、tree、构建日志与重复日志行。',
      "saver.prompts": '提示词档位',
      "saver.caveman": 'Caveman（电报体）',
      "saver.ponytail": 'Ponytail（YAGNI 最小实现）',
      "saver.local": '本地应答',
      "saver.kind.quota": '额度探测',
      "saver.kindHint.quota": '「还剩多少额度」在本地回答，不花一次请求。',
      "saver.kind.prefix": '命令前缀',
      "saver.kindHint.prefix": '权限提示里要的前缀，在本地回答。',
      "saver.kind.title": '会话标题',
      "saver.kindHint.title": '生成会话标题时不调用服务商。',
      "saver.kind.suggestion": '建议模式',
      "saver.kindHint.suggestion": '空的建议轮次在本地直接回答。',
      "saver.kind.filepath": '文件路径',
      "saver.kindHint.filepath": '本地提取命令读到的路径。',
      "saver.savings": '实测节省',
      "saver.noData": '还没有实测流量，跑几次调用后出现数字。',
      "saver.bytesBefore": '压缩前',
      "saver.bytesAfter": '压缩后',
      "saver.bytesSaved": '节省',
      "saver.blocks": '压缩块',
      "saver.calls": '统计调用',
      "saver.promptCalls": '提示词调用',
      "gateway.intro": 'FreeModel 插件跑了一个本机回环网关，供本机其它工具调用。下面是它当前的状态；Key 只在你主动索要时才离开插件。',
      "gateway.local": '本机网关',
      "gateway.lan": '局域网中继',
      "gateway.channel": '渠道网关',
      "gateway.models": '已发布的模型',
      "gateway.modelsHint": '/v1/models 上广播着 {count} 个模型 id。',
      "gateway.key": 'API Key',
      "gateway.lanKey": '中继 Key',
      "gateway.lanPort": '中继端口',
      "gateway.port": '端口',
      "gateway.running": '运行中',
      "gateway.stopped": '未运行',
      "gateway.noAddress": '中继当前没有对外发布地址。',
      "routing.intro": '一条链就是一个模型 id，代表一个有序列表。第一个真正产出正文的候选者胜出；在产出正文前失败的链路会被整段丢弃，调用方看不到。',
      "routing.chains": '链路（{count}）',
      "routing.empty": '还没有链路。加一条就能得到一个 combo：选择器里叫 combo:，网关上同名。',
      "routing.newChain": '新建链路',
      "routing.editChain": '编辑链路',
      "routing.name": '名称',
      "routing.strategy": '策略',
      "routing.sticky": '粘滞轮数',
      "routing.models": '模型，每行一个',
      "routing.available": '当前发布了 {count} 个模型 id，按顺序粘进上面的框即可。',
      "routing.save": '保存链路',
      "routing.saving": '保存中…',
      "routing.saved": '链路已保存。',
      "routing.cancel": '取消',
      "routing.edit": '编辑',
      "routing.enable": '启用',
      "routing.disable": '停用',
      "routing.enabled": '已启用',
      "routing.disabled": '已停用',
      "routing.delete": '删除',
"tab.eac": 'FreeModel · EAC 模型',
      "eac.intro": 'EAC 这条通道是「共付」路线：用 GitHub 身份授权一次，之后由插件保管凭据。本页只负责发起授权、轮询结果和退出。',
      "eac.laneReady": 'EAC 通道已配置',
      "eac.laneMissing": 'EAC 通道未配置',
      "eac.laneMissingHint": '插件里没有配置 EAC 端点，无从登录。',
      "eac.authorized": '已登录',
      "eac.unauthorized": '未登录',
      "eac.required": '该端点要求登录',
      "eac.configured": '已安装 GitHub 应用',
      "eac.starred": '已 star',
      "eac.reason": '端点给出的原因：{reason}',
      "eac.repo": '仓库：{repo}',
      "eac.login": '用 GitHub 登录',
      "eac.logout": '退出登录',
      "eac.working": '处理中…',
      "eac.cancel": '取消登录',
      "eac.pendingTitle": '等待 GitHub 授权',
      "eac.pendingHint": '打开下面的链接完成授权，然后回到本页；本页每两秒检查一次结果。',
      "eac.signedIn": '已登录：{login}。',
      "eac.signedOut": '已退出登录。',
      "eac.startFailed": '无法发起登录：{reason}',
      "eac.pollFailed": '登录没有完成：{reason}',
      "eac.failed": 'EAC 请求失败：{message}',
      "aggregate.intro": '聚合通道走你自己带来的服务商：给每个服务商粘一个 Key、勾选要用的模型，发布出去的模型 id 仍然用你自己的 Key 调用。Key 由插件保管，本页不留存。',
      "aggregate.search": '筛选服务商',
      "aggregate.providers": '服务商（{count}）',
      "aggregate.configure": '配置',
      "aggregate.on": '已启用',
      "aggregate.off": '已停用',
      "aggregate.verified": '已验证',
      "aggregate.empty": '插件没有返回任何服务商。',
      "aggregate.noMatch": '没有匹配的服务商。',
      "aggregate.editing": '配置 {name}',
      "aggregate.baseUrl": '接口地址',
      "aggregate.apiKey": 'API Key',
      "aggregate.keyPlaceholder": '留空表示保留已存的 Key',
      "aggregate.models": '模型 id，逗号或换行分隔',
      "aggregate.registryModels": '该服务商当前配置了 {count} 个模型 id。',
      "aggregate.enabled": '发布这个服务商',
      "aggregate.enabledHint": '停用的服务商不会向选择器贡献任何模型。',
      "aggregate.save": '保存',
      "aggregate.saving": '保存中…',
      "aggregate.test": '测试 Key',
      "aggregate.discover": '拉取模型列表',
      "aggregate.clearKey": '删除已存 Key',
      "aggregate.remove": '移除服务商',
      "aggregate.working": '处理中…',
      "aggregate.saved": '服务商已保存。',
      "aggregate.removed": '服务商已移除。',
      "aggregate.testOk": '服务端点返回了模型列表。',
      "aggregate.testFailed": '服务端点未通过验证（状态 {status}）。',
      "aggregate.lastTestOk": '上次验证通过：{at}。',
      "aggregate.lastTestFailed": '上次检查失败：{at}。',
      "aggregate.discovered": '拉到的模型（{count}）',
      "aggregate.discoveredEmpty": '该服务端点没有发布模型列表。',
      "dash.intro": '插件自己的账本：真正发出去的东西，按模型和按天折叠。它数的是插件发出的调用，不是宿主存储的会话——两者很少一致，各自都对各自的事。',
      "dash.calls": '调用数',
      "dash.turns": '轮次',
      "dash.success": '成功率',
      "dash.tokens": 'tokens',
      "dash.saved": '节省',
      "dash.estimated": '部分数字是估算的：插件自己还没有历史失败计数，失败数由按模型的行推出来。',
      "dash.byModel": '按模型',
      "dash.byDay": '最近 14 天',
      "dash.empty": '这 14 天没有流量记录。',
      "dash.noModels": '还没有模型被调用过。',
      "dash.columnModel": '模型',
      "dash.columnInput": '输入',
      "dash.columnOutput": '输出',
      "dash.columnReasoning": '推理',
      "dash.columnFailed": '失败',
      "dash.columnTps": 'tok/s',
      "dash.columnTtft": '首字延迟',
      "log.intro": '插件最近 200 次调用，最新的在最前：发了什么、回了多少、用了多久。标了「截断」或「无 usage」的行是链路中途断掉的调用——「那一轮怎么没了」要查的就是这些行。',
      "log.title": '最近的调用',
      "log.onlyFailed": '只看失败的调用',
      "log.filterModel": '模型',
      "log.allModels": '全部模型',
      "log.pageSize": '每页条数',
      "log.count": '{shown} / {total} 条 · 第 {page} / {pages} 页',
      "log.columnTime": '时间',
      "log.columnModel": '模型',
      "log.columnResult": '结果',
      "log.columnDecode": '解码耗时',
      "log.columnNotes": '备注',
      "log.ok": '成功',
      "log.failed": '失败',
      "log.truncated": '中途截断',
      "log.noUsage": '无 usage 帧',
      "log.empty": '还没有记录到任何调用。',
      "log.noMatch": '没有符合筛选的调用。',
      "log.prev": '上一页',
      "log.next": '下一页'
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
.dshPlatformDanger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dshPlatformOverlay{position:fixed;z-index:1000;inset:0;background:var(--dsw-alias-bg-base);align-items:center;justify-content:center;padding:24px;display:flex}
.dshPlatformDialog{border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-1);width:100%;max-width:520px;flex-direction:column;gap:12px;padding:20px 22px;display:flex}
.dshPlatformDialogTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:15px;font-weight:600;line-height:22px}
.dshPlatformDialogNote{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.dshPlatformDialogList{border:.5px solid var(--dsw-alias-border-l4);border-radius:10px;background:var(--dsh-alias-bg-layer-2,var(--dsh-alias-bg-layer-2));color:var(--dsh-alias-label-primary);margin:0;padding:8px 10px 8px 26px;max-height:160px;overflow:auto;font-size:12.5px;line-height:19px}
.dshPlatformPills{gap:6px;flex-wrap:wrap;display:flex}
.dshPlatformPill{border:.5px solid var(--dsw-alias-border-l4);border-radius:999px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-primary));background:var(--dsw-alias-bg-module-platform);padding:3px 10px;font-size:11px;line-height:18px;white-space:nowrap}
.dshPlatformPill.strong{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dshPlatformPill.ok{color:var(--dsw-alias-state-success-primary)}
.dshPlatformPill.warn{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-primary))}
.dshPlatformPill.danger{color:var(--dsw-alias-state-error-primary)}
.dshPlatformPill.off{opacity:.6}
.dshPlatformTableWrap{overflow-x:auto}
.dshPlatformChips{gap:6px;flex-wrap:wrap;display:flex}
.dshPlatformList{color:var(--dsw-alias-label-primary);margin:0;padding-left:20px;font-size:12.5px;line-height:20px}
.dshPlatformCode{background:var(--dsw-alias-bg-layer-2);border-radius:6px;color:var(--dsw-alias-label-primary);padding:2px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all}
.dshPlatformSecret{align-items:center;gap:10px;flex-wrap:wrap;display:flex}
.dshPlatformSecret .dshPlatformBar{margin-left:auto}
.dshPlatformStack{gap:10px;display:flex;flex-direction:column}
.dshPlatformChain{border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;background:var(--dsw-alias-bg-module-platform);flex-direction:column;gap:8px;padding:10px 12px;display:flex}
.dshPlatformChainHead{align-items:center;gap:8px;flex-wrap:wrap;display:flex}
    /* ── FreeModel 的玻璃质感：毛玻璃只给大块面，小卡片用半透明叠层 ────────── */
.dshFm{position:relative;display:flex;flex-direction:column;gap:18px;max-width:1120px;isolation:isolate}
.dshFmAurora{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}
.dshFmAurora i{position:absolute;display:block;border-radius:50%;filter:blur(70px);opacity:.42;animation:dshFmDrift 44s ease-in-out infinite alternate}
.dshFmAurora i:nth-child(1){width:46vw;height:46vw;left:-12vw;top:-14vw;background:radial-gradient(circle,color-mix(in srgb,var(--dsw-alias-state-business-primary) 62%,transparent),transparent 68%)}
.dshFmAurora i:nth-child(2){width:38vw;height:38vw;right:-10vw;top:4vh;background:radial-gradient(circle,color-mix(in srgb,var(--dsw-alias-state-success-primary) 42%,transparent),transparent 70%);animation-duration:56s;animation-delay:-12s}
.dshFmAurora i:nth-child(3){width:42vw;height:42vw;left:22vw;bottom:-18vw;background:radial-gradient(circle,color-mix(in srgb,var(--dsw-alias-brand-primary) 34%,transparent),transparent 70%);animation-duration:64s;animation-delay:-26s}
@keyframes dshFmDrift{0%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(3vw,2vh,0) scale(1.09)}100%{transform:translate3d(-3vw,-2vh,0) scale(.96)}}
.dshFmNav{position:sticky;top:0;z-index:30;padding:10px 12px;border-radius:16px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 82%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 62%,transparent);backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);box-shadow:inset 0 1px 0 color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent),0 8px 26px color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}
.dshFmTabs{position:relative;display:flex;flex-wrap:wrap;gap:2px;padding:3px;border-radius:13px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 80%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 62%,transparent);box-shadow:inset 0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent)}
.dshFmTab{position:relative;z-index:1;font:inherit;font-size:12px;font-weight:600;padding:6px 13px;border-radius:10px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;transition:color .2s ease,background .2s ease}
.dshFmTab:hover{color:var(--dsw-alias-label-primary)}
.dshFmTab.isOn{color:var(--dsw-alias-label-primary);background:linear-gradient(150deg,color-mix(in srgb,var(--dsw-alias-bg-layer-3) 92%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-2) 88%,transparent));box-shadow:0 3px 10px color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent),inset 0 1px 0 color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}
.dshFmPage{display:flex;flex-direction:column;gap:20px;animation:dshFmPageIn .4s cubic-bezier(.16,1,.3,1)}
@keyframes dshFmPageIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.dshFm .dshPlatformCard,.dshFm .dshPlatformStat,.dshFm .dshPlatformChain{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 68%,transparent);backdrop-filter:blur(16px) saturate(150%);-webkit-backdrop-filter:blur(16px) saturate(150%);border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 78%,transparent);border-radius:16px;box-shadow:inset 0 1px 0 color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent),0 12px 34px color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}
.dshFm .dshPlatformInput,.dshFm .dshPlatformSelect,.dshFm .dshPlatformTextarea{background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 72%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-border-l2) 70%,transparent);border-radius:10px}
.dshFm .dshPlatformPill{background:color-mix(in srgb,var(--dsw-alias-bg-layer-3) 62%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-border-l2) 60%,transparent)}
.dshFm .dshPlatformMeter{background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 70%,transparent)}
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
    /* ── FreeModel：一条页内导航，底下是八个子页面 ───────────────────────────
       One outer tab, one inner nav. The owner plugin splits these across tabs
       of its own; lifting them all into the platform's tab strip made an
       eleven-tab row that read like a different application. The inner nav is
       the same affordance the owner uses, and it is ours — which is the whole
       reason this section exists: 「免费模型」never appears in it. */

    const FM_STORAGE_KEY = 'dshDesktopPlatformFreeModel'
    const FM_SECTIONS = [
      { id: 'upgrade', label: 'fm.upgrade' },
      { id: 'eac', label: 'fm.eac' },
      { id: 'aggregate', label: 'fm.aggregate' },
      { id: 'saver', label: 'fm.saver' },
      { id: 'routing', label: 'fm.routing' },
      { id: 'dashboard', label: 'fm.dashboard' },
      { id: 'logs', label: 'fm.logs' },
      { id: 'gateway', label: 'fm.gateway' }
    ]

    function FreeModelSection ({ t }) {
      const [section, setSection] = React.useState(() => {
        try {
          const saved = window.localStorage.getItem(FM_STORAGE_KEY)
          return FM_SECTIONS.some((row) => row.id === saved) ? saved : FM_SECTIONS[0].id
        } catch {
          return FM_SECTIONS[0].id
        }
      })
      const select = (id) => {
        setSection(id)
        try { window.localStorage.setItem(FM_STORAGE_KEY, id) } catch { /* storage is optional */ }
      }
      const pages = {
        upgrade: UpgradePage,
        eac: EacPage,
        aggregate: AggregatePage,
        saver: SaverPage,
        routing: RoutingPage,
        dashboard: DashboardPage,
        logs: LogPage,
        gateway: GatewayPage
      }
      const Page = pages[section]
      return React.createElement('div', { className: 'dshFm' },
        // A flat shell background leaves backdrop-filter nothing to sample, so
        // every glass surface would read as a plain translucent box. The blobs
        // sit behind the content and never escape this section's stacking.
        React.createElement('div', { className: 'dshFmAurora', 'aria-hidden': 'true' },
          React.createElement('i', { key: 'a' }),
          React.createElement('i', { key: 'b' }),
          React.createElement('i', { key: 'c' })),
        React.createElement('div', { className: 'dshFmNav' },
          React.createElement('div', { className: 'dshFmTabs', role: 'tablist', 'aria-label': t('fm.title') },
            FM_SECTIONS.map((row) => React.createElement('button', {
              key: row.id,
              type: 'button',
              role: 'tab',
              id: `dshFmTab-${row.id}`,
              className: section === row.id ? 'dshFmTab isOn' : 'dshFmTab',
              'aria-selected': section === row.id,
              'aria-controls': `dshFmPanel-${row.id}`,
              tabIndex: section === row.id ? 0 : -1,
              onClick: () => select(row.id)
            }, t(row.label))))),
        React.createElement('div', {
          className: 'dshFmPage',
          role: 'tabpanel',
          id: `dshFmPanel-${section}`,
          'aria-labelledby': `dshFmTab-${section}`
        }, React.createElement(Page, { t })))
    }

    function PlatformSection({ t, scope, host }) {
      const [active, setActive] = React.useState(storedTab)
      const [visited, setVisited] = React.useState(() => new Set([storedTab()]))
      const select = (id) => {
        setActive(id)
        rememberTab(id)
        setVisited((current) => (current.has(id) ? current : new Set(current).add(id)))
      }
      const panel = (id, child) =>
        visited.has(id) ? React.createElement(Panel, { id, active: active === id }, child) : null
      const tabPanel = (tab, child) => panel(tab.id, child)
      return React.createElement('div', { className: 'dshPlatform' },
        React.createElement(TabBar, { t, active, onSelect: select }),
        React.createElement('div', { className: 'dshPlatformPanels' },
          tabPanel(TABS[0], React.createElement(UsagePanel, { t, scope })),
      tabPanel(TABS[1], React.createElement(ArchivePanel, { t, host })),
      tabPanel(TABS[2], React.createElement(MemoryPanel, { t })),
      tabPanel(TABS[3], React.createElement(FreeModelSection, { t }))))
    }
    /* ── FreeModel：自建的四个页面 ───────────────────────────────────────────
       The state, credentials, ports and the model adapter all belong to the
       dsh-our-free-model plugin; this is a second front-end over its
       `/api/our-free-model/*` routes, reached with the renderer's own
       same-origin credentials (its fence answers 401 to anything outside the
       page). Nothing here duplicates its storage, and a 404 means the owner is
       simply not installed — the pages say so instead of failing. */

    const FREE_MODEL_API = '/api/our-free-model'

    async function ownerFetch (path, options) {
      const response = await fetch(FREE_MODEL_API + path, { credentials: 'same-origin', cache: 'no-store', ...options })
      if (response.status === 404 || response.status === 401) {
        const failure = new Error('owner-absent')
        failure.absent = true
        throw failure
      }
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `HTTP ${response.status}`)
      return json
    }

    const ownerGet = (path) => ownerFetch(path)
    const ownerPost = (path, body, timeoutMs) => ownerFetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      ...timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(timeoutMs) }
    })

    /** Load a fixed set of owner routes, with a manual reload. */
    function useOwner (paths) {
      const key = paths.join('|')
      const [state, setState] = React.useState({ status: 'loading', data: null, error: '', absent: false })
      const [nonce, setNonce] = React.useState(0)
      React.useEffect(() => {
        let alive = true
        setState((current) => ({ ...current, status: current.data === null ? 'loading' : 'ready' }))
        Promise.all(key.split('|').map((path) => ownerGet(path)))
          .then((values) => { if (alive) setState({ status: 'ready', data: values, error: '', absent: false }) })
          .catch((failure) => {
            if (!alive) return
            setState({
              status: failure.absent === true ? 'absent' : 'error',
              data: null,
              error: failure.absent === true ? '' : messageOf(failure),
              absent: failure.absent === true
            })
          })
        return () => { alive = false }
      }, [key, nonce])
      return { ...state, reload: () => setNonce((value) => value + 1) }
    }

    function OwnerShell ({ t, state, children }) {
      if (state.status === 'absent') {
        return React.createElement('div', { className: 'dshPlatform' },
          React.createElement('p', { className: 'dshPlatformNote' }, t('owner.absent')))
      }
      if (state.status === 'loading') {
        return React.createElement('div', { className: 'dshPlatform' },
          React.createElement('p', { className: 'dshPlatformNote', role: 'status' }, t('owner.loading')))
      }
      if (state.status === 'error') {
        return React.createElement('div', { className: 'dshPlatform' },
          React.createElement('p', { className: 'dshPlatformError', role: 'alert' }, t('owner.failed', { message: state.error })),
          React.createElement('div', { className: 'dshPlatformBar' },
            React.createElement('button', { className: 'dshPlatformButton', type: 'button', onClick: state.reload }, t('owner.retry'))))
      }
      return children
    }

    function Pill ({ tone, children }) {
      return React.createElement('span', { className: tone === undefined ? 'dshPlatformPill' : `dshPlatformPill ${tone}` }, children)
    }

    function SwitchRow ({ checked, label, hint, disabled, onChange }) {
      return React.createElement('div', { className: 'dshPlatformSwitchRow' },
        React.createElement('input', {
          type: 'checkbox',
          className: 'dshPlatformCheckbox',
          checked: checked === true,
          disabled: disabled === true,
          onChange: (event) => onChange(event.target.checked)
        }),
        React.createElement('div', { className: 'dshPlatformSwitchCopy' },
          React.createElement('span', null, label),
          hint !== undefined && React.createElement('span', { className: 'dshPlatformMeta' }, hint)))
    }

    /** A secret the owner only hands out on demand: never rendered until asked. */
    function SecretRow ({ t, label, value, onRotate, busy }) {
      const [shown, setShown] = React.useState(false)
      const text = value === undefined || value === null || value === '' ? t('owner.noKey') : value
      return React.createElement('div', { className: 'dshPlatformSecret' },
        React.createElement('span', { className: 'dshPlatformMeta' }, label),
        React.createElement('code', { className: 'dshPlatformCode' }, shown ? text : maskKey(text)),
        React.createElement('div', { className: 'dshPlatformBar' },
          React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy, onClick: () => setShown((value) => !value) }, shown ? t('owner.hide') : t('owner.show')),
          React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy, onClick: () => void onRotate() }, t('owner.rotate'))))
    }

    function maskKey (text) {
      if (text === '（未设置）' || text === '(not set)') return text
      return text.length <= 8 ? '••••' : `••••${text.slice(-4)}`
    }

    /* ── 插件升级 ──────────────────────────────────────────────────────────── */
    function UpgradePage ({ t }) {
      const state = useOwner(['/update/status'])
      const [busy, setBusy] = React.useState('')
      const [note, setNote] = React.useState('')
      const [error, setError] = React.useState('')
      const run = async (kind, path, label, timeout) => {
        setBusy(kind)
        setNote('')
        setError('')
        try {
          await ownerPost(path, {}, timeout)
          setNote(label)
          state.reload()
        } catch (failure) {
          setError(messageOf(failure))
        } finally {
          setBusy('')
        }
      }
      const status = state.data === null ? null : state.data[0] ?? {}
      const notes = status === null || typeof status.notes !== 'string' || status.notes === '' ? null : status.notes
      const checked = status !== null && typeof status.checkedAt === 'number'
      const latest = status !== null && typeof status.latest === 'string' && status.latest !== '' ? status.latest : null
      const pills = []
      if (status !== null) {
        pills.push(React.createElement(Pill, { key: 'current', tone: 'strong' }, `${t('upgrade.current')}: ${status.current ?? '—'}`))
        if (typeof status.installedVersion === 'string') pills.push(React.createElement(Pill, { key: 'installed' }, `${t('upgrade.installed')}: ${status.installedVersion}`))
        if (latest !== null) pills.push(React.createElement(Pill, { key: 'latest' }, `${t('upgrade.latest')}: ${latest}`))
        if (status.available === true) pills.push(React.createElement(Pill, { key: 'new', tone: 'warn' }, t('upgrade.available', { version: status.latest })))
        if (status.available === false && latest !== null) pills.push(React.createElement(Pill, { key: 'ok', tone: 'ok' }, t('upgrade.upToDate')))
        if (status.applying === true) pills.push(React.createElement(Pill, { key: 'applying', tone: 'warn' }, t('upgrade.applying')))
        if (status.recoveryRequired === true) pills.push(React.createElement(Pill, { key: 'recovery', tone: 'danger' }, t('upgrade.recovery')))
        if (typeof status.recoveryBackup === 'string' && status.recoveryBackup !== '') pills.push(React.createElement(Pill, { key: 'backup', tone: 'danger' }, `${t('upgrade.backup')}: ${status.recoveryBackup}`))
        pills.push(React.createElement(Pill, { key: 'checked' }, `${t('upgrade.checkedAt')}: ${checked ? new Date(status.checkedAt).toLocaleString() : t('upgrade.never')}`))
      }
      const applyable = status !== null && status.available === true && status.applying !== true
      return React.createElement(OwnerShell, { t, state },
        React.createElement('div', { className: 'dshPlatform' },
          React.createElement('p', { className: 'dshPlatformIntro' }, t('upgrade.intro')),
          pills.length > 0 && React.createElement('div', { className: 'dshPlatformPills' }, pills),
          note !== '' && React.createElement('p', { className: 'dshPlatformNoteSuccess', role: 'status' }, note),
          error !== '' && React.createElement('p', { className: 'dshPlatformError', role: 'alert' }, t('owner.failed', { message: error })),
          React.createElement('div', { className: 'dshPlatformBar' },
            React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy !== '', onClick: () => { void run('check', '/update/check', t('upgrade.checked'), 60_000) } }, busy === 'check' ? t('upgrade.checking') : t('upgrade.check')),
            applyable && React.createElement('button', { className: 'dshPlatformButton dshPlatformDanger', type: 'button', disabled: busy !== '', onClick: () => { void run('apply', '/update/apply', t('upgrade.applied'), 600_000) } }, busy === 'apply' ? t('upgrade.applying') : t('upgrade.apply')),
            React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy !== '', onClick: () => { void run('reload', '/reload', t('upgrade.reloaded'), 30_000) } }, busy === 'reload' ? t('upgrade.reloading') : t('upgrade.reload'))),
          notes !== null && React.createElement('p', { className: 'dshPlatformNote' }, notes)))
    }

    /* ── 省 Token ──────────────────────────────────────────────────────────── */
    const CAVEMAN_LEVELS = ['off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-ultra']
    const PONYTAIL_LEVELS = ['off', 'lite', 'full', 'ultra']
    const LOCAL_KINDS = ['quota', 'prefix', 'title', 'suggestion', 'filepath']

    function SaverPage ({ t }) {
      const state = useOwner(['/token-saver', '/local-optimize'])
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [error, setError] = React.useState('')
      const write = async (path, patch) => {
        setBusy(true)
        setNote('')
        setError('')
        try {
          await ownerPost(path, patch)
          state.reload()
        } catch (failure) {
          setError(messageOf(failure))
        } finally {
          setBusy(false)
        }
      }
      const saver = state.data === null ? null : state.data[0] ?? {}
      const local = state.data === null ? null : state.data[1] ?? {}
      const savings = saver === null ? null : saver.savings ?? null
      const meterWidth = savings === null ? 0 : Math.min(100, Math.max(0, Number(savings.percent) || 0))
      const select = (value, levels, onPick) => React.createElement('select', {
        className: 'dshPlatformSelect',
        value,
        disabled: busy,
        onChange: (event) => onPick(event.target.value)
      }, levels.map((level) => React.createElement('option', { key: level, value: level }, level)))
      const labelled = (label, control) => React.createElement('label', { className: 'dshPlatformField' },
        React.createElement('span', { className: 'dshPlatformMeta' }, label), control)
      return React.createElement(OwnerShell, { t, state },
        React.createElement('div', { className: 'dshPlatform' },
          React.createElement('p', { className: 'dshPlatformIntro' }, t('saver.intro')),
          saver !== null && React.createElement(Card, { title: t('saver.switches') },
            React.createElement(SwitchRow, { checked: saver.enabled !== false, label: t('saver.master'), hint: t('saver.masterHint'), disabled: busy, onChange: (checked) => { void write('/token-saver', { enabled: checked }) } }),
            React.createElement(SwitchRow, { checked: saver.rtk !== false, label: t('saver.rtk'), hint: t('saver.rtkHint'), disabled: busy, onChange: (checked) => { void write('/token-saver', { rtk: checked }) } })),
          saver !== null && React.createElement(Card, { title: t('saver.prompts') },
            React.createElement('div', { className: 'dshPlatformFields' },
              labelled(t('saver.caveman'), select(saver.prompts?.caveman ?? 'off', CAVEMAN_LEVELS, (value) => { void write('/token-saver', { prompts: { caveman: value } }) })),
              labelled(t('saver.ponytail'), select(saver.prompts?.ponytail ?? 'off', PONYTAIL_LEVELS, (value) => { void write('/token-saver', { prompts: { ponytail: value } }) })))),
          local !== null && React.createElement(Card, { title: t('saver.local') },
            React.createElement('div', { className: 'dshPlatformGrid' }, LOCAL_KINDS.map((kind) => React.createElement('div', { className: 'dshPlatformStat', key: kind },
              React.createElement(SwitchRow, { checked: local[kind] !== false, label: t(`saver.kind.${kind}`), hint: t(`saver.kindHint.${kind}`), disabled: busy, onChange: (checked) => { void write('/local-optimize', { [kind]: checked }) } }))))),
          savings !== null && React.createElement(Card, { title: t('saver.savings') },
            React.createElement('div', { className: 'dshPlatformGrid' },
              React.createElement(Stat, { label: t('saver.bytesBefore'), value: `${formatNumber(savings.bytesBefore)} B` }),
              React.createElement(Stat, { label: t('saver.bytesAfter'), value: `${formatNumber(savings.bytesAfter)} B` }),
              React.createElement(Stat, { label: t('saver.bytesSaved'), value: `${formatNumber(savings.saved)} B` }),
              React.createElement(Stat, { label: t('saver.blocks'), value: formatNumber(savings.blocks) }),
              React.createElement(Stat, { label: t('saver.calls'), value: formatNumber(savings.calls) }),
              React.createElement(Stat, { label: t('saver.promptCalls'), value: formatNumber(savings.promptCalls) })),
            React.createElement('div', { className: 'dshPlatformMeter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(meterWidth), 'aria-label': t('saver.savings') },
              React.createElement('div', { className: Number(savings.percent) > 0 ? 'dshPlatformMeterFill' : 'dshPlatformMeterFillOver', style: { width: `${meterWidth}%` } }))),
          saver !== null && savings === null && React.createElement('p', { className: 'dshPlatformNote' }, t('saver.noData')),
          note !== '' && React.createElement('p', { className: 'dshPlatformNoteSuccess', role: 'status' }, note),
          error !== '' && React.createElement('p', { className: 'dshPlatformError', role: 'alert' }, t('owner.failed', { message: error }))))
    }

    /* ── 网关设置 ──────────────────────────────────────────────────────────── */
    function GatewayPage ({ t }) {
      const state = useOwner(['/clients', '/forward/key', '/forward/lan/key', '/forward/lan/addresses', '/chan-gateway'])
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const rotate = async (kind, path) => {
        setBusy(kind)
        setError('')
        try {
          await ownerPost(path, {})
          state.reload()
        } catch (failure) {
          setError(messageOf(failure))
        } finally {
          setBusy('')
        }
      }
      const clients = state.data === null ? null : state.data[0] ?? {}
      const forward = clients === null ? null : clients.forward ?? {}
      const lan = forward === null ? null : forward.lan ?? {}
      const channel = state.data === null ? null : state.data[4] ?? {}
      const addresses = state.data === null ? [] : state.data[3]?.addresses ?? []
      const models = clients !== null && Array.isArray(clients.models) ? clients.models : []
      const live = (flag) => React.createElement(Pill, { tone: flag === true ? 'ok' : 'off' }, flag === true ? t('gateway.running') : t('gateway.stopped'))
      const addressList = addresses.length === 0
        ? React.createElement('p', { className: 'dshPlatformNote' }, t('gateway.noAddress'))
        : React.createElement('ul', { className: 'dshPlatformList' }, addresses.map((address) => React.createElement('li', { key: address }, React.createElement('code', { className: 'dshPlatformCode' }, address))))
      return React.createElement(OwnerShell, { t, state },
        React.createElement('div', { className: 'dshPlatform' },
          React.createElement('p', { className: 'dshPlatformIntro' }, t('gateway.intro')),
          forward !== null && React.createElement(Card, { title: t('gateway.local') },
            React.createElement('div', { className: 'dshPlatformPills' }, live(forward.running), React.createElement(Pill, { tone: 'strong' }, `${t('gateway.port')}: ${forward.port ?? 0}`)),
            React.createElement(SecretRow, { t, label: t('gateway.key'), value: state.data[1]?.key, busy: busy !== '', onRotate: () => { void rotate('key', '/forward/rotate') } })),
          lan !== null && React.createElement(Card, { title: t('gateway.lan') },
            React.createElement('div', { className: 'dshPlatformPills' }, live(lan.running), React.createElement(Pill, { tone: 'strong' }, `${t('gateway.lanPort')}: ${lan.port ?? 0}`)),
            React.createElement(SecretRow, { t, label: t('gateway.lanKey'), value: state.data[2]?.key, busy: busy !== '', onRotate: () => { void rotate('lan', '/forward/lan/rotate') } }),
            addressList),
          channel !== null && React.createElement(Card, { title: t('gateway.channel') },
            React.createElement('div', { className: 'dshPlatformPills' }, live(channel.running), channel.port !== undefined && React.createElement(Pill, { tone: 'strong' }, `${t('gateway.port')}: ${channel.port}`)),
            channel.note !== undefined && React.createElement('p', { className: 'dshPlatformNote' }, channel.note)),
          models.length > 0 && React.createElement(Card, { title: t('gateway.models') },
            React.createElement('p', { className: 'dshPlatformNote' }, t('gateway.modelsHint', { count: models.length })),
            React.createElement('div', { className: 'dshPlatformChips' }, models.slice(0, 40).map((id) => React.createElement(Pill, { key: id }, id)))),
          error !== '' && React.createElement('p', { className: 'dshPlatformError', role: 'alert' }, t('owner.failed', { message: error }))))
    }

    /* ── 路由（降级链）────────────────────────────────────────────────────── */
    function RoutingPage ({ t }) {
      const state = useOwner(['/combos', '/summary'])
      const [editing, setEditing] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [error, setError] = React.useState('')
      const save = async (chains) => {
        setBusy(true)
        setNote('')
        setError('')
        try {
          await ownerPost('/combos', { combos: chains })
          setNote(t('routing.saved'))
          setEditing(null)
          state.reload()
        } catch (failure) {
          setError(messageOf(failure))
        } finally {
          setBusy(false)
        }
      }
      const chains = state.data === null ? [] : state.data[0]?.combos ?? []
      const models = state.data === null ? [] : (state.data[1]?.models ?? []).map((row) => (typeof row === 'string' ? row : row.id))
      const ready = editing !== null && editing.name.trim() !== '' && (editing.models ?? []).length > 0
      const strategy = (value, onPick) => React.createElement('select', { className: 'dshPlatformSelect', value, onChange: (event) => onPick(event.target.value) },
        React.createElement('option', { value: 'fallback' }, 'fallback'),
        React.createElement('option', { value: 'round-robin' }, 'round-robin'))
      const editor = editing === null ? null : React.createElement(Card, { title: editing.id === '' ? t('routing.newChain') : t('routing.editChain') },
        React.createElement('div', { className: 'dshPlatformFields' },
          React.createElement('label', { className: 'dshPlatformField' },
            React.createElement('span', { className: 'dshPlatformMeta' }, t('routing.name')),
            React.createElement('input', { className: 'dshPlatformInput', value: editing.name, placeholder: 'my-chain', onChange: (event) => setEditing({ ...editing, name: event.target.value }) })),
          React.createElement('label', { className: 'dshPlatformField' },
            React.createElement('span', { className: 'dshPlatformMeta' }, t('routing.strategy')),
            strategy(editing.strategy, (value) => setEditing({ ...editing, strategy: value }))),
          React.createElement('label', { className: 'dshPlatformField' },
            React.createElement('span', { className: 'dshPlatformMeta' }, t('routing.sticky')),
            React.createElement('input', { className: 'dshPlatformInput', type: 'number', min: '1', value: String(editing.stickyLimit ?? 1), onChange: (event) => setEditing({ ...editing, stickyLimit: Math.max(1, Number(event.target.value) || 1) }) }))),
        React.createElement('label', { className: 'dshPlatformField' },
          React.createElement('span', { className: 'dshPlatformMeta' }, t('routing.models')),
          React.createElement('textarea', { className: 'dshPlatformTextarea', spellCheck: false, rows: 4, value: (editing.models ?? []).join('\n'), placeholder: 'provider/model', onChange: (event) => setEditing({ ...editing, models: event.target.value.split('\n').map((line) => line.trim()).filter((line) => line !== '') }) })),
        models.length > 0 && React.createElement('p', { className: 'dshPlatformMeta' }, t('routing.available', { count: models.length })),
        React.createElement('div', { className: 'dshPlatformBar' },
          React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy || !ready, onClick: () => { void save(editing.id === '' ? [...chains, { ...editing, name: editing.name.trim() }] : chains.map((chain) => (chain.id === editing.id ? editing : chain))) } }, busy ? t('routing.saving') : t('routing.save')),
          React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy, onClick: () => setEditing(null) }, t('routing.cancel'))))
      const chainRows = chains.length === 0
        ? React.createElement('p', { className: 'dshPlatformNote' }, t('routing.empty'))
        : React.createElement('div', { className: 'dshPlatformStack' }, chains.map((chain) => React.createElement('div', { className: 'dshPlatformChain', key: chain.id },
          React.createElement('div', { className: 'dshPlatformChainHead' },
            React.createElement('code', { className: 'dshPlatformCode' }, `combo:${chain.id}`),
            React.createElement(Pill, { tone: chain.enabled === false ? 'off' : 'ok' }, chain.enabled === false ? t('routing.disabled') : t('routing.enabled')),
            React.createElement(Pill, null, chain.strategy ?? 'fallback'),
            typeof chain.stickyLimit === 'number' && chain.strategy === 'round-robin' && React.createElement(Pill, null, `${t('routing.sticky')}: ${chain.stickyLimit}`)),
          React.createElement('p', { className: 'dshPlatformMeta' }, (chain.models ?? []).join(' → ')),
          React.createElement('div', { className: 'dshPlatformBar' },
            React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy, onClick: () => setEditing({ ...chain, models: [...(chain.models ?? [])] }) }, t('routing.edit')),
            React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy, onClick: () => { void save(chains.map((item) => (item.id === chain.id ? { ...item, enabled: item.enabled === false } : item))) } }, chain.enabled === false ? t('routing.enable') : t('routing.disable')),
            React.createElement('button', { className: 'dshPlatformButton dshPlatformDanger', type: 'button', disabled: busy, onClick: () => { void save(chains.filter((item) => item.id !== chain.id)) } }, t('routing.delete'))))))
      return React.createElement(OwnerShell, { t, state },
        React.createElement('div', { className: 'dshPlatform' },
          React.createElement('p', { className: 'dshPlatformIntro' }, t('routing.intro')),
          editor,
          state.data !== null && React.createElement(Card, { title: t('routing.chains', { count: chains.length }) },
            React.createElement('div', { className: 'dshPlatformBar' },
              React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy, onClick: () => setEditing({ id: '', name: '', models: [], strategy: 'fallback', stickyLimit: 1, enabled: true }) }, t('routing.newChain')),
              React.createElement('span', { className: 'dshPlatformBarSpacer' })),
            chainRows),
          note !== '' && React.createElement('p', { className: 'dshPlatformNoteSuccess', role: 'status' }, note),
          error !== '' && React.createElement('p', { className: 'dshPlatformError', role: 'alert' }, t('owner.failed', { message: error }))))
    }

    /* ── EAC 模型 ──────────────────────────────────────────────────────────── */
    function EacPage ({ t }) {
      const state = useOwner(['/eac/status'])
      const [busy, setBusy] = React.useState('')
      const [pending, setPending] = React.useState(null)
      const [note, setNote] = React.useState('')
      const [error, setError] = React.useState('')
      const auth = state.data === null ? null : state.data[0] ?? {}
      const link = pending === null ? null : pending.link
      // The device flow is polled, not pushed: the owner answers a poll with the
      // GitHub state it last saw, so a slow page is a lag, never a loss.
      React.useEffect(() => {
        if (link === null) return undefined
        let alive = true
        const timer = setInterval(() => {
          ownerGet(`/eac/login/poll?link=${encodeURIComponent(link)}`)
            .then((answer) => {
              if (!alive) return
              if (answer?.status === 'ok') {
                setPending(null)
                setNote(t('eac.signedIn', { login: answer.login ?? '' }))
                state.reload()
              } else if (answer?.error !== undefined) {
                setPending(null)
                setError(t('eac.pollFailed', { reason: answer.error }))
              }
            })
            .catch((failure) => { if (alive) setError(messageOf(failure)) })
        }, 2000)
        return () => { alive = false; clearInterval(timer) }
      }, [link])
      const call = async (kind, path, body, timeout, label) => {
        setBusy(kind)
        setNote('')
        setError('')
        try {
          return await ownerPost(path, body, timeout)
        } catch (failure) {
          setError(messageOf(failure))
          return null
        } finally {
          setBusy('')
        }
      }
      const start = async () => {
        const started = await call('login', '/eac/login/start', undefined, 20_000)
        if (started === null) return
        if (started.error !== undefined) { setError(t('eac.startFailed', { reason: started.error })); return }
        setPending({ link: started.link, url: started.url ?? '' })
      }
      const cancel = async () => {
        if (pending === null) return
        await call('cancel', `/eac/login/cancel?link=${encodeURIComponent(pending.link)}`, undefined, 20_000)
        setPending(null)
      }
      const logout = async () => {
        await call('logout', '/eac/logout', undefined, 20_000)
        setNote(t('eac.signedOut'))
        state.reload()
      }
      const authorized = auth !== null && auth.authorized === true
      const pills = auth === null ? [] : [
        React.createElement(Pill, { key: 'lane', tone: auth.available === true ? 'ok' : 'off' }, auth.available === true ? t('eac.laneReady') : t('eac.laneMissing')),
        React.createElement(Pill, { key: 'auth', tone: authorized ? 'ok' : 'warn' }, authorized ? t('eac.authorized') : t('eac.unauthorized')),
        auth.required === true && React.createElement(Pill, { key: 'required', tone: 'strong' }, t('eac.required')),
        auth.configured === true && React.createElement(Pill, { key: 'configured' }, t('eac.configured')),
        typeof auth.login === 'string' && auth.login !== '' && React.createElement(Pill, { key: 'login', tone: 'strong' }, auth.login),
        auth.starred === true && React.createElement(Pill, { key: 'starred' }, t('eac.starred'))
      ]
      const repo = typeof auth?.repo === 'string' ? auth.repo : ''
      return React.createElement(OwnerShell, { t, state },
        React.createElement('div', { className: 'dshPlatform' },
          React.createElement('p', { className: 'dshPlatformIntro' }, t('eac.intro')),
          pills.length > 0 && React.createElement('div', { className: 'dshPlatformPills' }, pills),
          auth !== null && typeof auth.reason === 'string' && auth.reason !== '' && React.createElement('p', { className: 'dshPlatformNote' }, t('eac.reason', { reason: auth.reason })),
          repo !== '' && React.createElement('p', { className: 'dshPlatformMeta' }, t('eac.repo', { repo })),
          note !== '' && React.createElement('p', { className: 'dshPlatformNoteSuccess', role: 'status' }, note),
          error !== '' && React.createElement('p', { className: 'dshPlatformError', role: 'alert' }, error.startsWith('FreeModel') ? error : t('eac.failed', { message: error })),
          pending === null
            ? React.createElement('div', { className: 'dshPlatformBar' },
              authorized
                ? React.createElement('button', { className: 'dshPlatformButton dshPlatformDanger', type: 'button', disabled: busy !== '', onClick: () => { void logout() } }, busy === 'logout' ? t('eac.working') : t('eac.logout'))
                : React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy !== '' || auth?.available !== true, onClick: () => { void start() } }, busy === 'login' ? t('eac.working') : t('eac.login')),
              auth?.available !== true && React.createElement('p', { className: 'dshPlatformNote' }, t('eac.laneMissingHint')))
            : React.createElement(Card, { title: t('eac.pendingTitle') },
              React.createElement('p', { className: 'dshPlatformMeta' }, t('eac.pendingHint')),
              pending.url !== '' && React.createElement('code', { className: 'dshPlatformCode' }, pending.url),
              React.createElement('div', { className: 'dshPlatformBar' },
                React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy !== '', onClick: () => { void cancel() } }, busy === 'cancel' ? t('eac.working') : t('eac.cancel'))))))
    }

    /* ── 聚合渠道 ──────────────────────────────────────────────────────────── */
    function AggregatePage ({ t }) {
      const state = useOwner(['/providers'])
      const [query, setQuery] = React.useState('')
      const [editing, setEditing] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [note, setNote] = React.useState('')
      const [error, setError] = React.useState('')
      const [found, setFound] = React.useState(null)
      const answer = state.data === null ? null : state.data[0] ?? {}
      const registry = Array.isArray(answer?.registry) ? answer.registry : []
      const configured = answer?.configured?.providers ?? {}
      const needle = query.trim().toLowerCase()
      const shown = needle === ''
        ? registry
        : registry.filter((provider) => `${provider.id} ${provider.name ?? ''}`.toLowerCase().includes(needle))
      const blank = { providerId: '', enabled: true, baseUrl: '', apiKey: '', models: '' }
      const draft = editing ?? blank
      const run = async (kind, body, path, timeout) => {
        setBusy(kind)
        setNote('')
        setError('')
        try {
          return await ownerPost(path, body, timeout)
        } catch (failure) {
          setError(messageOf(failure))
          return null
        } finally {
          setBusy('')
        }
      }
      const save = async () => {
        const body = { providerId: draft.providerId, enabled: draft.enabled, baseUrl: draft.baseUrl, models: draft.models.split(/[,\n]/).map((row) => row.trim()).filter((row) => row !== '') }
        // An empty key box means *keep*: the owner tells an absent field from an
        // empty string, and conflating them is what silently kept a key the user
        // believed they had deleted. Clearing is therefore its own button.
        if (draft.apiKey !== '') body.apiKey = draft.apiKey
        setBusy('save')
        setNote('')
        setError('')
        try {
          await ownerPost('/providers', body)
          setNote(t('aggregate.saved'))
          setEditing(null)
          state.reload()
        } catch (failure) {
          setError(messageOf(failure))
        } finally {
          setBusy('')
        }
      }
      const clearKey = async () => {
        await run('clear', { providerId: draft.providerId, apiKey: '' }, '/providers', 30_000)
        setEditing((current) => (current === null ? null : { ...current, apiKey: '' }))
        state.reload()
      }
      const test = async () => {
        const result = await run('test', { providerId: draft.providerId }, '/providers/test', 60_000)
        if (result === null) return
        setNote(t(result.ok === true ? 'aggregate.testOk' : 'aggregate.testFailed', { status: result.status ?? 0 }))
      }
      const discover = async () => {
        const result = await run('discover', { providerId: draft.providerId }, '/providers/discover', 60_000)
        if (result === null) return
        setFound(Array.isArray(result.models) ? result.models : null)
        state.reload()
      }
      const remove = async () => {
        await run('remove', { providerId: draft.providerId }, '/providers/remove', 30_000)
        setNote(t('aggregate.removed'))
        setEditing(null)
        state.reload()
      }
      const verdict = configured[draft.providerId]?.lastTest
      const editor = editing === null ? null : React.createElement(Card, { title: t('aggregate.editing', { name: editing.name }) },
        React.createElement('div', { className: 'dshPlatformFields' },
          React.createElement('label', { className: 'dshPlatformField' },
            React.createElement('span', { className: 'dshPlatformMeta' }, t('aggregate.baseUrl')),
            React.createElement('input', { className: 'dshPlatformInput', value: draft.baseUrl, placeholder: editing.baseUrl ?? '', onChange: (event) => setEditing({ ...editing, baseUrl: event.target.value }) })),
          React.createElement('label', { className: 'dshPlatformField' },
            React.createElement('span', { className: 'dshPlatformMeta' }, t('aggregate.apiKey')),
            React.createElement('input', { className: 'dshPlatformInput', type: 'password', value: draft.apiKey, placeholder: t('aggregate.keyPlaceholder'), onChange: (event) => setEditing({ ...editing, apiKey: event.target.value }) })),
          React.createElement('label', { className: 'dshPlatformField' },
            React.createElement('span', { className: 'dshPlatformMeta' }, t('aggregate.models')),
            React.createElement('textarea', { className: 'dshPlatformTextarea', spellCheck: false, rows: 3, value: draft.models, placeholder: 'model-id, model-id', onChange: (event) => setEditing({ ...editing, models: event.target.value }) }))),
        React.createElement(SwitchRow, { checked: draft.enabled, label: t('aggregate.enabled'), hint: t('aggregate.enabledHint'), disabled: busy !== '', onChange: (checked) => setEditing({ ...editing, enabled: checked }) }),
        React.createElement('p', { className: 'dshPlatformMeta' }, t('aggregate.registryModels', { count: Array.isArray(editing.models) ? editing.models.length : 0 })),
        React.createElement('div', { className: 'dshPlatformBar' },
          React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy !== '', onClick: () => { void save() } }, busy === 'save' ? t('aggregate.saving') : t('aggregate.save')),
          React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy !== '', onClick: () => { void test() } }, busy === 'test' ? t('aggregate.working') : t('aggregate.test')),
          React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy !== '', onClick: () => { void discover() } }, busy === 'discover' ? t('aggregate.working') : t('aggregate.discover')),
          React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: busy !== '', onClick: () => { void clearKey() } }, busy === 'clear' ? t('aggregate.working') : t('aggregate.clearKey')),
          React.createElement('button', { className: 'dshPlatformButton dshPlatformDanger', type: 'button', disabled: busy !== '', onClick: () => { void remove() } }, busy === 'remove' ? t('aggregate.working') : t('aggregate.remove'))),
        verdict !== undefined && verdict !== null && React.createElement('p', { className: verdict.ok === true ? 'dshPlatformNoteSuccess' : 'dshPlatformNote' }, t(verdict.ok === true ? 'aggregate.lastTestOk' : 'aggregate.lastTestFailed', { at: new Date(verdict.at).toLocaleString() })),
        found !== null && React.createElement(Card, { title: t('aggregate.discovered', { count: found.length }) },
          found.length === 0
            ? React.createElement('p', { className: 'dshPlatformNote' }, t('aggregate.discoveredEmpty'))
            : React.createElement('p', { className: 'dshPlatformMeta' }, found.join(', '))))
      const rows = shown.length === 0
        ? React.createElement('p', { className: 'dshPlatformNote' }, registry.length === 0 ? t('aggregate.empty') : t('aggregate.noMatch'))
        : React.createElement('div', { className: 'dshPlatformStack' }, shown.map((provider) => {
          const state2 = configured[provider.id]
          const on = state2 !== undefined && state2 !== null && state2.enabled !== false
          return React.createElement('div', { className: 'dshPlatformChain', key: provider.id },
            React.createElement('div', { className: 'dshPlatformChainHead' },
              React.createElement('span', null, provider.name ?? provider.id),
              React.createElement(Pill, null, provider.category ?? ''),
              React.createElement(Pill, { tone: on ? 'ok' : 'off' }, on ? t('aggregate.on') : t('aggregate.off')),
              state2?.lastTest?.ok === true && React.createElement(Pill, { tone: 'ok' }, t('aggregate.verified'))),
            React.createElement('p', { className: 'dshPlatformMeta' }, `${provider.id} · ${provider.format ?? ''}`),
            React.createElement('div', { className: 'dshPlatformBar' },
              React.createElement('button', { className: 'dshPlatformButton', type: 'button', onClick: () => { setFound(null); setEditing({ providerId: provider.id, name: provider.name ?? provider.id, enabled: on, baseUrl: state2?.baseUrl ?? provider.baseUrl ?? '', apiKey: '', models: (state2?.models ?? []).join(', ') }) } }, t('aggregate.configure'))))
        }))
      return React.createElement(OwnerShell, { t, state },
        React.createElement('div', { className: 'dshPlatform' },
          React.createElement('p', { className: 'dshPlatformIntro' }, t('aggregate.intro')),
          React.createElement('div', { className: 'dshPlatformBar' },
            React.createElement('input', { className: 'dshPlatformInput', value: query, placeholder: t('aggregate.search'), 'aria-label': t('aggregate.search'), onChange: (event) => setQuery(event.target.value) })),
          editor,
          note !== '' && React.createElement('p', { className: 'dshPlatformNoteSuccess', role: 'status' }, note),
          error !== '' && React.createElement('p', { className: 'dshPlatformError', role: 'alert' }, t('owner.failed', { message: error })),
          React.createElement(Card, { title: t('aggregate.providers', { count: shown.length }) }, rows)))
    }

    /* ── 数据看板 ──────────────────────────────────────────────────────────── */
    function percentOf (part, whole) {
      return typeof whole === 'number' && whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—'
    }

    function DashboardPage ({ t }) {
      const state = useOwner(['/stats'])
      const stats = state.data === null ? null : state.data[0] ?? {}
      const grand = stats === null ? null : stats.grand ?? {}
      const rows = stats === null ? [] : stats.models ?? []
      const days = stats === null ? [] : (stats.days ?? []).slice(-14)
      const savings = stats === null ? null : stats.savings ?? null
      const success = grand === null ? 0 : Math.max(0, (grand.calls ?? 0) - (grand.failed ?? 0))
      const tokenTotal = grand === null ? 0 : (grand.input ?? 0) + (grand.output ?? 0) + (grand.reasoning ?? 0)
      const peak = days.reduce((max, day) => Math.max(max, day.total ?? 0), 0)
      const kpis = grand === null ? [] : [
        React.createElement(Stat, { key: 'calls', label: t('dash.calls'), value: formatNumber(grand.calls) }),
        React.createElement(Stat, { key: 'turns', label: t('dash.turns'), value: formatNumber(grand.turns) }),
        React.createElement(Stat, { key: 'ok', label: t('dash.success'), value: percentOf(success, grand.calls ?? 0) }),
        React.createElement(Stat, { key: 'tokens', label: t('dash.tokens'), value: formatNumber(tokenTotal) }),
        React.createElement(Stat, { key: 'saved', label: t('dash.saved'), value: savings === null ? '—' : `${formatNumber(savings.saved)} B` })
      ]
      const dayRows = days.length === 0
        ? React.createElement('p', { className: 'dshPlatformNote' }, t('dash.empty'))
        : React.createElement('div', { className: 'dshPlatformStack' }, days.map((day) => React.createElement('div', { className: 'dshPlatformChain', key: day.day },
          React.createElement('div', { className: 'dshPlatformChainHead' },
            React.createElement('code', { className: 'dshPlatformCode' }, day.day),
            React.createElement(Pill, { tone: 'strong' }, `${formatNumber(day.total)} ${t('dash.tokens')}`)),
          React.createElement('div', { className: 'dshPlatformMeter', 'aria-hidden': 'true' },
            React.createElement('div', { className: 'dshPlatformMeterFill', style: { width: `${peak > 0 ? Math.round(((day.total ?? 0) / peak) * 100) : 0}%` } })))))
      const modelRows = rows.length === 0
        ? React.createElement('p', { className: 'dshPlatformNote' }, t('dash.noModels'))
        : rows.map((row) => React.createElement('tr', { key: row.model },
          React.createElement('td', null, row.name ?? row.model),
          React.createElement('td', null, formatNumber(row.calls)),
          React.createElement('td', null, formatNumber(row.turns)),
          React.createElement('td', null, formatNumber(row.input)),
          React.createElement('td', null, formatNumber(row.output)),
          React.createElement('td', null, formatNumber(row.reasoning)),
          React.createElement('td', null, formatNumber(row.failed)),
          React.createElement('td', null, row.tps === null || row.tps === undefined ? '—' : String(row.tps)),
          React.createElement('td', null, row.avgTtftMs === null || row.avgTtftMs === undefined ? '—' : `${formatNumber(row.avgTtftMs)} ms`)))
      const table = rows.length === 0 ? null : React.createElement('div', { className: 'dshPlatformTableWrap' },
        React.createElement('table', { className: 'dshPlatformTable' },
          React.createElement('thead', null, React.createElement('tr', null,
            React.createElement('th', { scope: 'col' }, t('dash.columnModel')),
            React.createElement('th', { scope: 'col' }, t('dash.calls')),
            React.createElement('th', { scope: 'col' }, t('dash.turns')),
            React.createElement('th', { scope: 'col' }, t('dash.columnInput')),
            React.createElement('th', { scope: 'col' }, t('dash.columnOutput')),
            React.createElement('th', { scope: 'col' }, t('dash.columnReasoning')),
            React.createElement('th', { scope: 'col' }, t('dash.columnFailed')),
            React.createElement('th', { scope: 'col' }, t('dash.columnTps')),
            React.createElement('th', { scope: 'col' }, t('dash.columnTtft')))),
          React.createElement('tbody', null, modelRows)))
      return React.createElement(OwnerShell, { t, state },
        React.createElement('div', { className: 'dshPlatform' },
          React.createElement('p', { className: 'dshPlatformIntro' }, t('dash.intro')),
          kpis.length > 0 && React.createElement('div', { className: 'dshPlatformGrid' }, kpis),
          stats !== null && stats.requestFailuresEstimated === true && React.createElement('p', { className: 'dshPlatformMeta' }, t('dash.estimated')),
          table !== null && React.createElement(Card, { title: t('dash.byModel') }, table),
          React.createElement(Card, { title: t('dash.byDay') }, dayRows)))
    }

    /* ── 运行日志 ──────────────────────────────────────────────────────────── */
    const LOG_PAGE_SIZES = [20, 50, 100]

    function LogPage ({ t }) {
      const state = useOwner(['/stats'])
      const [onlyFailed, setOnlyFailed] = React.useState(false)
      const [model, setModel] = React.useState('')
      const [size, setSize] = React.useState(20)
      const [page, setPage] = React.useState(1)
      const stats = state.data === null ? null : state.data[0] ?? {}
      const samples = stats === null ? [] : stats.samples ?? []
      const models = stats === null ? [] : (stats.models ?? []).map((row) => row.model)
      const filtered = samples.filter((row) => (onlyFailed ? row.ok !== true : true) && (model === '' || row.model === model))
      const pages = Math.max(1, Math.ceil(filtered.length / size))
      const current = Math.min(page, pages)
      const shown = filtered.slice((current - 1) * size, current * size)
      const note = (row) => [row.truncated === true ? t('log.truncated') : '', row.noUsage === true ? t('log.noUsage') : ''].filter((text) => text !== '').join(' · ')
      const rows = shown.length === 0
        ? React.createElement('p', { className: 'dshPlatformNote' }, samples.length === 0 ? t('log.empty') : t('log.noMatch'))
        : shown.map((row) => React.createElement('tr', { key: `${row.at}-${row.model}-${row.input}-${row.output}` },
          React.createElement('td', null, new Date(row.at).toLocaleString()),
          React.createElement('td', null, row.model),
          React.createElement('td', null, React.createElement(Pill, { tone: row.ok === true ? 'ok' : 'danger' }, row.ok === true ? t('log.ok') : t('log.failed'))),
          React.createElement('td', null, formatNumber(row.input)),
          React.createElement('td', null, formatNumber(row.output)),
          React.createElement('td', null, typeof row.tps === 'number' ? String(row.tps) : '—'),
          React.createElement('td', null, typeof row.ttftMs === 'number' ? `${formatNumber(row.ttftMs)} ms` : '—'),
          React.createElement('td', null, typeof row.decodeMs === 'number' ? `${formatNumber(row.decodeMs)} ms` : '—'),
          React.createElement('td', null, [row.origin ?? '', row.effort ?? '', note(row)].filter((text) => text !== '').join(' · '))))
      const table = shown.length === 0 ? null : React.createElement('div', { className: 'dshPlatformTableWrap' },
        React.createElement('table', { className: 'dshPlatformTable' },
          React.createElement('thead', null, React.createElement('tr', null,
            React.createElement('th', { scope: 'col' }, t('log.columnTime')),
            React.createElement('th', { scope: 'col' }, t('log.columnModel')),
            React.createElement('th', { scope: 'col' }, t('log.columnResult')),
            React.createElement('th', { scope: 'col' }, t('dash.columnInput')),
            React.createElement('th', { scope: 'col' }, t('dash.columnOutput')),
            React.createElement('th', { scope: 'col' }, t('dash.columnTps')),
            React.createElement('th', { scope: 'col' }, t('dash.columnTtft')),
            React.createElement('th', { scope: 'col' }, t('log.columnDecode')),
            React.createElement('th', { scope: 'col' }, t('log.columnNotes')))),
          React.createElement('tbody', null, rows)))
      return React.createElement(OwnerShell, { t, state },
        React.createElement('div', { className: 'dshPlatform' },
          React.createElement('p', { className: 'dshPlatformIntro' }, t('log.intro')),
          React.createElement('div', { className: 'dshPlatformBar' },
            React.createElement(SwitchRow, { checked: onlyFailed, label: t('log.onlyFailed'), onChange: (checked) => { setOnlyFailed(checked); setPage(1) } }),
            React.createElement('label', { className: 'dshPlatformField' },
              React.createElement('span', { className: 'dshPlatformMeta' }, t('log.filterModel')),
              React.createElement('select', { className: 'dshPlatformSelect', value: model, onChange: (event) => { setModel(event.target.value); setPage(1) } },
                React.createElement('option', { value: '' }, t('log.allModels')),
                models.map((id) => React.createElement('option', { key: id, value: id }, id)))),
            React.createElement('label', { className: 'dshPlatformField' },
              React.createElement('span', { className: 'dshPlatformMeta' }, t('log.pageSize')),
              React.createElement('select', { className: 'dshPlatformSelect', value: String(size), onChange: (event) => { setSize(Number(event.target.value) || 20); setPage(1) } },
                LOG_PAGE_SIZES.map((value) => React.createElement('option', { key: value, value: String(value) }, String(value)))))),
          state.data !== null && React.createElement('p', { className: 'dshPlatformMeta' }, t('log.count', { shown: filtered.length, total: samples.length, page: current, pages })),
          React.createElement(Card, { title: t('log.title') }, table),
          pages > 1 && React.createElement('div', { className: 'dshPlatformBar' },
            React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: current <= 1, onClick: () => setPage(current - 1) }, t('log.prev')),
            React.createElement('button', { className: 'dshPlatformButton', type: 'button', disabled: current >= pages, onClick: () => setPage(current + 1) }, t('log.next')))))
    }

    // Declared soft dependencies. The host refuses to hand over a service that
    // is not named here — `ctx.locale` without this list throws
    // "cannot get property \"locale\" without inject" in the renderer, and the
    // whole client bundle fails to load. `slots` is unused by the pages today
    // but stays declared: the section is registered through it.
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
            inject: () => ({ t, scope, host })
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