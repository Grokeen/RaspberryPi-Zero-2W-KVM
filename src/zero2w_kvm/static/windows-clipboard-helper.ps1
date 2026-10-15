# 2026-10-16 03:22 KST: CodexCode - target USB reconnect and bounded LAN requests.
# Clipboard text is read only for an explicit copy job; dot-sourcing defines functions for isolated tests.
[CmdletBinding()]
param([switch]$CheckOnly, [switch]$CheckNetwork, [switch]$WatchUsb)
$KvmServer = '__KVM_SERVER__'
$KvmAgentToken = '__KVM_AGENT_TOKEN__'

function Test-KvmUsb {
    $device = Get-CimInstance -ClassName Win32_PnPEntity -Filter "PNPDeviceID LIKE '%VID_1D6B&PID_0104%' AND ConfigManagerErrorCode = 0" -ErrorAction Stop | Select-Object -First 1
    return $null -ne $device
}

function New-KvmHttpClient {
    Add-Type -AssemblyName System.Net.Http
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(4)
    $client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $KvmAgentToken)
    return $client
}

function Invoke-KvmRequest($Client, [string]$Path, $Payload = $null) {
    $request = $response = $null
    try {
        $method = if ($null -eq $Payload) { [Net.Http.HttpMethod]::Get } else { [Net.Http.HttpMethod]::Post }
        $request = [Net.Http.HttpRequestMessage]::new($method, "$KvmServer$Path")
        if ($null -ne $Payload) {
            $bytes = [Text.Encoding]::UTF8.GetBytes(($Payload | ConvertTo-Json -Compress))
            $request.Content = [Net.Http.ByteArrayContent]::new($bytes)
            $request.Content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new('application/json')
            $request.Content.Headers.ContentType.CharSet = 'utf-8'
        }
        $response = $Client.SendAsync($request).GetAwaiter().GetResult()
        if (!$response.IsSuccessStatusCode) {
            $failure = [InvalidOperationException]::new('KVM request failed.')
            $failure.Data['StatusCode'] = [int]$response.StatusCode
            throw $failure
        }
        return ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json)
    } finally {
        $bytes = $null
        if ($response) { $response.Dispose() }
        if ($request) { $request.Dispose() }
    }
}

function Get-KvmFailure($Failure) {
    $status = $Failure.Exception.Data['StatusCode']
    if ($status -eq 401 -or $status -eq 403) { return 'Helper authentication failed. Download a new paired helper from the signed-in KVM console.' }
    if ($status -eq 404) { return 'KVM clipboard endpoint not found. Update the Pi KVM server.' }
    return 'Cannot reach the Pi KVM server (4 second timeout). Check the target PC network and run Check-KVM-Clipboard.cmd.'
}

function Set-KvmStatus([string]$Message) {
    if ($script:LastKvmStatus -eq $Message) { return }
    $script:LastKvmStatus = $Message
    Write-Host $Message
    if ($script:KvmStatusPath) {
        # Store only the latest connection stage, never clipboard text, addresses or tokens.
        try {
            @{time = [DateTime]::UtcNow.ToString('o'); status = $Message} | ConvertTo-Json -Compress |
                Set-Content -LiteralPath $script:KvmStatusPath -Encoding UTF8
        } catch { }
    }
}

function Read-KvmClipboard([string]$Job, $StopSignal) {
    $result = @{job = $Job; error = 'busy'}
    if ($StopSignal.WaitOne(250)) { return $null }
    if (!(Test-KvmUsb)) { return $null }
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        try {
            if ([System.Windows.Forms.Clipboard]::ContainsText()) {
                $text = [System.Windows.Forms.Clipboard]::GetText()
                if ([Text.Encoding]::UTF8.GetByteCount($text) -gt 65536) { $result = @{job = $Job; error = 'too_large'} }
                else { $result = @{job = $Job; text = $text} }
            } else { $result = @{job = $Job; error = 'no_text'} }
            break
        } catch { if ($StopSignal.WaitOne(50)) { return $null } }
        finally { $text = $null }
    }
    return $result
}

