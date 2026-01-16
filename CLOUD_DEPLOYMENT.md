# Cloud Deployment Guide

This guide covers free and low-cost cloud deployment options for Stratus Weather Station with **free subdomains**.

---

## Recommended Platforms (Free Tier + Free Subdomain)

### 1. Render (Recommended)

**Why Render:**
- Free tier with 750 hours/month
- Free subdomain: `your-app.onrender.com`
- Auto-deploy from GitHub
- Free PostgreSQL database (90 days, then $7/month)
- SSL included

**Setup Steps:**

1. **Create Account**
   - Go to [render.com](https://render.com) and sign up with GitHub

2. **Create Web Service**
   - Click "New" → "Web Service"
   - Connect your GitHub repository
   - Configure:
     ```
     Name: stratus-weather
     Environment: Node
     Build Command: npm install && npm run build
     Start Command: npm run start
     ```

3. **Environment Variables**
   Add in Render dashboard:
   ```
   NODE_ENV=production
   PORT=5000
   DATABASE_URL=<from Render PostgreSQL>
   CLIENT_JWT_SECRET=<generate-secure-secret>
   DROPBOX_APP_KEY=<your-key>
   DROPBOX_APP_SECRET=<your-secret>
   ```

4. **Add PostgreSQL**
   - Click "New" → "PostgreSQL"
   - Copy the Internal Database URL
   - Add as `DATABASE_URL` environment variable

5. **Deploy**
   - Render auto-deploys on git push
   - Your app: `https://stratus-weather.onrender.com`

**Limitations:**
- Free tier spins down after 15 minutes of inactivity
- First request after sleep takes ~30 seconds

---

### 2. Fly.io

**Why Fly.io:**
- Free tier: 3 shared-cpu VMs
- Free subdomain: `your-app.fly.dev`
- Global deployment (edge locations)
- Persistent volumes available
- Free PostgreSQL

**Setup Steps:**

1. **Install Fly CLI**
   ```bash
   # Windows (PowerShell)
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   
   # Or download from https://fly.io/docs/hands-on/install-flyctl/
   ```

2. **Login & Initialize**
   ```bash
   fly auth login
   cd stratus
   fly launch
   ```

3. **Configure fly.toml**
   ```toml
   app = "stratus-weather"
   primary_region = "jnb"  # Johannesburg (closest to SA)
   
   [build]
     builder = "heroku/buildpacks:20"
   
   [env]
     NODE_ENV = "production"
     PORT = "8080"
   
   [http_service]
     internal_port = 8080
     force_https = true
   
   [[services.ports]]
     handlers = ["http"]
     port = 80
   
   [[services.ports]]
     handlers = ["tls", "http"]
     port = 443
   ```

4. **Create PostgreSQL**
   ```bash
   fly postgres create --name stratus-db
   fly postgres attach --app stratus-weather stratus-db
   ```

5. **Set Secrets**
   ```bash
   fly secrets set CLIENT_JWT_SECRET="your-secret"
   fly secrets set DROPBOX_APP_KEY="your-key"
   fly secrets set DROPBOX_APP_SECRET="your-secret"
   ```

6. **Deploy**
   ```bash
   fly deploy
   ```

**Your app:** `https://stratus-weather.fly.dev`

---

### 3. Koyeb

**Why Koyeb:**
- Free tier: 1 nano instance
- Free subdomain: `your-app.koyeb.app`
- Auto-deploy from GitHub
- Global edge network
- Built-in PostgreSQL

**Setup Steps:**

1. **Create Account**
   - Go to [koyeb.com](https://koyeb.com) and sign up

2. **Create Service**
   - Click "Create Service" → "Web Service"
   - Connect GitHub repository
   - Configure:
     ```
     Name: stratus-weather
     Instance: Nano (free)
     Region: Frankfurt or closest
     Build: npm install && npm run build
     Run: npm run start
     Port: 5000
     ```

3. **Environment Variables**
   ```
   NODE_ENV=production
   DATABASE_URL=<your-db-url>
   CLIENT_JWT_SECRET=<your-secret>
   ```

4. **Deploy**
   - Auto-deploys on push
   - Your app: `https://stratus-weather-<hash>.koyeb.app`

---

### 4. Cyclic.sh

**Why Cyclic:**
- Generous free tier
- Free subdomain: `your-app.cyclic.app`
- No cold starts (always warm)
- Simple GitHub integration
- AWS S3 storage included

**Setup Steps:**

1. **Create Account**
   - Go to [cyclic.sh](https://cyclic.sh) and connect GitHub

2. **Deploy**
   - Select your repository
   - Cyclic auto-detects Node.js
   - Configure environment variables in dashboard

3. **Database**
   - Use included AWS DynamoDB or
   - Connect external PostgreSQL (Neon, Supabase)

**Your app:** `https://stratus-weather.cyclic.app`

---

### 5. Vercel (Frontend) + Serverless Functions

**Why Vercel:**
- Free tier with 100GB bandwidth
- Free subdomain: `your-app.vercel.app`
- Excellent for React frontends
- Edge functions available

**Note:** Vercel is optimized for serverless. For Stratus's Express backend with WebSockets, consider:
- Deploy frontend on Vercel
- Deploy backend on Render/Fly.io

---

## Database Options (Free Tier)

### Neon (PostgreSQL)
- Free: 1 project, 3GB storage
- Auto-scaling, serverless
- `postgresql://...@ep-xxx.us-east-2.aws.neon.tech/neondb`

### Supabase (PostgreSQL)
- Free: 500MB database
- Built-in auth, storage, realtime
- `postgresql://postgres:password@db.xxx.supabase.co:5432/postgres`

### PlanetScale (MySQL)
- Free: 5GB storage
- Serverless, auto-scaling

### MongoDB Atlas
- Free: 512MB
- Great for document storage

---

## Quick Comparison

| Platform | Free Subdomain | Cold Starts | Free DB | Best For |
|----------|---------------|-------------|---------|----------|
| **Render** | ✅ `.onrender.com` | Yes (15 min) | 90 days | Full-stack apps |
| **Fly.io** | ✅ `.fly.dev` | Configurable | Yes | Global deployment |
| **Koyeb** | ✅ `.koyeb.app` | Minimal | Add-on | Simple deploys |
| **Cyclic** | ✅ `.cyclic.app` | No | DynamoDB | Always-on apps |

---

## Recommended Setup for Stratus

**Best Free Option: Render**
1. Deploy to Render Web Service
2. Use Neon PostgreSQL (free forever)
3. Result: `https://your-station.onrender.com`

**Best Performance: Fly.io**
1. Deploy to Fly.io (Johannesburg region)
2. Use Fly Postgres
3. Result: `https://your-station.fly.dev`

---

## Environment Variables Reference

All platforms need these environment variables:

```env
# Required
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://user:pass@host:5432/db
CLIENT_JWT_SECRET=generate-a-long-random-string

# Dropbox Integration
DROPBOX_APP_KEY=your_app_key
DROPBOX_APP_SECRET=your_app_secret
DROPBOX_REFRESH_TOKEN=your_refresh_token

# Optional
VITE_DEMO_MODE=false
```

---

## Domain Setup (Optional)

To use your own domain (e.g., `weather.yourdomain.com`):

1. **Add Custom Domain in Platform Dashboard**
2. **Update DNS Records:**
   - CNAME: `weather` → `your-app.onrender.com`
   - Or A record if provided by platform
3. **SSL Certificate:** Auto-provisioned by all platforms

---

## Monitoring & Logs

All platforms provide:
- Real-time logs
- Deployment history
- Basic metrics (CPU, memory)
- Uptime monitoring

For advanced monitoring, add:
- **Uptime Robot** (free uptime monitoring)
- **Better Stack** (free log management)
- **Sentry** (free error tracking)
