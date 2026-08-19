$ErrorActionPreference = "Stop"

# Один процесс: localhost:8080 = CloudPub. Правки в pto-app → HMR сразу и локально, и на туннеле.

$AppDir = "D:\PTO\pto-app"
$Port = 8080
$Logs = Join-Path $AppDir "logs"
$PidFile = Join-Path $Logs "pto.pid"
$Clo = "D:\PTO\tools\clo\clo.exe"
$NextJs = Join-Path $AppDir "node_modules\next\dist\bin\next"

Set-Location $AppDir
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

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

function Test-PortReady {
  param([int]$ListenPort)
  try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:$ListenPort" -UseBasicParsing -TimeoutSec 2
    return ($res.StatusCode -ge 200)
  } catch {
    return $false
  }
}

if (-not (Test-Path $NextJs)) {
  Write-Host "npm install"
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
}

$already = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
$needStart = $true
if ($already) {
  # Если уже крутится next из pto-app — не трогаем
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($already[0].OwningProcess)" -ErrorAction SilentlyContinue
  if ($proc -and $proc.CommandLine -match [regex]::Escape($AppDir) -and $proc.CommandLine -match "next") {
    Write-Host "Already serving $AppDir on $Port (pid $($already[0].OwningProcess))"
    $needStart = $false
  } else {
    Write-Host "Stop foreign process on $Port"
    Stop-Port -ListenPort $Port
    Start-Sleep -Seconds 2
  }
}

if ($needStart) {
  # Снять чужой next dev по этому каталогу (lock в .next)
  Get-CimInstance Win32_Process -Filter "name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine -match [regex]::Escape($AppDir) -and $_.CommandLine -match "next") {
      Write-Host "Stop existing next pid $($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 1

  Write-Host "Start next dev on $Port"
  $cmd = "cmd.exe /c `"node `"$NextJs`" dev --webpack -H 0.0.0.0 -p $Port > `"$Logs\pto.out.log`" 2> `"$Logs\pto.err.log`"`""
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmd
    CurrentDirectory = $AppDir
  }
  if ($created.ReturnValue -ne 0) {
    throw "Failed to start next: $($created.ReturnValue)"
  }
  Set-Content -Path $PidFile -Value $created.ProcessId

  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    if (Test-PortReady -ListenPort $Port) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    if (Test-Path "$Logs\pto.err.log") { Get-Content "$Logs\pto.err.log" -Tail 40 }
    throw "next did not start on $Port"
  }
}

Write-Host "Local + CloudPub origin: http://127.0.0.1:$Port"

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
