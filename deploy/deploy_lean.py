#!/usr/bin/env python3
"""
Deploy to VPS: Upload only web app files (no desktop/, release/, etc.)
Then rebuild Docker containers.
"""
import paramiko
import os
import sys
import tarfile
import io
import time

SERVER_IP = "139.84.242.126"
PASSWORD = os.environ.get("STRATUS_DEPLOY_PASSWORD", "ChangeMe123!")
APP_DIR = "/opt/stratus"
COMPOSE_FILE = "docker-compose.yml"

LOCAL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Directories to EXCLUDE from the upload
EXCLUDE_DIRS = {
    'node_modules', 'dist', '.git', 'logs', '__pycache__', '.vscode',
    'release', 'tmp_dist', 'win-unpacked', '.cache', '.parcel-cache',
    'demo_data', 'coverage', 'desktop',  # Exclude desktop .NET app
    '.vs', 'bin', 'obj', 'packages',
}

# Files to exclude
EXCLUDE_FILES = {
    '.env', '.env.local', '.env.production',  # Don't overwrite server .env
    'ssh_setup.py', 'deploy_full.py',
    'stratus-deploy.tar.gz', 'vps_state.txt',
    'check_vps.py', 'deploy_lean.py',
}

# File extensions to exclude
EXCLUDE_EXTS = {'.log', '.exe', '.blockmap', '.nsi', '.msi', '.dll', '.pdb'}


def ssh_connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {SERVER_IP}...")
    c.connect(SERVER_IP, username='root', password=PASSWORD, timeout=30)
    print("[OK] Connected!")
    return c


def run(client, cmd, timeout=600):
    print(f"\n>>> {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if out.strip():
        lines = out.strip().split('\n')
        for line in lines[-30:]:
            print(f"  {line}")
    if err.strip():
        for line in err.strip().split('\n')[-10:]:
            if 'warning' not in line.lower():
                print(f"  [stderr] {line}")
    print(f"  EXIT: {code}")
    return code, out, err


def create_archive():
    """Create a lean tar.gz archive in memory"""
    print("\n=== Creating lean archive ===")
    buf = io.BytesIO()
    file_count = 0
    
    with tarfile.open(fileobj=buf, mode='w:gz', compresslevel=6) as tar:
        for root, dirs, files in os.walk(LOCAL_ROOT):
            # Filter out excluded directories
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            
            for f in files:
                if f in EXCLUDE_FILES:
                    continue
                _, ext = os.path.splitext(f)
                if ext.lower() in EXCLUDE_EXTS:
                    continue
                
                full_path = os.path.join(root, f)
                arc_name = os.path.relpath(full_path, LOCAL_ROOT)
                
                # Skip files larger than 5MB (likely binaries)
                try:
                    if os.path.getsize(full_path) > 5 * 1024 * 1024:
                        continue
                except OSError:
                    continue
                
                try:
                    tar.add(full_path, arcname=arc_name)
                    file_count += 1
                except Exception:
                    pass
    
    buf.seek(0)
    size_mb = len(buf.getvalue()) / (1024 * 1024)
    print(f"  Archive: {size_mb:.1f} MB, {file_count} files")
    return buf


def upload(client, archive_buf):
    """Upload archive to server via SFTP"""
    print("\n=== Uploading to server ===")
    sftp = client.open_sftp()
    
    # Upload in chunks to avoid timeout
    remote_path = f"{APP_DIR}/stratus.tar.gz"
    archive_buf.seek(0)
    
    sftp.putfo(archive_buf, remote_path)
    sftp.close()
    print("  [OK] Upload complete")


def deploy(client):
    """Extract and rebuild on server"""
    print("\n=== Extracting on server ===")
    run(client, f"cd {APP_DIR} && tar -xzf stratus.tar.gz && rm stratus.tar.gz")
    
    print("\n=== Building Docker image (may take 5-10 min) ===")
    code, out, err = run(client, 
        f"cd {APP_DIR} && docker compose -f {COMPOSE_FILE} up -d --build stratus 2>&1",
        timeout=900)
    
    if code != 0:
        print("  [WARN] Build may have had issues, checking container status...")
    
    print("\n=== Waiting for startup (30s) ===")
    time.sleep(30)
    
    print("\n=== Container Status ===")
    run(client, f"cd {APP_DIR} && docker compose -f {COMPOSE_FILE} ps")
    
    print("\n=== Health Check ===")
    run(client, "curl -s http://localhost:5000/api/health 2>/dev/null || echo 'Health check via curl failed, trying wget...' && wget -q -O- http://localhost:5000/api/health 2>/dev/null || echo 'Health endpoint not reachable yet'")
    
    print("\n=== Recent Logs ===")
    run(client, f"cd {APP_DIR} && docker compose -f {COMPOSE_FILE} logs --tail=20 stratus 2>&1", timeout=30)


def main():
    print("=" * 50)
    print("  STRATUS LEAN DEPLOY")
    print(f"  Server: {SERVER_IP}")
    print("=" * 50)
    
    archive_buf = create_archive()
    
    client = ssh_connect()
    try:
        upload(client, archive_buf)
        deploy(client)
        print("\n" + "=" * 50)
        print("  DEPLOYMENT COMPLETE!")
        print(f"  https://stratusweather.co.za")
        print("=" * 50)
    except Exception as e:
        print(f"\n[ERROR] {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()


if __name__ == "__main__":
    main()
