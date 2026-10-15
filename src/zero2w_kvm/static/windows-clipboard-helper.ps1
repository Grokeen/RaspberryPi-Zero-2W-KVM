# 2026-10-16 00:25 KST: CodexCode - run in the interactive Windows target user's desktop.
# Only an explicit KVM Ctrl+C job reads clipboard text. No clipboard monitoring or input control.
$ErrorActionPreference = 'Stop'
$KvmServer = '__KVM_SERVER__'
$KvmAgentToken = '__KVM_AGENT_TOKEN__'
if ($KvmServer -eq '__KVM_' + 'SERVER__') { throw 'Download the paired helper from your signed-in KVM console.' }
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') { throw 'Run this helper with powershell.exe -STA -File <helper.ps1>.' }
Add-Type -AssemblyName System.Windows.Forms
$headers = @{Authorization = "Bearer $KvmAgentToken"}
Write-Host 'KVM Windows clipboard helper is running. Minimize this window; close it to disconnect.'
while ($true) {
    try {
        $job = Invoke-RestMethod -Uri "$KvmServer/api/clipboard/agent/poll" -Headers $headers -TimeoutSec 5
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
    } catch { Write-Host 'Waiting for the KVM connection...' }
    Start-Sleep -Milliseconds 500
}
