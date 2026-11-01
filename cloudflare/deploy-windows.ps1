# Horanov Store v0.4 - Windows PowerShell 5.1+
# Deploys a NEW worker + a NEW D1 DB, never deletes old resources.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
function Assert-Exit($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed ($LASTEXITCODE)" } }
function Write-Step($text) { Write-Host "`n$text" -ForegroundColor Cyan }

Write-Host "`n=== HORANOV STORE v0.4 - NEW CLOUDFLARE WORKER ===" -ForegroundColor Cyan
Write-Host 'Target hostname: store.horanov.com'
Write-Host 'No existing Workers or D1 databases will be deleted.'
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js 22+ and npm are required.' }

Write-Step '[1/5] Installing server dependencies'
& npm.cmd install --no-audit --no-fund
Assert-Exit 'npm install'

Write-Step '[2/5] Cloudflare authentication'
& npx.cmd wrangler whoami
if ($LASTEXITCODE -ne 0) {
  & npx.cmd wrangler login
  Assert-Exit 'wrangler login'
}

Write-Step '[3/5] Setting up a NEW D1 database'
$configPath = Join-Path $PSScriptRoot 'wrangler.jsonc'
$config = [System.IO.File]::ReadAllText($configPath)
$match = [regex]::Match($config, '"database_id"\s*:\s*"([^"]+)"')
if (-not $match.Success) { throw 'Missing database_id in wrangler.jsonc' }
$dbId = $match.Groups[1].Value
$uuid = '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
if ($dbId -notmatch $uuid) {
  $output = (& npx.cmd wrangler d1 create horanov-store-v04-db 2>&1 | Out-String)
  Write-Host $output
  Assert-Exit 'D1 create'
  $found = [regex]::Match($output, 'database_id\s*[:=]\s*["'']?([a-fA-F0-9-]{36})')
  if ($found.Success) { $dbId = $found.Groups[1].Value }
  else { $dbId = (Read-Host 'Paste the new database_id UUID shown above').Trim() }
  if ($dbId -notmatch $uuid) { throw 'Invalid database UUID. Check Cloudflare dashboard.' }
  Copy-Item -LiteralPath $configPath -Destination "$configPath.bak" -Force
  $config = $config.Substring(0, $match.Groups[1].Index) + $dbId + $config.Substring($match.Groups[1].Index + $match.Groups[1].Length)
  [System.IO.File]::WriteAllText($configPath, $config, ([System.Text.UTF8Encoding]::new($false)))
  Write-Host 'Saved new D1 UUID to wrangler.jsonc.' -ForegroundColor Green
} else { Write-Host 'Existing v0.4 database UUID detected. Skipping database creation.' }

Write-Step '[4/5] Apply D1 migration and deploy the NEW Worker'
& npm.cmd run db:remote
Assert-Exit 'D1 migration'
Write-Host 'Custom domain: store.horanov.com. Cloudflare zone must be active and the hostname must not have a conflicting CNAME.' -ForegroundColor Yellow
& npm.cmd run deploy
Assert-Exit 'wrangler deploy'

Write-Step '[5/5] Set up secret ADMIN_TOKEN'
$answer = (Read-Host 'Generate a NEW admin token? [Y/N] (Y for first deployment)').Trim().ToUpperInvariant()
if ($answer -eq 'Y') {
  $bytes = New-Object 'byte[]' 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $secret = [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  Write-Host '`nSAVE THIS IN YOUR PASSWORD MANAGER; DO NOT SEND IT IN CHAT:' -ForegroundColor Yellow
  Write-Host $secret -ForegroundColor Yellow
  $secret | & npx.cmd wrangler secret put ADMIN_TOKEN
  Assert-Exit 'ADMIN_TOKEN setup'
  Remove-Variable secret
} else {
  Write-Host 'Secret unchanged. If no ADMIN_TOKEN exists, /admin will not be usable.' -ForegroundColor Yellow
}
Write-Host "`nREADY. Check https://store.horanov.com/api/health, then https://store.horanov.com/admin" -ForegroundColor Green
Write-Host 'If the custom domain fails, verify horanov.com is an active Cloudflare zone and that store.horanov.com has no conflicting DNS CNAME.'
