# Stratus Weather Server - Production Runner
# This script runs the server and auto-restarts on failure
# It's designed to be run by Windows Task Scheduler

$ErrorActionPreference = "Continue"
$projectPath = "c:\Users\eed2k\Downloads\Itronics Projects\stratus"
$logPath = "$projectPath\logs"
$env:NODE_ENV = "production"
$env:PORT = "5000"

# Create logs directory
if (-not (Test-Path $logPath)) {
    New-Item -ItemType Directory -Path $logPath -Force | Out-Null
}

function Write-Log {
    param($Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] $Message"
    Write-Host $logMessage
    Add-Content -Path "$logPath\server.log" -Value $logMessage
}

Write-Log "=== Stratus Server Production Runner Starting ==="
Write-Log "Project path: $projectPath"
Write-Log "Node.js: $(node --version)"

Set-Location $projectPath

# Main loop - restart server on failure
while ($true) {
    Write-Log "Starting Stratus server on port 5000..."
    
    try {
        # Prefer built server, fall back to tsx
        if (Test-Path "$projectPath\dist\server\index.js") {
            Write-Log "Running built server (dist/server/index.js)"
            $process = Start-Process -FilePath "node" -ArgumentList "$projectPath\dist\server\index.js" -WorkingDirectory $projectPath -PassThru -NoNewWindow -Wait
        } else {
            Write-Log "Running development server via tsx (server/index.ts)"
            # Use tsx without watch mode for production stability
            $process = Start-Process -FilePath "npx" -ArgumentList "tsx", "$projectPath\server\index.ts" -WorkingDirectory $projectPath -PassThru -NoNewWindow -Wait
        }
        
        Write-Log "Server process exited with code: $($process.ExitCode)"
    }
    catch {
        Write-Log "ERROR: $($_.Exception.Message)"
    }
    
    Write-Log "Server stopped unexpectedly. Restarting in 10 seconds..."
    Start-Sleep -Seconds 10
}
