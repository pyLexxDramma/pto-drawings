$ErrorActionPreference = "Stop"
$AppDir = "D:\PTO\pto-prod"
$Port = 8080
$Clo = "D:\PTO\tools\clo\clo.exe"
$NextJs = Join-Path $AppDir "node_modules\next\dist\bin\next"

function Test-Port {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return [bool]$conn
}

if (-not (Test-Port)) {
  if (-not (Test-Path $NextJs)) {
    throw "PTO prod is not built. Run GitHub deploy first."
  }
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "node `"$NextJs`" start -H 0.0.0.0 -p $Port"
    CurrentDirectory = $AppDir
  } | Out-Null
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-Port) { break }
    Start-Sleep -Seconds 1
  }
}

$cloRunning = Get-Process clo -ErrorAction SilentlyContinue
if (-not $cloRunning) {
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "`"$Clo`" publish --name pto-drawings http $Port"
    CurrentDirectory = "D:\PTO\tools\clo"
  } | Out-Null
}
