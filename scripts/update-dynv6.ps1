# dynv6 IP Update Script for Stratus Weather Server
# Run this script on startup or schedule it to run every 10 minutes
# to keep your dynv6 hostname pointing to your current public IP

$token = "USDJe6U4YFJJTxzY5Je_Bfsuns2gQx"
$hostname = "stratusweather1.dynv6.net"

Write-Host "Updating dynv6 IP for $hostname..."

try {
    # Update IPv4 address
    $response = Invoke-WebRequest -Uri "https://ipv4.dynv6.com/api/update?hostname=$hostname&token=$token&ipv4=auto" -UseBasicParsing
    Write-Host "dynv6 Response: $($response.Content)"
    Write-Host "IP updated successfully at $(Get-Date)"
} catch {
    Write-Host "Error updating IP: $_"
}
