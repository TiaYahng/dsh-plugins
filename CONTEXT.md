# CONTEXT — dsh-plugins 重构交接

> 本文件是公开仓库的一部分，因此只写可复用的结论与流程，不写任何本机路径。
> 只关于某一台机器的路径与状态在未跟踪的 `.local-context.md` 里（换机器或别人克隆时不存在）。

> 本文是给**新会话 / 新 agent** 读的完整上下文。读完再给重构提示词。
> 所有结论都带验证证据；未验证的明确标注为「未验证」。

---

## 0. 一句话现状

自制插件（2 个）已从即将废弃的仓库 `<旧仓库>` 移到本目录
`<仓库根>\`，并已在 `<另一套发行版的宿主>`（harness `0.2.0-rc.2`）上实测可用：

1. **`dsh-desktop-platform`** —— 综合平台，1 个设置页 / 4 个页签。
2. **`dsh-localcoding-mcp`** —— 把 `LocalCodingMCP_v0_3` 接进宿主，三个方向：
   40 个 MCP 工具入宿主工具表、任务反向委派给 `codex.exe`、
   出站隧道让网页版 ChatGPT 调本机工具。

---

## 1. 路径地图

| 位置 | 角色 | 能否改 |
| --- | --- | --- |
| `<仓库根>\` | **维护入口**，源码唯一权威 | ✅ 改这里 |
| `%APPDATA%\dsh-desktop\harness\profiles\web\plugins\<name>\` | 安装产物（脚本复制过去） | ❌ 会被覆盖 |
| `%APPDATA%\dsh-desktop\harness\profiles\web\node_modules\<name>\` | pnpm 实体拷贝，实际加载的代码 | ❌ 会被覆盖 |
| `<宿主安装目录>\` | 厂商应用（asar 打包，`resources\app.asar`） | ❌ 会被更新清空 |
| `<旧仓库>\` | **待废弃的仓库**（2523 MB / 80254 文件） | 已抽离 |

宿主（harness）版本：`0.2.0-rc.2`。应用版本：`0.11.1`。

宿主包源码在 asar 里，查证用：`node <脚本> "<宿主安装目录>\resources\app.asar" grep <pattern> <路径过滤>`
（自写脚本按 asar 头部 JSON 读文件，不需要解包）。

---

## 2. 插件与界面的对应关系

**2 个插件 → 2 个设置页。**

```
dsh-localcoding-mcp
  └─ settings.section  id: 'localcoding-mcp'  order: 950  label: t('nav')
       ├── card.server   服务器状态（启停 / 端口 / 工作区 / 版本）
       ├── card.tools    工具清单（41 个 lcm_*）
       ├── card.codex    Codex 可用性 + 模型入口探活 + 注册 / 注销 MCP 服务器
       ├── card.probe    握手自检（会话 / capabilities / instructions）
       ├── card.tunnel   网页版 ChatGPT 隧道舰队（按账号启停 / /readyz / doctor）
       ├── card.browser  可选的浏览器面（Playwright MCP）
       └── card.logs     实时日志
