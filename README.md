# dsh-plugins

自制插件的独立存放处，与任何应用目录解耦。

原属 `E:\ai\aianymore\packages\local-plugins\`，随该仓库一起废弃时移到这里。**这一份是维护入口**，
应用 profile 里那份是安装产物。

## 目录内容

| 插件 | 设置界面 | 服务端路由 |
| --- | --- | --- |
| `dsh-desktop-platform/` | 综合平台（1 个页面，3 个页签） | `/dsh-desktop/usage-stats/summary`、`/dsh-desktop/shell/archive.list`、`/dsh-desktop/shell/workspaces`、`/dsh-desktop/shell/archive.restore`、`/dsh-desktop/shell/memory`、`/dsh-desktop/shell/convention`、`/dsh-desktop/shell/handoff` |

一个插件、一个设置页、三个页签：

```
综合平台  id: 'desktop-platform'  order: 900
  ├── 用量统计   token / 积分统计
  ├── 归档历史   归档会话还原与删除
  ├── 记忆系统   MEMORY.md、记忆约定、会话交接
  └── Our Free Model   挂载 dsh-our-free-model 自己的设置页（见下）
  ├── 用量统计   token / 积分统计
  ├── 归档历史   归档会话还原
  └── 记忆系统   MEMORY.md、记忆约定、会话交接
