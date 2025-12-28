# Setup Scheduled Task to Update dynv6 IP Every 10 Minutes
# Run this script ONCE as Administrator to create the scheduled task

$scriptPath = "$PSScriptRoot\update-dynv6.ps1"

# Create the scheduled task action
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""

# Create triggers: on startup and every 10 minutes
$triggerStartup = New-ScheduledTaskTrigger -AtStartup
$triggerRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 9999)

# Register the task
$taskName = "StratusWeather-dynv6-Update"

# Remove existing task if it exists
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create new task
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggerStartup, $triggerRepeat -Description "Updates dynv6 IP for Stratus Weather Server" -RunLevel Highest

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " dynv6 Scheduled Task Created!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Task Name: $taskName"
Write-Host "Script: $scriptPath"
Write-Host "Schedule: On startup + every 10 minutes"
Write-Host ""
Write-Host "Your hostname: stratusweather1.dynv6.net"
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "1. Configure port forwarding on your router (port 5000 -> your PC)"
Write-Host "2. Run Stratus EXE normally"
Write-Host "3. Upload the updated CRBASIC program to your datalogger"
Write-Host ""
