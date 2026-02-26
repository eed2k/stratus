# Stratus Deployment Guide

## Prerequisites

- Vultr VPS with Ubuntu 22.04 (or similar)
- DynV6 account and domain configured
- SSH access to the server

## Quick Deployment Steps

### 1. Configure Your DynV6 Domain

1. Go to [dynv6.com](https://dynv6.com) and log in
2. Create a new zone or use existing: `stratus.dynv6.net` (or your chosen subdomain)
3. Point the A record to your Vultr server IP
4. Note your **HTTP Token** from the Instructions page (needed for automatic updates)

### 2. Connect to Your Server

```bash
ssh root@YOUR_SERVER_IP
```

### 3. Run the Setup Script

Option A: Download and run directly:
```bash
curl -fsSL https://raw.githubusercontent.com/your-repo/stratus/main/deploy/server-setup.sh | bash
```

Option B: Copy the script manually and run:
```bash
# On your local machine, copy the script
scp deploy/server-setup.sh root@YOUR_SERVER_IP:/root/

# On the server
chmod +x /root/server-setup.sh
DOMAIN=stratus.dynv6.net ADMIN_EMAIL=your@email.com /root/server-setup.sh
```

### 4. Upload Your Application Code

From your local machine:
```bash
# Create a deployment package
tar -czf stratus-deploy.tar.gz \
    --exclude=node_modules \
    --exclude=dist \
    --exclude=.git \
    --exclude=logs \
    --exclude='*.log' \
    .

# Upload to server
scp stratus-deploy.tar.gz root@YOUR_SERVER_IP:/opt/stratus/

# On the server
cd /opt/stratus
tar -xzf stratus-deploy.tar.gz
rm stratus-deploy.tar.gz
```

### 5. Start the Application

```bash
cd /opt/stratus
docker compose up -d
```

### 6. Verify Deployment

```bash
# Check container status
docker compose ps

# View logs
docker compose logs -f stratus

# Test the endpoint
curl -I https://stratus.dynv6.net
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DOMAIN` | Yes | Your DynV6 domain (e.g., stratus.dynv6.net) |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password (auto-generated) |
| `CLIENT_JWT_SECRET` | Yes | JWT signing secret (auto-generated) |
| `STRATUS_ADMIN_EMAIL` | Yes | Admin account email |
| `STRATUS_ADMIN_PASSWORD` | Yes | Admin account password |
| `STRATUS_ADMIN_NAME` | No | Admin display name |
| `ACME_EMAIL` | Yes | Email for Let's Encrypt certificates |

---

## Useful Commands

### Container Management
```bash
# Start all services
cd /opt/stratus && docker compose up -d

# Stop all services
docker compose down

# Restart a specific service
docker compose restart stratus

# View logs
docker compose logs -f stratus
docker compose logs -f postgres
docker compose logs -f traefik
```

### Database Management
```bash
# Access PostgreSQL shell
docker exec -it stratus-postgres psql -U stratus -d stratus

# Create database backup
docker exec stratus-postgres pg_dump -U stratus stratus > backup.sql

# Restore database
cat backup.sql | docker exec -i stratus-postgres psql -U stratus -d stratus
```

### SSL Certificate Management
```bash
# Force certificate renewal
docker compose restart traefik

# View certificate status
docker exec stratus-traefik cat /letsencrypt/acme.json | jq '.letsencrypt.Certificates'
```

### Updates and Maintenance
```bash
# Pull and rebuild application
cd /opt/stratus
git pull
docker compose build --no-cache stratus
docker compose up -d

# Update all containers
docker compose pull
docker compose up -d

# Clean up old images
docker image prune -f
```

---

## Monitoring

### Check Service Health
```bash
# Overall status
/opt/stratus/status.sh

# Memory and CPU usage
docker stats

# Disk usage
df -h
docker system df
```

### Logs Location
- Application logs: `docker compose logs stratus`
- Traefik logs: `docker compose logs traefik`
- System logs: `/var/log/syslog`
- Backup logs: `/var/log/stratus-backup.log`

---

## Backup & Restore

### Manual Backup
```bash
/opt/stratus/backup.sh
```

### Restore from Backup
```bash
# Restore database
gunzip -c /opt/stratus/backups/stratus_db_YYYYMMDD_HHMMSS.sql.gz | \
    docker exec -i stratus-postgres psql -U stratus -d stratus

# Restore data volume
docker compose down
docker run --rm -v stratus_stratus-data:/data -v /opt/stratus/backups:/backup alpine \
    sh -c "rm -rf /data/* && tar xzf /backup/stratus_data_YYYYMMDD_HHMMSS.tar.gz -C /data"
docker compose up -d
```

---

## Troubleshooting

### Application Won't Start
```bash
# Check logs for errors
docker compose logs stratus

# Verify environment variables
cat /opt/stratus/.env

# Check database connection
docker exec stratus-postgres pg_isready -U stratus
```

### SSL Certificate Issues
```bash
# Check Traefik logs
docker compose logs traefik

# Verify DNS is pointing correctly
dig +short stratus.dynv6.net

# Test HTTP challenge
curl -I http://stratus.dynv6.net/.well-known/acme-challenge/test
```

### Database Issues
```bash
# Check PostgreSQL logs
docker compose logs postgres

# Verify database exists
docker exec stratus-postgres psql -U stratus -c "\l"

# Check database tables
docker exec stratus-postgres psql -U stratus -d stratus -c "\dt"
```

### Container Resource Issues
```bash
# Check if containers are OOM killed
dmesg | grep -i "killed process"

# Monitor resource usage
docker stats --no-stream
```

---

## Security Checklist

- [x] UFW firewall enabled (ports 22, 80, 443 only)
- [x] Fail2Ban configured for SSH protection
- [x] SSL/TLS via Let's Encrypt
- [x] Non-root user in Docker containers
- [x] Database not exposed externally
- [x] Environment secrets stored securely
- [ ] SSH key authentication only (disable password auth)
- [ ] Regular security updates (`apt update && apt upgrade`)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Vultr VPS (Ubuntu 22.04)                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                      Docker Network                      ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  ││
│  │  │   Traefik   │  │   Stratus   │  │   PostgreSQL    │  ││
│  │  │   (Proxy)   │──│    (App)    │──│      (DB)       │  ││
│  │  │  :80/:443   │  │    :5000    │  │     :5432       │  ││
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  Volumes: stratus-data, postgres-data, letsencrypt-data     │
└─────────────────────────────────────────────────────────────┘
```