```

页签在第一次打开时挂载，之后保持挂载（隐藏而非卸载）——记忆编辑器卸载会把没保存的输入丢掉。

文件划分：

```
client.js              客户端：注册设置页、页签壳、三个面板
index.js               服务端入口：name / inject / Config / apply
server/http.js         loopback + JSON 的共用管道、路由表
server/workspace.js    工作区根目录收敛、UTF-8 读取
server/usage.js        token 折叠与统计路由
server/archive.js      归档列表 / 还原、工作区列表
server/memory.js       MEMORY.md、约定块、交接摘要
package.json           含 dsh.bundle 与 dsh.client 声明
cordis.patch.yml       把插件挂进 profile 的配置树
```

`client.js` 没有按 7.4 的建议拆成同包子文件：客户端模块加载器
（`dsh-client-modules`）的 `require` 只认平台 seed 名与已注册的模块 id，**没有同步相对导入**；
拆文件只能走 `require.async('./client.xxx.js')` 的异步 chunk，多一层会失败的加载路径，不值得。

## FreeModel：把别的插件的页面挂进综合平台

综合平台的第 4 个页签「FreeModel」不是复刻，而是**直接把那个插件已注册的组件取出来渲染**：

```js
const entry = ctx.slots.entries('settings.section').find((e) => e.options.id === 'our-free-model')
React.createElement(entry.component, { close: () => {}, t: ctx.locale.bind(entry.options.locale) })
```

`ctx.slots.entries()` 返回的 entry 自带 `component` 与 `inject`（见 `dsh-client-ui-slots`
`SlotCore.entries`：「The raw SlotCore.entries view stays the inspection surface」），所以一个插件
写好的设置页可以被另一个插件挂载，宿主不提供任何额外的跨插件 API，也不需要知道对方的
路由、存储或凭据。

带来什么：免费模型 / EAC 模型 / 白嫖模型接入 / 聚合渠道 / 省 Token / 路由 / 数据看板 /
运行日志 / 网关设置 / 插件升级，全部原样可用，数据与写操作都走那个插件自己的
`/api/our-free-model/*`；它升级，这些页跟着升级。综合平台不持有它的任何状态。

代价与边界：

- **它那 10 个页签（含第一页「免费模型」）会一并显示。** 页签条是它组件内部的 state，
  从外部无法隐藏其中一个；要藏掉第一页只能把需要的几页按 `/api/our-free-model/*`
  重新实现成第二套界面（数据仍然来自它），按页做。
两个必须手动补上的东西（各踩过一次）：

- **`t` 不能省。** 那个插件的页面第一行就读 `props.t`，缺了会在渲染时抛错，整个页签白屏。
  宿主 shell 靠注册项声明的命名空间绑出它，手动挂载要自己
  `ctx.locale.bind(entry.locale)`；声明缺失时退化为回显 key，而不是抛错。
- **命名空间在 entry 顶层，不在 entry.options 里。** `SlotCore.register` 只把
  `key/id/order/label/priority` 收进 `options`，而 `locale`/`inject`/`store`/`children`
  与 `component` 同级。读错地方会静默退化成回显，界面全是 `nav.tab.free` 这样的原始 key。

另外用一条**限定在本页签内**的 CSS 藏掉它的报头（图标 + 产品名，`.ofm_navbrand`）——
页签条和 Star 按钮保留，它自己那个设置页的报头也不受影响：

```css
#dshPlatformPanel-freemodel .ofm_navbrand{display:none}
```

文案语言跟随应用语言：那套界面用的是它自己注册的中英词典，通过上面的 `t` 取出。

- 那个插件没装 / 还没加载完时，本页签显示一句提示，不会白屏。
- 它的 `EventSource` 是模块级单例（源码注释：One EventSource for the whole app surface），
  页面被挂载两次也只开一条连接。

## 归档里删除会话

「归档历史」页签现在有删除：每行一个「删除」，勾选后有「全选 / 取消选择 / 删除所选（N）」，
两种都走同一个确认框，框里列出会话名并写明**不可恢复**。

删除调的是宿主自己的 `ctx.remote.session.delete({ sessionId })`，不在本插件里重写删除逻辑。
宿主那条路径（`SessionCommandController.delete`）依次做四件事：销毁活跃 Agent →
`persistence.delete` 删存储日志 → `workspaceRegistry.forgetSession` 清注册表与归档集合 →
广播 `api-session/removed`。自带「正在跑 / 子 Agent 拥有 / 找不到」等检查，自己重写等于把这些
检查重新实现一遍。

`ctx.remote` 与 `ctx.remote.session` 用 `ctx.inject` 软依赖：服务没到位时归档页不显示删除控件，
其余功能照常。

## 自检

```powershell
node .\test\platform-client.test.mjs .\dsh-desktop-platform\client.js
node .\test\archive-delete.test.mjs
```

两个都不需要装依赖：

- `platform-client.test.mjs` 用假的 `window` / `document` / `react` 跑一遍 `apply()`，断言
  注册了且只注册了 1 个 `settings.section`、4 个页签、中英 key 齐平、样式里没有硬编码色值、
  排序落在所有内置页面之后，以及第 4 个页签在 owner 缺席时降级为提示、在场时渲染 owner 组件。
- `archive-delete.test.mjs` 用一个带状态的迷你 React 挂载真实的设置页，**真的去点按钮**：
  列表渲染、逐行删除的确认框与宿主调用、失败时的错误文案、勾选全选后的批量删除与调用顺序，
  共 17 项。

## 为什么放在应用目录外面

放进 `E:\ai\DSH Desktop` 会被厂商更新清空，证据：

```yaml
# E:\ai\DSH Desktop\resources\app-update.yml
provider: generic
url: https://dshdesktop.com/updates/latest/
```

```
C:\Users\HP-XXX\AppData\Local\dsh-desktop-updater\installer.exe   248.2 MB   已暂存
```

electron-builder 的 NSIS 更新流程是先跑旧版卸载器（`RMDir /r $INSTDIR`）再装新版，整个安装目录
会被重建。自放进去的文件不在卸载记录里，但目录本身会被清掉。

用户数据目录（`%APPDATA%\dsh-desktop\harness\`）不受影响，所以插件走 Profile 通道。

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

指定其它 profile：`.\install-to-profile.ps1 -Profile web -DshHome <harness目录>`

改完代码必须重跑脚本。宿主插件是热加载的，但 profile 插件不是。

## 三条实测出来的硬约束

**`file:` 依赖必须指向 profile 内部。** 跨目录的 `file:` 依赖会被宿主当成 profile 内的相对目录
去 scandir：

```
ENOENT: no such file or directory, scandir '<profile>/E:/ai/...'
```

`file:E:/...` 和 `file:///E:/...` 两种写法都会归一化成前者，都失败。

**pnpm 把 `file:` 依赖装成实体拷贝，而且会复用 store 里的旧副本。** 改了源目录不重装，
运行时就还是旧代码；**`--force` 单独不够** —— 版本号没变时 pnpm 仍可能拿 lockfile 里的旧副本
（2026-10-14 实测：修完 bug 重装，`node_modules` 里仍是坏的那一份，启动直接报
`does not provide an export named 'SUMMARY_PATH'`）。所以脚本第 4 步先删
`node_modules\<name>`，让安装必然重来。漏掉它还会报：

```
failed to read overlay <profile>/node_modules/<name>/cordis.patch.yml: ENOENT
```

漏掉 `cordis.patch.yml` 本身则更严重 —— profile 预检失败，应用**拒绝正常启动并回退 Safe Mode**：

```
profile bundle "<name>" declares no dsh.bundle in its package.json
```

## 脚本里的两个 Windows 编码坑

保留这两处写法，不要"简化"：

- **`.ps1` 必须存 UTF-8 with BOM。** Windows PowerShell 5.1 会把无 BOM 的 UTF-8 按 ANSI 读，
  中文注释变乱码导致整个脚本语法报错。
- **`package.json` 必须无 BOM 写。** 用
  `[System.IO.File]::WriteAllText($p, $t, [System.Text.UTF8Encoding]::new($false))`，
  不要用 `Set-Content -Encoding UTF8` —— 5.1 下它会加 BOM，而 package.json 由 Node 的
  `JSON.parse` 读取，带 BOM 会直接报 `Unexpected token '﻿{'`。

## 自制插件不会有更新提示

`file:` 依赖被服务端归类为 linked，没有 `latest`：

```js
// dshmarket/lib/updates.js:449
result[name] = { kind: 'linked', version, current: null, latest: null, updateAvailable: false }
```

它们会被纳入检查范围，但 `updateAvailable` 恒为 `false`。更新方式就是改这里的源码 + 重跑脚本。

## 设置导航排序

导航按 `settings.section` 的 `order` 升序排列，宿主把位置留得很开：

| order | 页面 | 归属 |
| --- | --- | --- |
| -10 / 0 / 10 / 15 / 20 | 账号 / 通用 / 模型 / 插件 / Agent 预设 | 宿主自带 |
| 21 | IM机器人 | 第三方插件 |
| **900** | **综合平台** | **本插件** |

「自带的在前、装的三方和自制的在后」这条成立。取 900 而不是刚过 21，是为了宿主将来在 30-200
新增页面时自制页仍排最后；`test/platform-client.test.mjs` 会断言这个位置。

## 已验证状态（2026-10-14）

在 DSH Desktop 0.11.1（宿主 harness 0.2.0-rc.2）上，合并成一个插件、改名为综合平台之后：

```
Safe Mode 回退                     0 处
/dsh-desktop/usage-stats/summary   HTTP 200, 4395 字节
/dsh-desktop/shell/archive.list    HTTP 200,   67 字节
/dsh-desktop/shell/workspaces      HTTP 200,  262 字节
/dsh-desktop/shell/memory          HTTP 200（已注册工作区）/ 400（未注册根目录，被收敛拒绝）
test\archive-delete.test.mjs          17 项全过（真点按钮：单删 / 批量 / 失败分支）
install-to-profile.ps1             实测执行通过，旧依赖与改名残留已从 profile 摘除
客户端注册契约自检                  通过（1 section / 4 页签 / 111 key 中英齐平 / order 900）
```

**未验证**：客户端渲染结果（侧边栏的「综合平台」是否排到最后、页签切换、记忆编辑器切页不丢稿、
归档页的删除按钮与确认框在真实数据下的观感）——需要在应用里点一遍。

## 依赖

peer 依赖都是宿主自带的 `@deepseek-ai/*`：

```
dsh-desktop-platform   cordis / dsh-client-ui-settings / dsh-host-webserver
                        dsh-home-paths / dsh-session-persistence / dsh-settings / dsh-workspace
```

peer 范围允许 `^0.2.0-rc.1`，与宿主 0.2.0-rc.2 兼容。宿主升级到不兼容世代时会报
compatibility warning，届时需要同步放宽 peer 范围。