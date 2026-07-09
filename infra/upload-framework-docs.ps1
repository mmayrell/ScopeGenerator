# Uploads (or replaces) the engine/doctrine source PDFs served by
# GET /api/framework-file/{kind}. Run whenever a new edition of either
# document is adopted; update api/src/data/framework.ts in code alongside it.
#
# Usage:
#   .\infra\upload-framework-docs.ps1 -EnginePdf "C:\path\to\spec.pdf" -DoctrinePdf "C:\path\to\stein.pdf"
#   (either parameter may be omitted to leave that document unchanged)
#
# The access code comes from .secrets\access-code.txt, or pass -AccessCode.
# The API base defaults to production; override with -ApiBase for local dev.
param(
  [string]$EnginePdf,
  [string]$DoctrinePdf,
  [string]$AccessCode,
  [string]$ApiBase = 'https://scopegen-api-apvgm.azurewebsites.net/api'
)
$ErrorActionPreference = 'Stop'

if (-not $EnginePdf -and -not $DoctrinePdf) { throw 'Nothing to upload: pass -EnginePdf and/or -DoctrinePdf' }

if (-not $AccessCode) {
  $root = Split-Path -Parent $PSScriptRoot
  $codePath = Join-Path $root '.secrets\access-code.txt'
  if (-not (Test-Path $codePath)) { throw "No -AccessCode given and $codePath not found" }
  $AccessCode = (Get-Content $codePath -Raw).Trim()
}

$targets = @()
if ($EnginePdf) { $targets += @{ kind = 'engine'; path = $EnginePdf } }
if ($DoctrinePdf) { $targets += @{ kind = 'doctrine'; path = $DoctrinePdf } }

foreach ($t in $targets) {
  if (-not (Test-Path $t.path)) { throw "File not found: $($t.path)" }
  $mb = [math]::Round((Get-Item $t.path).Length / 1MB, 1)
  Write-Host "== Uploading $($t.kind) PDF ($mb MB): $($t.path)"
  $resp = Invoke-RestMethod -Method Put -Uri "$ApiBase/framework-file/$($t.kind)" `
    -Headers @{ 'x-access-code' = $AccessCode } -ContentType 'application/pdf' `
    -InFile $t.path -TimeoutSec 600
  Write-Host "   stored ($($resp.size) bytes)"
}
Write-Host '== Done'
