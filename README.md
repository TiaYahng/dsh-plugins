# dsh-plugins

DSH Desktop 的自制插件。当前只有一个：**综合平台**（`dsh-desktop-platform`）——
把所有自制功能收进设置里的一个页面，导航名「综合平台」，排在宿主与第三方插件之后。

## 页面

综合平台是一个设置页、11 个页签。

**自己的数据（走本插件的 `/dsh-desktop/*` 路由）**

| 页签 | 作用 |
| --- | --- |
| 用量统计 | 按模型/天统计 token，积分按你填的费率折算 |
| 归档历史 | 归档会话的还原与删除（单个 + 批量） |
| 记忆系统 | 工作区 `MEMORY.md` 的编辑、记忆约定、会话交接 |

**读 `dsh-our-free-model` 的数据（只读它的 `/api/our-free-model/*`）**

| 页签 | 作用 |
| --- | --- |
| FreeModel · 插件升级 | 检查 / 安装 / 热重载该插件 |
| FreeModel · EAC 模型 | EAC 通道的 GitHub 授权与退出 |
| FreeModel · 聚合渠道 | 76 个服务商的 Key、模型与连通性 |
| FreeModel · 省 Token | 工具输出压缩、提示词档位、本地应答 |
| FreeModel · 路由 | 降级链（combo）增删改 |
| FreeModel · 数据看板 | 该插件自己的调用/token 账本 |
| FreeModel · 运行日志 | 最近 200 次调用的逐条记录 |
| FreeModel · 网关设置 | 本机网关 / 局域网中继 / 渠道网关的端口与 Key |

后 8 个页签只是它的前端：状态、凭据、存储全在 `dsh-our-free-model` 那边，本插件不持有。
**装了 `dsh-our-free-model` 才有数据**，否则这些页签显示一句安装提示。

## 安装

```powershell
powershell -ExecutionPolicy Bypass -File .\install-to-profile.ps1
```

改完代码重跑一次，然后重启 DSH Desktop。自制插件没有更新提示（`file:` 依赖被视为 linked）。

## 环境

- DSH Desktop 0.11.1（harness `0.2.0-rc.2`）
- peer 依赖都是宿主自带的 `@deepseek-ai/*`
- `dsh-our-free-model` ≥ 2.1.0（可选，只有后 8 个页签需要）

## 自检

```powershell
node .\test\platform-client.test.mjs .\dsh-desktop-platform\client.js
node .\test\archive-delete.test.mjs
```

不需要装依赖。实现细节、踩过的坑与未验证项见 [docs/ENGINEERING.md](docs/ENGINEERING.md)。
