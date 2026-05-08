# stop_windows.ps1 — stop and remove the FinAlly container on Windows.
#
# Does NOT remove the bind-mounted db\finally.db — your portfolio survives.
# Run `Remove-Item db\finally.db` yourself for a clean slate.

# NOTE: not using `$ErrorActionPreference = 'Stop'` — see start_windows.ps1
# for the rationale (PowerShell 5.1 NativeCommandError footgun).
$ErrorActionPreference = 'Continue'

$Container = 'finally'

# Probe via `docker ps` (always exits 0; empty stdout means missing) rather
# than `docker inspect` (writes to stderr when missing).
$existing = & docker ps -a --filter "name=^$Container$" --format '{{.Status}}'
if ([string]::IsNullOrWhiteSpace($existing)) {
    Write-Host "==> No $Container container found; nothing to do"
    exit 0
}

Write-Host "==> Stopping $Container"
& docker rm -f $Container *>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to remove container $Container"
    exit $LASTEXITCODE
}
Write-Host "==> $Container stopped and removed (db\finally.db preserved)"
