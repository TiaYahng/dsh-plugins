<#
.SYNOPSIS
    安装 / 更新本目录下的自制插件到 DSH Desktop 的 web profile。

.DESCRIPTION
    宿主插件放在应用安装目录里会被厂商更新清空，所以本目录下的自制插件走 Profile 通道：
    复制进 profile，再按 profile 内路径注册。

    改名或合并插件后重跑本脚本会把旧的 file: 依赖摘掉（只碰 file: 依赖，市场装的第三方插件不动）。

    两条硬约束（都是实测踩出来的，不要绕过）：

      1. file: 依赖必须指向 profile 内部。跨 profile / 跨目录的 file: 依赖会被宿主
         当成 profile 内的相对目录去scandir，报 ENOENT。
      2. pnpm 把 file: 依赖装成 node_modules 下的实体拷贝，不是链接。改了源目录
         不重新安装，运行时就还是旧代码 —— 所以这里固定用 --force。

.PARAMETER DshHome
    Harness 数据目录，默认 %APPDATA%\dsh-desktop\harness。

.PARAMETER Profile
    profile 名，默认 web。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-to-profile.ps1
#>
[CmdletBinding()]
param(
    [string]$DshHome = "$env:APPDATA\dsh-desktop\harness",
    [string]$Profile = 'web'
)

$ErrorActionPreference = 'Stop'

$sourceRoot = $PSScriptRoot
$profileDir = Join-Path $DshHome "profiles\$Profile"
$manifestFile = Join-Path $profileDir 'package.json'
$pluginsDir = Join-Path $profileDir 'plugins'

if (-not (Test-Path $manifestFile)) {
    throw "找不到 profile manifest: $manifestFile（DSH Desktop 启动过一次才会有）"
}

$names = Get-ChildItem $sourceRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'package.json') } |
    Select-Object -ExpandProperty Name
if (-not $names) {
    throw "$sourceRoot 下没有可安装的插件目录"
}

Write-Host "目标 profile: $profileDir"
Write-Host "待安装插件: $($names -join ', ')"
Write-Host ''

# 1) 复制源码进 profile。cordis.patch.yml 必须一起过去，否则 profile bundle
#    预检失败，应用会拒绝正常启动并回退 Safe Mode。
New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
foreach ($name in $names) {
    $target = Join-Path $pluginsDir $name
    Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $sourceRoot $name) $target -Recurse -Force
    Write-Host "  已复制 $name -> $target"
}

# 2) 注册：dependencies 用 profile 内路径，dsh.profile.bundles 补上包名。
$manifest = Get-Content $manifestFile -Raw | ConvertFrom-Json
if (-not $manifest.dependencies) { $manifest | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
if (-not $manifest.dsh) { $manifest | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) }
if (-not $manifest.dsh.profile) { $manifest.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) }
if (-not $manifest.dsh.profile.bundles) { $manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() }

# 2a) 摘除已经改名 / 合并掉的插件。只认 file: 依赖（那才是本脚本装的），市场装的
#     第三方插件一律不碰。漏了这一步，旧插件会留在 profile 的 bundles 里继续挂载，
#     侧边栏就会多出几个没人维护的入口。
$stale = @($manifest.dependencies.PSObject.Properties |
    Where-Object { $_.Value -is [string] -and $_.Value.StartsWith('file:') -and $names -notcontains $_.Name })
foreach ($property in $stale) {
    $manifest.dependencies.PSObject.Properties.Remove($property.Name)
    $manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne $property.Name })
    $spec = $property.Value.Substring('file:'.Length)
    if (Test-Path $spec) {
        Remove-Item $spec -Recurse -Force
        Write-Host "  已移除旧插件 $($property.Name) -> $spec"
    } else {
        Write-Host "  已移除旧依赖 $($property.Name)（目录已不存在）"
    }
    # 改名时留下的实体拷贝也要清掉，否则 node_modules 里会一直躺着上一代的代码。
    $orphan = Join-Path $profileDir "node_modules\$($property.Name)"
    if (Test-Path $orphan) {
        Remove-Item $orphan -Recurse -Force
        Write-Host "  已清除旧拷贝 $($property.Name)"
    }
}

foreach ($name in $names) {
    $spec = 'file:' + ((Join-Path $pluginsDir $name) -replace '\\', '/')
    $manifest.dependencies | Add-Member -NotePropertyName $name -NotePropertyValue $spec -Force
    if ($manifest.dsh.profile.bundles -notcontains $name) {
        $manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles) + $name
    }
    Write-Host "  已注册 $name -> $spec"
}
# 必须无 BOM 写：Set-Content -Encoding UTF8 在 Windows PowerShell 5.1 会加 BOM，
# 而 package.json 由 Node 的 JSON.parse 读取，带 BOM 会直接报 "Unexpected token"。
$manifestJson = ($manifest | ConvertTo-Json -Depth 20) + "`n"
[System.IO.File]::WriteAllText($manifestFile, $manifestJson, [System.Text.UTF8Encoding]::new($false))

# 3) 安装。先删掉 node_modules 里的实体拷贝：pnpm 会按 lockfile 里的 file: 依赖复用
#    store 副本，源目录改了而版本号没变时，连 --force 都可能不重新拷贝，运行时还是旧
#    代码（2026-10-14 实测：修完 bug 重装后，node_modules 里仍是坏的那一份）。
$staleInstalls = @()
foreach ($name in $names) {
    $installed = Join-Path $profileDir "node_modules\$name"
    if (Test-Path $installed) {
        Remove-Item $installed -Recurse -Force
        $staleInstalls += $name
    }
}
if ($staleInstalls.Count -gt 0) { Write-Host "  已清除旧拷贝: $($staleInstalls -join ', ')" }

# --force 仍然是必须的：pnpm 对 file: 依赖做实体拷贝，不加它不会刷新。
$shimDir = Join-Path $DshHome '.desktop-bin'
if (Test-Path $shimDir) { $env:PATH = "$shimDir;$env:PATH" }

Push-Location $profileDir
try {
    Write-Host ''
    Write-Host '运行 pnpm install --force ...'
    pnpm install --workspace-root --force
    if ($LASTEXITCODE -ne 0) { throw "pnpm 退出码 $LASTEXITCODE" }
} finally {
    Pop-Location
}

# 4) 自检：确认 patch 文件真的进了 node_modules，否则运行时会报 overlay ENOENT。
Write-Host ''
$missing = @()
foreach ($name in $names) {
    $installed = Join-Path $profileDir "node_modules\$name\cordis.patch.yml"
    if (Test-Path $installed) {
        Write-Host "  OK   $name 已就位"
    } else {
        $missing += $name
        Write-Host "  FAIL $name 缺少 cordis.patch.yml"
    }
}
if ($missing.Count -gt 0) {
    throw "以下插件未正确安装: $($missing -join ', ')"
}

Write-Host ''
Write-Host '完成。重启 DSH Desktop 后可用以下路由自检：'
Write-Host '  /dsh-desktop/usage-stats/summary   综合平台 › 用量统计'
Write-Host '  /dsh-desktop/shell/archive.list    综合平台 › 归档历史'