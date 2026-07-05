# Builds the SPA with the deployed API base URL and publishes it to Azure Static Web Apps.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$res = Get-Content (Join-Path $PSScriptRoot 'azure-resources.json') -Raw | ConvertFrom-Json
$token = (Get-Content (Join-Path $root '.secrets\swa-deploy-token.txt') -Raw).Trim()

Write-Host "== Building frontend (VITE_API_BASE = $($res.functionAppUrl)/api)"
Push-Location $root
try {
  $env:VITE_API_BASE = "$($res.functionAppUrl)/api"
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
} finally {
  Remove-Item Env:VITE_API_BASE -ErrorAction SilentlyContinue
  Pop-Location
}

Write-Host "== Deploying dist/ to $($res.staticWebAppUrl)"
Push-Location $root
try {
  npx --yes @azure/static-web-apps-cli@2 deploy ./dist --deployment-token $token --env production
  if ($LASTEXITCODE -ne 0) { throw "swa deploy failed" }
} finally { Pop-Location }
Write-Host "== Done: $($res.staticWebAppUrl)"
