#!/usr/bin/env python3
"""Simple deployment script without Unicode characters"""
import paramiko
import os
import sys
import tarfile
import io
import time

# Configuration - reads from environment variables for security
SERVER_IP = os.environ.get("STRATUS_DEPLOY_HOST", "YOUR_SERVER_IP")
USERNAME = os.environ.get("STRATUS_DEPLOY_USER", "root")
PASSWORD = os.environ.get("STRATUS_DEPLOY_PASSWORD", "")
SSH_KEY_PATH = os.environ.get("STRATUS_DEPLOY_KEY", "")
APP_DIR = os.environ.get("STRATUS_DEPLOY_DIR", "/opt/stratus")
COMPOSE_FILE = os.environ.get("STRATUS_COMPOSE_FILE", "deploy/docker-compose.prod.yml")

if not PASSWORD and not SSH_KEY_PATH:
    print("[ERROR] Set STRATUS_DEPLOY_PASSWORD or STRATUS_DEPLOY_KEY environment variable")
    sys.exit(1)

def ssh_connect():
    """Connect to server via SSH"""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {SERVER_IP}...")
    if SSH_KEY_PATH:
        client.connect(SERVER_IP, username=USERNAME, key_filename=SSH_KEY_PATH, timeout=30)
    else:
        client.connect(SERVER_IP, username=USERNAME, password=PASSWORD, timeout=30)
    print("[OK] Connected!")
    return client

def run_command(client, command, show_output=True, timeout=600):
    """Run a command on the server"""
    print(f"\n>>> {command[:80]}{'...' if len(command) > 80 else ''}")
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)

    output = stdout.read().decode()
    errors = stderr.read().decode()
    exit_code = stdout.channel.recv_exit_status()

    if show_output and output:
        for line in output.strip().split('\n')[-20:]:
            print(f"  {line}")
    if errors and 'WARNING' not in errors and 'warning' not in errors:
        for line in errors.strip().split('\n')[-10:]:
            print(f"  [stderr] {line}")

    return exit_code, output, errors

def upload_application(client):
    """Upload application files to server"""
    print("\n" + "="*50)
    print("Uploading Application")
    print("="*50)

    local_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    print(f"  Creating archive from {local_path}...")

    sftp = client.open_sftp()

    # Create tar in memory
    tar_buffer = io.BytesIO()
    with tarfile.open(fileobj=tar_buffer, mode='w:gz') as tar:
        for root, dirs, files in os.walk(local_path):
            # Filter directories - exclude build artifacts, large folders, dev-only content
            dirs[:] = [d for d in dirs if d not in [
                'node_modules', 'dist', '.git', 'logs', '__pycache__', '.vscode',
                'release', 'tmp_dist', 'win-unpacked', '.cache', '.parcel-cache',
                'demo_data', 'coverage',
            ]]

            for file in files:
                # Skip logs, env files, large binaries, deploy scripts with credentials
                if file.endswith(('.log', '.exe', '.blockmap', '.nsi')):
                    continue
                if file in ['.env', '.env.local', 'ssh_setup.py', 'deploy_full.py', 'stratus-deploy.tar.gz']:
                    continue

                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, local_path)
                try:
                    tar.add(file_path, arcname=arcname)
                except Exception as e:
                    pass

    tar_buffer.seek(0)
    tar_size = len(tar_buffer.getvalue()) / (1024 * 1024)
    print(f"  Archive size: {tar_size:.2f} MB")

    print("  Uploading to server...")
    tar_buffer.seek(0)
    sftp.putfo(tar_buffer, f"{APP_DIR}/stratus.tar.gz")
    sftp.close()
    print("  [OK] Upload complete")

    print("  Extracting files...")
    run_command(client, f"cd {APP_DIR} && tar -xzf stratus.tar.gz && rm stratus.tar.gz", show_output=False)
    print("  [OK] Files extracted")

def build_and_start(client):
    """Build and start Docker containers"""
    print("\n" + "="*50)
    print("Building & Starting Containers")
    print("="*50)

    print("\n  Building Docker images (this may take 5-10 minutes)...")
    try:
        exit_code, output, errors = run_command(client, f"cd {APP_DIR} && docker compose -f {COMPOSE_FILE} build stratus 2>&1", timeout=900)
        if exit_code != 0:
            print(f"  [WARN] Build had issues")
            print(errors[-500:] if errors else output[-500:])
        else:
            print("  [OK] Build complete")
    except Exception as e:
        print(f"  [WARN] SSH session dropped during build ({e}), reconnecting...")
        client.close()
        client = ssh_connect()

    # Ensure session is active for container start
    try:
        client.exec_command("echo ok", timeout=5)
    except Exception:
        print("  Reconnecting SSH for container restart...")
        client.close()
        client = ssh_connect()

    print("\n  Starting containers...")
    run_command(client, f"cd {APP_DIR} && docker compose -f {COMPOSE_FILE} up -d", timeout=120)

    print("\n  Waiting for services to start...")
    time.sleep(10)

    print("\n  Container status:")
    run_command(client, f"cd {APP_DIR} && docker compose -f {COMPOSE_FILE} ps")

    return client

def main():
    print("\n" + "="*50)
    print("  STRATUS DEPLOYMENT")
    print(f"  Server: {SERVER_IP}")
    print("="*50)

    client = ssh_connect()

    try:
        upload_application(client)
        client = build_and_start(client)

        print("\n" + "="*50)
        print("  DEPLOYMENT COMPLETE!")
        print("="*50)
        print(f"\n  Your Stratus instance has been updated.")
        print(f"\n  Your app should be live at https://stratusweather.co.za")
        print(f"\n  To check logs: ssh root@{SERVER_IP} 'cd /opt/stratus && docker compose -f {COMPOSE_FILE} logs -f'")

    except Exception as e:
        print(f"\n[ERROR] Deployment failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    main()
