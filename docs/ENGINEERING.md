# 实现细节

README 只讲用途，这里记实现、踩过的坑和没验证的部分。

## 综合平台的 11 个页签

一个插件、一个设置页（`settings.section`，id `desktop-platform`，order 900）、11 个页签。
页签在第一次打开时挂载，之后保持挂载（隐藏而非卸载）——记忆编辑器卸载会把没保存的输入丢掉。

前三页用本插件自己的 `/dsh-desktop/*` 路由；后 8 页是 `dsh-our-free-model` 的前端。

## FreeModel：为什么是重做而不是挂载

先试过把那个插件已注册的设置页整块挂进来（`ctx.slots.entries('settings.section').find(...)`
→ `React.createElement(entry.component, { close, t })`），一行代码没抄。技术上是通的，但
**页签条是它组件内部的 state，从外部无法隐藏其中某一项**：挂载 = 一次接受它全部 9 个页签，
其中第一页正是用户不要的「免费模型」。要控制页签集合只能自建前端。

顺带记下两个坑（当时各踩一次）：

- **手动挂载设置页必须自带 `t`。** 它的页面第一行就是 `props.t(x)`，缺了在渲染期抛错、页签白屏。
- **命名空间在 `entry.locale`**（与 `component`/`inject` 同级），不在 `entry.options`——
  `SlotCore.register` 只把 `key/id/order/label/priority` 收进 `options`。读错会静默走回退分支，
  界面全是原始 key（当时截图里一片 `nav.tab.free`）。

## FreeModel：围栏与降级

它的路由有信任围栏：外部 curl 一律 401，认证 cookie 只在渲染进程里。所以：

```js
fetch('/api/our-free-model' + path, { credentials: 'same-origin', cache: 'no-store' })
```

`404` / `401` 一律映射成「owner 不在」（插件没装或没加载）→ 显示安装提示，不抛 HTTP 错误。
Key 默认打码，点「显示」才明文；轮换走它自己的 `/forward/rotate`、`/forward/lan/rotate`。
长任务单独给超时：`/update/check` 60 s、`/update/apply` 600 s（`AbortSignal.timeout`）。

### 每页读哪些路由

| 页签 | 读 | 写 |
| --- | --- | --- |
| 插件升级 | `/update/status` | `/update/check`、`/update/apply`、`/reload` |
| EAC 模型 | `/eac/status` | `/eac/login/start`、`/eac/login/poll?link=`、`/eac/login/cancel?link=`、`/eac/logout` |
| 聚合渠道 | `/providers` | `/providers`、`/providers/test`、`/providers/discover`、`/providers/remove` |
| 省 Token | `/token-saver`、`/local-optimize` | 同名 POST |
| 路由 | `/combos`、`/summary` | `/combos` |
| 数据看板 | `/stats` | — |
| 运行日志 | `/stats` | — |
| 网关设置 | `/clients`、`/forward/key`、`/forward/lan/key`、`/forward/lan/addresses`、`/chan-gateway` | `/forward/rotate`、`/forward/lan/rotate` |

看板和日志是同一份账本 `/stats` 的两种读法：

```js
{ requests, requestFailures, requestFailuresEstimated, turns, failedTurns, recoveredTurns,
  days:   [{ day, total, models: [...] }],
  models: [{ model, name, input, output, reasoning, cacheRead, calls, failed, turns, tps, avgTtftMs }],
  samples:[{ at, model, ok, input, output, ttftMs, tps, decodeMs, decodeTokens, effort, origin, truncated?, noUsage? }],
  savings:{ bytesBefore, bytesAfter, saved, blocks, calls, promptCalls, percent },
  grand:  { input, output, reasoning, calls, failed, turns } }
```

`samples` 是最近 200 次调用的环形缓冲，里面标了 `truncated` / `noUsage` 的行就是「那一轮怎么没了」
要查的行。`/stats` 的 `requestFailuresEstimated === true` 时看板会说明失败数是推算的。

### 聚合渠道的 Key 语义

Key 输入框**留空表示保留**——插件能区分「字段没给」和「空字符串」，把两者混为一谈正是
「以为删掉了其实没删」的来源。清空 Key 是独立按钮，删除服务商是另一个。

## 还没搬过来的页

