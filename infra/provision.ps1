# Provisions all Azure resources for ScopeGenerator.
# Idempotent-ish: safe to re-run; reuses the suffix recorded in infra/azure-resources.json if present.
# Outputs: infra/azure-resources.json (names/urls), .secrets/access-code.txt, .secrets/swa-deploy-token.txt

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$location = 'eastus2'
$rg = 'scopegen-rg'
$swaName = 'scopegen-web'
$resourcesPath = Join-Path $PSScriptRoot 'azure-resources.json'
$secretsDir = Join-Path $root '.secrets'
New-Item -ItemType Directory -Force $secretsDir | Out-Null

if (Test-Path $resourcesPath) {
  $existing = Get-Content $resourcesPath -Raw | ConvertFrom-Json
  $suffix = $existing.suffix
} else {
  $suffix = -join ((48..57) + (97..122) | Get-Random -Count 5 | ForEach-Object { [char]$_ })
}
$storage = "scopegenst$suffix"
$funcApp = "scopegen-api-$suffix"

Write-Host "== Resource group $rg ($location)"
az group create -n $rg -l $location -o none

Write-Host "== Storage account $storage"
az storage account create -n $storage -g $rg -l $location --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false -o none
$conn = az storage account show-connection-string -n $storage -g $rg --query connectionString -o tsv

Write-Host "== Tables, queue, containers"
az storage table create --name entities --connection-string $conn -o none
az storage table create --name jobs --connection-string $conn -o none
az storage queue create --name genjobs --connection-string $conn -o none
az storage queue create --name 'genjobs-poison' --connection-string $conn -o none
az storage container create --name data --connection-string $conn -o none
az storage container create --name uploads --connection-string $conn -o none

Write-Host "== Function App $funcApp (consumption, Node)"
$created = $false
try {
  az functionapp create -g $rg -n $funcApp --storage-account $storage --consumption-plan-location $location --runtime node --runtime-version 22 --functions-version 4 --os-type Windows -o none
  $created = $true
} catch {}
if (-not $created) {
  Write-Host "   Node 22 rejected; retrying with Node 20"
  az functionapp create -g $rg -n $funcApp --storage-account $storage --consumption-plan-location $location --runtime node --runtime-version 20 --functions-version 4 --os-type Windows -o none
}

Write-Host "== Static Web App $swaName (Free)"
az staticwebapp create -n $swaName -g $rg -l $location --sku Free -o none
$swaHost = az staticwebapp show -n $swaName -g $rg --query defaultHostname -o tsv
$swaToken = az staticwebapp secrets list -n $swaName -g $rg --query properties.apiKey -o tsv
Set-Content -Path (Join-Path $secretsDir 'swa-deploy-token.txt') -Value $swaToken -Encoding ascii

Write-Host "== Access code + app settings"
$accessCodePath = Join-Path $secretsDir 'access-code.txt'
if (Test-Path $accessCodePath) {
  $accessCode = (Get-Content $accessCodePath -Raw).Trim()
} else {
  $chunk = { -join ((48..57) + (97..122) | Get-Random -Count 4 | ForEach-Object { [char]$_ }) }
  $accessCode = "scope-$(& $chunk)-$(& $chunk)"
  Set-Content -Path $accessCodePath -Value $accessCode -Encoding ascii
}
az functionapp config appsettings set -g $rg -n $funcApp --settings "APP_ACCESS_CODE=$accessCode" "CLAUDE_MODEL=claude-fable-5" -o none

Write-Host "== CORS"
az functionapp cors add -g $rg -n $funcApp --allowed-origins "https://$swaHost" "http://localhost:5173" -o none

$out = [ordered]@{
  suffix           = $suffix
  resourceGroup    = $rg
  location         = $location
  storageAccount   = $storage
  functionApp      = $funcApp
  functionAppUrl   = "https://$funcApp.azurewebsites.net"
  staticWebApp     = $swaName
  staticWebAppUrl  = "https://$swaHost"
}
$out | ConvertTo-Json | Set-Content -Path $resourcesPath -Encoding utf8
Write-Host "== Done. Resources written to $resourcesPath"
Write-Host ("   Web:  https://{0}" -f $swaHost)
Write-Host ("   API:  https://{0}.azurewebsites.net" -f $funcApp)
Write-Host ("   Access code: {0}" -f $accessCode)
