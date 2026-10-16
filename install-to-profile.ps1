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

.PARAMETER Plugin
    只装/更新这几个插件，默认本目录下全部。别人克隆这个仓库时通常只需要
    dsh-comprehensive-platform：另一个（dsh-localcoding-mcp）要本机有编译好的
    LocalCodingMCP.exe，仓库里没有，缺它跑起来是坏的。

.PARAMETER SkipPnpm
    只做复制与注册，不跑 pnpm install。用来在没装 pnpm 的机器上先看清单；
    少了这一步 node_modules 里不会刷新，运行时会加载旧代码。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-to-profile.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-to-profile.ps1 -Plugin dsh-comprehensive-platform
#>
[CmdletBinding()]
param(
    [string]$DshHome = "$env:APPDATA\dsh-desktop\harness",
    [string]$Profile = 'web',
    [string[]]$Plugin = @(),
    [switch]$SkipPnpm
)

$ErrorActionPreference = 'Stop'

$sourceRoot = $PSScriptRoot
$profileDir = Join-Path $DshHome "profiles\$Profile"
$manifestFile = Join-Path $profileDir 'package.json'
$pluginsDir = Join-Path $profileDir 'plugins'

if (-not (Test-Path $manifestFile)) {
    throw "找不到 profile manifest: $manifestFile（DSH Desktop 启动过一次才会有）"
}

$pluginDirs = @(
    Get-ChildItem $sourceRoot -Directory -ErrorAction SilentlyContinue
    foreach ($group in 'plugins', 'packages', 'apps') {
        $holder = Join-Path $sourceRoot $group
        if (Test-Path $holder) { Get-ChildItem $holder -Directory -ErrorAction SilentlyContinue }
    }
)
$all = $pluginDirs | Where-Object { Test-Path (Join-Path $_.FullName 'package.json') } |
    Select-Object -ExpandProperty Name
if (-not $all) {
    throw "$sourceRoot 下没有找到插件（根目录与 plugins\packages\apps 下都要有带 package.json 的目录）"
}
# 只装其中一部分时，另一部分**保持原样**：它们同样是本仓库的插件，但这次没让人
# 装它们，脚本就不该替人做决定把它们从 profile 里摘掉。
$names = if ($Plugin) { $Plugin } else { $all }
$unknown = @($names | Where-Object { $all -notcontains $_ })
if ($unknown) {
    throw "本仓库没有这些插件: $($unknown -join ', ')（可选: $($all -join ', ')）"
}

Write-Host "目标 profile: $profileDir"
Write-Host "待安装插件: $($names -join ', ')"
Write-Host ''

# 1) 复制源码进 profile。cordis.patch.yml 必须一起过去，否则 profile bundle
#    预检失败，应用会拒绝正常启动并回退 Safe Mode。
New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
foreach ($name in $names) {
    $source = $pluginDirs | Where-Object { $_.Name -eq $name } | Select-Object -First 1
    if ($null -eq $source) { throw "找不到插件目录: $name" }
    $target = Join-Path $pluginsDir $name
    Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item $source.FullName $target -Recurse -Force
    Write-Host "  已复制 $name -> $target"
}

# 2) 注册：dependencies 用 profile 内路径，dsh.profile.bundles 补上包名。
$manifest = Get-Content $manifestFile -Raw | ConvertFrom-Json
if (-not $manifest.dependencies) { $manifest | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
if (-not $manifest.dsh) { $manifest | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) }
if (-not $manifest.dsh.profile) { $manifest.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) }
if (-not $manifest.dsh.profile.bundles) { $manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() }

# 2a) 摘除已经改名 / 合并掉的插件。只认 file: 依赖（那才是本脚本装的），市场装的
#     第三方插件一律不碰。这次没让装的同仓库插件也不碰 —— 判据是「名字在本仓库里
#     已经不存在」，而不是「这次没被选中」。
$stale = @($manifest.dependencies.PSObject.Properties |
    Where-Object {
        $_.Value -is [string] -and
        $_.Value.StartsWith('file:') -and
        $all -notcontains $_.Name -and
        $names -notcontains $_.Name
    })
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

if ($SkipPnpm) {
    Write-Host ''
    Write-Warning '-SkipPnpm：node_modules 里不会刷新。此时宿主仍在加载旧代码，别把这当成装好了。'
} else {
    # 别人机器上没有 pnpm 是常态，而 pnpm 缺失的报错（command not found）不会告诉
    # 人该怎么办，所以在这里说清楚。
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw "找不到 pnpm。宿主用 pnpm 装 profile 依赖，没有它装不了。装法：corepack enable pnpm，或 npm i -g pnpm；也可以先加 -SkipPnpm 只看清单。"
    }
    Push-Location $profileDir
    try {
        Write-Host ''
        Write-Host '运行 pnpm install --force ...'
        pnpm install --workspace-root --force
        if ($LASTEXITCODE -ne 0) { throw "pnpm 退出码 $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
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