FreeModel 自己还有「白嫖模型接入」（账号渠道）。它读的不是 `/api/our-free-model/*`，而是
**被吸收的 channel pack 的 RPC**：`connection.rpc.call('/api', 'channel-pack', { method, payload })`，
方法名 `usage.tokenLedger` / `usage.tokenLedgerHistory`。这台机器上没装那个 pack
（profile 里只有 dsh-our-free-model / dsh-im 之外的几个），拿不到返回结构，所以不凭猜测写。
装了 pack 之后按 `useOwner` + `ctx.get('connection')` 的模式一页一页加即可。

## 归档里删除会话

「归档历史」页签有删除：每行一个「删除」，勾选后有「全选 / 取消选择 / 删除所选（N）」，
两种都走同一个确认框，框里列出会话名并写明**不可恢复**。

删除调宿主自己的 `ctx.remote.session.delete({ sessionId })`，不在本插件里重写删除逻辑。
宿主那条路径依次做四件事：销毁活跃 Agent → `persistence.delete` 删存储日志 →
`workspaceRegistry.forgetSession` 清注册表与归档集合 → 广播 `api-session/removed`，
自带「正在跑 / 子 Agent 拥有 / 找不到」等检查。

`ctx.remote` / `ctx.remote.session` 用 `ctx.inject` 软依赖：服务没到位时归档页不显示删除控件，
其余功能照常。

## 会话撤回

没有做。宿主日志是 append-only（契约原文「已提交事件绝不重写」「无删除或保留接口」），
「撤回某条消息」在宿主里没有原语，只能 fork。试过按 fork 语义实现，用户反馈不好用，已整块删除。

## 为什么放在应用目录外面

放进 `E:\ai\DSH Desktop` 会被厂商更新清空：electron-builder 的 NSIS 更新流程先跑旧版卸载器
（`RMDir /r $INSTDIR`）再装新版，整个安装目录会被重建；自放进去的文件不在卸载记录里，
但目录本身会被清掉。用户数据目录（`%APPDATA%\dsh-desktop\harness\`）不受影响，
所以插件走 Profile 通道。

## 安装 / 更新

```powershell
powershell -ExecutionPolicy Bypass -File .\install-to-profile.ps1
```

脚本做五件事，缺一不可：

1. 复制插件源码到 `%APPDATA%\dsh-desktop\harness\profiles\web\plugins\`
2. 摘除已经改名 / 合并掉的旧插件（**只碰 `file:` 依赖**，市场装的第三方插件不动）
3. 在 profile 的 `package.json` 里注册 `file:` 依赖（**profile 内路径**）并补 `dsh.profile.bundles`
4. 删掉 `node_modules` 里的旧实体拷贝，再 `pnpm install --force`
5. 自检 `cordis.patch.yml` 是否真的进了 `node_modules`

指定其它 profile：`.\install-to-profile.ps1 -Profile web -DshHome <harness目录>`。

改完代码必须重跑脚本。宿主插件是热加载的，但 profile 插件不是。

## 三条实测出来的硬约束

**`file:` 依赖必须指向 profile 内部。** 跨目录的 `file:` 依赖会被宿主当成 profile 内的相对目录去
scandir（`ENOENT ... scandir '<profile>/E:/ai/...'`）。`file:E:/...` 和 `file:///E:/...` 两种写法
都会归一化成前者，都失败。

**pnpm 把 `file:` 依赖装成实体拷贝，而且会复用 store 里的旧副本。** 改了源目录不重装，
运行时就还是旧代码；**`--force` 单独不够**——版本号没变时 pnpm 仍可能拿 lockfile 里的旧副本。
所以脚本第 4 步先删 `node_modules\<name>`，让安装必然重来。

**漏掉 `cordis.patch.yml` 会让应用拒绝正常启动并回退 Safe Mode**：

```
profile bundle "<name>" declares no dsh.bundle in its package.json
```

## 脚本里的两个 Windows 编码坑

保留这两处写法，不要「简化」：

- **`.ps1` 必须存 UTF-8 with BOM。** Windows PowerShell 5.1 会把无 BOM 的 UTF-8 按 ANSI 读，
  中文注释变乱码导致整个脚本语法报错。
