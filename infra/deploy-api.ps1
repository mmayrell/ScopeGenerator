# Builds and zip-deploys the Functions backend (api/) to the provisioned Function App.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$res = Get-Content (Join-Path $PSScriptRoot 'azure-resources.json') -Raw | ConvertFrom-Json

Write-Host "== Building api/"
Push-Location (Join-Path $root 'api')
try {
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
} finally { Pop-Location }

Write-Host "== Staging deployment package"
$staging = Join-Path $env:TEMP "scopegen-api-deploy"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force $staging | Out-Null
foreach ($item in @('host.json', 'package.json', 'package-lock.json', 'dist', 'assets')) {
  $src = Join-Path $root "api\$item"
  if (Test-Path $src) { Copy-Item $src -Destination $staging -Recurse }
}
Push-Location $staging
try {
  npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci --omit=dev failed in staging" }
} finally { Pop-Location }

$zip = Join-Path $env:TEMP "scopegen-api.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip

Write-Host "== Deploying to $($res.functionApp)"
az functionapp deployment source config-zip -g $res.resourceGroup -n $res.functionApp --src $zip --timeout 600 -o none
Write-Host "== Done: $($res.functionAppUrl)/api/health"
