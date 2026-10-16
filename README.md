# dsh-plugins

DSH Harness 的自制插件。两个：

| 插件 | 做什么 |
| --- | --- |
| `dsh-comprehensive-platform` | 把自制功能收进设置里的一个页面，导航名「综合平台」 |
| `dsh-localcoding-mcp` | 把 LocalCodingMCP 接进宿主：本地工具入表、任务出给 Codex、隧道打通网页版 ChatGPT |

## 综合平台（`dsh-comprehensive-platform`）

### 页面

综合平台是一个设置页、4 个页签：用量统计 / 归档历史 / 记忆系统 / FreeModel。

前三页（用量统计 / 归档历史 / 记忆系统）用本插件自己的 `/dsh-desktop/*` 路由，数据在本插件里。

第四页 FreeModel **不是本插件写的页面**：它是另一个插件 `dsh-our-free-model` 的设置页。做法是把
那个插件自己的前端代码原样内嵌进本插件（只改了十二处，清单在 `tools/vendor-our-free-model.mjs`
的文件头，每处都写了为什么），再把它挂成这一页的第四个页签。改的地方里有一处是从它的页签
列表里删掉「免费模型」、一处是去掉它自己的标题行与「公告中心」面板、EAC 挪到第三。
所以它那 8 个页面（白嫖模型接入 / 聚合渠道 / EAC 模型 / 省 Token / 路由 / 数据看板 /
运行日志 / 网关设置）的行为与原版一致，也能跟着它升级。

这一页要的数据全部来自那个插件提供的 `/api/our-free-model/*` 路由；本插件不持有它的数据、
凭据或存储。**没装 `dsh-our-free-model` 时这一页用不了**：页面会显示它自己的加载 / 错误提示
（不是本插件写的说明），其余三个页签照常。要跟着它升级内嵌副本，见下面的「更新」。

## 本地编码 MCP（`dsh-localcoding-mcp`）

把 `LocalCodingMCP_v0_3`（一个 .NET 8 的 MCP 服务器，40 个工具）接进宿主，三个方向：

- **进（本地）**：宿主工具表多出 41 个 `lcm_*` 工具（40 个 MCP 工具 + `lcm_codex_task`），
  本模型可以直接读写工程、跑构建、查 git。
- **出（Codex）**：`lcm_codex_task` 把编码任务委派给 `codex.exe`；
  设置页一键把本服务器注册进 Codex（`codex mcp add dsh-localcoding --url http://127.0.0.1:3011/mcp`），
  于是 Codex 也能读写同一个工程，两个 agent 共用一套工具面。
- **网页版 ChatGPT → 本地**：`chatgpt.com` 的连接器够不到 `127.0.0.1`，
  所以设置页按账号起 `tunnel-client.exe`（OpenAI 官方**出站**守护进程），
  它主动连 OpenAI 控制面；之后在 `chatgpt.com/#settings/Connectors` 里选中这条隧道，
  网页版 ChatGPT 就能调用本机的 40 个工具。**这是唯一不需要开放入站端口的接法。**
  设置页可按账号启停、看 `/readyz` 与 `doctor` 输出，并提示
  `/readyz` 只证明进程活着 —— 真正的验收是去连接器里发一次真实工具调用。
  可选的浏览器面（Playwright MCP）也走同一个连接器，`mcp.local.json` 已按白名单放行
  24 个 `browser_*` 工具，刻意不含 `browser_run_code_unsafe`。

插件自己托管它起的每一个进程：`LocalCodingMCP.exe`、各账号的 `tunnel-client.exe`、
可选的浏览器 MCP，都随宿主启停。设置页有服务器状态、工具清单、Codex 与模型入口、
握手自检、隧道舰队和实时日志。

> 两个账号相关的前提本机还不满足：`accounts.json` 里三个账号的 `organizationId` 都是空的
> （会得到 `403 tunnel_active_organization_required`），隧道 ID 也可能已过期需要在
> `platform.openai.com/settings/organization/tunnels` 重新建。控制面密钥是 DPAPI 加密串，
> 只在内存里解开，不进日志、不进响应、不进任何配置。

## 安装

前置：**DSH Desktop 至少启动过一次**（profile 的 `package.json` 由它生成），PATH 上有 `pnpm`
（`corepack enable pnpm` 或 `npm i -g pnpm`）。FreeModel 页签另需 `dsh-our-free-model`（可选）。

```powershell
git clone https://github.com/TiaYahng/dsh-plugins.git
cd dsh-plugins
powershell -ExecutionPolicy Bypass -File .\install-to-profile.ps1 -Plugin dsh-comprehensive-platform
```

重启 DSH Desktop，插件管理里出现「综合平台」即可。脚本做四件事：把插件复制进
`%APPDATA%\dsh-desktop\harness\profiles\web\plugins`、在 profile 的 `package.json` 里注册
`file:` 依赖与 `dsh.profile.bundles`、删掉 `node_modules` 里的旧拷贝再 `pnpm install --force`
（pnpm 对 `file:` 依赖是实体拷贝而不是链接，不删就还在跑旧代码）、最后确认
`cordis.patch.yml` 进了 `node_modules`。

