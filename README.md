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

第四页 FreeModel **不是本插件写的页面**：它是 `dsh-our-free-model` 的设置页。做法是把它自己的
代码取过来，只改必须改的地方（清单在 `tools/vendor-our-free-model.mjs` 的文件头与服务端阶段的
注释里，每处都写了为什么），再挂成这一页的第四个页签：

- **页面**（前端）内嵌在 `client.js` 的 VENDOR 段里，十三处改动，含删掉它的「免费模型」页、
  去掉它自己的标题行与「公告中心」面板、EAC 挪到第三、API 指向本插件自己的前缀。
- **服务端**在 `free-model/`，提供 `/api/comprehensive-platform/free-model/*`。
  它自己的自更新、公告通道与热重载都已停用——那三样都会改写已安装的字节，而那些字节现在是
  本插件的；数据目录也换成自己的，避免两个插件写同一份目录。

所以这一页**不依赖任何其他插件**：装这一个就完整可用。那 8 个页面（白嫖模型接入 / 聚合渠道 /
EAC 模型 / 省 Token / 路由 / 数据看板 / 运行日志 / 网关设置）的行为与原版一致。
来源与改动写在 `free-model/NOTICE.md`。

> **那 13 个账号渠道的包不在这个仓库里。** `free-model/vendor/channel-pack/` 是第三方项目的整份拷贝，
> 里面带着它的 Google OAuth 凭据；本仓库是公开的，推上去等于公开别人的凭据（GitHub 的推送保护也确实拦了）。
> 所以它 `.gitignore` 掉了，只留在装了它的机器上。缺了它插件照常工作：渠道列表会显示「渠道包不可用」
> 与原因，其余页面（免费车道、EAC 模型、账本、日志、网关、省 Token、路由）不受影响——这是它自己的降级路径。
> 它的 LICENSE 与 NOTICE 仍然在仓库里，第三方来源有据可查。
## 本地编码 MCP（`dsh-localcoding-mcp`）

**不启动任何外部程序。** 工具直接实现在本插件里（Node + 宿主 `ctx.tools.register`），
没有子进程、没有本地端口、没有需要单独编译的二进制。四个方向：

- **本地工具**：宿主工具表多出 30 多个 `lcm_*` 工具 —— 读写改文件、目录操作、搜索与符号定位、
  git 状态/差异/提交/还原、构建与测试、长驻进程会话、以及一个**可撤销的改动日志**
  （`lcm_undo_last_change`）。所有路径都被限制在工作区内，越界直接拒绝。
- **对外提供 MCP**：插件自己在 `/mcp` 上提供 MCP（streamable HTTP），
  和本地工具是**同一批实现**。Codex 用 `codex mcp add dsh-localcoding --url http://127.0.0.1:19387/mcp` 接进来。
- **本应用模型给 Codex 用**：插件在 `/v1` 上提供 OpenAI 兼容端点，背后是宿主的 `llm` 服务。
  设置页一个按钮把 `~/.codex/config.toml` 改成指向它（**改前自动备份**，可一键还原），
  于是 Codex 跑的就是本应用正在用的模型 —— 不需要第三方中转、不需要单独的 API Key、不用 `codex login`。
- **网页版 ChatGPT → 本地**：`chatgpt.com` 的连接器够不到 `127.0.0.1`，
  所以设置页按账号起 `tunnel-client.exe`（OpenAI 官方**出站**守护进程），
  它主动连 OpenAI 控制面；之后在 `chatgpt.com/#settings/Connectors` 里选中这条隧道，
  网页版 ChatGPT 就能调用上面那批工具。**这是唯一不需要开放入站端口的接法。**
  设置页可按账号启停、看 `/readyz` 与 `doctor` 输出，并提示
  `/readyz` 只证明进程活着 —— 真正的验收是去连接器里发一次真实工具调用。
  可选的浏览器面（Playwright MCP）也走同一个连接器。

设置页显示：工具表、两个端点的地址与可直接粘贴的客户端配置、Codex 状态、隧道舰队。
`sourceMode: 'external-mcp'` 是给「别人已经在跑 LocalCodingMCP.exe」的场景留的**只连接、不启动**模式。

> 两个账号相关的前提本机还不满足：`accounts.json` 里三个账号的 `organizationId` 都是空的
> （会得到 `403 tunnel_active_organization_required`），隧道 ID 也可能已过期需要在
> `platform.openai.com/settings/organization/tunnels` 重新建。控制面密钥是 DPAPI 加密串，
> 只在内存里解开，不进日志、不进响应、不进任何配置。

## 安装

前置：**DSH Desktop 至少启动过一次**（profile 的 `package.json` 由它生成），PATH 上有 `pnpm`
（`corepack enable pnpm` 或 `npm i -g pnpm`）。不需要装别的插件：四个页签的数据都在本插件里。

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

上架插件列表（收录后市场就能搜到）的投稿文件与步骤在 `docs/market-entry.yml`：
目录不是市场本地索引，而是由 `awesome-dsh-plugin` 仓库生成，收录要往那边提一个 PR。

## 更新

```powershell
cd dsh-plugins
git pull
powershell -ExecutionPolicy Bypass -File .\install-to-profile.ps1 -Plugin dsh-comprehensive-platform
```

然后**重启 DSH Desktop**。前端（`client.js`）改动本可以靠插件管理里关一次开一次热加载，
但服务端是 Node 的 ESM，模块缓存不随开关清除——不重启就还在跑旧的服务端代码，
而前端已经变了，两边对不上。

内嵌的那份副本要跟上上游时：先升级 profile 里的 `dsh-our-free-model`，再跑

```powershell
node tools\vendor-our-free-model.mjs
```

重新生成副本（十二处改动都记在 `tools/vendor-our-free-model.mjs` 里），然后跑自检、再重装本插件。

## 环境

- 宿主 harness `0.2.0-rc.2`，peer 依赖都是宿主自带的 `@deepseek-ai/*`
- 内嵌的上游版本：`dsh-our-free-model` 2.1.0（前端与服务端都在本仓库里，见 `free-model/NOTICE.md`）
- `dsh-localcoding-mcp` 需要已编译的 `LocalCodingMCP.exe`（0.3.0）；网页版方向另需
  `mcp-accounts\tunnel-client.exe` 与 `config\accounts.json`（可选 Playwright MCP 另需扩展令牌）
- Codex CLI 走的是第三方中转，`codex login status` 说「未登录」是**预期**的（中转用 bearer
  token，不用 OpenAI 账号登录）；真正的就绪判据是插件去探中转入口能不能连通

## 自检

```powershell
node .\test\platform-client.test.mjs .\dsh-comprehensive-platform\client.js
node .\test\archive-delete.test.mjs
node .\test\free-model-standalone.test.mjs
node .\test\schema-calls.test.mjs
node .\test\localcoding-client.test.mjs .\dsh-localcoding-mcp\client.js
node .\test\localcoding-native.test.mjs
node .\test\localcoding-process.test.mjs
node .\test\localcoding-tunnel.test.mjs
node .\test\localcoding-plugin.test.mjs
node .\test\localcoding-server.test.mjs
```

前两个前端自检必须带 `client.js` 的路径参数（只认位置参数，不吃环境变量）。
`localcoding-plugin.test.mjs` **默认加载 profile 里那份将要被宿主加载的副本**，
跑完整的 `apply()`，所以漏部署一个文件会在这里报错而不是在应用里。
`localcoding-server.test.mjs` 需要本地 MCP 服务器在跑。

不需要装依赖。实现细节、踩过的坑与未验证项见 [docs/ENGINEERING.md](docs/ENGINEERING.md)。
