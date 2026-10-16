/**
 * Settings page for `dsh-localcoding-mcp`.
 *
 * One self-contained client module: DSH client bundles cannot use relative
 * `require`, so everything (locale copy, styles, components) lives in this file.
 * All copy goes through `ctx.locale`; nothing reads `navigator.language`, and all
 * colours come from `--dsw-alias-*` tokens so the page follows the host theme.
 */
window.__ModuleLoader__.load({
  id: 'dsh-localcoding-mcp/client',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'settings.localCodingMcp'
    // A settings section is keyed by the owning Loader entry id, so this must
    // match the plugin's `name` (and the patch row id) exactly.
    const SETTINGS_NAMESPACE = 'dsh-localcoding-mcp'
    const API = '/dsh-localcoding-mcp'
    /**
     * Where this section lands in the Settings navigation. The ledger is sorted
     * ascending, and the installed third-party pages already occupy the low 20s,
     * so 950 keeps this page last even as the host ships more sections.
     */
    const SECTION_ORDER = 950

    const zh = {
      'nav': 'LocalCoding MCP',
      'heading': 'LocalCoding MCP 桥接',
      'hint': '把 LocalCodingMCP 的 .NET MCP 服务接入本应用：工具注册进当前会话供模型调用，同时把 /mcp 端点暴露给 Codex 形成反向委派。',
      'server': 'MCP 服务',
      'tools': '工具桥接',
      'probe': '握手与指令',
      'logs': '服务日志',
      'codex': 'Codex 反向委派',
      'codexRegistered': 'Codex 已可回调本机 /mcp',
      'codexNotRegistered': '尚未向 Codex 注册',
      'codexRegisteredStale': '已注册，但指向的端口不对',
      'codexStaleHint': 'Codex 里的那条记录指向的端口不是本机现在应答的端口，Codex 会调到一个没人监听的端口。点「注册到 Codex」覆盖它。',
      'codexStaleDetail': '（原 {was} → 现在 {now}）',
      'codexLoggedOut': 'Codex CLI 未登录，请先在终端执行 codex login，否则反向委派会失败。',
      'codexEndpoint': '当前模型入口',
      'codexEndpointOk': '模型入口可达',
      'codexEndpointDown': '模型入口不可达（反向委派会失败）',
      'codexEndpointHint': '反向委派失败的原因：模型入口不可达。',
      'codexRelayNote': '上面这个入口来自系统里已有的 codex 配置（config.toml），与本插件无关。点「改用本应用模型」把它换成下面这个由本应用提供的入口。',
      'useAppModel': '改用本应用模型',
      'undoAppModel': '恢复原 Codex 配置',
      'appModel': '本应用模型端点',
      'appModelHint': 'Codex 直接使用本应用的模型能力：不需要第三方中转、不需要单独的 API Key、不用 codex login。点一下即可改写 ~/.codex/config.toml 并自动备份。',
      'appModelDisabled': '模型端点未挂载（需要宿主 webServer）。',
      'appModelSnippet': '或手动写入 config.toml',
      'endpoints': '端点',
      'nativeTools': '原生工具',
      'nativeNote': '这些工具直接跑在插件进程里，不启动任何外部程序、不占端口。',
      'codexServers': 'Codex 已配置的 MCP 服务',
      'state': '状态',
      'workspace': '工作区',
      'exe': '可执行文件',
      'mcpUrl': 'MCP 端点',
      'pid': '进程',
      'version': '版本',
      'uptime': '已运行',
      'session': '会话',
      'toolCount': '已注册工具',
      'execRegistered': '宿主注册',
      'refresh': '刷新',
      'start': '启动',
      'stop': '停止',
      'restart': '重启',
      'refreshTools': '重新同步工具',
      'probeButton': '握手检查',
      'loadAvailable': '读取服务端工具',
      'registerCodex': '注册到 Codex',
      'unregisterCodex': '从 Codex 移除',
      'empty': '暂无数据',
      'ok': '成功',
      'failed': '失败',
      'disabled': '未启用自动启动',
      'external': '复用已在运行的进程',
      'running': '运行中',
      'stopped': '已停止',
      'starting': '启动中',
      'capabilities': '能力',
      'duration': '耗时',
      'rawOutput': '原始输出',
      'arguments': '参数',
      'close': '关闭',
      'consent': '该工具可读写本地文件、执行命令；确认了解后再交给外部模型。',
      // ---- GPT web → local ----
      'tunnel': 'GPT 网页调用',
      'tunnelHint': '网页版 ChatGPT 无法访问 127.0.0.1，这里为每个账号启动一条隧道客户端，由它主动向外连接 OpenAI 控制面；账号在 ChatGPT 连接器里选中这条隧道后，就能调用上面的本地工具。',
      'tunnelOff': '隧道未启用，请在下方设置中打开 tunnelEnabled。',
      'tunnelAccounts': '账号',
      'tunnelTunnelId': '隧道 ID',
      'tunnelKey': '控制面密钥',
      'tunnelKeyOk': '已配置（DPAPI 加密，仅内存解密）',
      'tunnelKeyMissing': '未配置',
      'tunnelProxy': '出站代理',
      'tunnelProxyDirect': '直连',
      'tunnelProxyOff': '尚未探测',
      'tunnelHealthPort': '健康端口',
      'tunnelReady': '就绪',
      'tunnelStarting': '连接中',
      'tunnelDied': '已退出',
      'tunnelTimeout': '连接超时',
      'tunnelProfileFailed': '配置文件生成失败',
      'tunnelSkipped': '已忽略的账号',
      'tunnelStart': '启动隧道',
      'tunnelStop': '停止隧道',
      'tunnelStartAll': '全部启动',
      'tunnelStopAll': '全部停止',
      'tunnelDoctor': '诊断',
      'tunnelOrgMissing': '该账号没有 organizationId，OpenAI 控制面可能返回 403 tunnel_active_organization_required —— 在 platform.openai.com 的隧道设置里补上组织 ID，再把密钥换成本账号的运行时密钥。',
      'tunnelReadyzNote': '/readyz 只证明守护进程活着；真正的验证是在 ChatGPT 连接器里选中隧道后真的调用一次工具。',
      'tunnelConnector': '连接器设置',
      'tunnelSkippedReason': '原因'
    }

    const en = {
      'nav': 'LocalCoding MCP',
      'heading': 'LocalCoding MCP bridge',
      'hint': 'Brings the LocalCodingMCP .NET server into this app: its tools are registered into the current session for the model, and its /mcp endpoint is exposed to Codex for reverse delegation.',
      'server': 'MCP server',
      'tools': 'Tool bridge',
      'probe': 'Handshake & instructions',
      'logs': 'Server log',
      'codex': 'Codex reverse delegation',
      'codexRegistered': 'Codex can call back into the local /mcp endpoint',
      'codexNotRegistered': 'not registered with Codex yet',
      'codexRegisteredStale': 'registered, but pointing at the wrong port',
      'codexStaleHint': 'The row in Codex points at a port this machine is no longer answering on, so Codex calls a dead endpoint. Press "Register with Codex" to overwrite it.',
      'codexStaleDetail': '(was {was} → now {now})',
      'codexLoggedOut': 'The Codex CLI is not logged in. Run `codex login` first, otherwise reverse delegation fails.',
      'codexEndpoint': 'current model endpoint',
      'codexEndpointOk': 'model endpoint reachable',
      'codexEndpointDown': 'model endpoint unreachable (delegation will fail)',
      'codexEndpointHint': 'Why reverse delegation fails: the model endpoint is not answering.',
      'codexRelayNote': 'The endpoint above comes from the codex configuration already on this machine (config.toml) and has nothing to do with this plugin. Press "Use this app\'s model" to replace it with the endpoint below, served by this app.',
      'useAppModel': "Use this app's model",
      'undoAppModel': 'Restore the original Codex config',
      'appModel': "this app's model endpoint",
      'appModelHint': "Codex then runs on this app's own model access: no third-party relay, no separate API key, no `codex login`. One press rewrites ~/.codex/config.toml and backs it up first.",
      'appModelDisabled': 'The model endpoint is not mounted (it needs the host webServer).',
      'appModelSnippet': 'or write it into config.toml yourself',
      'endpoints': 'endpoints',
      'nativeTools': 'native tools',
      'nativeNote': 'These tools run inside the plugin process: no external program is started and no port is taken.',
      'codexServers': 'MCP servers configured in Codex',
      'state': 'State',
      'workspace': 'Workspace',
      'exe': 'Executable',
      'mcpUrl': 'MCP endpoint',
      'pid': 'PID',
      'version': 'Version',
      'uptime': 'Uptime',
      'session': 'Session',
      'toolCount': 'Registered tools',
      'execRegistered': 'Host registry',
      'refresh': 'Refresh',
      'start': 'Start',
      'stop': 'Stop',
      'restart': 'Restart',
      'refreshTools': 'Re-sync tools',
      'probeButton': 'Check handshake',
      'loadAvailable': 'Read server tools',
      'registerCodex': 'Register with Codex',
      'unregisterCodex': 'Remove from Codex',
      'empty': 'nothing here yet',
      'ok': 'ok',
      'failed': 'failed',
      'disabled': 'auto-start is off',
      'external': 'adopting an already-running process',
      'running': 'running',
      'stopped': 'stopped',
      'starting': 'starting',
      'capabilities': 'Capabilities',
      'duration': 'Duration',
      'rawOutput': 'Raw output',
      'arguments': 'Arguments',
      'close': 'Close',
      'consent': 'These tools read and write local files and run commands. Confirm you understand before handing work to an external model.',
      // ---- GPT web → local ----
      'tunnel': 'GPT web access',
      'tunnelHint': 'Web ChatGPT cannot reach 127.0.0.1. This starts one tunnel client per account, each dialling out to the OpenAI control plane; once you pick its tunnel in the ChatGPT connector settings, the web model can call the local tools above.',
      'tunnelOff': 'Tunnels are off — turn on tunnelEnabled in the settings below.',
      'tunnelAccounts': 'Accounts',
      'tunnelTunnelId': 'Tunnel ID',
      'tunnelKey': 'Control plane key',
      'tunnelKeyOk': 'configured (DPAPI-encrypted, decrypted in memory only)',
      'tunnelKeyMissing': 'not configured',
      'tunnelProxy': 'Outbound proxy',
      'tunnelProxyDirect': 'direct',
      'tunnelProxyOff': 'not probed yet',
      'tunnelHealthPort': 'Health port',
      'tunnelReady': 'ready',
      'tunnelStarting': 'connecting',
      'tunnelDied': 'exited',
      'tunnelTimeout': 'connection timed out',
      'tunnelProfileFailed': 'profile generation failed',
      'tunnelSkipped': 'Skipped accounts',
      'tunnelStart': 'Start tunnel',
      'tunnelStop': 'Stop tunnel',
      'tunnelStartAll': 'Start all',
      'tunnelStopAll': 'Stop all',
      'tunnelDoctor': 'Diagnose',
      'tunnelOrgMissing': 'This account has no organizationId, so the OpenAI control plane may answer 403 tunnel_active_organization_required — add the organization ID in the tunnel settings on platform.openai.com and replace the key with a runtime key issued for this account.',
      'tunnelReadyzNote': '/readyz only proves the daemon runs; the real check is picking the tunnel in the ChatGPT connector settings and making an actual tool call.',
      'tunnelConnector': 'connector settings',
      'tunnelSkippedReason': 'Reason'
    }

    const STYLES = `
.dshLcm{margin:0 auto;max-width:960px;width:100%;padding:20px 4px 48px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dshLcmTitle{margin:0;font-size:18px;font-weight:600;line-height:26px}
.dshLcmHint{margin:0;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-primary));font-size:12px;line-height:19px}
.dshLcmCard{border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-1);padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.dshLcmCardHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dshLcmCardTitle{margin:0;font-size:14px;font-weight:500;line-height:22px}
.dshLcmBar{display:flex;gap:8px;flex-wrap:wrap}
.dshLcmButton{box-sizing:border-box;height:32px;padding:0 14px;min-width:72px;flex:none;border:.5px solid var(--dsw-alias-border-l3);border-radius:16px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap}
.dshLcmButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshLcmButton:disabled{opacity:.4;cursor:default}
.dshLcmDanger{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary))}
.dshLcmGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
.dshLcmStat{border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:2px;min-width:0}
.dshLcmStatKey{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-primary));opacity:.75}
.dshLcmStatValue{font-size:13px;line-height:20px;word-break:break-all}
.dshLcmTag{display:inline-flex;align-items:center;height:22px;padding:0 10px;border-radius:11px;border:.5px solid var(--dsw-alias-border-l3);font-size:11px;line-height:20px}
.dshLcmOk{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-primary));border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent)}
.dshLcmBad{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary));border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
.dshLcmList{display:flex;flex-direction:column;gap:6px;max-height:340px;overflow:auto}
.dshLcmRow{display:flex;gap:10px;align-items:baseline;padding:6px 10px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 60%,transparent);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:19px}
.dshLcmRowName{flex:none;font-weight:600}
.dshLcmRowDesc{min-width:0;opacity:.72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshLcmLog{margin:0;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 70%,transparent);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:17px;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.dshLcmNote{margin:0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-primary))}
.dshLcmNoteWarn{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-primary))}
@media (prefers-reduced-motion:reduce){.dshLcm *{transition:none!important;animation:none!important}}
`

    async function request (path, options) {
      const response = await fetch(API + path, { credentials: 'same-origin', cache: 'no-store', ...options })
      const text = await response.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = { error: text } }
      if (!response.ok) throw new Error(body?.error || `${response.status} ${response.statusText}`)
      return body
    }

    function Card ({ title, actions, children }) {
      return React.createElement('section', { className: 'dshLcmCard' },
        React.createElement('div', { className: 'dshLcmCardHead' },
          React.createElement('h3', { className: 'dshLcmCardTitle' }, title),
          actions ? React.createElement('div', { className: 'dshLcmBar' }, actions) : null),
        children)
    }

    function Stat ({ label, value }) {
      return React.createElement('div', { className: 'dshLcmStat' },
        React.createElement('span', { className: 'dshLcmStatKey' }, label),
        React.createElement('span', { className: 'dshLcmStatValue' }, value))
    }

    function Btn ({ danger, disabled, onClick, children }) {
      return React.createElement('button', {
        className: danger ? 'dshLcmButton dshLcmDanger' : 'dshLcmButton',
        type: 'button',
        disabled: disabled === true,
        onClick
      }, children)
    }

    function seconds (ms) {
      if (!ms || ms < 0) return '—'
      const total = Math.floor(ms / 1000)
      return `${Math.floor(total / 60)}m ${total % 60}s`
    }

    function LocalCodingSection ({ t }) {
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState('')
      const [note, setNote] = useState('')
      const [probe, setProbe] = useState(null)
      const [available, setAvailable] = useState(null)
      const [logs, setLogs] = useState([])
      /**
       * Doctor reports keyed by account id. A plain object, not state: the report
       * only ever changes when its own button is pressed, and re-rendering the whole
       * account list on every poll would fight the 6 s status refresh.
       */
      const doctor = useRef({}).current
      const timerRef = useRef(null)

      const load = useCallback(async () => {
        try {
          const next = await request('/status')
          setStatus(next)
          setNote('')
          setLogs(await request('/logs?limit=60'))
        } catch (error) {
          setNote(error.message)
        }
      }, [])

      useEffect(() => {
        void load()
        // Only refresh while the page is open: this is a desktop page, but a
        // long-lived tab must not keep hammering the server.
        timerRef.current = setInterval(() => void load(), 6000)
        return () => { if (timerRef.current) clearInterval(timerRef.current) }
      }, [load])

      const run = useCallback(async (key, path, label) => {
        setBusy(key)
        setNote('')
        try {
          const result = await request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          setNote(`${label}: ${result?.state ?? result?.toolCount ?? result?.name ?? t('ok')}`)
          await load()
        } catch (error) {
          setNote(`${label}: ${error.message}`)
        } finally {
          setBusy('')
        }
      }, [load, t])

      /**
       * Same as `run`, but for endpoints that need a body and return something the
       * user wants to read (a per-account state, a doctor report).
       */
      const runWith = useCallback(async (key, path, body, label) => {
        setBusy(key)
        setNote('')
        try {
          const result = await request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          setNote(`${label}: ${result?.state ?? t('ok')}`)
          await load()
          return result
        } catch (error) {
          setNote(`${label}: ${error.message}`)
          return null
        } finally {
          setBusy('')
        }
      }, [load, t])

      /** Read an endpoint into local state without disturbing the page note. */
      const fetchInto = useCallback(async (key, path, setter) => {
        setBusy(key)
        try {
          setter(await request(path))
        } catch (error) {
          setter({ ok: false, error: error.message })
        } finally {
          setBusy('')
        }
      }, [])

      const server = status?.server
      const client = status?.client
      const codex = status?.codex
      const tunnel = status?.tunnel
      const endpoints = status?.client
      const live = server?.state === 'native' || server?.state === 'external'

      const stateLabel = server?.state === 'native'
        ? t('nativeTools')
        : server?.state === 'external'
          ? t('external')
          : t('stopped')

      /**
       * Tunnel states come from the fleet verbatim (READY / DIED / TIMEOUT /
       * PROFILE_FAILED / FAILED / stopped) so the page never invents its own
       * vocabulary for something the daemon actually decided.
       */
      const tunnelStateLabel = (account) => {
        switch (account?.state) {
          case 'READY': return { text: t('tunnelReady'), ok: true }
          case 'starting': return { text: t('tunnelStarting'), ok: false }
          case 'DIED': return { text: t('tunnelDied'), ok: false }
          case 'TIMEOUT': return { text: t('tunnelTimeout'), ok: false }
          case 'PROFILE_FAILED': return { text: t('tunnelProfileFailed'), ok: false }
          case 'stopped': return { text: t('stopped'), ok: false }
          default: return { text: account?.state ?? '—', ok: false }
        }
      }

      return React.createElement('div', { className: 'dshLcm' },
        React.createElement('h2', { className: 'dshLcmTitle' }, t('heading')),
        React.createElement('p', { className: 'dshLcmHint' }, t('hint')),
        note
          ? React.createElement('p', { className: 'dshLcmNote' }, note)
          : null,

        // ---- tool surface ----
        //
        // There is no process to start or stop any more: the tools live in the
        // plugin, so the only useful actions are refreshing the view and reading
        // the endpoint a client should point at.
        React.createElement(Card, {
          title: t('server'),
          actions: [
            React.createElement(Btn, { key: 'refresh', disabled: busy !== '', onClick: () => void load() }, t('refresh'))
          ]
        },
          React.createElement('div', { className: 'dshLcmBar' },
            React.createElement('span', {
              className: live ? 'dshLcmTag dshLcmOk' : 'dshLcmTag dshLcmBad'
            }, `${t('state')}: ${stateLabel}`),
            React.createElement('span', { className: 'dshLcmTag' }, t('nativeNote'))),
          React.createElement('div', { className: 'dshLcmGrid' },
            React.createElement(Stat, { key: 'ws', label: t('workspace'), value: status?.settings?.workspaceRoot ?? '—' }),
            React.createElement(Stat, { key: 'mode', label: t('state'), value: status?.settings?.sourceMode ?? '—' }),
            React.createElement(Stat, { key: 'mcp', label: t('mcpUrl'), value: client?.mcpUrl ?? codex?.mcpUrl ?? '—' }),
            React.createElement(Stat, { key: 'model', label: t('appModel'), value: client?.modelBaseUrl ?? '—' }),
            React.createElement(Stat, { key: 'count', label: t('toolCount'), value: String(status?.tools?.toolCount ?? 0) }),
            React.createElement(Stat, { key: 'sessions', label: t('session'), value: String(client?.sessions ?? 0) }))),

        // ---- tools ----
        React.createElement(Card, {
          title: `${t('tools')} (${status?.tools?.toolCount ?? 0})`,
          actions: [
            React.createElement(Btn, { key: 'avail', disabled: busy !== '' || !live, onClick: () => {
              setBusy('avail')
              void request('/available')
                .then((next) => setAvailable(next))
                .catch((error) => setNote(error.message))
                .finally(() => setBusy(''))
            } }, t('loadAvailable'))
          ]
        },
          React.createElement(Stat, {
            label: t('execRegistered'),
            value: (status?.tools?.tools ?? []).slice(0, 3).map((tool) => tool.registeredName).join(', ') +
              (status?.tools?.toolCount > 3 ? ` +${status.tools.toolCount - 3}` : '')
          }),
          status?.tools?.tools?.length
            ? React.createElement('div', { className: 'dshLcmList' },
              status.tools.tools.map((tool) => React.createElement('div', { key: tool.registeredName, className: 'dshLcmRow' },
                React.createElement('span', { className: 'dshLcmRowName' }, tool.registeredName),
                React.createElement('span', { className: 'dshLcmRowDesc' }, tool.description || tool.name))))
            : React.createElement('p', { className: 'dshLcmNote' }, t('empty')),
          available
            ? React.createElement('details', null,
              React.createElement('summary', null, `${t('rawOutput')} (${available.count ?? available.tools.length})`),
              React.createElement('pre', { className: 'dshLcmLog' },
                available.ok ? available.tools.map((tool) => tool.name).join('\n') : available.error))
            : null),

        // ---- codex ----
        React.createElement(Card, {
          title: t('codex'),
          actions: [
            React.createElement(Btn, { key: 'reg', disabled: busy !== '', onClick: () => void run('codexreg', '/codex/register', t('registerCodex')) }, t('registerCodex')),
            React.createElement(Btn, { key: 'unreg', danger: true, disabled: busy !== '', onClick: () => void run('codexunreg', '/codex/unregister', t('unregisterCodex')) }, t('unregisterCodex'))
          ]
        },
          React.createElement('div', { className: 'dshLcmBar' },
            // Three states, not two. A row left over from an earlier session used
            // to read as "registered" while Codex called a dead endpoint, so the
            // match is reported separately instead of folded into a boolean.
            React.createElement('span', {
              className: codex?.matchesOurEndpoint ? 'dshLcmTag dshLcmOk'
                : codex?.registered ? 'dshLcmTag dshLcmBad'
                  : 'dshLcmTag'
            }, codex?.matchesOurEndpoint
              ? t('codexRegistered')
              : codex?.registered ? t('codexRegisteredStale') : t('codexNotRegistered')),
            codex?.loggedIn === false
              ? React.createElement('span', { className: 'dshLcmTag dshLcmBad' }, t('codexLoggedOut'))
              : null,
            // Whether the endpoint Codex is *currently* configured with answers.
            // `codex login status` can never be this signal: a relay config has no
            // auth.json and always reports "not logged in".
            codex?.endpoint?.checked
              ? React.createElement('span', {
                className: codex.endpoint.reachable ? 'dshLcmTag dshLcmOk' : 'dshLcmTag dshLcmBad'
              }, codex.endpoint.reachable
                ? t('codexEndpointOk')
                : t('codexEndpointDown'))
              : null),
          React.createElement('div', { className: 'dshLcmGrid' },
            React.createElement(Stat, { key: 'path', label: 'codex', value: codex?.path ?? '—' }),
            React.createElement(Stat, { key: 'name', label: t('mcpUrl'), value: codex?.mcpServerName ?? '—' }),
            React.createElement(Stat, { key: 'url', label: 'url', value: codex?.mcpUrl ?? '—' }),
            codex?.provider?.baseUrl
              ? React.createElement(Stat, {
                key: 'endpoint',
                label: t('codexEndpoint'),
                value: `${codex.provider.name} · ${codex.provider.baseUrl}${codex.provider.hasToken ? ' · token' : ''}`
              })
              : null,
            // The endpoint this plugin offers, next to whatever Codex uses today.
            // Seeing both is the point: the user asked to replace the first with
            // the second, and the difference has to be visible to press the button.
            React.createElement(Stat, {
              key: 'appmodel',
              label: t('appModel'),
              value: endpoints?.modelBaseUrl ?? '—'
            })),
          codex?.provider?.relay
            ? React.createElement('p', { className: 'dshLcmNote dshLcmNoteWarn' }, t('codexRelayNote'))
            : null,
          // Always rendered, even before the first poll lands: this is the control
          // that performs the user's actual request (run Codex on this app's model),
          // and a feature that only appears once status arrives is one nobody finds.
          React.createElement('p', {
            className: endpoints?.modelBaseUrl === undefined ? 'dshLcmNote dshLcmNoteWarn' : 'dshLcmNote'
          }, endpoints?.modelBaseUrl === undefined ? t('appModelDisabled') : t('appModelHint')),
          React.createElement('div', { className: 'dshLcmBar' },
            React.createElement(Btn, {
              key: 'usemodel',
              disabled: busy !== '' || endpoints?.modelBaseUrl === undefined,
              onClick: () => void run('usemodel', '/codex/use-app-model', t('useAppModel'))
            }, t('useAppModel')),
            React.createElement(Btn, {
              key: 'undomodel',
              danger: true,
              disabled: busy !== '',
              onClick: () => void run('undomodel', '/codex/restore', t('undoAppModel'))
            }, t('undoAppModel'))),
          endpoints?.modelSnippet
            ? React.createElement('details', null,
              React.createElement('summary', null, t('appModelSnippet')),
              React.createElement('pre', { className: 'dshLcmLog' }, endpoints.modelSnippet))
            : null,
          codex?.endpoint?.checked && codex.endpoint.reachable === false
            ? React.createElement('p', { className: 'dshLcmNote dshLcmNoteWarn' },
              t('codexEndpointHint'), ' ', codex.endpoint.error ?? '')
            : null,
          codex?.registered && codex?.matchesOurEndpoint === false
            ? React.createElement('p', { className: 'dshLcmNote dshLcmNoteWarn' },
              t('codexStaleHint'), ' ',
              t('codexStaleDetail')
                .replace('{was}', codex.registeredUrl ?? '—')
                .replace('{now}', codex.mcpUrl ?? '—'),
              ' ')
            : null,
          codex?.provider?.relay
            ? React.createElement('p', { className: 'dshLcmNote' }, t('codexRelayNote'))
            : null,
          codex?.servers?.length
            ? React.createElement('div', null,
              React.createElement('p', { className: 'dshLcmNote' }, t('codexServers')),
              React.createElement('div', { className: 'dshLcmList' },
                codex.servers.map((server_) => React.createElement('div', { key: server_.name, className: 'dshLcmRow' },
                  React.createElement('span', { className: 'dshLcmRowName' }, server_.name),
                  React.createElement('span', { className: 'dshLcmRowDesc' }, server_.target)))))
            : null,
          React.createElement('p', { className: 'dshLcmNote dshLcmNoteWarn' }, t('consent'))),

        // ---- GPT web → local ----
        React.createElement(Card, {
          title: t('tunnel'),
          actions: [
            React.createElement(Btn, { key: 'tstartall', disabled: busy !== '' || !tunnel?.enabled || !live, onClick: () => void runWith('tstartall', '/tunnel/start-all', {}, t('tunnelStartAll')) }, t('tunnelStartAll')),
            React.createElement(Btn, { key: 'tstopall', danger: true, disabled: busy !== '', onClick: () => void runWith('tstopall', '/tunnel/stop-all', {}, t('tunnelStopAll')) }, t('tunnelStopAll'))
          ]
        },
          React.createElement('p', { className: 'dshLcmNote' }, t('tunnelHint')),
          tunnel?.enabled === false
            ? React.createElement('p', { className: 'dshLcmNote dshLcmNoteWarn' }, tunnel.reason ?? t('tunnelOff'))
            : React.createElement('div', { className: 'dshLcmGrid' },
              React.createElement(Stat, { key: 'exe', label: t('exe'), value: tunnel?.exePath ?? '—' }),
              React.createElement(Stat, { key: 'url', label: t('mcpUrl'), value: tunnel?.mcpUrl ?? '—' }),
              React.createElement(Stat, {
                key: 'proxy',
                label: t('tunnelProxy'),
                value: tunnel?.proxy ? tunnel.proxy : tunnel?.proxyResolved ? t('tunnelProxyDirect') : t('tunnelProxyOff')
              }),
              React.createElement(Stat, { key: 'cp', label: 'control plane', value: tunnel?.controlPlaneBaseUrl ?? '—' }),
              React.createElement(Stat, { key: 'profile', label: 'profile dir', value: tunnel?.profileDir ?? '—' }),
              React.createElement(Stat, { key: 'rt', label: 'runtime', value: tunnel?.runtimePath ?? '—' })),
          tunnel?.accounts?.length
            ? React.createElement('div', { className: 'dshLcmList' },
              tunnel.accounts.map((account) => {
                const state = tunnelStateLabel(account)
                return React.createElement('div', { key: account.id },
                  React.createElement('div', { className: 'dshLcmRow' },
                    React.createElement('span', { className: 'dshLcmRowName' }, `${account.name} (${account.id})`),
                    React.createElement('span', { className: state.ok ? 'dshLcmTag dshLcmOk' : 'dshLcmTag dshLcmBad' }, state.text),
                    React.createElement('span', { className: 'dshLcmRowDesc' },
                      `${t('tunnelKey')}: ${account.keyConfigured ? t('tunnelKeyOk') : t('tunnelKeyMissing')} · ` +
                      `${t('tunnelHealthPort')}: ${account.healthPort || '—'}` +
                      (account.message ? ` · ${account.message}` : ''))),
                  React.createElement('div', { className: 'dshLcmBar' },
                    React.createElement(Btn, {
                      key: `start-${account.id}`,
                      disabled: busy !== '' || !live || account.state === 'READY',
                      onClick: () => void runWith(`tstart-${account.id}`, '/tunnel/start', { id: account.id }, `${t('tunnelStart')} ${account.name}`)
                    }, t('tunnelStart')),
                    React.createElement(Btn, {
                      key: `stop-${account.id}`,
                      danger: true,
                      disabled: busy !== '' || account.state === 'stopped',
                      onClick: () => void runWith(`tstop-${account.id}`, '/tunnel/stop', { id: account.id }, `${t('tunnelStop')} ${account.name}`)
                    }, t('tunnelStop')),
                    React.createElement(Btn, {
                      key: `doctor-${account.id}`,
                      disabled: busy !== '',
                      onClick: () => void fetchInto(`doctor-${account.id}`, `/tunnel/doctor?id=${encodeURIComponent(account.id)}`, (report) => {
                        doctor[account.id] = report
                      })
                    }, t('tunnelDoctor'))),
                  // A tunnel without an organization id fails at the control plane
                  // with a 403 that no local check can see, so it is stated here
                  // instead of being discovered from a log file.
                  account.organizationId
                    ? null
                    : React.createElement('p', { className: 'dshLcmNote dshLcmNoteWarn' }, t('tunnelOrgMissing')),
                  doctor[account.id]
                    ? React.createElement('pre', { className: 'dshLcmLog' },
                      doctor[account.id].ok
                        ? [doctor[account.id].output, doctor[account.id].notes].filter(Boolean).join('\n')
                        : doctor[account.id].error)
                    : null)
              }))
            : React.createElement('p', { className: 'dshLcmNote' }, t('empty')),
          tunnel?.skipped?.length
            ? React.createElement('div', null,
              React.createElement('p', { className: 'dshLcmNote' }, t('tunnelSkipped')),
              React.createElement('div', { className: 'dshLcmList' },
                tunnel.skipped.map((entry) => React.createElement('div', { key: entry.id, className: 'dshLcmRow' },
                  React.createElement('span', { className: 'dshLcmRowName' }, entry.id),
                  React.createElement('span', { className: 'dshLcmRowDesc' }, `${t('tunnelSkippedReason')}: ${entry.reason}`)))))
            : null,
          React.createElement('p', { className: 'dshLcmNote' },
            `${t('tunnelConnector')}: https://chatgpt.com/#settings/Connectors — ${t('tunnelReadyzNote')}`)),

        // ---- probe + logs ----
        React.createElement(Card, {
          title: t('probe'),
          actions: [
            React.createElement(Btn, { key: 'probe', disabled: busy !== '' || !live, onClick: () => {
              setBusy('probe')
              void request('/probe')
                .then(setProbe)
                .catch((error) => setProbe({ ok: false, error: error.message }))
                .finally(() => setBusy(''))
            } }, t('probeButton'))
          ]
        },
          probe
            ? React.createElement('pre', { className: 'dshLcmLog' },
              probe.ok
                ? `${probe.serverInfo?.name} ${probe.serverInfo?.version}\n${probe.instructions ?? ''}`
                : probe.error)
            : null),

        React.createElement(Card, { title: t('logs') },
          React.createElement('pre', { className: 'dshLcmLog' },
            logs.length
              ? logs.map((entry) => `${entry.at} ${entry.stream} ${entry.text}`).join('\n')
              : t('empty'))))
    }

    const inject = ['slots', 'locale', 'configForms']
    function apply (ctx) {
      if (typeof document !== 'undefined' && !document.getElementById('dsh-localcoding-mcp-styles')) {
        const style = document.createElement('style')
        style.id = 'dsh-localcoding-mcp-styles'
        style.textContent = STYLES
        document.head.appendChild(style)
      }
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-localcoding-mcp: copy dictionaries')
      const t = ctx.locale.bind(NS)
      // `configForms` is the per-Loader-entry settings controller. Reading it here
      // is what gives this section its form: the Host builds the widget for the
      // entry id declared in `cordis.patch.yml`.
      const scope = ctx.configForms.get(SETTINGS_NAMESPACE)
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'localcoding-mcp',
            order: SECTION_ORDER,
            label: () => t('nav'),
            inject: () => ({ t, scope })
          },
          LocalCodingSection
        )
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})