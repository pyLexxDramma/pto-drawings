$ErrorActionPreference = "Stop"

# Локальный production на 8080 (без CloudPub).
# Разработка: npm run dev → http://localhost:3000
# Прод для команды: Timeweb VPS, автодеплой с GitHub.

$AppDir = if ($env:PTO_APP_DIR) { $env:PTO_APP_DIR } else { "D:\PTO\pto-app" }
$Port = 8080
$Logs = Join-Path $AppDir "logs"
$PidFile = Join-Path $Logs "pto.pid"
$NextJs = Join-Path $AppDir "node_modules\next\dist\bin\next"
$SkipBuild = ($env:PTO_SKIP_BUILD -eq "1")

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
  Get-CimInstance Win32_Process -Filter "name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine -match [regex]::Escape($AppDir) -and $_.CommandLine -match "next" -and $_.CommandLine -match "-p $ListenPort") {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
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

node ./scripts/init-env.mjs
if ($LASTEXITCODE -ne 0) { throw "init-env failed" }

Write-Host "Stop port $Port"
Stop-Port -ListenPort $Port
Start-Sleep -Seconds 2

if (-not $SkipBuild) {
  Write-Host "Build production"
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
} elseif (-not (Test-Path (Join-Path $AppDir ".next\BUILD_ID"))) {
  Write-Host "No build found, building"
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
}

Write-Host "Start next start on $Port"
$cmd = "cmd.exe /c `"node `"$NextJs`" start -H 0.0.0.0 -p $Port > `"$Logs\pto.out.log`" 2> `"$Logs\pto.err.log`"`""
$created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = $cmd
  CurrentDirectory = $AppDir
}
if ($created.ReturnValue -ne 0) {
  throw "Failed to start next: $($created.ReturnValue)"
}
Set-Content -Path $PidFile -Value $created.ProcessId

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  if (Test-PortReady -ListenPort $Port) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) {
  if (Test-Path "$Logs\pto.err.log") { Get-Content "$Logs\pto.err.log" -Tail 40 }
  throw "next did not start on $Port"
}

Write-Host "Local production: http://127.0.0.1:$Port"
Write-Host "Dev: npm run dev → http://localhost:3000"
Write-Host "Team URL: http://201.24.50.177 (Timeweb VPS, auto-deploy from GitHub)"
