#!/usr/bin/env python3
"""Full Stratus deployment script"""
import paramiko
import os
import sys
import tarfile
import io

# Configuration — set via environment variables (never hardcode credentials)
SERVER_IP = os.environ.get("STRATUS_DEPLOY_HOST", "")
USERNAME = os.environ.get("STRATUS_DEPLOY_USER", "root")
PASSWORD = os.environ.get("STRATUS_DEPLOY_PASSWORD", "")
DOMAIN = os.environ.get("STRATUS_DOMAIN", "stratusweather1.dynv6.net")
ADMIN_EMAIL = os.environ.get("STRATUS_ADMIN_EMAIL", "")
ACME_EMAIL = os.environ.get("STRATUS_ACME_EMAIL", "")
APP_DIR = os.environ.get("STRATUS_DEPLOY_DIR", "/opt/stratus")

if not SERVER_IP or not PASSWORD:
    print("[ERROR] Set STRATUS_DEPLOY_HOST and STRATUS_DEPLOY_PASSWORD environment variables")
    sys.exit(1)

def ssh_connect():
    """Connect to server via SSH"""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {SERVER_IP}...")
    client.connect(SERVER_IP, username=USERNAME, password=PASSWORD, timeout=30)
    print("✓ Connected!")
    return client

def run_command(client, command, show_output=True, timeout=600):
    """Run a command on the server"""
    print(f"\n>>> {command[:80]}{'...' if len(command) > 80 else ''}")
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    
    output = stdout.read().decode()
    errors = stderr.read().decode()
    exit_code = stdout.channel.recv_exit_status()
    
    if show_output and output:
        for line in output.strip().split('\n')[-20:]:  # Last 20 lines
            print(f"  {line}")
    if errors and 'WARNING' not in errors and 'warning' not in errors:
        for line in errors.strip().split('\n')[-10:]:
            print(f"  [stderr] {line}")
    
    return exit_code, output, errors

def setup_server(client):
    """Setup server with Docker, firewall, etc."""
    print("\n" + "="*50)
    print("PHASE 1: Server Setup")
    print("="*50)
    
    commands = [
        # Update system
        ("Updating system packages...", "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y"),
        
        # Install essentials
        ("Installing essential packages...", "DEBIAN_FRONTEND=noninteractive apt-get install -y curl wget git ufw fail2ban htop"),
        
        # Install Docker
        ("Installing Docker...", "curl -fsSL https://get.docker.com | sh"),
        ("Enabling Docker...", "systemctl enable docker && systemctl start docker"),
        
        # Install Docker Compose
        ("Installing Docker Compose...", "apt-get install -y docker-compose-plugin"),
        
        # Configure firewall - IMPORTANT: Allow SSH first before enabling!
        ("Configuring firewall...", "ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw default deny incoming && ufw default allow outgoing && ufw --force enable"),
        
        # Configure fail2ban
        ("Configuring fail2ban...", """cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
maxretry = 3
bantime = 86400
EOF
systemctl enable fail2ban && systemctl restart fail2ban"""),
    ]
    
    for desc, cmd in commands:
        print(f"\n{desc}")
        exit_code, _, _ = run_command(client, cmd, show_output=False)
        if exit_code == 0:
            print(f"  ✓ Done")
        else:
            print(f"  ⚠ Warning (exit code {exit_code})")

def create_app_directory(client):
    """Create application directory and config files"""
    print("\n" + "="*50)
    print("PHASE 2: Application Configuration")
    print("="*50)
    
    # Generate secrets
    import secrets
    jwt_secret = secrets.token_hex(32)
    postgres_password = secrets.token_urlsafe(24)
    admin_password = secrets.token_urlsafe(16)
    
    print(f"\n Generated credentials (SAVE THESE!):")
    print(f"   Admin Email:    {ADMIN_EMAIL}")
    print(f"   Admin Password: {admin_password}")
    print(f"   DB Password:    {postgres_password}")
    
    # Create directory
    run_command(client, f"mkdir -p {APP_DIR}", show_output=False)
    
    # Create .env file
    env_content = f"""# Stratus Environment Configuration
# Generated automatically

DOMAIN={DOMAIN}
POSTGRES_PASSWORD={postgres_password}
CLIENT_JWT_SECRET={jwt_secret}
STRATUS_ADMIN_EMAIL={ADMIN_EMAIL}
STRATUS_ADMIN_PASSWORD={admin_password}
STRATUS_ADMIN_NAME=Admin
ACME_EMAIL={ACME_EMAIL}
NODE_ENV=production
PORT=5000
"""
    
    run_command(client, f"cat > {APP_DIR}/.env << 'ENVEOF'\n{env_content}\nENVEOF", show_output=False)
    run_command(client, f"chmod 600 {APP_DIR}/.env", show_output=False)
    print("  ✓ Environment file created")
    
    # Create docker-compose.yml
    compose_content = '''version: '3.8'

services:
  stratus:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: stratus-app
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=5000
      - DATABASE_URL=postgresql://stratus:${POSTGRES_PASSWORD}@postgres:5432/stratus
      - CLIENT_JWT_SECRET=${CLIENT_JWT_SECRET}
      - STRATUS_ADMIN_EMAIL=${STRATUS_ADMIN_EMAIL}
      - STRATUS_ADMIN_PASSWORD=${STRATUS_ADMIN_PASSWORD}
      - STRATUS_ADMIN_NAME=${STRATUS_ADMIN_NAME}
    volumes:
      - stratus-data:/app/data
      - stratus-logs:/app/logs
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - stratus-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.stratus.rule=Host(`${DOMAIN}`)"
      - "traefik.http.routers.stratus.entrypoints=websecure"
      - "traefik.http.routers.stratus.tls.certresolver=letsencrypt"
      - "traefik.http.services.stratus.loadbalancer.server.port=5000"

  postgres:
    image: postgres:15-alpine
    container_name: stratus-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_USER=stratus
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=stratus
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - stratus-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U stratus -d stratus"]
      interval: 10s
      timeout: 5s
      retries: 5

  traefik:
    image: traefik:v2.10
    container_name: stratus-traefik
    restart: unless-stopped
    command:
      - "--api.dashboard=false"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.web.http.redirections.entryPoint.to=websecure"
      - "--entrypoints.web.http.redirections.entryPoint.scheme=https"
      - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt-data:/letsencrypt
    networks:
      - stratus-network

volumes:
  stratus-data:
  stratus-logs:
  postgres-data:
  letsencrypt-data:

networks:
  stratus-network:
    driver: bridge
'''
    
    run_command(client, f"cat > {APP_DIR}/docker-compose.yml << 'COMPOSEEOF'\n{compose_content}\nCOMPOSEEOF", show_output=False)
    print("  ✓ Docker Compose file created")
    
    return admin_password, postgres_password