- **`package.json` 必须无 BOM 写。** 用
  `[System.IO.File]::WriteAllText($p, $t, [System.Text.UTF8Encoding]::new($false))`，
  不要用 `Set-Content -Encoding UTF8`——5.1 下它会加 BOM，而 package.json 由 Node 的
  `JSON.parse` 读取，带 BOM 会直接报 `Unexpected token`。

## 设置导航排序

导航按 `settings.section` 的 `order` 升序排列：

| order | 页面 | 归属 |
| --- | --- | --- |
| -10 / 0 / 10 / 15 / 20 | 账号 / 通用 / 模型 / 插件 / Agent 预设 | 宿主自带 |
| 21 | IM机器人 | 第三方插件 |
| **900** | **综合平台** | **本插件** |

取 900 而不是刚过 21，是为了宿主将来在 30-200 新增页面时自制页仍排最后；
`test/platform-client.test.mjs` 会断言这个位置。

## 自制插件不会有更新提示

`file:` 依赖被服务端归类为 linked（`dshmarket/lib/updates.js` 里 `kind: 'linked'`、
`updateAvailable: false`），会被纳入检查范围但永远提示没有更新。更新方式就是改源码 + 重跑脚本。

## 维护规范

- **`exports.inject` 是服务声明，不能因为「没人用了」就删。** 宿主只在声明过的服务上放行：访问未声明的 `ctx.locale` 会在渲染进程抛 `cannot get property "locale" without inject`，整个 client bundle 加载失败，宿主判定 profile 失败并弹出「恢复 / 卸载此插件」——表现是**应用打不开**，日志里只有一行 renderer stderr（`harness.log` 的 `Failed to load plugins` 段）。`test/platform-client.test.mjs` 现在扫描源码里所有 `ctx.<name>`（`inject` / `effect` 除外），要求它们都在声明里。
- 语义色只用 `--dsw-alias-*`，样式表里不出现硬编码色值（自检会查）。
- 文案必须 `ctx.locale.register(NS, { zh, en })`，中英同批加，自检会比对 key 齐平。
- 服务端可以拆子文件；**客户端不可拆**——客户端模块加载器（`dsh-client-modules`）的 `require`
  只认平台 seed 名与已注册的模块 id，没有同步相对导入，拆了只能走异步 chunk。
- 不改第三方源码。

## 自检

```powershell
node .\test\platform-client.test.mjs .\dsh-desktop-platform\client.js
node .\test\archive-delete.test.mjs
```

两个都不需要装依赖：

- `platform-client.test.mjs` 用假的 `window` / `document` / `react` 跑一遍 `apply()`，断言
  注册了且只注册了 1 个 `settings.section`、11 个页签、中英 key 齐平、样式里没有硬编码色值、
  排序落在所有内置页面之后；再逐个记起那 8 个 FreeModel 页签，断言它们读的正是上表里的路由、
  每个请求都带 `credentials: 'same-origin'`，以及 owner 返 404 时落到「未安装」提示而不是报错。
  最后用一套**有记忆的 hook** 真渲染看板、日志、聚合渠道、EAC 四个页面，断言它们把返回值画了出来
  （模型名、成功率、`ms` 延迟、截断标记、已验证标记、登录名），而不只是「没崩」。
- `archive-delete.test.mjs` 用一个带状态的迷你 React 挂载真实的设置页，**真的去点按钮**：
  列表渲染、逐行删除的确认框与宿主调用、失败时的错误文案、勾选全选后的批量删除与调用顺序。

## 已验证 / 未验证

**已验证**（DSH Desktop 0.11.1，harness 0.2.0-rc.2）：

- 两个自检脚本全过（含 11 个页签、8 个 FreeModel 页签的路由与渲染断言）。
- `install-to-profile.ps1` 实测执行通过，旧依赖与改名残留已从 profile 摘除。
- 服务端路由用 loopback 自检：命中即 200。

**未验证**：客户端在应用里的真实观感（侧边栏排序、页签切换、记忆编辑器切页不丢稿、归档删除的
确认框、4 个新页签在真实数据下的排版）——需要在 DSH Desktop 里点一遍。

## 相关文档

- `CONTEXT.md`：本仓库的上下文与结构总览（含 slot 账本、设置表单键等宿主契约）。
- `MEMORY.md`：跨会话的长期事实。
