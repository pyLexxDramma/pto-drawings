$ErrorActionPreference = "Stop"

function Assert-Ok {
  param([string]$Step)
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE"
  }
}

# CloudPub = production build на 8080
$AppDir = if ($env:PTO_APP_DIR) { $env:PTO_APP_DIR } else { "D:\PTO\pto-app" }

Set-Location $AppDir

Write-Host "Pull $AppDir"
git fetch origin
Assert-Ok "git fetch"
git checkout main
Assert-Ok "git checkout"
git pull origin main
Assert-Ok "git pull"

Write-Host "Install deps"
npm ci --no-audit --no-fund
Assert-Ok "npm ci"

$env:PTO_APP_DIR = $AppDir
Remove-Item Env:PTO_SKIP_BUILD -ErrorAction SilentlyContinue
powershell -ExecutionPolicy Bypass -File (Join-Path $AppDir "scripts\serve-live.ps1")
Assert-Ok "serve-live"

Write-Host "Deployed production CloudPub: http://127.0.0.1:8080"