function Invoke-KvmClipboardStep($Client, $StopSignal, [bool]$Connected) {
    if (!$Connected -or $StopSignal.WaitOne(0)) { return }
    $result = $null
    try {
        $job = Invoke-KvmRequest $Client '/api/clipboard/agent/poll'
        Set-KvmStatus 'Connected to KVM. Waiting for an explicit Ctrl+C request.'
        if ($job.job) {
            Set-KvmStatus 'Copy requested. Waiting for the target Windows clipboard...'
            $result = Read-KvmClipboard $job.job $StopSignal
            if ($null -eq $result -or $StopSignal.WaitOne(0)) { return }
            Set-KvmStatus 'Sending the requested clipboard result to Pi...'
            Invoke-KvmRequest $Client '/api/clipboard/agent/result' $result | Out-Null
            Set-KvmStatus 'Clipboard result delivered to Pi. Waiting for the next Ctrl+C request.'
        }
    } finally { $result = $null; $job = $null }
}

# 2026-10-16 03:27 KST: keep USB reconnect behavior testable without a real desktop or startup registration.
function Invoke-KvmClipboardSession($Client, $StopSignal, [bool]$MonitorUsb, [double]$UsbCheckSeconds = 2) {
    $nextUsbCheck = [DateTime]::MinValue
    $usb = $false
    while (!$StopSignal.WaitOne(0)) {
        try {
            if ([DateTime]::UtcNow -ge $nextUsbCheck) {
                $usb = Test-KvmUsb
                $nextUsbCheck = [DateTime]::UtcNow.AddSeconds($UsbCheckSeconds)
            }
            if (!$usb) {
                if (!$MonitorUsb) { Set-KvmStatus 'Pi USB disconnected. Run the helper again after reconnecting.'; break }
                Set-KvmStatus 'Waiting for the Pi USB keyboard. The clipboard is not being read.'
            } else { Invoke-KvmClipboardStep $Client $StopSignal $true }
        } catch { Set-KvmStatus (Get-KvmFailure $_) }
        if ($StopSignal.WaitOne(500)) { break }
    }
}

function Start-KvmClipboard {
    $ErrorActionPreference = 'Stop'
    if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') { throw 'Run this helper with powershell.exe -STA -File <helper.ps1>.' }
    $usb = Test-KvmUsb
    if (!$usb -and (!$WatchUsb -or $CheckOnly -or $CheckNetwork)) {
        throw 'Pi USB keyboard not found. Run this helper on the CONTROLLED Windows PC, not the computer displaying the KVM browser. Connect the Pi USB data cable first.'
    }
    if ($CheckOnly) { Write-Host 'Pi USB keyboard found. Target check passed; clipboard was not read.'; return }
    if ($KvmServer -eq '__KVM_' + 'SERVER__') { throw 'Download the paired helper from your signed-in KVM console.' }
    $client = New-KvmHttpClient
    if ($CheckNetwork) {
        try {
            Invoke-KvmRequest $client '/api/clipboard/agent/health' | Out-Null
            Write-Host 'Pi USB, network and helper authentication passed. Clipboard was not read.'
            $statusPath = Join-Path $env:LOCALAPPDATA 'Zero2WKVM-Clipboard\status.json'
            if (Test-Path -LiteralPath $statusPath) {
                $state = Get-Content -Raw -LiteralPath $statusPath | ConvertFrom-Json
                Write-Host ('Automatic helper last state change (' + $state.time + '): ' + $state.status)
            }
        } catch { throw (Get-KvmFailure $_) }
        finally { $client.Dispose() }
        return
    }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $mutex = [Threading.Mutex]::new($false, "Local\Zero2WKVMClipboard.$sid")
    $owned = $false; $stopSignal = $null
    try {
        try { $owned = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned = $true }
        if (!$owned) { Write-Host 'KVM clipboard helper is already running for this user. Run Check-KVM-Clipboard.cmd to check it.'; return }
        $stopSignal = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, "Local\Zero2WKVMClipboardStop.$sid")
        $stopSignal.Reset() | Out-Null
        if ($WatchUsb) { $script:KvmStatusPath = Join-Path $env:LOCALAPPDATA 'Zero2WKVM-Clipboard\status.json' }
        Add-Type -AssemblyName System.Windows.Forms
        Invoke-KvmClipboardSession $client $stopSignal ([bool]$WatchUsb)
        Set-KvmStatus 'KVM clipboard helper stopped.'
    } finally {
        $client.Dispose()
        if ($stopSignal) { $stopSignal.Dispose() }
        if ($owned) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

if ($MyInvocation.InvocationName -ne '.') { Start-KvmClipboard }
