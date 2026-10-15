# 2026-10-15 23:10 KST: CodexCode - open a localhost console for this PC's capture board.
param(
    [string]$PiHost = '',
    [ValidateRange(1,65535)][int]$PiPort = 8080,
    [ValidateRange(1,65535)][int]$LocalPort = 8081,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($PiHost)) {
    $rulesPath = Join-Path $projectRoot 'codexCode.md'
    if (Test-Path -LiteralPath $rulesPath) {
        $rules = Get-Content -Raw -Encoding UTF8 -LiteralPath $rulesPath
        $match = [regex]::Match($rules, '(?m)^- ip\s*:\s*([^\r\n]+)')
        if ($match.Success) { $PiHost = $match.Groups[1].Value.Trim() }
    }
}
if ($PiHost -notmatch '^[a-zA-Z0-9.-]+$') { throw 'Specify -PiHost <Pi-IP> or a local codexCode.md IP entry.' }
$url = "http://127.0.0.1:${LocalPort}/"
$health = $null
try { $health = Invoke-RestMethod -Uri "${url}__local_kvm__/status" -TimeoutSec 2 } catch {}
if ($health -and ($health.service -ne 'zero2w-kvm-local' -or $health.pi_host -ne $PiHost -or $health.pi_port -ne $PiPort)) {
    throw "Port $LocalPort is serving another console. Choose -LocalPort <unused-port>."
}
if (!$health) {
    $pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
    $pythonPrefix = ''
    if (!(Test-Path -LiteralPath $pythonPath)) {
        $pythonCommand = Get-Command py,python -ErrorAction SilentlyContinue | Select-Object -First 1
        if (!$pythonCommand) { throw 'Install Python 3.10 or newer to run the PC console.' }
        $pythonPath = $pythonCommand.Source
        if ($pythonCommand.Name -eq 'py.exe') { $pythonPrefix = '-3 ' }
    }
    $helperPath = Join-Path $projectRoot 'src\zero2w_kvm\local_console.py'
    $logsPath = Join-Path $projectRoot '.local'
    New-Item -ItemType Directory -Path $logsPath -Force | Out-Null
    $arguments = $pythonPrefix + '"' + $helperPath + '" --pi-host ' + $PiHost + ' --pi-port ' + $PiPort + ' --port ' + $LocalPort
    $helper = Start-Process -FilePath $pythonPath -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsPath "pc-console-${LocalPort}.log") -RedirectStandardError (Join-Path $logsPath "pc-console-${LocalPort}.error.log")
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 200
        try { $health = Invoke-RestMethod -Uri "${url}__local_kvm__/status" -TimeoutSec 1; break } catch {}
        if ($helper.HasExited) { break }
    }
    if (!$health -or $health.service -ne 'zero2w-kvm-local' -or $health.pi_host -ne $PiHost -or $health.pi_port -ne $PiPort) {
        throw "Cannot start the PC console. Check .local\pc-console-${LocalPort}.error.log or choose another -LocalPort."
    }
}
if (!$NoBrowser) { Start-Process -FilePath $url }
Write-Output "KVM PC capture console: $url"
