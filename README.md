# dsh-plugins

DSH Harness 的自制插件。两个：

| 插件 | 做什么 |
| --- | --- |
| `dsh-desktop-platform` | 把自制功能收进设置里的一个页面，导航名「综合平台」 |
| `dsh-localcoding-mcp` | 把 LocalCodingMCP 接进宿主：本地工具入表、任务出给 Codex、隧道打通网页版 ChatGPT |

## 综合平台（`dsh-desktop-platform`）

### 页面

综合平台是一个设置页、4 个页签：用量统计 / 归档历史 / 记忆系统 / FreeModel。

前三页用本插件自己的 `/dsh-desktop/*` 路由。第四页**就是 `dsh-our-free-model` 自己的页面**：
它的 `client.js` 被内嵌进来，只改了十二处（清单在 `tools/vendor-our-free-model.mjs` 的文件头，
每处都写了为什么），其中一处是从它的页签列表里删掉「免费模型」、一处是去掉它自己的标题行与
「公告中心」面板。所以它那 8 个页面（白嫖模型接入 / 聚合渠道 / EAC 模型 / 省 Token / 路由 /
数据看板 / 运行日志 / 网关设置）的行为与原版一致，跟得上它升级。

**它没装或没加载时，FreeModel 页签显示一句说明**，其余三个页签照常。
数据、凭据、存储全在它那边，本插件不持有。要跟着它升级内嵌副本，见下面的「更新」。

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
powershell -ExecutionPolicy Bypass -File .\install-to-profile.ps1 -Plugin dsh-desktop-platform
```

重启 DSH Desktop，插件管理里出现「综合平台」即可。脚本做四件事：把插件复制进
`%APPDATA%\dsh-desktop\harness\profiles\web\plugins`、在 profile 的 `package.json` 里注册
`file:` 依赖与 `dsh.profile.bundles`、删掉 `node_modules` 里的旧拷贝再 `pnpm install --force`
（pnpm 对 `file:` 依赖是实体拷贝而不是链接，不删就还在跑旧代码）、最后确认
`cordis.patch.yml` 进了 `node_modules`。

只想要「综合平台」就带 `-Plugin dsh-desktop-platform`。不带这个参数会装上仓库里的两个插件，
而 `dsh-localcoding-mcp` 需要本机有编译好的 `LocalCodingMCP.exe`（仓库里没有），缺它跑起来是坏的。
其他参数：`-DshHome` / `-Profile` 换目标，`-SkipPnpm` 只复制与注册、不装依赖。

装完用这两条路由自检（宿主在跑时返回 200 即已激活）：

```
/dsh-desktop/usage-stats/summary   综合平台 › 用量统计
/dsh-desktop/shell/archive.list    综合平台 › 归档历史
```

**用 DeepSeek Harness（harness home `~\.dsh`）不要用这个脚本**，它的第 3 步 pnpm 会把
profile 的 `node_modules` 弄坏。手动三步：

```powershell
$P = "$env:USERPROFILE\.dsh\profiles\desktop"
Copy-Item -Recurse -Force "$P\plugins\dsh-localcoding-mcp" "$P\node_modules\dsh-localcoding-mcp"
```

`package.json` 里要有 `dependencies` 的 `file:` 条目与 `dsh.profile.bundles` 的行，
然后在插件管理里把该 bundle 关一次再开一次，即刻生效、不用重启。
**改完服务端代码仍需重启应用**（Node 的 ESM 模块缓存不随开关插件清除）。

## 更新

```powershell
cd dsh-plugins
git pull
powershell -ExecutionPolicy Bypass -File .\install-to-profile.ps1 -Plugin dsh-desktop-platform
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

- 宿主 `E:\ai\DeepSeek Harness`（harness `0.2.0-rc.2`），peer 依赖都是宿主自带的 `@deepseek-ai/*`
- `dsh-our-free-model` ≥ 2.1.0（可选，只有综合平台后 8 个页签需要）
- `dsh-localcoding-mcp` 需要已编译的 `LocalCodingMCP.exe`（0.3.0）；网页版方向另需
  `mcp-accounts\tunnel-client.exe` 与 `config\accounts.json`（可选 Playwright MCP 另需扩展令牌）
- Codex CLI 走的是第三方中转，`codex login status` 说「未登录」是**预期**的（中转用 bearer
  token，不用 OpenAI 账号登录）；真正的就绪判据是插件去探中转入口能不能连通

## 自检

```powershell
node .\test\platform-client.test.mjs .\dsh-desktop-platform\client.js
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
