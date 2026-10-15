# 2026-10-16 03:27 KST: CodexCode - isolated helper/installer checks; no real clipboard, HID, startup folder or Pi access.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'src\zero2w_kvm\static\windows-clipboard-helper.ps1')
. (Join-Path $root 'src\zero2w_kvm\static\windows-clipboard-setup.ps1')
$checks = 0
function Assert($Condition, [string]$Message) { if (!$Condition) { throw $Message }; $script:checks++ }
$script:FixtureUsb = $false
function Get-CimInstance {
    param($ClassName, $Filter, $ErrorAction)
    Assert ($ClassName -eq 'Win32_PnPEntity' -and $Filter -match 'VID_1D6B&PID_0104' -and $Filter -match 'ConfigManagerErrorCode = 0') 'USB query lost its target/status filter.'
    if ($script:FixtureUsb) { [pscustomobject]@{PNPDeviceID='USB\VID_1D6B&PID_0104\fixture'; ConfigManagerErrorCode=0} }
}
Assert (!(Test-KvmUsb)) 'Absent USB was accepted.'
$script:FixtureUsb = $true
Assert (Test-KvmUsb) 'Present USB was rejected.'
$CheckOnly = $true
Start-KvmClipboard
$script:FixtureUsb = $false
$refused = $false
try { Start-KvmClipboard } catch { $refused = $_.Exception.Message -match 'Pi USB keyboard not found' }
Assert $refused 'Wrong PC was not refused before clipboard/network access.'
$CheckOnly = $false

$script:Requests = @(); $script:Reads = 0; $script:FixtureJob = $null
function Invoke-KvmRequest($Client, [string]$Path, $Payload = $null) {
    $script:Requests += [pscustomobject]@{Path=$Path; Payload=$Payload}
    if ($Path.EndsWith('/poll')) { return [pscustomobject]@{job=$script:FixtureJob} }
    return [pscustomobject]@{ok=$true}
}
function Read-KvmClipboard([string]$Job, $StopSignal) {
    $script:Reads++
    return @{job=$Job; text='fixture-only text'}
}
$stop = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset)
try {
    Invoke-KvmClipboardStep $null $stop $false
    Assert ($script:Requests.Count -eq 0 -and $script:Reads -eq 0) 'Disconnected USB performed clipboard/network work.'
    Invoke-KvmClipboardStep $null $stop $true
    Assert ($script:Requests.Count -eq 1 -and $script:Reads -eq 0) 'Idle poll read the clipboard.'
    $script:FixtureJob = 'explicit-fixture-job'
    Invoke-KvmClipboardStep $null $stop $true
    Assert ($script:Reads -eq 1 -and $script:Requests[-1].Path.EndsWith('/result')) 'Explicit job did not produce a result.'
    Assert ($script:Requests[-1].Payload.text -eq 'fixture-only text') 'Requested result text was lost.'
    $count = $script:Requests.Count
    $stop.Set() | Out-Null
    Invoke-KvmClipboardStep $null $stop $true
    Assert ($script:Requests.Count -eq $count) 'Stopped helper performed network work.'
} finally { $stop.Dispose() }

$script:Requests = @(); $script:Reads = 0; $script:FixtureJob = $null
$script:UsbTransitions = [Collections.Generic.Queue[bool]]::new()
foreach ($present in @($false, $true, $false)) { $script:UsbTransitions.Enqueue($present) }
$script:CycleStop = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset)
function Test-KvmUsb {
    $present = $script:UsbTransitions.Dequeue()
    if ($script:UsbTransitions.Count -eq 0) { $script:CycleStop.Set() | Out-Null }
    return $present
}
try {
    Invoke-KvmClipboardSession $null $script:CycleStop $true 0
    Assert ($script:Requests.Count -eq 1 -and $script:Reads -eq 0) 'USB reconnect cycle polled while disconnected or read an idle clipboard.'
    Assert ($script:LastKvmStatus -match 'Waiting for the Pi USB') 'USB removal did not return to waiting.'
} finally { $script:CycleStop.Dispose() }

$fixture = Join-Path $root ('.local\windows-helper-fixture-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture -Force | Out-Null
$script:FixturePaths = @{
    Directory = Join-Path $fixture 'installed files'
    Startup = Join-Path $fixture 'startup files'
    Sid = 'fixture-' + [Guid]::NewGuid().ToString('N')
    Powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Helper = Join-Path $fixture 'KVM-Windows-Clipboard.ps1'
    Setup = Join-Path $root 'src\zero2w_kvm\static\windows-clipboard-setup.ps1'
    Uninstaller = Join-Path $fixture 'Uninstall-KVM-Clipboard.cmd'
}
New-Item -ItemType Directory -Path $script:FixturePaths.Startup | Out-Null
Set-Content -LiteralPath $script:FixturePaths.Helper -Value 'param([switch]$CheckOnly) if (!$CheckOnly) { throw "Fixture check only" }; exit 0' -Encoding UTF8
Set-Content -LiteralPath $script:FixturePaths.Uninstaller -Value '@echo off' -Encoding ASCII
function Get-KvmSetupPaths { return $script:FixturePaths }
$script:Launches = @()
function Start-Process($FilePath, $ArgumentList, $WindowStyle) {
    $script:Launches += [pscustomobject]@{Path=$FilePath; Args=$ArgumentList; Style=$WindowStyle}
}
Invoke-KvmSetup 'Install'
$shortcutPath = Join-Path $script:FixturePaths.Startup 'Zero2W KVM Clipboard.lnk'
Assert (Test-Path -LiteralPath $shortcutPath) 'Installer did not create its isolated startup shortcut.'
$shell = New-Object -ComObject WScript.Shell
try {
    $link = $shell.CreateShortcut($shortcutPath)
    Assert ($link.TargetPath -eq $script:FixturePaths.Powershell -and $link.Arguments -match '-STA.*-WindowStyle Hidden.*-WatchUsb') 'Shortcut lost interactive STA/USB watcher arguments.'
    Assert ($link.WorkingDirectory -eq $script:FixturePaths.Directory) 'Shortcut points outside the installed directory.'
} finally {
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) | Out-Null
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null
}
Assert ($script:Launches.Count -eq 1 -and $script:Launches[0].Style -eq 'Hidden') 'Installer did not request hidden launch.'
$keep = Join-Path $script:FixturePaths.Directory 'unrelated.txt'
Set-Content -LiteralPath $keep -Value 'preserve'
Invoke-KvmSetup 'Install'
Assert ((Get-ChildItem -LiteralPath $script:FixturePaths.Startup).Count -eq 1) 'Reinstall duplicated the shortcut.'
Invoke-KvmSetup 'Uninstall'
Assert (!(Test-Path -LiteralPath $shortcutPath)) 'Uninstall left its shortcut.'
Assert (!(Test-Path -LiteralPath (Join-Path $script:FixturePaths.Directory 'KVM-Windows-Clipboard.ps1'))) 'Uninstall left its helper.'
Assert (Test-Path -LiteralPath $keep) 'Uninstall removed an unrelated file.'
Set-Content -LiteralPath $script:FixturePaths.Helper -Value 'exit 1' -Encoding UTF8
$refused = $false
try { Invoke-KvmSetup 'Install' } catch { $refused = $_.Exception.Message -match 'CONTROLLED Windows PC' }
Assert ($refused -and !(Test-Path -LiteralPath $shortcutPath)) 'Failed target verification registered automatic startup.'
Write-Host "PASS $checks isolated Windows helper/installer assertions. No real clipboard, startup registration, Pi connection or background helper was used."
