#!/bin/bash
# =============================================================================
# Stratus Weather Station - Server Setup Script
# For Ubuntu 22.04 on Vultr VPS
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# =============================================================================
# Configuration - EDIT THESE VALUES
# =============================================================================
DOMAIN="${DOMAIN:-stratus.dynv6.net}"      # Your DynV6 domain
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -base64 16)}"
ADMIN_NAME="${ADMIN_NAME:-Admin}"
ACME_EMAIL="${ACME_EMAIL:-$ADMIN_EMAIL}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -base64 24)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"

APP_DIR="/opt/stratus"

echo ""
echo "=============================================="
echo "  Stratus Weather Station - Server Setup"
echo "=============================================="
echo ""

# =============================================================================
# 1. System Update and Basic Packages
# =============================================================================
log_info "Updating system packages..."
apt-get update && apt-get upgrade -y

log_info "Installing essential packages..."
apt-get install -y \
    curl \
    wget \
    git \
    ufw \
    fail2ban \
    htop \
    vim \
    unzip \
    software-properties-common \
    ca-certificates \
    gnupg \
    lsb-release

# =============================================================================
# 2. Install Docker
# =============================================================================
log_info "Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    log_success "Docker installed successfully"
else
    log_warn "Docker already installed"
fi

# Install Docker Compose plugin
log_info "Installing Docker Compose..."
apt-get install -y docker-compose-plugin
log_success "Docker Compose installed successfully"

# =============================================================================
# 3. Configure Firewall (UFW)
# =============================================================================
log_info "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
log_success "Firewall configured (SSH, HTTP, HTTPS allowed)"

# =============================================================================
# 4. Configure Fail2Ban
# =============================================================================
log_info "Configuring Fail2Ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 86400
EOF

systemctl enable fail2ban
systemctl restart fail2ban
log_success "Fail2Ban configured"

# =============================================================================
# 5. Create Application Directory
# =============================================================================
log_info "Creating application directory..."
mkdir -p $APP_DIR
cd $APP_DIR

# =============================================================================
# 6. Create Environment File
# =============================================================================
log_info "Creating environment configuration..."
cat > $APP_DIR/.env << EOF
# Stratus Environment Configuration
# Generated on $(date)

# Domain Configuration
DOMAIN=$DOMAIN

# Database
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# Application Security
CLIENT_JWT_SECRET=$JWT_SECRET

# Admin Account
STRATUS_ADMIN_EMAIL=$ADMIN_EMAIL
STRATUS_ADMIN_PASSWORD=$ADMIN_PASSWORD
STRATUS_ADMIN_NAME=$ADMIN_NAME

# SSL Certificate Email
ACME_EMAIL=$ACME_EMAIL

# Application Settings
NODE_ENV=production
PORT=5000
EOF

chmod 600 $APP_DIR/.env
log_success "Environment file created at $APP_DIR/.env"

# =============================================================================
# 7. Create Docker Compose File
# =============================================================================
log_info "Creating Docker Compose configuration..."
cat > $APP_DIR/docker-compose.yml << 'COMPOSE'
version: '3.8'

services:
  stratus:
    image: ghcr.io/stratus/stratus:latest
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
      - "traefik.http.routers.stratus.rule=Host(\`${DOMAIN}\`)"
      - "traefik.http.routers.stratus.entrypoints=websecure"
      - "traefik.http.routers.stratus.tls.certresolver=letsencrypt"
      - "traefik.http.services.stratus.loadbalancer.server.port=5000"
      - "traefik.http.routers.stratus-http.rule=Host(\`${DOMAIN}\`)"
      - "traefik.http.routers.stratus-http.entrypoints=web"
      - "traefik.http.routers.stratus-http.middlewares=https-redirect"
      - "traefik.http.middlewares.https-redirect.redirectscheme.scheme=https"

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
      - "--log.level=INFO"
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
COMPOSE

log_success "Docker Compose file created"

# =============================================================================
# 8. Create Systemd Service
# =============================================================================
log_info "Creating systemd service..."
cat > /etc/systemd/system/stratus.service << EOF
[Unit]
Description=Stratus Weather Station
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable stratus.service
log_success "Systemd service created and enabled"

