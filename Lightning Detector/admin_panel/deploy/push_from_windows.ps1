# Deploy the updated admin panel to the Vultr VPS from Windows.
#
# Prereq: SSH access as root (password or key).
#   If password login fails, reset the root password in the Vultr dashboard
#   (Server -> Settings -> Reset root password) or add your SSH public key.
#
# Usage (PowerShell, from admin_panel folder):
#   .\deploy\push_from_windows.ps1 -Password 'your-root-password'
#   .\deploy\push_from_windows.ps1 -KeyPath "$env:USERPROFILE\.ssh\id_rsa"
#
param(
    [string]$VpsHost = "139.84.238.225",
    [string]$User = "root",
    [string]$Password = "",
    [string]$KeyPath = "",
    [string]$RemoteDir = "/opt/lightning-panel",
    [string]$Domain = "gwld1-admin.dynv6.net"
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Here

Write-Host "==> Installing paramiko/scp if needed..."
python -m pip install --quiet paramiko scp

$Stage = Join-Path $env:TEMP "lightning-panel-deploy"
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Path $Stage | Out-Null

Write-Host "==> Staging files..."
$exclude = @('.venv*', 'data', '__pycache__', '*.pyc', '_deploy_ssh.py', '_check_live.py')
Get-ChildItem -Force | Where-Object {
    $n = $_.Name
    -not ($n -match '^\.venv' -or $n -eq 'data' -or $n -match '^_deploy' -or $n -match '^_check')
} | ForEach-Object {
    Copy-Item -Recurse -Force $_.FullName -Destination (Join-Path $Stage $_.Name)
}
Copy-Item -Force ".env.vps" (Join-Path $Stage ".env")

$Zip = Join-Path $env:TEMP "lightning-panel.zip"
if (Test-Path $Zip) { Remove-Item -Force $Zip }
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $Zip -Force

Write-Host "==> Connecting to $User@${VpsHost}..."
$py = @"
import os, sys, tarfile, io, time
import paramiko
from scp import SCPClient

host, user, remote_dir, domain, zip_path = sys.argv[1:6]
password = os.environ.get('DEPLOY_PW', '') or None
key_path = os.environ.get('DEPLOY_KEY', '') or None

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
kwargs = dict(hostname=host, username=user, timeout=60, look_for_keys=False, allow_agent=False)
if key_path:
    kwargs['key_filename'] = key_path
else:
    kwargs['password'] = password
client.connect(**kwargs)

def run(cmd, check=True):
    print('>>>', cmd)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=600)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if out.strip(): print(out.strip())
    if err.strip(): print('ERR:', err.strip())
    if check and code != 0:
        raise SystemExit(f'command failed ({code}): {cmd}')
    return out

run(f'mkdir -p {remote_dir}')
with SCPClient(client.get_transport()) as scp:
    scp.put(zip_path, '/tmp/lightning-panel.zip')

run(f'apt-get update -qq && apt-get install -y -qq unzip rsync 2>/dev/null || true', check=False)
run(f'cd {remote_dir} && unzip -o /tmp/lightning-panel.zip -d {remote_dir}_new')
run(f'rsync -a {remote_dir}_new/ {remote_dir}/ 2>/dev/null || cp -a {remote_dir}_new/. {remote_dir}/')
run(f'chmod +x {remote_dir}/deploy/deploy_on_vps.sh')
run(f'cd {remote_dir} && DOMAIN={domain} bash deploy/deploy_on_vps.sh')

client.close()
print('DEPLOY_OK')
"@

$pyFile = Join-Path $env:TEMP "deploy_remote.py"
Set-Content -Path $pyFile -Value $py -Encoding UTF8

if ($Password) { $env:DEPLOY_PW = $Password } else { Remove-Item Env:DEPLOY_PW -ErrorAction SilentlyContinue }
if ($KeyPath) { $env:DEPLOY_KEY = $KeyPath } else { Remove-Item Env:DEPLOY_KEY -ErrorAction SilentlyContinue }

python $pyFile $VpsHost $User $RemoteDir $Domain $Zip
if ($LASTEXITCODE -ne 0) { throw "Deploy failed." }

Write-Host ""
Write-Host "Live at: https://$Domain"
Write-Host "Pi webhook token must match ALERT_WEBHOOK_TOKEN in .env (already set in lightning_config.json)."
