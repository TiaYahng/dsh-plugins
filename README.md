# dsh-plugins

DSH Harness 的自制插件。两个：

| 插件 | 做什么 |
| --- | --- |
| `dsh-desktop-platform` | 把自制功能收进设置里的一个页面，导航名「综合平台」 |
| `dsh-localcoding-mcp` | 把 LocalCodingMCP 接进宿主，双向打通 Codex 与本模型 |

## 综合平台（`dsh-desktop-platform`）

### 页面

综合平台是一个设置页、4 个页签：用量统计 / 归档历史 / 记忆系统 / FreeModel。

前三页用本插件自己的 `/dsh-desktop/*` 路由。第四页是 `dsh-our-free-model` 的前端，
页内一条自己的导航（玻璃质感，与原版一致）：

| 页内页 | 作用 |
| --- | --- |
| 插件升级 | 检查 / 安装 / 热重载该插件 |
| EAC 模型 | EAC 通道的 GitHub 授权与退出 |
| 模型接入 | 13 个渠道的账号池、每日签到、积分与模型开关 |
| 聚合渠道 | 76 个服务商的 Key、模型与连通性 |
| 省 Token | 工具输出压缩、提示词档位、本地应答 |
| 路由 | 降级链（combo）增删改 |
| 数据看板 | 插件自有用量 + 13 个渠道账号的 90 天账本 |
| 运行日志 | 逐条调用记录，可切换「插件自有线路 / 渠道账号」 |
| 网关设置 | 本机网关 / 局域网中继 / 渠道网关的端口与 Key |

这些页签只是它的前端：状态、凭据、存储全在 `dsh-our-free-model` 那边，本插件不持有。
唯一例外是「模型接入」和「渠道用量」：账号池、积分、模型黑名单、90 天账本都归被吸收的
**channel pack** 管，本页通过宿主的 RPC 直接读写（pack 就躺在插件的 `vendor/channel-pack/` 里，
不是独立安装的插件）。没有这个宿主服务时，这两处会显示一句说明而不是空界面。
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