# =============================================================================
# 9. Create Helper Scripts
# =============================================================================
log_info "Creating helper scripts..."

# Deploy script
cat > $APP_DIR/deploy.sh << 'DEPLOY'
#!/bin/bash
set -e
cd /opt/stratus
echo "Pulling latest changes..."
git pull origin main 2>/dev/null || echo "Not a git repo, skipping pull"
echo "Building and starting containers..."
docker compose build --no-cache
docker compose up -d
echo "Cleaning up old images..."
docker image prune -f
echo "Deployment complete!"
docker compose ps
DEPLOY
chmod +x $APP_DIR/deploy.sh

# Logs script
cat > $APP_DIR/logs.sh << 'LOGS'
#!/bin/bash
cd /opt/stratus
docker compose logs -f --tail=100 "$@"
LOGS
chmod +x $APP_DIR/logs.sh

# Backup script
cat > $APP_DIR/backup.sh << 'BACKUP'
#!/bin/bash
set -e
BACKUP_DIR="/opt/stratus/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

echo "Creating database backup..."
docker exec stratus-postgres pg_dump -U stratus stratus | gzip > "$BACKUP_DIR/stratus_db_$DATE.sql.gz"

echo "Creating data backup..."
docker run --rm -v stratus_stratus-data:/data -v $BACKUP_DIR:/backup alpine tar czf /backup/stratus_data_$DATE.tar.gz -C /data .

echo "Cleaning old backups (keeping last 7 days)..."
find $BACKUP_DIR -name "*.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_DIR"
ls -la $BACKUP_DIR
BACKUP
chmod +x $APP_DIR/backup.sh

# Status script
cat > $APP_DIR/status.sh << 'STATUS'
#!/bin/bash
cd /opt/stratus
echo "=== Stratus Status ==="
docker compose ps
echo ""
echo "=== Resource Usage ==="
docker stats --no-stream stratus-app stratus-postgres stratus-traefik 2>/dev/null || true
STATUS
chmod +x $APP_DIR/status.sh

log_success "Helper scripts created"

# =============================================================================
# 10. Setup Automatic Backups (Cron)
# =============================================================================
log_info "Setting up automatic daily backups..."
(crontab -l 2>/dev/null | grep -v "stratus/backup.sh"; echo "0 3 * * * $APP_DIR/backup.sh >> /var/log/stratus-backup.log 2>&1") | crontab -
log_success "Daily backup scheduled at 3:00 AM"

# =============================================================================
# 11. SSH Security Hardening
# =============================================================================
log_info "Hardening SSH configuration..."
sed -i 's/#PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config 2>/dev/null || true
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config 2>/dev/null || true
# Don't restart SSH automatically - let the user verify settings first
log_warn "SSH hardening prepared. Review /etc/ssh/sshd_config before restarting SSH"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "=============================================="
echo -e "${GREEN}  Stratus Server Setup Complete!${NC}"
echo "=============================================="
echo ""
echo "Configuration Summary:"
echo "  Domain:           $DOMAIN"
echo "  Admin Email:      $ADMIN_EMAIL"
echo "  App Directory:    $APP_DIR"
echo ""
echo "Generated Credentials (SAVE THESE!):"
echo "  Admin Password:   $ADMIN_PASSWORD"
echo "  DB Password:      $POSTGRES_PASSWORD"
echo "  JWT Secret:       $JWT_SECRET"
echo ""
echo "Next Steps:"
echo "  1. Configure your DynV6 domain to point to: $(curl -s ifconfig.me)"
echo "  2. Upload your Stratus code to $APP_DIR"
echo "  3. Run: cd $APP_DIR && docker compose up -d"
echo ""
echo "Useful Commands:"
echo "  View logs:        $APP_DIR/logs.sh"
echo "  Check status:     $APP_DIR/status.sh"
echo "  Deploy updates:   $APP_DIR/deploy.sh"
echo "  Create backup:    $APP_DIR/backup.sh"
echo ""
echo "=============================================="
