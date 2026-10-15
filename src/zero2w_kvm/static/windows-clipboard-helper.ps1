# 2026-10-16 00:25 KST: CodexCode - run in the interactive Windows target user's desktop.
# Only an explicit KVM Ctrl+C job reads clipboard text. No clipboard monitoring or input control.
[CmdletBinding()]
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$KvmServer = '__KVM_SERVER__'
$KvmAgentToken = '__KVM_AGENT_TOKEN__'
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') { throw 'Run this helper with powershell.exe -STA -File <helper.ps1>.' }
# 2026-10-16 01:55 KST: prevent reading the controller's clipboard when run on the wrong PC.
$targetUsb = Get-CimInstance Win32_PnPEntity | Where-Object {
    $_.PNPDeviceID -match 'VID_1D6B&PID_0104' -and $_.ConfigManagerErrorCode -eq 0
} | Select-Object -First 1
if (!$targetUsb) { throw 'Pi USB keyboard not found. Run this helper on the CONTROLLED Windows PC, not the computer displaying the KVM browser. Connect the Pi USB data cable first.' }
if ($CheckOnly) { Write-Host 'Pi USB keyboard found. Target check passed; clipboard was not read.'; exit 0 }
if ($KvmServer -eq '__KVM_' + 'SERVER__') { throw 'Download the paired helper from your signed-in KVM console.' }
Add-Type -AssemblyName System.Windows.Forms
$headers = @{Authorization = "Bearer $KvmAgentToken"}
$connectionStatus = ''
Write-Host 'Target USB verified. Connecting to KVM... Close this window to disconnect.'
while ($true) {
    try {
        $job = Invoke-RestMethod -Uri "$KvmServer/api/clipboard/agent/poll" -Headers $headers -TimeoutSec 5
        if ($connectionStatus -ne 'connected') { Write-Host 'Connected to KVM. Waiting for an explicit Ctrl+C request; minimize this window.'; $connectionStatus = 'connected' }
        if ($job.job) {
            # Allow the Windows foreground application to finish its Ctrl+C handling.
            Start-Sleep -Milliseconds 250
            $result = @{job = $job.job; error = 'busy'}
            for ($attempt = 0; $attempt -lt 10; $attempt++) {
                try {
                    if ([System.Windows.Forms.Clipboard]::ContainsText()) {
                        $text = [System.Windows.Forms.Clipboard]::GetText()
                        if ([Text.Encoding]::UTF8.GetByteCount($text) -gt 65536) {
                            $result = @{job = $job.job; error = 'too_large'}
                        } else { $result = @{job = $job.job; text = $text} }
                    } else { $result = @{job = $job.job; error = 'no_text'} }
                    break
                } catch { Start-Sleep -Milliseconds 50 }
            }
            $body = [Text.Encoding]::UTF8.GetBytes(($result | ConvertTo-Json -Compress))
            Invoke-RestMethod -Method Post -Uri "$KvmServer/api/clipboard/agent/result" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 5 | Out-Null
            $text = $null; $body = $null; $result = $null
        }
    } catch {
        $message = 'Cannot reach the Pi KVM server. Check the target PC network connection and Pi server availability.'
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
            if ($status -eq 401 -or $status -eq 403) { $message = 'Helper authentication failed. Download a new paired helper from the signed-in KVM console.' }
            elseif ($status -eq 404) { $message = 'KVM clipboard endpoint not found. Update the Pi KVM server.' }
        }
        if ($connectionStatus -ne $message) { Write-Host $message; $connectionStatus = $message }
    } finally { $text = $null; $body = $null; $result = $null }
    Start-Sleep -Milliseconds 500
}
