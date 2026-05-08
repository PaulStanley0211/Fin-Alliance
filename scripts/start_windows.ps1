# start_windows.ps1 — build (if needed) and run the FinAlly container on Windows.
#
# Usage:
#   .\scripts\start_windows.ps1           # build if image missing, then run
#   .\scripts\start_windows.ps1 -Build    # force rebuild
#   .\scripts\start_windows.ps1 -Logs     # follow logs after start
#
# Idempotent: a running container is left alone; an existing-but-stopped
# container is removed and restarted.

[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$Logs
)

# NOTE: not using `$ErrorActionPreference = 'Stop'`. Native commands' stderr
# in Windows PowerShell 5.1 is wrapped into ErrorRecord objects (the
# NativeCommandError footgun), which can halt the script even when the
# native command succeeded. We check $LASTEXITCODE explicitly after each
# docker call instead.
$ErrorActionPreference = 'Continue'

$Image     = 'finally:latest'
$Container = 'finally'
$Port      = 8000

# Resolve project root (parent of this script's directory).
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..')
Set-Location $ProjectRoot

# Sanity: .env must exist.
if (-not (Test-Path '.env')) {
    Write-Error "ERROR: .env not found at $ProjectRoot\.env`nCopy .env.example to .env and add your ANTHROPIC_API_KEY."
    exit 1
}

# Sanity: docker's --env-file parser is unforgiving. Catch common hand-edit
# mistakes before docker hits the user with a cryptic message — or worse,
# silently passes a malformed value through to the API and produces 401s.

# (1) Whitespace around `=` — rejected by docker's parser.
$badWhitespace = Select-String -Path .env -Pattern '^[A-Z_][A-Z0-9_]*\s*=\s' -CaseSensitive
if ($badWhitespace) {
    Write-Error @"
ERROR: .env contains whitespace around '=' which docker's --env-file parser rejects.
Offending lines:
$(($badWhitespace | ForEach-Object { "  line $($_.LineNumber): $($_.Line)" }) -join "`n")
Fix: rewrite each as KEY=value (no spaces), e.g. MASSIVE_API_KEY=abc123
"@
    exit 1
}

# (2) Quoted values — docker's --env-file does NOT strip surrounding quotes,
# so the literal " or ' chars become part of the value (causing 401 invalid
# x-api-key on Anthropic, etc.).
$badQuoted = Select-String -Path .env -Pattern '^[A-Z_][A-Z0-9_]*=(["''])(.*)\1\s*$' -CaseSensitive
if ($badQuoted) {
    Write-Error @"
ERROR: .env contains quoted values. Docker's --env-file does NOT strip surrounding quotes — the literal quote characters become part of the value.
Offending lines:
$(($badQuoted | ForEach-Object { "  line $($_.LineNumber): $($_.Line)" }) -join "`n")
Fix: remove the surrounding quotes, e.g. ANTHROPIC_API_KEY=sk-ant-... (not "sk-ant-...")
"@
    exit 1
}

# (3) CRLF line endings — Docker's parser includes the trailing `r in values,
# silently corrupting them. PowerShell editors and Notepad save as CRLF by
# default on Windows, which makes this a near-universal first-launch trap.
$envBytes = [System.IO.File]::ReadAllBytes((Resolve-Path '.env'))
if ($envBytes -contains 13) {
    Write-Error @"
ERROR: .env has Windows CRLF line endings. Docker's --env-file includes the trailing \r in every value, silently corrupting them.
Fix: convert to LF endings. In VS Code: click 'CRLF' in the bottom-right status bar and pick 'LF', then re-save. Or run from Git Bash: dos2unix .env
"@
    exit 1
}

# Build if forced or image missing. Probe with `docker images` (which always
# succeeds and returns empty stdout when the tag doesn't exist) rather than
# `image inspect` (which writes to stderr and trips PowerShell 5.1's
# NativeCommandError wrapping).
$imageId = & docker images -q $Image
$imageExists = -not [string]::IsNullOrWhiteSpace($imageId)

if ($Build -or -not $imageExists) {
    Write-Host "==> Building $Image"
    & docker build -t $Image .
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Host "==> Reusing existing image $Image (use -Build to force rebuild)"
}

# Idempotent container handling. Probe via `docker ps` rather than
# `container inspect`, because `inspect` writes to stderr when the container
# is missing and PowerShell 5.1's NativeCommandError wrapping makes that
# painful to suppress reliably.
$existing = & docker ps -a --filter "name=^$Container$" --format '{{.Status}}'
if ([string]::IsNullOrWhiteSpace($existing)) {
    $state = 'missing'
} elseif ($existing -match '^Up\b') {
    $state = 'running'
} else {
    # Anything else (Exited, Created, Restarting, Paused, Dead) → recreate.
    $state = 'stopped'
}

switch ($state) {
    'running' {
        Write-Host "==> Container $Container is already running"
    }
    'stopped' {
        Write-Host "==> Removing stopped container $Container"
        & docker rm -f $Container *>&1 | Out-Null
        $state = 'missing'
    }
}

if ($state -eq 'missing') {
    Write-Host "==> Starting $Container on port $Port"
    # Bind mount: ${PWD}\db -> /app/db so the SQLite file is visible on the host
    # and survives container removal. (Named volume alternative: -v finally-data:/app/db)
    docker run -d `
        --name $Container `
        -p "$Port`:8000" `
        --env-file .env `
        -v "${PWD}/db:/app/db" `
        --restart unless-stopped `
        $Image | Out-Null
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$Url = "http://localhost:$Port"
Write-Host "==> FinAlly is starting at $Url"
Write-Host "    Health: $Url/api/health"
Write-Host "    Stop:   .\scripts\stop_windows.ps1"

if ($Logs) {
    Write-Host "==> Tailing logs (Ctrl-C to detach; container keeps running)"
    docker logs -f $Container
}
