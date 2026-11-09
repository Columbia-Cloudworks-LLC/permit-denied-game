# Start or stop the Vite dev server for the VS Code tasks when VS Code runs on Windows.
# Prefers WSL: a folder opened from \\wsl.localhost\<distro>\... or \\wsl$\<distro>\... hands off
# to scripts/dev-server.sh inside that distro, so Linux node_modules run under Linux Node.
# A native Windows checkout runs natively. Usage: dev-server.ps1 start|stop
param([Parameter(Mandatory = $true)][ValidateSet('start', 'stop')][string]$Action)

$port = if ($env:DEV_SERVER_PORT) { [int]$env:DEV_SERVER_PORT } else { 5173 }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).ProviderPath

if ($root -match '^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)?$') {
  $distro = $Matches[1]
  $linuxRoot = if ($Matches[2]) { $Matches[2] -replace '\\', '/' } else { '/' }
  $env:WSLENV = (@($env:WSLENV, 'DEV_SERVER_PORT') | Where-Object { $_ }) -join ':'
  & wsl.exe -d $distro --cd $linuxRoot -- bash scripts/dev-server.sh $Action
  exit $LASTEXITCODE
}

Set-Location $root
if ($Action -eq 'start') {
  & npm run dev -- --port $port --strictPort
  exit $LASTEXITCODE
}

$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Write-Output "No dev server is running on port $port."
  exit 0
}
$ids = $listening | Select-Object -ExpandProperty OwningProcess -Unique
$ids | ForEach-Object { Stop-Process -Id $_ -Force }
Write-Output "Stopped dev server on port $port (pid $($ids -join ' '))."
