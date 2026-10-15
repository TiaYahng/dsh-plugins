# dsh-plugins

DSH Harness 的自制插件。两个：

| 插件 | 做什么 |
| --- | --- |
| `dsh-desktop-platform` | 把自制功能收进设置里的一个页面，导航名「综合平台」 |
| `dsh-localcoding-mcp` | 把 LocalCodingMCP 接进宿主，双向打通 Codex 与本模型 |

## 综合平台（`dsh-desktop-platform`）

### 页面

综合平台是一个设置页、4 个页签：用量统计 / 归档历史 / 记忆系统 / FreeModel。

前三页用本插件自己的 `/dsh-desktop/*` 路由。第四页**就是 `dsh-our-free-model` 自己的页面**：
它的 `client.js` 被内嵌进来，只改了七处（见 `tools/vendor-our-free-model.mjs`），其中一处是
从它的页签列表里删掉「免费模型」。所以它那 9 个页面（EAC 模型 / 白嫖模型接入 / 聚合渠道 /
省 Token / 路由 / 数据看板 / 运行日志 / 网关设置）的行为与原版一致，也跟得上它升级。

**它没装或没加载时，FreeModel 页签显示一句说明**，其余三个页签照常。
数据、凭据、存储全在它那边，本插件不持有。

要更新这份内嵌副本：先升级 profile 里的 `dsh-our-free-model`，再跑

```powershell
node tools\vendor-our-free-model.mjs
```
**装了 `dsh-our-free-model` 才有数据**，否则显示一句安装提示。

## 本地编码 MCP（`dsh-localcoding-mcp`）

把 `LocalCodingMCP_v0_3`（一个 .NET 8 的 MCP 服务器，40 个工具）接进宿主，**双向**：

- **进**：宿主工具表多出 41 个 `lcm_*` 工具（40 个 MCP 工具 + `lcm_codex_task`），
  本模型可以直接读写工程、跑构建、查 git。
- **出**：`lcm_codex_task` 把编码任务委派给 `codex.exe`；
  设置页一键把本服务器注册进 Codex（`codex mcp add dsh-localcoding --url http://127.0.0.1:3011/mcp`），
  于是网页版 Codex 也能读写同一个工程。

插件自己托管 `LocalCodingMCP.exe` 的启停（端口、工作区、自动启动都在设置里），
设置页另有服务器状态、工具清单、Codex 登录态、握手自检与实时日志。

## 安装

装到 `%APPDATA%\dsh-desktop\harness\profiles\web`：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-to-profile.ps1
```

**装到当前在跑的那套（`E:\ai\DeepSeek Harness`，harness home `~\.dsh`）不要用这个脚本**，
它的第 3 步 pnpm 会把 profile 的 `node_modules` 弄坏。手动三步即可：

```powershell
$P = "$env:USERPROFILE\.dsh\profiles\desktop"
Copy-Item -Recurse -Force "$P\plugins\dsh-localcoding-mcp" "$P\node_modules\dsh-localcoding-mcp"
```

`package.json` 里要有 `dependencies` 的 `file:` 条目与 `dsh.profile.bundles` 的行，
然后在插件管理里把该 bundle 关一次再开一次，即刻生效、不用重启。
**改完服务端代码仍需重启应用**（Node 的 ESM 模块缓存不随开关插件清除）。

## 环境

- 宿主 `E:\ai\DeepSeek Harness`（harness `0.2.0-rc.2`），peer 依赖都是宿主自带的 `@deepseek-ai/*`
- `dsh-our-free-model` ≥ 2.1.0（可选，只有综合平台后 8 个页签需要）
- `dsh-localcoding-mcp` 需要已编译的 `LocalCodingMCP.exe`（0.3.0）与（可选）Codex CLI
- Codex 未登录时 `codex exec` 会静默挂住，插件会提前拦下并提示 `codex login`

## 自检

```powershell
node .\test\platform-client.test.mjs .\dsh-desktop-platform\client.js
node .\test\archive-delete.test.mjs
node .\test\localcoding-client.test.mjs .\dsh-localcoding-mcp\client.js
node .\test\localcoding-process.test.mjs
$env:LCM_URL = 'http://127.0.0.1:3011/mcp'; node .\test\localcoding-server.test.mjs
```

不需要装依赖。实现细节、踩过的坑与未验证项见 [docs/ENGINEERING.md](docs/ENGINEERING.md)。
