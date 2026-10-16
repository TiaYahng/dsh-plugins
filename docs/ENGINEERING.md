# 实现细节

README 只讲用途，这里记实现、踩过的坑和没验证的部分。

## 综合平台的 4 个页签

一个插件、一个设置页（`settings.section`，id `desktop-platform`，order 900）、4 个页签。
页签在第一次打开时挂载，之后保持挂载（隐藏而非卸载）——记忆编辑器卸载会把没保存的输入丢掉。

FreeModel 的 8 个页面不占外层页签：外层只有 1 个 `freemodel` 页签，里面一条自己的
胶囊导航（`dshFmTabs` / `dshFmTab`）。一开始把 8 个功能各占一个外层页签，外层被撑到 11 个，
读起来像另一个应用——用户明确要求收成 4 个。页内导航的选中项记在
`dshDesktopPlatformFreeModel`，未打开过的页不构建（每个 owner 页一挂载就发请求）。

前三页用本插件自己的 `/dsh-desktop/*` 路由；后 8 页是 `dsh-our-free-model` 的前端。

## FreeModel：内嵌原版，而不是重做

这条路走过两轮。第一轮是**挂载**：把对方已注册的设置页取出来渲染，一行代码没抄。
技术上通，但它那 9 个页签会整排显示，页签条是它组件内部的 state，从外部无法隐藏其中
某一项——用户要的「免费模型」删不掉。第二轮是**照着它的接口重写一套**：功能能补齐，
但结构、交互、文案始终是另一套东西，看着像另一个应用。

现在是第三轮：**把它的 `client.js` 内嵌进来**，只改七处，其余原封不动。

| 改动 | 为什么 |
| --- | --- |
| bundle id → `dsh-our-free-model-vendored` | 这份副本只经本插件的加载壳求值，宿主看不到；万一看到了，两个 bundle 抢一个 id |
| 页签记忆列表去掉 `'free'` | 记住的那一项也可能是被删掉的那页 |
| 导航去掉 `t('nav.tab.free')` 那一行 | 页签条上不该有它 |
| 默认分支不再渲染 FreePage | 兜底分支改成 EacPage，那页的组件永远挂不上 |
| 两处 `ctx.slots.inject(...)` 注册去掉 | 注册了就会在设置侧栏多出第二个页面，和「综合平台」并排 |
| 公告 EventSource 去掉 | 它自己的插件已经为整个应用面开了一条；再来一条就是同一份 feed 双份 toast 和系统通知 |
| 导出 `exports.renderSettings` | 页面本身交出来，由本插件在自己的 section 里挂载 |

`tools/vendor-our-free-model.mjs` 重新生成 `dsh-comprehensive-platform/vendor/our-free-model-client.js`
并把它拼进 `client.js` 的 VENDOR 标记之间。**每处改动都按行内容定位，不按缩进定位**：
源码是别人的，重排一次缩进不该让这个脚本变成空格游戏。原版更新后重跑即可。

### 词典注册必须容忍重复

宿主**拒绝同一命名空间注册两次**：`locale namespace "X" already has locale "zh"` 会在渲染进程
抛错，client bundle 整个加载失败，宿主判定 profile 失败——表现是**应用打不开**，界面上只看得见
市场那两行 registry 404。实测踩了两次，两次原因不同：

1. 内嵌的副本调 `apply` 时注册 `settings.ourFreeModel`，而**owner 插件自己也注册它**（它就装在旁边）。
2. `apply` 会跑不止一次（热重载、profile 变更），**自己的**命名空间也会撞上。

所以两处都用 `try` 包住，只放行 `already has locale` 这一种失败，其余照旧抛出。词典是内容不是
资源，同一份内容再注册一次不是失败。当原插件不在时，内嵌那份就正常注册——两种情况都能工作。

自检的 locale stub 也会拒绝重复命名空间，并且在 `apply` 之前**先放一份 owner 的词典**，让测试站在
真实机器所处的位置上；只在自己那一份干净环境里跑，就会漏掉这个 bug（漏过一次）。

### 页签顺序有两份清单

原版副本里页签顺序存在两处：模块级的 `const TABS = [...]`（哪些页签可以被记住）和组件里渲染用的
`const tabs = [[id, 文案, 数字], ...]`。两者必须同步改——它们漂移开的症状很隐蔽：胶囊行里没有任何一个
被点亮，而屏幕上显示着某个页面。

