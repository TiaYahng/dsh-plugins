# dsh-plugins

DSH Desktop 的自制插件。当前只有一个：**综合平台**（`dsh-desktop-platform`）——
把所有自制功能收进设置里的一个页面，导航名「综合平台」，排在宿主与第三方插件之后。

## 页面

综合平台是一个设置页、4 个页签：用量统计 / 归档历史 / 记忆系统 / FreeModel。

前三页用本插件自己的 `/dsh-desktop/*` 路由。第四页是 `dsh-our-free-model` 的前端，
页内一条自己的导航（玻璃质感，与原版一致）：

| 页内页 | 作用 |
| --- | --- |
| 插件升级 | 检查 / 安装 / 热重载该插件 |
| EAC 模型 | EAC 通道的 GitHub 授权与退出 |
| 模型接入 | 13 个渠道的账号池、每日签到、模型开关 |
| 聚合渠道 | 76 个服务商的 Key、模型与连通性 |
| 省 Token | 工具输出压缩、提示词档位、本地应答 |
| 路由 | 降级链（combo）增删改 |
| 数据看板 | 该插件自己的调用 / token 账本 |
| 运行日志 | 最近 200 次调用的逐条记录 |
| 网关设置 | 本机网关 / 局域网中继 / 渠道网关的端口与 Key |

这些页签只是它的前端：状态、凭据、存储全在 `dsh-our-free-model` 那边，本插件不持有。
唯一例外是「模型接入」：账号池与模型黑名单归被吸收的 **channel pack** 管，
本页通过宿主的 RPC 直接读写（pack 就躺在插件的 `vendor/channel-pack/` 里，不是独立安装的插件）。
**装了 `dsh-our-free-model` 才有数据**，否则显示一句安装提示。

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
