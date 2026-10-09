# 2026-10-09 23:35 KST: CodexCode - open the Pi desktop from this Windows PC.
param(
    [string]$PiHost = '',
    [ValidateRange(1,65535)][int]$Port = 8080
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($PiHost)) {
    $localRules = Join-Path $PSScriptRoot '..\codexCode.md'
    if (Test-Path -LiteralPath $localRules) {
        $rulesText = Get-Content -Raw -Encoding UTF8 -LiteralPath $localRules
        $match = [regex]::Match($rulesText, '(?m)^- ip\s*:\s*([^\r\n]+)')
        if ($match.Success) { $PiHost = $match.Groups[1].Value.Trim() }
    }
}
if ([string]::IsNullOrWhiteSpace($PiHost)) {
    throw 'Specify -PiHost <Pi-IP> or provide the local codexCode.md IP entry.'
}
if ($PiHost -notmatch '^[a-zA-Z0-9.-]+$') { throw 'Invalid Pi hostname or IPv4 address.' }
$targetUrl = "http://${PiHost}:${Port}/pi"
Test-NetConnection -ComputerName $PiHost -Port $Port -WarningAction SilentlyContinue | Out-Null
# The user runs this launcher to open an interactive remote desktop in their browser.
Start-Process -FilePath $targetUrl
Write-Output "Pi desktop opened: $targetUrl"
