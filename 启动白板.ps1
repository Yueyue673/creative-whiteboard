$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$port = if ($env:CREATIVE_BOARD_PORT) { $env:CREATIVE_BOARD_PORT } else { '18746' }
Write-Host "启动后请打开 http://127.0.0.1:$port/ ，关闭这个终端即可停止服务。"
if (Get-Command py -ErrorAction SilentlyContinue) { & py -3 (Join-Path $PSScriptRoot 'server.py') }
elseif (Get-Command python -ErrorAction SilentlyContinue) { & python (Join-Path $PSScriptRoot 'server.py') }
else { throw '未找到 Python。请安装 Python 3.10 或更新版本后重试。' }
