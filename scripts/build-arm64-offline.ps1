param(
  [string]$OutputDirectory = "release/requirements-manager-arm64-offline",
  [string]$ComposeVersion = "v2.39.2",
  [string]$HostProxyUrl = "",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RepositoryRoot = (Resolve-Path (Join-Path $ProjectRoot "..")).Path
$OutputPath = Join-Path $ProjectRoot $OutputDirectory
$ImagesArchive = Join-Path $OutputPath "requirements-manager-arm64-images.tar"
$BundleArchive = "$OutputPath.tar.gz"
$BuildProxyArguments = @()

if ($HostProxyUrl) {
  $env:HTTP_PROXY = $HostProxyUrl
  $env:HTTPS_PROXY = $HostProxyUrl
  $ContainerProxyUrl = $HostProxyUrl -replace '127\.0\.0\.1', 'host.docker.internal' -replace 'localhost', 'host.docker.internal'
  $BuildProxyArguments = @(
    "--build-arg", "HTTP_PROXY=$ContainerProxyUrl",
    "--build-arg", "HTTPS_PROXY=$ContainerProxyUrl"
  )
}

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "命令执行失败：$Command $($Arguments -join ' ')"
  }
}

function Invoke-Download([string]$Uri, [string]$Destination, [string]$ProxyUrl = "") {
  $Arguments = @(
    "--fail",
    "--location",
    "--retry", "8",
    "--retry-delay", "3",
    "--retry-all-errors",
    "--continue-at", "-",
    "--output", $Destination
  )
  if ($ProxyUrl) {
    $Arguments += @("--proxy", $ProxyUrl)
  }
  $Arguments += $Uri
  Invoke-Checked "curl.exe" $Arguments
}

Write-Host "检查Docker Buildx..."
Invoke-Checked "docker" @("buildx", "version")

if (-not $SkipBuild) {
  Write-Host "构建ARM64 API镜像..."
  Invoke-Checked "docker" (@("buildx", "build", "--platform", "linux/arm64", "--load") + $BuildProxyArguments + @("--target", "api", "-t", "requirements-manager-api:arm64", "-f", (Join-Path $ProjectRoot "docker/app.Dockerfile"), $ProjectRoot))

  Write-Host "构建ARM64 Worker镜像..."
  Invoke-Checked "docker" (@("buildx", "build", "--platform", "linux/arm64", "--load") + $BuildProxyArguments + @("--target", "worker", "-t", "requirements-manager-worker:arm64", "-f", (Join-Path $ProjectRoot "docker/app.Dockerfile"), $ProjectRoot))

  Write-Host "构建ARM64 Web镜像..."
  Invoke-Checked "docker" (@("buildx", "build", "--platform", "linux/arm64", "--load") + $BuildProxyArguments + @("--target", "web", "-t", "requirements-manager-web:arm64", "-f", (Join-Path $ProjectRoot "docker/app.Dockerfile"), $ProjectRoot))

  Write-Host "构建ARM64 OpenCode镜像..."
  Invoke-Checked "docker" (@("buildx", "build", "--platform", "linux/arm64", "--load") + $BuildProxyArguments + @("-t", "requirements-manager-opencode:arm64", "-f", (Join-Path $ProjectRoot "docker/opencode.Dockerfile"), $RepositoryRoot))
}

$ThirdPartyImageDefinitions = @(
  @{ Source = "postgres:16-alpine"; Target = "requirements-manager-postgres:arm64" },
  @{ Source = "redis:7-alpine"; Target = "requirements-manager-redis:arm64" },
  @{ Source = "minio/minio:RELEASE.2025-04-22T22-12-26Z"; Target = "requirements-manager-minio:arm64" }
)
foreach ($Definition in $ThirdPartyImageDefinitions) {
  Write-Host "构建ARM64基础镜像：$($Definition.Source) -> $($Definition.Target)"
  Invoke-Checked "docker" (@(
    "buildx", "build",
    "--platform", "linux/arm64",
    "--load",
    "--build-arg", "BASE_IMAGE=$($Definition.Source)",
    "-t", $Definition.Target,
    "-f", (Join-Path $ProjectRoot "docker/third-party.Dockerfile"),
    $ProjectRoot
  ))
}

$ApplicationImages = @(
  "requirements-manager-api:arm64",
  "requirements-manager-worker:arm64",
  "requirements-manager-web:arm64",
  "requirements-manager-opencode:arm64"
)
$ThirdPartyImages = $ThirdPartyImageDefinitions | ForEach-Object { $_.Target }
$AllImages = $ApplicationImages + $ThirdPartyImages
foreach ($Image in $AllImages) {
  $Architecture = (& docker image inspect $Image --format "{{.Architecture}}" 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or $Architecture -ne "arm64") {
    throw "镜像不是ARM64架构或不存在：$Image（检测结果：$Architecture）"
  }
}

Write-Host "验证ARM64 OpenCode镜像中的Node Phase 2 runner..."
$OpenCodeImage = "requirements-manager-opencode:arm64"
Invoke-Checked "docker" @(
  "run", "--rm", "--platform", "linux/arm64", "--entrypoint", "node",
  $OpenCodeImage, "-e", "console.log(process.arch, 'node runtime ok')"
)
Invoke-Checked "docker" @(
  "run", "--rm", "--platform", "linux/arm64", "--entrypoint", "sh", $OpenCodeImage, "-lc",
  "test -s /plugin/dist/direct-phase2-runner.js && ! grep -aEq 'Bun\.(serve|file|Glob)|import\.meta\.dir' /plugin/dist/direct-phase2-runner.js"
)