只想要「综合平台」就带 `-Plugin dsh-comprehensive-platform`。不带这个参数会装上仓库里的两个插件，
而 `dsh-localcoding-mcp` 需要本机有编译好的 `LocalCodingMCP.exe`（仓库里没有），缺它跑起来是坏的。
其他参数：`-DshHome` / `-Profile` 换目标，`-SkipPnpm` 只复制与注册、不装依赖。

装完用这两条路由自检（宿主在跑时返回 200 即已激活）：

```
/dsh-desktop/usage-stats/summary   综合平台 › 用量统计
/dsh-desktop/shell/archive.list    综合平台 › 归档历史
```

**换一套 harness 数据目录时不要用这个脚本**，它第 3 步的 pnpm 在那套 profile 上会把
`node_modules` 弄坏（原因见 `docs/ENGINEERING.md`）。手动三步：

```powershell
# $P 指向目标 profile 目录（harness home 下的 profiles\<profile>）
Copy-Item -Recurse -Force "$P\plugins\<插件名>" "$P\node_modules\<插件名>"
```

`package.json` 里要有 `dependencies` 的 `file:` 条目与 `dsh.profile.bundles` 的行，
然后在插件管理里把该 bundle 关一次再开一次，即刻生效、不用重启。
**改完服务端代码仍需重启应用**（Node 的 ESM 模块缓存不随开关插件清除）。

## 给 agent 与自动化安装

宿主自带的插件通道接受四种源：**npm 包名 / Git 仓库地址 / 归档链接 / 本机目录**
（设置 › 插件 › 插件管理里的安装对话框，或 `dsh plugin add <源>`）。按这四种源看：

| 源 | 现在能用吗 | 还需要什么 |
| --- | --- | --- |
| 本机目录 | ✅ 已验证 | 克隆仓库后跑 `install-to-profile.ps1`（见上）。脚本做的事与宿主通道一致，只是替你写 profile 的 `package.json` |
| Git 仓库地址 | ⚠️ 未验证 | 本仓库是**多插件仓库**，宿主按包名安装单个插件，需要指向子目录的写法；本仓库尚未按这个形态验证过 |
| 归档链接 | ⚠️ 未验证 | 同上 |
| npm 包名 | ❌ 还没有 | 插件尚未发布到 npm，且 `package.json` 里 `private: true`、没有 `files` 字段 |

所以今天给别的 agent 的答案是**本机目录**那一条：克隆 → 跑脚本 → 重启应用 → 打路由自检。
要让「一条命令装上」成立，需要先把每个插件单独发布到 npm，并把 `private`、`files`、
`engines.dsh`、`dsh-plugin` 关键字补齐。

更新同一条路：`git pull` → 重跑脚本 → **重启应用**。

## 更新

```powershell
cd dsh-plugins
git pull
powershell -ExecutionPolicy Bypass -File .\install-to-profile.ps1 -Plugin dsh-comprehensive-platform
```

然后**重启 DSH Desktop**。前端（`client.js`）改动本可以靠插件管理里关一次开一次热加载，
但服务端是 Node 的 ESM，模块缓存不随开关清除——不重启就还在跑旧的服务端代码，
而前端已经变了，两边对不上。

内嵌的那份原版副本要跟着 `dsh-our-free-model` 升级时：先在 profile 里升级那个插件，再跑

```powershell
node tools\vendor-our-free-model.mjs
```

重新生成副本（十二处改动都记在 `tools/vendor-our-free-model.mjs` 里），然后跑自检、再重装本插件。

## 环境

- 宿主 harness `0.2.0-rc.2`，peer 依赖都是宿主自带的 `@deepseek-ai/*`
- `dsh-our-free-model` ≥ 2.1.0（可选，只有综合平台后 8 个页签需要）
- `dsh-localcoding-mcp` 需要已编译的 `LocalCodingMCP.exe`（0.3.0）；网页版方向另需
  `mcp-accounts\tunnel-client.exe` 与 `config\accounts.json`（可选 Playwright MCP 另需扩展令牌）
- Codex CLI 走的是第三方中转，`codex login status` 说「未登录」是**预期**的（中转用 bearer
  token，不用 OpenAI 账号登录）；真正的就绪判据是插件去探中转入口能不能连通

## 自检

```powershell
node .\test\platform-client.test.mjs .\dsh-comprehensive-platform\client.js
node .\test\archive-delete.test.mjs
node .\test\localcoding-client.test.mjs .\dsh-localcoding-mcp\client.js
node .\test\localcoding-process.test.mjs
node .\test\localcoding-tunnel.test.mjs
node .\test\localcoding-plugin.test.mjs
$env:LCM_URL = 'http://127.0.0.1:3011/mcp'; node .\test\localcoding-server.test.mjs
```

前两个前端自检必须带 `client.js` 的路径参数（只认位置参数，不吃环境变量）。
`localcoding-plugin.test.mjs` **默认加载 profile 里那份将要被宿主加载的副本**，
跑完整的 `apply()`，所以漏部署一个文件会在这里报错而不是在应用里。
`localcoding-server.test.mjs` 需要本地 MCP 服务器在跑。

不需要装依赖。实现细节、踩过的坑与未验证项见 [docs/ENGINEERING.md](docs/ENGINEERING.md)。
