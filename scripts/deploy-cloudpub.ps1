$ErrorActionPreference = "Stop"

function Assert-Ok {
  param([string]$Step)
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE"
  }
}

# Прод = живой next dev из pto-app (тот же процесс, что и локально).
$AppDir = if ($env:PTO_APP_DIR) { $env:PTO_APP_DIR } else { "D:\PTO\pto-app" }
$Port = 8080
$Logs = Join-Path $AppDir "logs"
$PidFile = Join-Path $Logs "pto.pid"
$Clo = "D:\PTO\tools\clo\clo.exe"

Set-Location $AppDir
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

Write-Host "Pull $AppDir"
git fetch origin
Assert-Ok "git fetch"
git checkout main
Assert-Ok "git checkout"
git pull origin main
Assert-Ok "git pull"

function Stop-Port {
  param([int]$ListenPort)
  $conns = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue
  foreach ($conn in $conns) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $PidFile) {
    $oldPid = Get-Content $PidFile | Select-Object -First 1
    if ($oldPid) {
      Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Stop port $Port"
Stop-Port -ListenPort $Port
Start-Sleep -Seconds 2

Write-Host "Install deps"
npm ci --no-audit --no-fund
Assert-Ok "npm ci"

$env:PTO_APP_DIR = $AppDir
powershell -ExecutionPolicy Bypass -File (Join-Path $AppDir "scripts\serve-live.ps1")
Assert-Ok "serve-live"

Write-Host "Deployed live: http://127.0.0.1:$Port (+ CloudPub)"
if (-not (Test-Path $Clo)) {
  Write-Host "CloudPub CLI not found at $Clo"
}