$RunnerCheckContainer = "requirements-manager-opencode-arm64-check-$PID"
try {
  $ContainerId = (& docker run -d --platform linux/arm64 --name $RunnerCheckContainer `
    -e OPENCODE_SERVER_USERNAME=opencode `
    -e OPENCODE_SERVER_PASSWORD=runner-check `
    -e PROJECTS_ROOT=/data/projects `
    -e MATRIX_PHASE2_RUNNER_PORT=4097 `
    $OpenCodeImage opencode serve --hostname 0.0.0.0 --port 4096 --print-logs --log-level INFO).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $ContainerId) {
    throw "无法启动ARM64 OpenCode镜像验证容器"
  }
  $Healthy = $false
  for ($Attempt = 1; $Attempt -le 60; $Attempt++) {
    # 服务启动期间健康检查失败是预期状态。让容器内的shell吞掉探测输出，
    # 避免Windows PowerShell把Node的stderr升级为NativeCommandError并提前终止轮询。
    & docker exec $RunnerCheckContainer sh -c "node /usr/local/bin/opencode-healthcheck.mjs >/dev/null 2>&1"
    if ($LASTEXITCODE -eq 0) {
      $Healthy = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $Healthy) {
    & docker logs $RunnerCheckContainer
    throw "ARM64 OpenCode或Phase 2 runner健康检查失败"
  }
  Write-Host "ARM64 Node Phase 2 runner健康检查通过"
} finally {
  & docker rm -f $RunnerCheckContainer *> $null
}

if (Test-Path $OutputPath) {
  Remove-Item $OutputPath -Recurse -Force
}
New-Item $OutputPath -ItemType Directory | Out-Null
New-Item (Join-Path $OutputPath "bin") -ItemType Directory | Out-Null
New-Item (Join-Path $OutputPath "data/opencode-config") -ItemType Directory -Force | Out-Null

Copy-Item (Join-Path $ProjectRoot "docker-compose.offline-arm64.yml") (Join-Path $OutputPath "docker-compose.yml")
Copy-Item (Join-Path $ProjectRoot ".env.offline.example") (Join-Path $OutputPath ".env.example")
Copy-Item (Join-Path $ProjectRoot "offline/opencode.json.example") (Join-Path $OutputPath "data/opencode-config/opencode.json.example")
Copy-Item (Join-Path $ProjectRoot "offline/*.sh") $OutputPath
Copy-Item (Join-Path $ProjectRoot "offline/README-OFFLINE.md") $OutputPath

$ComposeUrl = "https://github.com/docker/compose/releases/download/$ComposeVersion/docker-compose-linux-aarch64"
$ComposePath = Join-Path $OutputPath "bin/docker-compose"
Write-Host "下载ARM64 Docker Compose：$ComposeVersion"
Invoke-Download $ComposeUrl $ComposePath $HostProxyUrl

Write-Host "导出ARM64镜像归档，文件可能较大..."
Invoke-Checked "docker" (@("image", "save", "-o", $ImagesArchive) + $AllImages)

$IntegrityFiles = @(
  "requirements-manager-arm64-images.tar",
  "bin/docker-compose",
  "docker-compose.yml",
  ".env.example",
  "data/opencode-config/opencode.json.example",
  "README-OFFLINE.md"
) + (Get-ChildItem $OutputPath -Filter "*.sh" -File | ForEach-Object { $_.Name })
$IntegrityLines = $IntegrityFiles |
  Sort-Object -Unique |
  ForEach-Object {
    $AbsolutePath = Join-Path $OutputPath $_
    $Hash = (Get-FileHash $AbsolutePath -Algorithm SHA256).Hash.ToLowerInvariant()
    "$Hash  $($_ -replace '\\', '/')"
  }
$Sha256SumsPath = Join-Path $OutputPath "SHA256SUMS"
# The bundle is consumed by GNU sha256sum on Linux. PowerShell's Set-Content
# uses the host platform newline, so packages built on Windows used to contain
# CRLF here and sha256sum treated the trailing CR as part of every filename.
# Write the manifest as ASCII with explicit Unix LF line endings instead.
$Sha256SumsContent = ($IntegrityLines -join "`n") + "`n"
[System.IO.File]::WriteAllText(
  $Sha256SumsPath,
  $Sha256SumsContent,
  [System.Text.Encoding]::ASCII
)

$Sha256SumsBytes = [System.IO.File]::ReadAllBytes($Sha256SumsPath)
if ($Sha256SumsBytes -contains 13) {
  throw "SHA256SUMS包含CR字符，无法生成Linux离线包"
}

$Manifest = [ordered]@{
  generatedAt = (Get-Date).ToString("o")
  platform = "linux/arm64"
  composeVersion = $ComposeVersion
  externalPort = 8089
  images = $AllImages
}
$Manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $OutputPath "manifest.json") -Encoding utf8

if (Test-Path $BundleArchive) {
  Remove-Item $BundleArchive -Force
}
Invoke-Checked "tar" @("-czf", $BundleArchive, "-C", (Split-Path $OutputPath -Parent), (Split-Path $OutputPath -Leaf))

Write-Host "离线部署目录已生成：$OutputPath" -ForegroundColor Green
Write-Host "可交付压缩包已生成：$BundleArchive" -ForegroundColor Green

