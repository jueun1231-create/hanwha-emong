# ============================================================
#  Hanwha Emong MarketView - one-shot GitHub Pages deploy setup
#  Run:
#    ! powershell -ExecutionPolicy Bypass -File "C:\Users\user\Desktop\scratchpad\hanwha-emong-repo\setup-github.ps1"
#
#  Steps: install git+gh -> gh login (you do this once in browser) ->
#         create repo & push -> enable Pages -> Actions write perm ->
#         first workflow run -> print dashboard URL
# ============================================================
$ErrorActionPreference = 'Continue'   # native tools write to stderr; do not treat as fatal
$repoDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoName = 'hanwha-emong'
Set-Location $repoDir

function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path','User')
}
function Die($msg) { Write-Host ''; Write-Warning $msg; exit 1 }

# 1) install tools --------------------------------------------------------
if (-not (Have git)) {
  Write-Host '[1/6] installing git via winget...' -ForegroundColor Cyan
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements --silent | Out-Null
  RefreshPath
}
if (-not (Have gh)) {
  Write-Host '[1/6] installing GitHub CLI via winget...' -ForegroundColor Cyan
  winget install --id GitHub.cli -e --source winget --accept-package-agreements --accept-source-agreements --silent | Out-Null
  RefreshPath
}
if (-not (Have git) -or -not (Have gh)) {
  Die 'git / gh not on PATH yet. Open a NEW PowerShell window and run this script again.'
}
Write-Host ('[1/6] git {0} / gh {1} ready' -f ((git --version) -replace 'git version ',''), ((gh --version) -split "`n")[0]) -ForegroundColor Green

# 2) login --------------------------------------------------------------
& gh auth status
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '[2/6] GitHub sign-in needed. Enter the code shown at https://github.com/login/device , click Authorize.' -ForegroundColor Yellow
  Write-Host '      (no account? click "Sign up" on that page first, then continue)' -ForegroundColor Yellow
  & gh auth login --hostname github.com --git-protocol https --web --scopes 'repo,workflow'
  if ($LASTEXITCODE -ne 0) { Die 'login not completed. re-run the script after signing in.' }
}

# 2b) make sure the token carries the 'workflow' scope (required to push .github/workflows/*)
$scopeOk = (& gh api -i user 2>$null | Select-String -Pattern 'x-oauth-scopes:.*workflow' -Quiet)
if (-not $scopeOk) {
  Write-Host '[2/6] adding "workflow" permission - authorize ONE more time at https://github.com/login/device' -ForegroundColor Yellow
  & gh auth refresh --hostname github.com --scopes 'repo,workflow'
  if ($LASTEXITCODE -ne 0) { Die 'permission upgrade not completed. re-run the script and authorize the browser prompt.' }
}
& gh auth setup-git

$owner = (& gh api user --jq '.login')
if (-not $owner) { Die 'could not read GitHub username. re-run the script.' }
$owner = "$owner".Trim()
Write-Host ('[2/6] logged in as: {0}' -f $owner) -ForegroundColor Green

# 3) create repo + push ------------------------------------------------
if (-not (Test-Path (Join-Path $repoDir '.git'))) {
  & git init -q
  & git checkout -q -b main
}
& git add -A
& git -c user.name="$owner" -c user.email="$owner@users.noreply.github.com" commit -q -m 'init: Hanwha Emong MarketView'

& gh repo view "$owner/$repoName" *> $null
$exists = ($LASTEXITCODE -eq 0)

if ($exists) {
  Write-Host '[3/6] repo already exists - pushing...' -ForegroundColor Cyan
  & git remote remove origin 2>$null | Out-Null
  & git remote add origin "https://github.com/$owner/$repoName.git"
  & git push -u origin main --force
} else {
  Write-Host '[3/6] creating repo and pushing...' -ForegroundColor Cyan
  & gh repo create $repoName --public --source . --remote origin --push
}
if ($LASTEXITCODE -ne 0) { Die 'push failed. check the messages above, then re-run the script.' }
Write-Host '[3/6] pushed' -ForegroundColor Green

# 4) enable Pages -----------------------------------------------------
Write-Host '[4/6] enabling GitHub Pages...' -ForegroundColor Cyan
& gh api -X POST "repos/$owner/$repoName/pages" -f 'source[branch]=main' -f 'source[path]=/' *> $null
if ($LASTEXITCODE -ne 0) {
  & gh api -X PUT "repos/$owner/$repoName/pages" -f 'source[branch]=main' -f 'source[path]=/' *> $null
}
if ($LASTEXITCODE -ne 0) { Write-Warning 'auto-enable failed - do it manually: repo Settings > Pages > Branch main / root' }
else { Write-Host '[4/6] Pages enabled' -ForegroundColor Green }

# 5) Actions write permission --------------------------------------
Write-Host '[5/6] granting Actions write permission...' -ForegroundColor Cyan
& gh api -X PUT "repos/$owner/$repoName/actions/permissions/workflow" -F default_workflow_permissions=write -F can_approve_pull_request_reviews=false *> $null
if ($LASTEXITCODE -ne 0) { Write-Warning 'failed - set manually: Settings > Actions > General > Workflow permissions > Read and write' }
else { Write-Host '[5/6] done' -ForegroundColor Green }

# 6) first run ------------------------------------------------------
Start-Sleep -Seconds 3
& gh workflow run daily-market-update.yml -R "$owner/$repoName" *> $null
if ($LASTEXITCODE -eq 0) { Write-Host '[6/6] first data-update workflow triggered' -ForegroundColor Green }
else { Write-Host '[6/6] trigger later: repo Actions tab > daily-market-update > Run workflow (or wait for 08:05 KST)' -ForegroundColor DarkGray }

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host ' DONE. Shareable dashboard URL (live in ~2 min):' -ForegroundColor Green
Write-Host ('   https://{0}.github.io/{1}/' -f $owner, $repoName) -ForegroundColor White
Write-Host ' Auto-updates daily at 08:05 KST. Recipients only need the link.' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
