$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$tools = Join-Path $env:LOCALAPPDATA "dev-tools"
$env:PATH = "$(Join-Path $tools 'MinGit\cmd');$(Join-Path $tools 'bin');$(Join-Path $tools 'node-v22.20.0-win-x64');" + $env:PATH

Set-Location $root

gh auth status
if ($LASTEXITCODE -ne 0) {
  Write-Host "GitHub CLI is not logged in. Run:"
  Write-Host "  gh auth login --hostname github.com --git-protocol https --web"
  exit 1
}

$ErrorActionPreference = "Continue"
$user = gh api user --jq .login
$repo = "calorie-tracker"
$full = "$user/$repo"

gh repo view $full *> $null
if ($LASTEXITCODE -ne 0) {
  gh repo create $repo --public --source=. --remote=origin
}

# Pages must be on before the first push, or the first deploy fails.
gh api -X POST "repos/$full/pages" -f build_type=workflow *> $null
if ($LASTEXITCODE -ne 0) {
  gh api -X PUT "repos/$full/pages" -f build_type=workflow
}

git push -u origin main

Write-Host ""
Write-Host "Repo: https://github.com/$full"
Write-Host "Live site after the Actions deploy finishes:"
Write-Host "  https://$user.github.io/$repo/"
