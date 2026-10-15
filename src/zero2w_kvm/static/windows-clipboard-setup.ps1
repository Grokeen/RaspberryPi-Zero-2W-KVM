# 2026-10-16 03:22 KST: CodexCode - reversible current-user startup registration on the USB target.
[CmdletBinding()]
param([ValidateSet('Install', 'Uninstall')][string]$Action = 'Install')

function Get-KvmSetupPaths {
    return @{
        Directory = Join-Path $env:LOCALAPPDATA 'Zero2WKVM-Clipboard'
        Startup = [Environment]::GetFolderPath('Startup')
        Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        Powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        Helper = Join-Path $PSScriptRoot 'KVM-Windows-Clipboard.ps1'
        Setup = $PSCommandPath
        Uninstaller = Join-Path $PSScriptRoot 'Uninstall-KVM-Clipboard.cmd'
    }
}

function Stop-KvmHelper([string]$Sid) {
    try {
        $signal = [Threading.EventWaitHandle]::OpenExisting("Local\Zero2WKVMClipboardStop.$Sid")
        try { $signal.Set() | Out-Null } finally { $signal.Dispose() }
    } catch [Threading.WaitHandleCannotBeOpenedException] { }
    $mutex = [Threading.Mutex]::new($false, "Local\Zero2WKVMClipboard.$Sid")
    try {
        try { $stopped = $mutex.WaitOne(8000) } catch [Threading.AbandonedMutexException] { $stopped = $true }
        if (!$stopped) { throw 'The helper is still busy. Wait a few seconds, then try again.' }
        $mutex.ReleaseMutex()
    } finally { $mutex.Dispose() }
}

function Invoke-KvmSetup([string]$Mode) {
    $ErrorActionPreference = 'Stop'
    $paths = Get-KvmSetupPaths
    if (!$paths.Startup) { throw 'Windows user Startup folder was not found.' }
    $shortcutPath = Join-Path $paths.Startup 'Zero2W KVM Clipboard.lnk'
    if ($Mode -eq 'Uninstall') {
        # Remove only exact installed files; no recursive deletion or PID-based process killing.
        if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
        Stop-KvmHelper $paths.Sid
        foreach ($name in @('KVM-Windows-Clipboard.ps1', 'KVM-Windows-Clipboard-Setup.ps1', 'Uninstall-KVM-Clipboard.cmd', 'status.json')) {
            $path = Join-Path $paths.Directory $name
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
        }
        Write-Host 'KVM clipboard automatic startup removed. The helper is stopped.'
        return
    }
    & $paths.Powershell -NoProfile -STA -ExecutionPolicy Bypass -File $paths.Helper -CheckOnly
    if ($LASTEXITCODE -ne 0) { throw 'Install on the CONTROLLED Windows PC with the Pi USB data cable connected.' }
    Stop-KvmHelper $paths.Sid
    New-Item -ItemType Directory -Path $paths.Directory -Force | Out-Null
    Copy-Item -LiteralPath $paths.Helper -Destination (Join-Path $paths.Directory 'KVM-Windows-Clipboard.ps1') -Force
    Copy-Item -LiteralPath $paths.Setup -Destination (Join-Path $paths.Directory 'KVM-Windows-Clipboard-Setup.ps1') -Force
    Copy-Item -LiteralPath $paths.Uninstaller -Destination (Join-Path $paths.Directory 'Uninstall-KVM-Clipboard.cmd') -Force
    $arguments = '-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $paths.Directory 'KVM-Windows-Clipboard.ps1') + '" -WatchUsb'
    $shell = New-Object -ComObject WScript.Shell
    try {
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $paths.Powershell
        $shortcut.Arguments = $arguments
        $shortcut.WorkingDirectory = $paths.Directory
        $shortcut.Description = 'Wait for the Pi USB keyboard and serve explicit KVM clipboard copy requests.'
        $shortcut.WindowStyle = 7
        $shortcut.Save()
    } finally {
        if ($shortcut) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) | Out-Null }
        [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null
    }
    Start-Process -FilePath $paths.Powershell -ArgumentList $arguments -WindowStyle Hidden
    Write-Host 'Installed for the current Windows user. Pi USB reconnect and next Windows sign-in start the helper automatically.'
    Write-Host 'Check the KVM console for target helper connected. Remove with Uninstall-KVM-Clipboard.cmd.'
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-KvmSetup $Action }