落地页也跟着第一个页签走。删掉「免费模型」之后原来的默认值还写着它，于是首次进入时页面有内容、
胶囊全灭；现在两处兜底都是 `TABS[0]`。

删东西的两个坑（都踩过）：一行代码如果是某个表达式的**最后一个元素**，它的行尾括号往往替外层调用兜底——
整行删掉会留下一个没关的括号，bundle 直接不解析（EAC 页的公告面板就是这种，删行改为只删内容、保留括号）。
另外这个 bundle 是**一层缩进包起来的工厂**：函数的收尾 `}` 和函数体同缩进，按缩进找函数结尾必然切错，要找同层的下一个声明，
并校验它前面是 `}` 加空行。

顶部那一行标题（原版自己的名字 + 图标 + Star 按钮）整行去掉了：页面已经只是「综合平台」里的一个页签，
再挂一个应用名在它上面就成了两个应用。Star 按钮没删——它是链接不是品牌，改为落在页签行右侧
（`.ofm_tabs` 收窄到第 1 列、`.ofm_starbtn` 定第 2 列第 1 行；不这么定它会被挤到第二行）。顺手带走的
还有那张 base64 的品牌图（8 KB，只被删掉的那一行引用）和两条只为它存在的覆盖样式。

### 加载壳

它的 bundle 是手写的 ModuleLoader bundle，会调 `window.__ModuleLoader__.load`——而宿主自己的
加载器就在同一个对象上。放它过去就会注册出第二个同名 bundle（两个插件、一个 id、两个设置页）。
所以求值期间把加载器换成捕获用的假对象，求值完（同步）立刻换回来，之后断言宿主加载器仍在。

### 两个必须自己绑的东西

- **翻译器**：宿主平时按 section 注册的 `locale` 绑 `t`。我们不注册它的 section，所以要自己
  `ctx.locale.bind('settings.ourFreeModel')`——而且要在它 `apply` 注册完词典**之后**绑。
  绑错的话它的页面会拿本插件的词典去取自己的 key，界面上出现回显或错词。
- **两份样式表**：它那 426 KB 里自带 `data-plugin="dsh-our-free-model"` 的样式，由它的
  `apply` 注入；本插件另有自己的一份。自检要求两份都在。

### 它的 CSS 有两个宿主没定义的 token

`--dsw-alias-state-warning-primary` 和 `--dsw-alias-label-on-accent`：宿主一共 119 个
`--dsw-alias-*`，没有这两个。在 `color-mix()` 里这会让整条声明作废，所以原版那两处颜色
**今天就是不显示的**。自检只审我们自己的样式表，遇到它会**报告而不报错**——这是它的 CSS，
要改得由它改；我们这份副本照原样带着。

## FreeModel：围栏与降级

内嵌的那份代码自己面对这些约束，结论不用重写，只记两条我们改到过的：

- **它的路由有信任围栏**：外部 curl 一律 401，认证 cookie 只在渲染进程里，所以它每个请求都
  带 `credentials: 'same-origin'`。这也是为什么这份副本只能跑在宿主页面里。
- **账号与积分不在插件的 `/api` 下**：它们在被吸收的 channel pack 里（`vendor/channel-pack/`
  里那 426 KB 的一部分，183 个 RPC 方法），经宿主 `/api` → `channel-pack` 调用。
  可选服务只能读 `ctx.get('connection')`，直接读 `ctx.connection` 会因为未声明而抛错。

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