def upload_application(client):
    """Upload application files to server"""
    print("\n" + "="*50)
    print("PHASE 3: Uploading Application")
    print("="*50)
    
    # Create tarball locally
    local_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    exclude_patterns = [
        'node_modules', 'dist', '.git', 'logs', '__pycache__',
        '.env', '.env.local', '*.log', 'deploy/ssh_setup.py', 'deploy/deploy_full.py'
    ]
    
    print(f"  Creating archive from {local_path}...")
    
    # Use SFTP to upload
    sftp = client.open_sftp()
    
    # Create tar in memory
    tar_buffer = io.BytesIO()
    with tarfile.open(fileobj=tar_buffer, mode='w:gz') as tar:
        for root, dirs, files in os.walk(local_path):
            # Filter directories
            dirs[:] = [d for d in dirs if d not in ['node_modules', 'dist', '.git', 'logs', '__pycache__']]
            
            for file in files:
                if file.endswith('.log') or file in ['.env', '.env.local', 'ssh_setup.py', 'deploy_full.py']:
                    continue
                    
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, local_path)
                try:
                    tar.add(file_path, arcname=arcname)
                except Exception as e:
                    pass  # Skip files we can't read
    
    tar_buffer.seek(0)
    tar_size = len(tar_buffer.getvalue()) / (1024 * 1024)
    print(f"  Archive size: {tar_size:.2f} MB")
    
    print("  Uploading to server...")
    tar_buffer.seek(0)
    sftp.putfo(tar_buffer, f"{APP_DIR}/stratus.tar.gz")
    sftp.close()
    print("  ✓ Upload complete")
    
    # Extract on server
    print("  Extracting files...")
    run_command(client, f"cd {APP_DIR} && tar -xzf stratus.tar.gz && rm stratus.tar.gz", show_output=False)
    print("  ✓ Files extracted")

def build_and_start(client):
    """Build and start Docker containers"""
    print("\n" + "="*50)
    print("PHASE 4: Building & Starting Containers")
    print("="*50)
    
    print("\n  Building Docker images (this may take 5-10 minutes)...")
    exit_code, output, errors = run_command(client, f"cd {APP_DIR} && docker compose build 2>&1", timeout=900)
    
    if exit_code != 0:
        print(f"  ⚠ Build had issues, checking...")
        print(errors[-500:] if errors else output[-500:])
    else:
        print("  ✓ Build complete")
    
    print("\n  Starting containers...")
    run_command(client, f"cd {APP_DIR} && docker compose up -d", timeout=120)
    
    print("\n  Waiting for services to start...")
    import time
    time.sleep(10)
    
    print("\n  Container status:")
    run_command(client, f"cd {APP_DIR} && docker compose ps")

def main():
    print("\n" + "="*50)
    print("  STRATUS DEPLOYMENT")
    print(f"  Server: {SERVER_IP}")
    print(f"  Domain: {DOMAIN}")
    print("="*50)
    
    client = ssh_connect()
    
    try:
        setup_server(client)
        admin_pass, db_pass = create_app_directory(client)
        upload_application(client)
        build_and_start(client)
        
        print("\n" + "="*50)
        print("  DEPLOYMENT COMPLETE!")
        print("="*50)
        print(f"\n  Your Stratus instance will be available at:")
        print(f"  https://{DOMAIN}")
        print(f"\n  Admin Login:")
        print(f"    Email:    {ADMIN_EMAIL}")
        print(f"    Password: {admin_pass}")
        print(f"\n  Note: SSL certificate may take a few minutes to provision.")
        print(f"\n  To check logs: ssh root@{SERVER_IP} 'cd /opt/stratus && docker compose logs -f'")
        
    except Exception as e:
        print(f"\n✗ Deployment failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    main()
