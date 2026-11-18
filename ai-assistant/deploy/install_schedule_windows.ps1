# Schedules the assistant with Windows Task Scheduler (8:00, 12:00, 17:00 daily).
# Run from the project folder in PowerShell:
#   powershell -ExecutionPolicy Bypass -File deploy\install_schedule_windows.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\install_schedule_windows.ps1 -Uninstall
param([switch]$Uninstall)

$TaskName = "AI Assistant"
$Project  = Split-Path -Parent $PSScriptRoot
$Python   = Join-Path $Project ".venv\Scripts\python.exe"

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed schedule."
    exit 0
}

if (-not (Test-Path $Python)) { Write-Host "Create the virtualenv first (see README)."; exit 1 }
New-Item -ItemType Directory -Force -Path (Join-Path $Project "data") | Out-Null

$Log = Join-Path $Project "data\assistant.log"
$Action = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/c `"`"$Python`" -m assistant run >> `"$Log`" 2>&1`"" `
    -WorkingDirectory $Project
$Triggers = @(
    New-ScheduledTaskTrigger -Daily -At 8:00am
    New-ScheduledTaskTrigger -Daily -At 12:00pm
    New-ScheduledTaskTrigger -Daily -At 5:00pm
)
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Triggers `
    -Settings $Settings -Description "Personal AI assistant check" -Force | Out-Null

Write-Host "Scheduled: runs at 8:00, 12:00 and 17:00. Log: $Log"
Write-Host "Run now with: Start-ScheduledTask -TaskName '$TaskName'"