放进**宿主安装目录**会被厂商更新清空：electron-builder 的 NSIS 更新流程先跑旧版卸载器
（`RMDir /r $INSTDIR`）再装新版，整个安装目录会被重建；自放进去的文件不在卸载记录里，
但目录本身会被清掉。用户数据目录（`%APPDATA%\dsh-desktop\harness\`）不受影响，
所以插件走 Profile 通道。

## 重命名：包身份要跟着走，两个数据键不能跟着走

包名从 `dsh-desktop-platform` 改成 `dsh-comprehensive-platform` 时跟着改的是**包身份**——
宿主按它认插件：client bundle 的 id、`cordis.patch.yml` 里挂载 bundle 的那一行、
服务端导出的 `name`、`package.json` 的 `name`，以及 profile 的 `dependencies` 与
`dsh.profile.bundles`（旧条目由安装脚本的清理步骤摘掉，`node_modules` 里的旧实体拷贝一并删）。

**不能跟着改的是两个键**，它们指向已经存在于别人机器上的数据：

- `SETTINGS_NAMESPACE`（configForms 的命名空间）：改了等于把所有人存过的设置丢在原地。
- 设置页的 section id：平台记住当前页签用的就是它，改了会让人回到第一个页签。

HTTP 路由前缀 `/dsh-desktop/*` 同理：它是对外的字符串，自检与用户的书签都指着它，
一并留在原地，只在文档里说明，不跟着包名走。

这三处在自检里各自有常量，并断言它们**不随包名变化**——否则下一次重命名会顺手把它们带走，
而那种回归没有任何症状。

## 第 4 页为什么现在自带服务端

内嵌页面只是把「必须先装另一个插件」这件事往后推了一格：前端在自己的包里，数据还在别人
的包里。装我们一个，第 4 页是死的。**独立的意思是装一个就完整**，所以服务端一起搬。

搬的是他们的服务端整个 `index.js` + `src/`（渠道包另说，见下），
改动只有四处，每处都是「不改就会出事」而不是「改了更整齐」：

| 位置 | 改动 | 不改会怎样 |
| --- | --- | --- |
| `free-model/server.js` | 路由前缀 → `/api/comprehensive-platform/free-model` | 两个插件抢同一个前缀；对方的插件可能就装在旁边 |
| `free-model/server.js` | `distributionOf()` 恒为 `managed` | 它的自更新、公告通道、热重载会去改**我们**已安装的字节 |
| `free-model/src/store.js` | `DATA_DIR_NAME` → `comprehensive-platform` | 两个写手写同一份目录，正是他们自己警告过的损坏方式 |
| `free-model/server.js` | 版本号读上一层的 `package.json` | 这棵树里没有它自己的 manifest，`/summary` 会报空版本 |

`managed` 这个模式是他们为「发行包接管字节」写的，正好是我们要的状态，而且是**无条件**打开的：
这样这条性质写在 fork 里，不依赖调用点传什么参数。

`llm` 保持软依赖（`ctx.inject(['llm'], …)`）。他们的服务端只硬依赖这一个；把它提到本插件的
`inject` 里，等于让「没有模型面」的宿主连另外三个页签一起失去。自检 `test/free-model-standalone.test.mjs`
把上面每一条都钉住：前缀、数据目录、managed 开关、`llm` 的软依赖、以及 LICENSE / NOTICE 四份
出处文件都在。

许可链是三层：他们的 MIT（`free-model/LICENSE`）→ 渠道包是他们从第三方 upstream 整份拷贝的
（`vendor/channel-pack/NOTICE.md` 写明 upstream 与提交号，自带 MIT `LICENSE`）→ 我们这份 fork 的
改动记在 `free-model/NOTICE.md`。三层一份都不能少。

### 渠道包为什么不进仓库

`vendor/channel-pack/pack.js` 里有 `GEMINI_DEFAULT_CLIENT_ID` 与 `GEMINI_DEFAULT_CLIENT_SECRET`，
是**上游作者的** Google OAuth 凭据。仓库是公开的，第一次 push 就被 GitHub 的推送保护拦下
（`Push cannot contain secrets`）。处理方式：包 `.gitignore` 掉，只留在装了它的机器上，
许可与 NOTICE 两个文本文件照常进仓库，来源有据可查。

两种状态都必须是好的：

- 有包（这台机器）：13 个账号渠道正常，`free-model-standalone.test.mjs` 断言包与 wasm 在它自己的位置上。
- 无包（别人克隆后）：他们的服务端本来就把它当可选挂载（`void import(...)` 的 `.catch` 里
  `channelPack = { state: 'failed', error }`），页面会说明渠道列表为什么空，其余页面照常。
  自检断言的正是这条降级路径存在。

两条路都跑过（把包移走再跑一次），不是只验证了有包的那种。

## 上架插件列表：目录在另一个仓库里

市场里的插件目录不是市场自己维护的索引：它每次启动都读
`https://awesome-dsh-plugin.com/plugins.json`，而那份 JSON 由
`awesome-dsh-plugin/awesome-dsh-plugin` 的 `data/plugins/*.yml` 生成。所以「能被搜到」
= 往那个仓库提一个 PR 加一个文件，合并后站点自动重建。投稿文件已经备好在
`docs/market-entry.yml`（头部是注释，末尾那段 YAML 就是全部内容）。

它的 CI 会机械校验四件事，其中两件直接决定仓库该怎么摆：

- **`dsh.bundle` 清单必须在根 `package.json` 或 `packages/` · `plugins/` · `apps/`
  子包里。** 本插件一度为了这条搬进 `plugins/`，后来又搬回仓库根目录下的
  `dsh-comprehensive-platform/`——本仓库没有根 `package.json`，所以严格按 CI 的
  白名单，这个位置**不在**它认得的四种布局里。真要提列表 PR，两个办法二选一：
  要么把插件目录放回 `plugins/`（以及 `packages/` · `apps/`）下，要么在仓库根补一个
  带 `dsh.bundle` 的 `package.json`（根包那条路）。只声明 `dsh.client` 也算不合格。
- **仓库年龄 ≥1 天**（自动检查，挡的是「PR 前几分钟才建好」的仓库）。

另外两条靠自觉：给仓库加 `dsh-plugin` topic（发现入口，已加），以及描述必须属实——
维护者会读源码核对描述里的每一句话，包括数字与 API 名字。夸大是唯一的常见打回原因。

列表条目指向的是包目录（现在是 `.../tree/main/dsh-comprehensive-platform`，若在根包则是仓库
根），文件名由 `owner__repo--<子目录>` 拼出；一个 PR 最多加 3 条，多插件仓库也受这条限制。

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

### 正在跑的那套 profile 不一样，而且不能对它用 pnpm

本机有两套 harness：

| 宿主 | harness home 下的 `profiles\<profile>` | 说明 |
| --- | --- | --- |
| 桌面版 | `%APPDATA%\dsh-desktop\harness` | 脚本默认打这套 |
| 另一套发行版 | `~/.dsh` | 另一套数据目录，脚本的 `-DshHome` 能指过去 |

两边共用 GUI 端口 19387，但各自只认自己的 profile —— 往错的那套装，路由全是 404。

往**不是脚本默认那套**的 profile 里跑 `pnpm install` 会毁掉它的安装树：
pnpm 11.15.1 打完 `Packages: +N -2` 就报 `Worker pnpm#8 exited with code 1`
（`--ignore-scripts`、`--reporter=ndjson` 都复现，日志里只有
`Failed to load the ES module: .../pnpm/dist/worker.js` 这类噪音，给不出真正原因），
副作用是把两个 `file:` 插件从 `node_modules` 里删掉、把 `.pnpm` 虚拟 store 清空。

活 profile 的正确装法（完全不用 pnpm）：

```powershell
$d = "$env:USERPROFILE\.dsh\profiles\desktop"
Copy-Item "$d\plugins\dsh-localcoding-mcp" "$d\node_modules\dsh-localcoding-mcp" -Recurse -Force
# package.json 里要有 dependencies 的 file: 条目 + dsh.profile.bundles 的一行
```

再让 `plugin_manager set_bundle` 走一次 `enabled=false` → `enabled=true`（返回
`application:"applied"`）即刻生效，不用重启。但**它不清 Node 的 ESM 模块缓存**：
改了 server 代码还是得重启应用，改 client 代码刷新页面就够。

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
- **语义色只用 `--dsw-alias-*`**，而且**必须是宿主真的定义了的**。宿主一共 119 个
  `--dsw-alias-*`，state 只有五个色相：`business` / `idle` / `success` / `warn` / `error`。
  `info`、`brand`、`warning`、`danger` 都是猜的——写上去不会报错，而是**整条声明作废**，
  渐变和文字直接消失。`test/dsw-tokens.json` 是宿主包里的快照，自检会逐个核对。
- 文案必须 `ctx.locale.register(NS, { zh, en })`，中英同批加，自检会比对 key 齐平。
- 服务端可以拆子文件；**客户端不可拆**——客户端模块加载器（`dsh-client-modules`）的 `require`
  只认平台 seed 名与已注册的模块 id，没有同步相对导入，拆了只能走异步 chunk。
- 不改第三方源码。

## 自检

```powershell
node .\test\platform-client.test.mjs .\dsh-comprehensive-platform\client.js
node .\test\archive-delete.test.mjs
node .\test\localcoding-client.test.mjs .\dsh-localcoding-mcp\client.js
node .\test\localcoding-process.test.mjs
$env:LCM_URL = 'http://127.0.0.1:3011/mcp'; node .\test\localcoding-server.test.mjs
```

两个都不需要装依赖：

- `platform-client.test.mjs` 用假的 `window` / `document` / `react` 跑一遍 `apply()`，断言
  注册了且只注册了 1 个 `settings.section`、4 个外层页签与 8 个页内页面、中英 key 齐平、样式里没有硬编码色值、
  排序落在所有内置页面之后；再逐个记起那 8 个 FreeModel 页签，断言它们读的正是上表里的路由、
  每个请求都带 `credentials: 'same-origin'`，以及 owner 返 404 时落到「未安装」提示而不是报错。
  最后用一套**有记忆的 hook** 真渲染看板、日志、聚合渠道、EAC 四个页面，断言它们把返回值画了出来
  （模型名、成功率、`ms` 延迟、截断标记、已验证标记、登录名），而不只是「没崩」。
- `archive-delete.test.mjs` 用一个带状态的迷你 React 挂载真实的设置页，**真的去点按钮**：
  列表渲染、逐行删除的确认框与宿主调用、失败时的错误文案、勾选全选后的批量删除与调用顺序。
- `localcoding-client.test.mjs` 用假的 `window` / `document` / `react` 跑一遍 `apply()`，
  断言中英 key 齐平、每个 `ctx.<name>` 都在 `inject` 里声明过、样式里没有硬编码色值。
- `localcoding-process.test.mjs` 断言端口挑选、认领已在跑的服务（不 spawn 也不误杀）、
  真实 spawn → health → stop、`autoStart=false` 时报错而不是擅自启动、codex 路径优先级。
- `localcoding-server.test.mjs` 打真实服务器：注册出 40 个 `lcm_*`、
  成功调用取到 `data.root`、渲染出 content、失败路径按宿主要求 throw、中止能传导。

**`lcm_*` 已实测接入活着的宿主**：`GET /dsh-localcoding-mcp/status` 返回 200 且
`tools.toolCount = 40`；`lcm_get_workspace_info` / `lcm_write_file` / `lcm_read_file` /
`lcm_delete_file` 在真实对话里跑通；`codex mcp add` 之后 `~/.codex/config.toml` 里出现
`[mcp_servers.dsh-localcoding]` + `url = "http://127.0.0.1:3011/mcp"`，且 `codex mcp list`
的 HTTP 表里显示为 enabled。

## 本地编码 MCP（`dsh-localcoding-mcp`）

把 `LocalCodingMCP_v0_3` 的 .NET 8 MCP 服务器接进宿主，三个方向：
本地工具入表、任务出给 Codex、隧道打通网页版 ChatGPT。

### 分层

| 文件 | 职责 |
| --- | --- |
| `server/mcp-client.js` | streamable-HTTP 的 MCP 客户端（`McpHttpClient`）：initialize / tools/list / tools/call |
| `server/process.js` | `LocalCodingMCP.exe` 的生命周期：端口挑选、认领已在跑的服务、spawn、health、stop |
| `server/bridge.js` | 把 MCP 工具表翻译成宿主 `tools.register` 的 `ToolDefinition` |
| `server/codex.js` | 反向：`lcm_codex_task` 委派给 `codex.exe`，外加 `codex mcp add/register` 与中转入口探活 |
| `server/tunnel.js` | 网页版方向：按账号起一个 `tunnel-client.exe`（出站隧道舰队） |
| `server/browser.js` | 可选的 Playwright MCP 浏览器面，走同一个连接器 |
| `server/http.js` | 设置页用的 loopback 路由 |
| `client.js` | 设置页（前端必须单文件，见上文） |

宿主没有 `mcp` 服务，也没有 `codex` 服务：唯一的接缝是 **`ctx.tools.register`**。
`mcpResources` 只管 MCP 的 resources，不管 tools。

### 为什么工具名要加 `lcm_` 前缀

MCP 的 `read_file` / `write_file` / `search_code` / `apply_patch` 与宿主原生的
`read` / `write` / `grep` / `edit` 撞名。`bridge.js` 给所有工具加 `PREFIX = 'lcm_'`
（`lcm_read_file`），既避开冲突，也让人一眼看出这批工具来自 MCP。

### 四个协议坑

**响应是 SSE，不是 JSON。** `POST /mcp` 返回 `Content-Type: text/event-stream`，
正文是 `event: message\ndata: {json}`，会话在响应头 `Mcp-Session-Id` 上。
**不要开 `GET /mcp`** —— 那是一条永不结束的长连接，`ReadToEnd()` 会永久挂住。

**成功时没有 `isError`。** `tools/call` 成功的结果里根本没有这个字段，缺失即成功；
`result.content[0].text` 是一个**需要 `JSON.parse` 的字符串**。

**Schema 要削。** MCP 的 `inputSchema` 带 `$schema` / `additionalProperties` / `$ref`，
宿主只认子集 `type/oneOf/properties/required/additionalProperties/items/enum/const`
+ 注解 `description/title/default/examples`，多一个 key 就
`unsupported JSON schema: ... is not a supported keyword`。`narrowSchema()` 负责削，
没声明类型的工具退化成单个自由格式的 `arguments: string`。

**`execute` 返回裸值，失败靠 throw。** 宿主自己做
`validateJsonSchemaValue(tool.output.schema, value)` 再调 `output.render(args, value)`；
`execute` 里返回 `{isError:true}` 是错的写法，throw 才会被宿主转成 `Error: <message>`。

### 两个真 bug（都是自测抓到的）

`import setTimeout from 'node:timers/promises'` 会**遮蔽全局 `setTimeout`**，
于是 `setTimeout(() => child.kill('SIGKILL'), 4000)` 抛
`TypeError: setTimeout is not a function` —— 停止进程永远走不到 SIGKILL 那一步。
`process.js` 与 `codex.js` 都中过招，改成 `import { setTimeout as sleep }`。

`isPlainObject(signal)` 当作信号的有效性检查是**错的**：`AbortSignal` 也是
`typeof 'object'` 的普通对象，检查永远为真，于是调用方的 signal 被静默丢弃，
工具该中止时照跑到底（实测 1.5 秒中止、25 秒才返回）。
正确做法是先鸭子类型：`typeof signal?.addEventListener === 'function'`。

### 未登录的 Codex 会静默挂死

`codex exec` 在没有账号时既不输出也不退出（实测 120 秒无任何输出）。
`buildCodexToolDefinition` 在跑之前先探一次中转入口（60 秒缓存一次），
不可达就抛 `codex cannot reach its model endpoint …: fetch failed`，
而不是让调用方等到超时。

（这条判据换过一次。本机 Codex 走第三方中转：`~/.codex/config.toml` 里是
`model_provider="custom"` + `base_url` + `experimental_bearer_token`、**没有 auth.json**，
所以 `codex login status` 恒报 Not logged in —— 它只反映 OpenAI 账号登录，
拿它当就绪判据会误报。真正要探的是 `baseUrl` 能不能连通：
未带凭据 GET 一下，返回 401 就说明入口活着。
探针本身失败不拦截（`.catch(() => undefined)`），以免探测故障挡住可用的 Codex。）

### 网页版 ChatGPT 方向：出站隧道

`chatgpt.com` 的连接器在浏览器里，够不到 `127.0.0.1`。唯一可行的接法是
`mcp-accounts\tunnel-client.exe`（OpenAI 官方的**出站**守护进程）：它主动连
`https://api.openai.com`，因此**不需要任何入站端口**。

`TunnelFleet` 的每个账号一个子进程，`--health-listen-addr` 默认 `127.0.0.1:8080`
（所以多账号要错开，`tunnelHealthPortBase` 可调）。密钥处理是这块最要紧的：

- `accounts.json` 里的 `tunnel.controlPlaneKey` 是 **DPAPI 加密串**，
  只在内存里解开，通过独立环境变量 `LCM_CP_KEY_<ID_UPPER_SNAKE>` 交给子进程；
  `readAccounts()` **绝不把它带出配置读取层**，`describe()` 也只报
  `keyConfigured: true/false`。自检会 grep 全部 JSON 与 describe 输出，确保没有泄漏。
- 每个账号可能配自己的代理。**`NO_PROXY` 只对来自环境变量的代理生效**
  （`pkg/proxy/route.go`），`--control-plane.http-proxy` 会忽略它
  （`pkg/transport/proxy.go`）；所以用显式 control-plane 代理时必须清掉
  `http_proxy`/`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` 的全部大小写变体，
  再钉上 `NO_PROXY=127.0.0.1,localhost,::1`（本地 `/readyz` 探活要走回环）。

`$LASTEXITCODE` 在这里**证明不了成功**（宿主不一定等子进程），
`prepareProfile()` 跑完 `init` 之后按**内容**校验 profile 里同时含 tunnel id、
`env:<keyVar>` 与 listen addr，最多重试 10 次。停进程也只按 `ExecutablePath`
匹配 tunnel-client 自己来杀，绝不按进程名 —— 同名进程可能是用户的另一个实例。

隧道转发的是一个**字面 URL**，所以起隧道前 `syncTunnelTarget()` 会把舰队目标改成
服务器实际落到的端口（被认领或向上找空闲端口时端口会变），否则连接器会指向旧端口。

### 网页版方向的三个坑

**`/readyz` 只证明进程活着。** 真密钥也可能 200，真正的验收是去
`chatgpt.com/#settings/Connectors` 选中这条隧道后发一次真实工具调用。
所以设置页必须把这句话写给用户，不能拿 READY 当成「已打通」。

**`organizationId` 为空是本地看不见的失败。** 三个账号当前都是空的，
会得到 `403 tunnel_active_organization_required`，而 `/readyz`、doctor、
日志里都看不出原因。设置页因此在 organizationId 为空时显式警告。

**Playwright MCP 要用 `localhost` 而不是 `127.0.0.1`。** 它按 `--allowed-hosts`
校验 Host 头，裸 IP 直接 403；扩展令牌 `PLAYWRIGHT_MCP_EXTENSION_TOKEN` 只存在于
用户级注册表（`reg query HKCU\Environment /v ...`），不在当前进程块里，
所以 `resolveExtensionToken()` 查注册表而不是 `process.env`。

### 隧道自检抓到的 bug

**PS 5.1 里解不了 DPAPI。** `powershell.exe -NoProfile -NonInteractive -EncodedCommand`
默认是 Windows PowerShell 5.1，不预载 `System.Security`，报
`Unable to find type [System.Security.Cryptography.ProtectedData]`。
`decryptControlPlaneKey` 的脚本开头补 `Add-Type -AssemblyName System.Security`。
（路径以 PS 单引号字面量嵌进脚本：`-Command` 会把后面的 argv 当脚本续行。）
密钥解出后只打印长度（实测 164 字符），不打印值。

## 已验证 / 未验证

**已验证**（harness 0.2.0-rc.2）：

- 两个自检脚本全过（含 4 个页签、8 个页内页面的路由与渲染断言）。
- `install-to-profile.ps1` 实测执行通过，旧依赖与改名残留已从 profile 摘除。
- 服务端路由用 loopback 自检：命中即 200。

**未验证**：客户端在应用里的真实观感（侧边栏排序、页签切换、记忆编辑器切页不丢稿、归档删除的
确认框、4 个新页签在真实数据下的排版）——需要在应用里点一遍。
`lcm_codex_task` 的**成功路径**也还没跑过：本机 Codex 走的中转 `new.ruiflux.sbs` 当前不可达
（TCP 通、代理隧道 200，但 TLS 握手对端不回字节；同一代理访问 `api.openai.com` 正常），
只验证了它会明确报「模型入口不可达」而不是挂死。
网页版方向的隧道**从未真正建通过**：本机三个账号的 `organizationId` 都为空，
隧道 ID 也没有在 `platform.openai.com/settings/organization/tunnels` 复核过，
所以只验证到 profile 生成、内容校验、密钥解密与 `/readyz` 探测这一层，
**没有一次成功的出站隧道，也没有一次来自 chatgpt.com 的真实工具调用**。

> 服务端改动（含整个网页版方向）在下次重启宿主之前都不会生效。
> `plugin_manager set_bundle` 会重载插件，但 Node 的 ESM 模块缓存不清。
> `test\localcoding-plugin.test.mjs` 默认加载 profile 里那份副本、在进程内跑完整 `apply()`，
> 就是为了在这条限制下仍然能验证新代码。

## 相关文档

- `CONTEXT.md`：本仓库的上下文与结构总览（含 slot 账本、设置表单键等宿主契约）。
- `MEMORY.md`：跨会话的长期事实。
