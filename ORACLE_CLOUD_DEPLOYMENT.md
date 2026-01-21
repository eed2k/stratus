# Stratus Weather Station - Oracle Cloud Deployment Guide

Deploy Stratus on Oracle Cloud's **Always Free** tier for 24/7 continuous operation.

## Why Oracle Cloud?

- **Truly Free Forever** - No charges after signup
- **24 GB RAM + 4 ARM cores** (or 2x 1GB AMD VMs)
- **200 GB storage** included
- **10 TB/month** outbound bandwidth
- Runs continuously 24/7 - perfect for weather data collection

---

## Prerequisites

- Oracle Cloud account: [cloud.oracle.com](https://cloud.oracle.com)
- Credit card for verification (won't be charged)
- SSH key pair for VM access

---

## Step 1: Create an Oracle Cloud Account

1. Go to [cloud.oracle.com](https://cloud.oracle.com)
2. Click **Sign Up**
3. Complete registration (requires credit card for verification)
4. Wait for account activation (usually instant)

---

## Step 2: Generate SSH Keys (if you don't have them)

### Windows (PowerShell):
```powershell
ssh-keygen -t rsa -b 4096 -f "$env:USERPROFILE\.ssh\oracle_key"
```

### Linux/Mac:
```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/oracle_key
```

---

## Step 3: Create a Free VM Instance

1. Login to Oracle Cloud Console
2. Navigate to: **Compute** → **Instances** → **Create Instance**

### Instance Configuration:

| Setting | Value |
|---------|-------|
| **Name** | `stratus-weather` |
| **Compartment** | (default) |
| **Availability Domain** | Any available |
| **Image** | Ubuntu 22.04 (or latest LTS) |
| **Shape** | Click **Change Shape** |

### Choose Shape (Free Tier Options):

**Option A - AMD (Recommended for beginners):**
- Shape: `VM.Standard.E2.1.Micro`
- 1 GB RAM, 1 OCPU
- ✅ Always Free eligible

**Option B - ARM (More powerful):**
- Shape: `VM.Standard.A1.Flex`
- Configure: 4 OCPUs, 24 GB RAM
- ✅ Always Free eligible (up to 4 cores + 24GB)

### Networking:
- Create new VCN or use existing
- Assign public IP: **Yes**
- Add SSH key: Paste your public key (`oracle_key.pub`)

4. Click **Create**
5. Wait for instance to be **Running** (2-5 minutes)

---

## Step 4: Configure Security Rules (Open Port 5000)

1. Go to: **Networking** → **Virtual Cloud Networks**
2. Click on your VCN
3. Click on **Security Lists** → **Default Security List**
4. Click **Add Ingress Rules**

| Setting | Value |
|---------|-------|
| Source Type | CIDR |
| Source CIDR | `0.0.0.0/0` |
| IP Protocol | TCP |
| Destination Port Range | `5000` |
| Description | Stratus Weather Server |

5. Click **Add Ingress Rules**

---

## Step 5: Connect to Your VM

Get your VM's public IP from the Instance Details page.

```powershell
# Windows
ssh -i "$env:USERPROFILE\.ssh\oracle_key" ubuntu@YOUR_VM_IP
```

```bash
# Linux/Mac
ssh -i ~/.ssh/oracle_key ubuntu@YOUR_VM_IP
```

---

## Step 6: Install Node.js and Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Git and build tools
sudo apt install -y git build-essential

# Verify installation
node --version  # Should show v20.x
npm --version
```

---

## Step 7: Clone and Build Stratus

```bash
# Clone your repository
git clone https://github.com/reuxnergy-admin1/stratus.git
cd stratus

# Install dependencies
npm install

# Build the application
npm run build
```

---

## Step 8: Configure Environment Variables

```bash
# Create environment file
nano .env
```

Add your configuration:
```env
NODE_ENV=production
PORT=5000

# IMPORTANT: Enable authentication for network deployments
# This MUST be set to 'true' when deploying to cloud/network
REQUIRE_AUTH=true

# Optional: Set log level (error, warn, info, debug)
LOG_LEVEL=info

# Optional: JWT secret for session management (auto-generated if not set)
# CLIENT_JWT_SECRET=your_secure_random_secret_here

# Optional: Dropbox integration (get from https://www.dropbox.com/developers/apps)
# DROPBOX_APP_KEY=your_app_key
# DROPBOX_APP_SECRET=your_app_secret
# DROPBOX_REFRESH_TOKEN=your_refresh_token
```

Save: `Ctrl+O`, `Enter`, `Ctrl+X`

---

## Step 9: Install PM2 for Process Management

PM2 keeps Stratus running 24/7 and auto-restarts on crashes.

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start Stratus with PM2
pm2 start npm --name "stratus" -- start

# Configure PM2 to start on boot
pm2 startup
# Run the command it outputs (starts with sudo)

# Save the process list
pm2 save
```

### Useful PM2 Commands:
```bash
pm2 status          # Check status
pm2 logs stratus    # View logs
pm2 restart stratus # Restart app
pm2 stop stratus    # Stop app
pm2 monit           # Real-time monitoring
```

---

## Step 10: Configure Firewall (UFW)

```bash
# Enable UFW
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 5000/tcp  # Stratus
sudo ufw enable

# Verify
sudo ufw status
```

---

## Step 11: Access Your Stratus Server

Open in your browser:
```
http://YOUR_VM_IP:5000
```

---

## Optional: Set Up HTTPS with Nginx

### Install Nginx:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### Configure Nginx:
```bash
sudo nano /etc/nginx/sites-available/stratus
```

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/stratus /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Open port 80
sudo ufw allow 80/tcp
```

### Add SSL (if you have a domain):
```bash
sudo certbot --nginx -d yourdomain.com
```

---

## Updating Stratus

```bash
cd ~/stratus
git pull
npm install
npm run build
pm2 restart stratus
```

---

## Troubleshooting

### Check if Stratus is running:
```bash
pm2 status
curl http://localhost:5000/api/stations
```

### View logs:
```bash
pm2 logs stratus --lines 100
```

### Check ports:
```bash
sudo netstat -tlnp | grep 5000
```

### Restart everything:
```bash
pm2 restart stratus
sudo systemctl restart nginx  # If using Nginx
```

### Memory issues:
```bash
# Check memory
free -h

# If low, restart PM2
pm2 restart stratus
```

---

## Free Tier Limits

| Resource | Always Free Limit |
|----------|-------------------|
| AMD Compute | 2 VMs (1 GB RAM each) |
| ARM Compute | 4 OCPUs + 24 GB RAM total |
| Block Storage | 200 GB total |
| Object Storage | 10 GB |
| Outbound Data | 10 TB/month |

Your Stratus instance will run **continuously 24/7** within these limits.

---

## Support

- Oracle Cloud Docs: [docs.oracle.com/en-us/iaas](https://docs.oracle.com/en-us/iaas/Content/home.htm)
- Stratus Issues: [GitHub Issues](https://github.com/reuxnergy-admin1/stratus/issues)
