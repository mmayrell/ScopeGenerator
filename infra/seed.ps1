# Seeds the deployed backend with the demo content (idempotent unless -Force).
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$res = Get-Content (Join-Path $PSScriptRoot 'azure-resources.json') -Raw | ConvertFrom-Json
$code = (Get-Content (Join-Path $root '.secrets\access-code.txt') -Raw).Trim()

$uri = "$($res.functionAppUrl)/api/ops/seed"
if ($Force) { $uri += '?force=true' }
$resp = Invoke-RestMethod -Method Post -Uri $uri -Headers @{ 'x-access-code' = $code } -TimeoutSec 120
$resp | ConvertTo-Json -Depth 5
