$ErrorActionPreference = "Stop"

function Assert-Ok {
  param([string]$Step)
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE"
  }
}

$AppDir = if ($env:PTO_APP_DIR) { $env:PTO_APP_DIR } else { Split-Path -Parent $PSScriptRoot }
$Port = 8080
$Logs = Join-Path $AppDir "logs"
$PidFile = Join-Path $Logs "pto.pid"
$OutLog = Join-Path $Logs "pto.out.log"
$ErrLog = Join-Path $Logs "pto.err.log"
$Clo = "D:\PTO\tools\clo\clo.exe"

Set-Location $AppDir
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

Write-Host "Pull $AppDir"
git fetch origin
Assert-Ok "git fetch"
git checkout main
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

Write-Host "Install and build"
npm ci --no-audit --no-fund
Assert-Ok "npm ci"
npm run build
Assert-Ok "npm run build"

Write-Host "Start on port $Port"

$nextJs = Join-Path $AppDir "node_modules\next\dist\bin\next"
$created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = "node `"$nextJs`" start -H 0.0.0.0 -p $Port"
  CurrentDirectory = $AppDir
}
if ($created.ReturnValue -ne 0) {
  throw "Failed to start PTO process: $($created.ReturnValue)"
}
Set-Content -Path $PidFile -Value $created.ProcessId

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:$Port" -UseBasicParsing -TimeoutSec 2
    if ($res.StatusCode -ge 200) { $ready = $true; break }
  } catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $ready) {
  if (Test-Path $ErrLog) { Get-Content $ErrLog }
  throw "PTO did not start on port $Port"
}

Write-Host "Local: http://127.0.0.1:$Port"

if (-not (Test-Path $Clo)) {
  Write-Host "CloudPub CLI not found at $Clo"
  exit 0
}

$cloRunning = Get-Process clo -ErrorAction SilentlyContinue
if ($cloRunning) {
  Write-Host "CloudPub already running"
} else {
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "`"$Clo`" publish --name pto-drawings http $Port"
    CurrentDirectory = "D:\PTO\tools\clo"
  } | Out-Null
  Write-Host "CloudPub started"
}
