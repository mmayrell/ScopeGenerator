# Reads the Anthropic API key from .secrets/anthropic-key.txt and sets it on the Function App.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$res = Get-Content (Join-Path $PSScriptRoot 'azure-resources.json') -Raw | ConvertFrom-Json
$keyPath = Join-Path $root '.secrets\anthropic-key.txt'

if (-not (Test-Path $keyPath)) {
  Write-Error "Key file not found: $keyPath`nCreate that file containing only the Anthropic API key (sk-ant-...), then re-run this script."
}
$key = (Get-Content $keyPath -Raw).Trim()
if (-not $key.StartsWith('sk-ant-')) {
  Write-Warning "Key does not start with 'sk-ant-' - setting it anyway."
}
az functionapp config appsettings set -g $res.resourceGroup -n $res.functionApp --settings "ANTHROPIC_API_KEY=$key" -o none
Write-Host "== ANTHROPIC_API_KEY set on $($res.functionApp). The app picks it up within a minute."
