$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $PSScriptRoot
$Port = 8080
$Logs = Join-Path $AppDir "logs"
$PidFile = Join-Path $Logs "pto.pid"
$OutLog = Join-Path $Logs "pto.out.log"
$CloDir = "D:\PTO\tools\clo"
$Clo = Join-Path $CloDir "clo.exe"

Set-Location $AppDir
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

Write-Host "Pull $AppDir"
git fetch origin
git checkout main
git pull origin main

Write-Host "Install and build"
npm ci
npm run build

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

Write-Host "Restart on port $Port"
Stop-Port -ListenPort $Port
Start-Sleep -Seconds 1

$env:PORT = "$Port"
$env:HOSTNAME = "0.0.0.0"
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run start" -WorkingDirectory $AppDir -PassThru -WindowStyle Hidden -RedirectStandardOutput $OutLog -RedirectStandardError (Join-Path $Logs "pto.err.log")
Set-Content -Path $PidFile -Value $proc.Id

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
  throw "PTO did not start on port $Port"
}

Write-Host "Local: http://127.0.0.1:$Port"

if (-not (Test-Path $Clo)) {
  Write-Host "CloudPub CLI not found at $Clo"
  exit 0
}

& $Clo publish --name pto-drawings http $Port
if ($LASTEXITCODE -ne 0) {
  Write-Host "CloudPub publish failed. Run: $Clo login YOUR@EMAIL"
  & $Clo ls
}