```

**1 个插件 → 1 个设置页 → 11 个页签。** 2026-10-14 由原来的「2 插件 / 3 页面」合并而来；
2026-10-15 加入 FreeModel 的 8 个自建页（原先是挂载对方的整页，因无法隐藏其中某一页而重做）。

```
dsh-desktop-platform
  └─ settings.section  id: 'desktop-platform'  order: 900  label: t('nav')
       ├── tab.usage      用量统计
       ├── tab.archive    归档历史
       ├── tab.memory     记忆系统
       ├── tab.upgrade    FreeModel · 插件升级   （/update/*、/reload）
       ├── tab.eac        FreeModel · EAC 模型   （/eac/*）
       ├── tab.aggregate  FreeModel · 聚合渠道   （/providers*）
       ├── tab.saver      FreeModel · 省 Token   （/token-saver、/local-optimize）
       ├── tab.routing    FreeModel · 路由       （/combos、/summary）
       ├── tab.dashboard  FreeModel · 数据看板   （/stats）
       ├── tab.logs       FreeModel · 运行日志   （/stats）
       └── tab.gateway    FreeModel · 网关设置   （/clients、/forward/*、/chan-gateway）
```

文案 key（`dsh-desktop-platform/client.js`）：

```js
nav: '综合平台' / 'Workbench',
'tab.usage': '用量统计' / 'Usage',
'tab.archive': '归档历史' / 'Archived sessions',
'tab.memory': '记忆系统' / 'Memory',
'usage.title': '统计概览' / 'Totals',
```

后 8 个页签与 `dsh-our-free-model` 的关系：只读它的 `/api/our-free-model/*`
（同源凭据 `credentials: 'same-origin'`，围栏只放行渲染进程），不持有它的状态；
`404/401` 一律视为「owner 没装」→ 显示安装提示。
唯一没搬的是「白嫖模型接入」：它读的是被吸收的 channel pack 的 RPC（`usage.tokenLedger*`），
本机没装那个 pack，拿不到返回结构，所以不凭猜测写。

## 3. 目录内容

```
<仓库根>\
├── dsh-desktop-platform\
│   ├── client.js              客户端：设置页 + 页签壳 + 七个面板（未拆子文件，见 7.4）
│   ├── index.js               服务端入口：name / inject / Config / apply
│   ├── server\http.js         loopback + JSON 共用管道、路由表
│   ├── server\workspace.js    工作区根目录收敛、UTF-8 读取
│   ├── server\usage.js         token 折叠、积分换算、summary 路由
│   ├── server\archive.js      归档列表 / 还原、工作区列表
│   ├── server\memory.js       MEMORY.md、约定块、交接摘要
│   ├── package.json
│   └── cordis.patch.yml
├── dsh-localcoding-mcp\
│   ├── client.js              客户端：MCP 桥接设置页（单文件，见 7.4）
│   ├── index.js               服务端入口：Config / 路由挂载 / 桥接 effect
│   ├── server\mcp-client.js   streamable-HTTP 的 MCP 客户端（POST-only，不开 GET 长连接）
│   ├── server\process.js      LocalCodingMCP.exe 生命周期：端口挑选 / 认领 / spawn / health / stop
│   ├── server\bridge.js       MCP 工具表 → 宿主 tools.register 的 ToolDefinition（lcm_ 前缀）
│   ├── server\codex.js        反向：lcm_codex_task 委派 codex.exe + codex mcp add/register + 中转入口探活
│   ├── server\tunnel.js       网页版方向：出站隧道舰队（DPAPI 解密 / profile 生成 / /readyz / doctor）
│   ├── server\browser.js      可选的 Playwright MCP 浏览器面（令牌从用户级注册表读）
│   ├── server\http.js         设置页用的 loopback 路由
│   ├── package.json
│   └── cordis.patch.yml
├── test\platform-client.test.mjs   客户端注册契约自检（零依赖）
├── test\localcoding-client.test.mjs
├── test\localcoding-server.test.mjs  打真实 MCP 服务器
├── test\localcoding-process.test.mjs 端口 / spawn / stop / codex 路径
├── test\localcoding-tunnel.test.mjs 账号解析 / 密钥变量名 / 代理探测 / DPAPI / profile 内容校验
├── test\localcoding-plugin.test.mjs  进程内跑完整 apply()，默认加载 profile 里那份部署副本
├── tools\asar.mjs                    asar 读取器（list / read / grep）
├── install-to-profile.ps1            安装与更新脚本（已实测通过）
├── README.md                         使用说明、来源、踩坑记录
└── CONTEXT.md                        本文
```

各文件职责：

| 文件 | 职责 |
| --- | --- |
| `client.js` | 客户端：注册设置界面 section、页签、注入样式、渲染 |
| `index.js` | 服务端：组合 `server/*` 的路由、声明 `inject` 与设置 `Config` |
| `server/*.js` | 服务端：路由与各自的领域逻辑 |
| `package.json` | `dsh.bundle`（挂载声明）+ `dsh.client`（注入与平台） |
| `cordis.patch.yml` | 把插件挂进 profile 的配置树，内容是一行 `- insert: - id / name` |

---

## 4. 安装与验证

```powershell
powershell -ExecutionPolicy Bypass -File <仓库根>\install-to-profile.ps1
```

改完代码**必须重跑**，然后重启 DSH Desktop。

不依赖应用的静态自检（零依赖，秒级）：

```powershell
node .\test\platform-client.test.mjs .\dsh-desktop-platform\client.js
```

验证手段（无需认证，服务端 loopback 路由）：

```powershell
Invoke-WebRequest http://127.0.0.1:43129/dsh-desktop/usage-stats/summary -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:43129/dsh-desktop/shell/archive.list  -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:43129/dsh-desktop/shell/workspaces    -UseBasicParsing
```

三个路由返回 200 且字节数正常 = 服务端已激活。
**客户端界面无法从外部验证** —— 页面返回 401（认证 cookie 只在渲染进程内存），
客户端 bundle 在 loopback 端口上也是 404，日志不记录客户端资源请求，只能靠用户看侧边栏截图。

---

## 5. 硬约束（全部实测踩出来的，不要绕过）

### 5.1 `file:` 依赖必须指向 profile 内部

跨目录的 `file:` 依赖会被宿主当成 profile 内的相对目录去 scandir：

```
ENOENT: no such file or directory, scandir '<profile>/E:/ai/...'
```

`file:E:/...` 与 `file:///E:/...` 两种写法都会归一化成前者，**都失败**。
所以脚本固定复制到 `profiles\web\plugins\<name>` 再注册该路径。

### 5.2 pnpm 把 `file:` 依赖装成实体拷贝，而且会复用 store 里的旧副本

改了源目录不重新安装，运行时就还是旧代码。脚本固定用 `pnpm install --force`，
**并在安装前删掉 `node_modules\<name>`**。

`--force` 单独不够（2026-10-14 实测）：修完 bug 重跑脚本，`plugins\<name>` 已是新代码，
`node_modules\<name>` 却仍是坏的那一份，启动报

```
The requested module './http.js' does not provide an export named 'SUMMARY_PATH'
```

版本号没变时 pnpm 按 lockfile 复用 store 副本。删掉实体拷贝后安装必然重来。
漏掉这一步还会偶发报：

```
failed to read overlay <profile>/node_modules/<name>/cordis.patch.yml: ENOENT
```

### 5.3 缺 `cordis.patch.yml` 或 `dsh.bundle` → 应用回退 Safe Mode

```
profile bundle "<name>" declares no dsh.bundle in its package.json
Profile recovery requires Safe Mode
```

这不是警告，是**拒绝正常启动**。侧边栏会没有那 3 个界面。

### 5.4 两个 Windows 编码坑

- **`.ps1` 必须存 UTF-8 with BOM。** Windows PowerShell 5.1 把无 BOM 的 UTF-8 按 ANSI 读，
  中文注释变乱码 → 整个脚本语法报错。
- **`package.json` 必须无 BOM 写。** 用
  `[System.IO.File]::WriteAllText($p, $t, [System.Text.UTF8Encoding]::new($false))`。
  不要用 `Set-Content -Encoding UTF8` —— 5.1 下它加 BOM，Node 的 `JSON.parse` 直接拒绝：
  `Unexpected token '﻿{'`。

---

## 6. 为什么插件不能放进应用目录

```yaml
# <宿主安装目录>\resources\app-update.yml
provider: generic
url: https://dshdesktop.com/updates/latest/
```

```
~\AppData\Local\dsh-desktop-updater\installer.exe   248.2 MB   已暂存
https://dshdesktop.com/updates/latest/latest.yml → version 0.11.1
```

electron-builder 的 NSIS 更新先跑旧版卸载器（`RMDir /r $INSTDIR`）再装新版，
整个安装目录重建。自放进去的文件会被清掉。用户数据目录不受影响 → 所以走 Profile 通道。

---

## 7. 代码规范（来自即将删除的 `packages/AGENTS.md`，仓库删掉后仅剩此处）

重构必须遵守以下规则 —— 这是从已废弃仓库里抢救出来的：

### 7.1 主题与样式

- 语义色**只用 `var(--dsw-alias-*)`**。不新增 `--ds-*`，不硬编码十六进制色。
- 深浅主题靠 token 自动切换，**不写** `body[data-ds-dark-theme]` 一类手写分支。
- 不自建第三套主题 token 体系。
- 样式用 `document.createElement('style')` 注入，以 `id` 或 `data-plugin-css` 做幂等 guard。
- 选择器用插件命名空间前缀，不覆盖上游或其他插件的变量。

### 7.2 文案与 i18n

- 文案一律 `ctx.locale.register(NS, { zh, en })` 注册、`ctx.locale.bind(NS)` 读取。
- **禁止** `navigator.language` + 组件内联 `copy` 对象。
- 中英文 key **必须同批维护**，缺一即视为未完成。
- 文案与展示逻辑分离，不把整句写死在组件分支里。

### 7.3 UI 完整性

- 覆盖 loading / error / empty / disabled、键盘与焦点、深浅主题。
- 弹层需焦点陷阱、`aria-modal`、Esc 关闭、遮罩点击；busy 时禁止关闭。
- 状态切换不能只改颜色，需配文案或 `aria-live`。
- 动画与过渡需尊重 `prefers-reduced-motion`。

### 7.4 代码组织

- 插件默认自包含。**不得 import 别的插件的 client 实现**，不要为此新建组件库。
- 服务端可以按领域拆同包子文件（当前 `server/{http,workspace,usage,archive,memory}.js`）。
- **客户端不能拆**：宿主 `dsh-client-modules` 的 `require` 只认平台 seed 名与已注册的模块 id，
  没有同步相对导入；拆文件只能走 `require.async('./client.xxx.js')` 的异步 chunk，
  多一层会失败的加载路径。所以 `client.js` 保持单文件（当前 1000 行上下）。
- 不直接改第三方源码。

### 7.5 当前合规扫描结果

| 检查项 | platform |
| --- | --- |
| 行数 | client.js 约 1000 / index.js 76 / server/* 共 5 个文件 |
| `var(--dsw-alias-*)` token | 全部色值走 token ✅ |
| **硬编码色值** | 无 ✅（旧 shell-tools 的 `#fff` 随无用的 `.dshDesktopShellProviderMark` 一起删掉） |
| `navigator.language` | 0 ✅ |
| `locale.register/bind` | 各 1 处 ✅，297 个 key 中英齐平（自检脚本断言） |
| `prefers-reduced-motion` | 有 ✅（页签与额度条过渡在该设置下关闭） |
| style 注入 | `createElement('style')`，`id = 'dsh-desktop-platform-style'` |
| 键盘 / ARIA | `role=tablist/tab/tabpanel`、roving tabindex、方向键与 Home/End ✅ |
| 空态 / 错态 / 禁用 | 11 个页签都覆盖 ✅（FreeModel 那 8 页共用 `OwnerShell` 的三态） |

`archive.columnActions` 原为空串 + 硬编码英文 `aria-label="actions"`，合并时改成随语言的操作列表头。

---

## 8. 依赖契约

peer 全是宿主自带，改动时不要随意放宽或收紧：

```
dsh-desktop-platform
  @deepseek-ai/cordis ^4.0.2
  @deepseek-ai/dsh-client-ui-settings ^0.1.5-rc.2 || ^0.2.0-rc.1
  @deepseek-ai/dsh-host-webserver        ^0.1.5-rc.2 || ^0.2.0-rc.1
  @deepseek-ai/dsh-home-paths            ^0.1.5-rc.2 || ^0.2.0-rc.1
  @deepseek-ai/dsh-session-persistence   ^0.1.5-rc.2 || ^0.2.0-rc.1
  @deepseek-ai/dsh-settings              ^0.1.5-rc.2 || ^0.2.0-rc.1
  @deepseek-ai/dsh-workspace             ^0.1.5-rc.2 || ^0.2.0-rc.1
```

runtime 依赖：`@deepseek-ai/schemastery ^3.18.2`、`yaml ^2.4.0`。

服务端 `inject = ['sessionPersistence', 'workspaceRegistry']`：`llm` 是可选的，
在 `apply` 里用 `ctx.inject(['llm'], ...)` 捕获，plane 不在时交接摘要降级为
`runtime-unavailable` 而不是让所有路由都不挂载。

peer 范围允许 `^0.2.0-rc.1`，与宿主 `0.2.0-rc.2` 兼容。
宿主升级到不兼容世代时会报 compatibility warning，届时需同步放宽。

**设置表单的键是 entry id（= patch 行 id = 插件 `name`），不是 section 的 `id` 字段。**
上游自 0.1.7 起由 entry 的 `Config` schema 派生；`ConfigForms.get(entryId)` 会按需
现场创建控制器（`dsh-client-ui-settings/lib/client.js`），所以「不注册 section 也能拿到表单」。
section 的 `id`（现为 `desktop-platform`）只用于 slot 账本去重，可以自由取名。

### 设置导航的排序分层

导航是 `settings.section` 账本按 `order` 升序投影（`dsh-client-ui-settings-general`
`rows(...).sort((a, b) => a.order - b.order)`）。宿主与本机实测占位：

| order | 页面 | 归属 |
| --- | --- | --- |
| -10 | 账号 | 宿主 |
| 0 | 通用 | 宿主 |
| 10 | 模型 | 宿主 |
| 15 | 插件 | 宿主 |
| 20 | Agent 预设 | 宿主 |
| 21 | IM机器人 | 第三方（`@xmanrui/dsh-im`） |
| **900** | **综合平台** | **自制（本插件）** |

本机 9 个插件里只有 `@xmanrui/dsh-im` 注册了顶层 `settings.section`；其余
（dsh-context / dsh-our-free-model / dsh-whale-widget / dshmarket / billion-context /
@michengai/dsh-codex-ui / @opencode2dsh）只贡献侧边栏，不进设置导航。

取 900 而不是「刚好比 21 大」：宿主将来在 30–200 区间新增页面时，自制页仍排在最后。
`test\platform-client.test.mjs` 会断言 `order > 100`。

---

## 9. 与插件无关但会影响判断的环境事实

### 9.1 dshmarket 区域设置

vendor 版的 `.dsh-market/state.json` 已被改为：

```json
{"disabled":[],"groups":{},"groupOrder":[],"region":"china","regionAuto":false}
```

原因：官方 registry 在这个网络下极慢（实测 `billion-context` 单次请求 16.3 秒，
而市场超时是 10 秒）。`china` 走腾讯镜像，实测 0.2–1.9 秒。

**若用户离开国内网络，需把 region 改回 `global`。**

### 9.2 目录体积导致的超时（已修，仅供理解）

`dshmarket@1.65.1` 用单个 15 秒总超时覆盖整个目录拉取，而目录已涨到 5.1 MB / 17.6 秒
→ 永远拉不完 → 市场页一直显示「正在加载插件目录…」。已升级到 `1.66.21`
（拆成「15 秒收首包 + 15 秒无进展看门狗 + 10 分钟总上限」）。

### 9.3 已知无法修复的报错

```
ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-workflow-worker-thread'
```

来自 `orchestrator` agent preset（分解委派模式）的 `agent.cordis.yml`。
npm 最新 `0.1.5-rc.3` 的 peer 要求宿主 `0.1.5-rc.3`，本机是 `0.2.0-rc.2`，**无可用版本**。
每次启动固定 4 条 grouped error，属上游 preset 与宿主世代不匹配。
**不要靠装不兼容版本消错。**

---

## 10. vendor 版 profile 里的其他插件（重构时别误伤）

9 个插件，自制的只有 1 个：

| 插件 | 版本 | 来源 |
| --- | --- | --- |
| `dsh-our-free-model` | 2.1.0 | 第三方（别人的插件） |
| `dshmarket` | 1.66.21 | 第三方 |
| `@opencode2dsh/dsh-plugin` | 0.3.12 | 第三方 |
| `billion-context` | 0.1.197 | 第三方 |
| `dsh-context` | 0.70.0 | 第三方 |
| `dsh-whale-widget` | 0.4.2 | 第三方 |
| `@michengai/dsh-codex-ui` | 1.1.37 | 第三方 |
| `@xmanrui/dsh-im` | 4.39.0 | 第三方 |
| **`dsh-desktop-platform`** | 0.1.0 | **自制** |
| **`dsh-localcoding-mcp`** | 0.1.0 | **自制** |

第三方插件全部是精确版本 pin（不是 `^`），所以 `pnpm update` 不会动它们；
市场页的更新检测走的是「已装版本 vs 目录 latest」，与 pin 无关。
自制插件是 `file:` 依赖，`dsh.profile.bundles` 里与第三方混在同一个数组里。

> 这张表原本列的是 `%APPDATA%\dsh-desktop\harness\profiles\web`。
> **实际在跑的是 `<harness home>/profiles/<profile>`**（`<另一套发行版的宿主>`），
> 它的第三方插件清单略有不同（多 `@michengai/dsh-skills-manager`、`@deepseek-ai/dsh-experimental-*` 等）。

---

## 11. 已验证状态（2026-10-14，DSH Desktop 0.11.1）

合并成一个插件、改名为「综合平台」之后：

```
Safe Mode 回退                          0 处
/dsh-desktop/usage-stats/summary       HTTP 200, 4395 字节
/dsh-desktop/shell/archive.list        HTTP 200,   67 字节
/dsh-desktop/shell/workspaces          HTTP 200,  262 字节
/dsh-desktop/shell/memory              HTTP 200（已注册工作区）
/dsh-desktop/shell/memory              HTTP 400（未注册根目录，被收敛拒绝，符合预期）
harness.log                             本次启动无 platform 相关报错
install-to-profile.ps1                 实测执行通过，旧依赖与改名残留已从 profile 摘除
node test\platform-client.test.mjs      通过（1 section / 3 tabs / 93 key 中英齐平 / order 900）
```

**未验证**：客户端渲染结果 —— 侧边栏的「综合平台」是否排在内置与三方之后、页签是否可切换、
记忆编辑器切页是否保留未保存内容。需要用户在真实应用里点一遍。

改名会换掉 settings 命名空间（entry id 从 dsh-desktop-usage-stats → dsh-desktop-platform），
已配置的积分折算费率会回到默认 0。本机从未写过该配置，无损失；以后改名要知道这件事。

---

## 12. 重构时最容易踩的 5 件事

1. **改完不重跑 `install-to-profile.ps1`** → 运行时的还是旧代码（pnpm 实体拷贝）。
   脚本已改成安装前先删 `node_modules\<name>`，`--force` 不再是唯一保险。
2. **动了 `cordis.patch.yml` 的 id 或删掉 `dsh.bundle`** → Safe Mode，整个页面全没。
3. **改了 `package.json` 的写法** → 带上 BOM 会让 pnpm 直接拒绝加载 manifest。
4. **只改中英文其中一边** → 缺 key 即视为未完成；`test\platform-client.test.mjs` 会当场报错。
5. **把 `client.js` 按 7.4 拆成多个 `require('./x.js')`** → 运行时报
   `require("…") missed the module table`。客户端没有同步相对导入，见 7.4。

---

## 13. 相关但不在本目录的东西

- `<旧仓库>\`（待删）：独立版构建、`patches/`、`docs/`、`test/`。
  删掉后本文第 7 节的规范仅剩此处。
- `%APPDATA%\dsh-desktop\logs\harness.log`：启动诊断唯一来源。
  `[desktop]` 段是宿主侧，`[stderr] [harness-log]` 是后端插件；该构建**不记录 `[renderer]`**。
- `%APPDATA%\dsh-desktop\harness\profiles\node_modules\@deepseek-ai\*` 是指向
  `<另一仓库>\resources\app\node_modules\*` 的失效 junction（该路径已不存在）。
  查宿主源码要读 `<宿主安装目录>\resources\app.asar`，不要顺着 junction 找。


---

## 14. 归档页的删除：为什么走宿主 RPC

2026-10-14。删除归档会话的能力宿主本来就有，本插件不重写。

宿主的永久删除在 `SessionCommandController.delete`（`dsh-api-session-controller/lib/index.js`），
四步：`agents.disposeOwned` → `persistence.delete` → `workspaceRegistry.forgetSession` →
`emit('api-session/removed')`，中途检查活跃 Agent、子 Agent 归属、找不到。

所以客户端直接调 `ctx.remote.session.delete({ sessionId })`（result 形状 `{ deleted: true }`）。
自己用 `registry.forgetSession` 重写会漏掉「持久层删除」和「正在跑」这两步——
`forgetSession` 的注释写的是「Remove a **permanently deleted** Session from Workspace and
archive state」，它只清注册表和归档集合，不删日志。

**会话日志是只追加的**（`dsh-session-persistence/README.zh.md:84`「已提交事件绝不重写」、
:152「无删除或保留接口」），所以「撤回某条消息」这种需求在宿主里没有原语，只能 fork。
本轮试过按 fork 语义做「撤回重发」，用户反馈不好用，已整块删除（代码、路由、文案、测试、
文档都已清干净）。

---

## 15. 跨插件页面：挂载走得通，但页签集合作不了主

2026-10-15。先试过把 `dsh-our-free-model` 已注册的设置页整块挂进综合平台（`ForeignPage`），
一行代码没抄；用户要求「删掉免费模型那一页」之后**整块推翻**，改为自建那 4 页。

### 挂载为什么不行（结论，别再走回头路）

```js
// dsh-client-ui-slots/lib/index.js:205
const entry = { component, options: { key?, id?, order?, label?, priority? }, inject?, ... }
// :264  entries(key) —— 注释原文：The raw SlotCore.entries view stays the inspection surface
const entry = ctx.slots.entries('settings.section').find((e) => e.options.id === 'our-free-model')
React.createElement(entry.component, { close: () => {}, t: ctx.locale.bind(entry.locale) })
```

技术上是通的（账本读的是组件本身；`inject` 没声明传 `{}`；宿主把设置页渲染成
`renderSlot('settings.section', { close }, { only: active })`，所以组件要能吃一个 `close`；
对账本变化用 `slots.getVersion(key)` + `slots.subscribe(key, cb)`）。
但**页签条是对方组件内部的 state，从外部无法隐藏其中某一项**：挂载 = 一次接受它全部 10 个页签，
其中第一页正是用户不要的「免费模型」。要控制页签集合只能自建前端。

顺带记下两个坑（当时各踩一次，现在代码里没有，但下次挂载别人页面还会遇到）：

- **手动挂载设置页必须自带 `t`。** `dsh-our-free-model` 的页面第一行就是 `props.t(x)`，
  缺了会在渲染期抛错、页签整块空白。命名空间在 **`entry.locale`**（与 `component`/`inject` 同级），
  不在 `entry.options`——`SlotCore.register` 只把 `key/id/order/label/priority` 收进 `options`。
  读错会静默走回退分支，界面全是原始 key（当时截图里一片 `nav.tab.free`）。

### 自建页的边界

数据仍走它的 `/api/our-free-model/*`，但那条路有信任围栏：外部 curl 一律 401，
认证 cookie 只在渲染进程里。所以请求必须带 `credentials: 'same-origin'`，页面只能在宿主页面里跑。

- `404` / `401` 统一映射成「owner 不在」（插件没装或还没加载）→ 显示安装提示，不抛 HTTP 错误。
- 前端不复制它的存储与逻辑，只读它的接口；它升级，这些页跟着升级。
- `useOwner(paths)` 一次并发读多条路由并给出手动 `reload()`；`OwnerShell` 统一处理
  loading / absent / error 三态。
- 长任务单独给超时：`/update/check` 60 s、`/update/apply` 600 s（`AbortSignal.timeout`）。
- Key 默认打码，点「显示」才明文；轮换走它自己的 `/forward/rotate`、`/forward/lan/rotate`。

---

## 16. `dsh-localcoding-mcp`：宿主没有 MCP 服务，接缝只有 `tools.register`

宿主服务目录里**没有 `mcp`、也没有 `codex`**。`cordis_inspect_query` 的
`provider:'Service', method:'listService'` 列出来的是：
`sessionPersistence, workspaceRegistry, webServer, settings, slots, locale, configForms,
remote, remote.session, uiWorkspace, sessions, commands, mcpResources, llm, tools`。

`mcpResources.register(server, {request})` 只覆盖 MCP 的 **resources**
（`resources/list` / `resources/templates/list` / `resources/read`），**不管 tools**。
所以接 MCP 工具的唯一入口是 `ctx.tools.register`。

`ToolDefinition` 的确切形状（`ToolSchema` + `output` + `execute`）：

```ts
{
  name: string, description: string, parameters: Record<string, unknown>,
  output: { schema: JsonSchemaNode, render(args, value): ContentBlock[], presentationMeta? },
  execute(args, exec: ToolRunContext): Promise<unknown>,
  timeoutMs?, isConcurrencySafe?, deferLoading?,
  projectContent?, finalizeContent?, presentCall?, presentResult?
}
```

- **`execute` 返回裸值**：宿主自己 `validateJsonSchemaValue(tool.output.schema, value)`
  再调 `output.render(args, value)`。返回 `{isError:true}` 是错的，**失败要 throw**，
  宿主会转成 `Error: <message>` 的 isError 结果。
- `exec: ToolRunContext` 带 `callId/rootCallId/name/arguments/agent?/parent?/signal:AbortSignal/token`
  外加 `deferContext(UserMessage)` 与 `concludeTurn()`。
- **Schema 只支持子集**：`type/oneOf/properties/required/additionalProperties/items/enum/const`
  + 注解 `description/title/default/examples`。多一个 key 就
  `unsupported JSON schema: <key> is not a supported keyword`。
  `additionalProperties` 必须 boolean；`required` 每项必须在 `properties` 里；`run_code` 是保留名。
- `register` 返回一个 `() => void` 反注册函数；同一层内重名会 FAIL。

细节与协议坑见 `docs/ENGINEERING.md` 的「本地编码 MCP」一节。

---

## 17. 网页版 ChatGPT 方向：出站隧道，不是入站端口

`chatgpt.com` 的连接器在浏览器里，够不到 `127.0.0.1`。**不要去做内网穿透**——
`mcp-accounts\tunnel-client.exe` 是 OpenAI 官方的出站守护进程，它主动连
`https://api.openai.com`，因此不需要任何入站端口。这也是唯一官方支持的接法。

每个 ChatGPT 账号一个子进程。账号配置在 `mcp-accounts\config\accounts.json`，
三个账号的 `permissions` 都是 `[read,write,build,command]`。

**密钥纪律**（这块一旦泄漏就是控制面凭据泄漏）：

- `tunnel.controlPlaneKey` 是 DPAPI 加密串，只在内存里解开，
  经独立环境变量 `LCM_CP_KEY_<ID_UPPER_SNAKE>` 交给子进程；
  `readAccounts()` 不把它带出配置读取层，`describe()` 只报 `keyConfigured`。
- 自检会扫全部 JSON 与 describe 输出，确保没有 `env:` 引用或密钥形状的字符串泄漏。

**本地检查看不出来的两件事**：

1. `/readyz` 返 200 只证明进程活着（假密钥也 200）。真正验收是去
   `chatgpt.com/#settings/Connectors` 选中隧道后发一次真实工具调用。
2. `organizationId` 为空会得到 `403 tunnel_active_organization_required`，
   日志和 doctor 都看不出原因。本机三个账号的 `organizationId` **目前都是空的**，
   隧道 ID 也没在 `platform.openai.com/settings/organization/tunnels` 复核过，
   所以这条链路从未真正建通过。

**代理**：`NO_PROXY` 只对来自环境变量的代理生效，`--control-plane.http-proxy` 忽略它；
用显式 control-plane 代理时必须清掉 `http_proxy`/`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`
的全部大小写变体（PS 5.1 的 `Start-Process` 用大小写不敏感的哈希表，
只留 `http_proxy`+`HTTP_PROXY` 会直接抛「已添加项。字典中的关键字…」）。

**Playwright MCP 要用 `localhost` 而非 `127.0.0.1`**（按 `--allowed-hosts` 校验 Host 头），
且扩展令牌只在用户级注册表里，`reg query HKCU\Environment /v PLAYWRIGHT_MCP_EXTENSION_TOKEN` 才读得到。
