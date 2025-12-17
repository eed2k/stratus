# GitHub Deployment Instructions

## Quick Deployment Guide

Follow these steps to deploy the Campbell Scientific integration to GitHub and Netlify:

### Step 1: Verify Local Setup

```bash
# Install dependencies
npm install

# Verify build works
npm run build

# Test locally (optional)
npm run dev
```

### Step 2: Commit Changes

```bash
# Check status
git status

# Stage all changes
git add .

# Commit with descriptive message
git commit -m "Add Campbell Scientific integration with PakBus protocol, calibration tracking, and maintenance logging

Features:
- PakBus protocol implementation for Campbell Scientific dataloggers
- Multi-protocol connection support (Serial, TCP/IP, GSM, LoRa)
- Real-time data collection with automatic reconnection
- Research-grade calibration tracking with expiration alerts
- Maintenance event logging with photo support
- Comprehensive alarm system with notifications
- Data quality flagging linked to maintenance events
- Configuration audit trail for compliance
- Station grouping and multi-station support
- Extended database schema with 10+ new tables
- 45+ API endpoints for station management
- Complete documentation and deployment guides"
```

### Step 3: Push to GitHub

```bash
# Push to main branch
git push origin main

# Or if your default branch is master:
# git push origin master
```

### Step 4: Netlify Auto-Deploy

Netlify will automatically:
1. Detect the GitHub push
2. Install dependencies (`npm install`)
3. Build the application (`npm run build`)
4. Deploy to your Netlify URL

**Monitor deployment**: Check your Netlify dashboard for build progress and logs.

## Required Netlify Environment Variables

Before deployment, configure these in Netlify Dashboard → Site settings → Environment variables:

### Required Variables

```
DATABASE_URL=postgresql://username:password@host:port/database
NODE_ENV=production
```

### Optional Variables

```
VITE_DEMO_MODE=false
LOG_LEVEL=info
PAKBUS_TIMEOUT=30000
RECONNECT_INTERVAL=30
MAX_RECONNECT_ATTEMPTS=10
```

## Post-Deployment Steps

### 1. Run Database Migration

After first deployment, initialize the database:

```bash
# Option A: Using Netlify CLI
netlify dev
npm run db:push

# Option B: Direct database connection
# Connect to your PostgreSQL database and run:
# npm run db:push
```

### 2. Verify Deployment

```bash
# Check if API is responding
curl https://your-app.netlify.app/api/stations

# Check Campbell Scientific endpoints
curl https://your-app.netlify.app/api/campbell/stations/status
```

### 3. Configure First Station

```bash
curl -X POST https://your-app.netlify.app/api/stations \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Main Weather Station",
    "stationType": "campbell_scientific",
    "dataloggerModel": "CR1000X",
    "connectionType": "tcp",
    "protocol": "pakbus",
    "ipAddress": "192.168.1.100",
    "port": 6785,
    "pakbusAddress": 1,
    "dataTable": "OneMin",
    "pollInterval": 60,
    "isActive": true
  }'
```

## Troubleshooting

### Build Fails on Netlify

**Check build logs** in Netlify dashboard for specific errors.

Common issues:
- **Missing dependencies**: Ensure `package.json` includes all required packages
- **TypeScript errors**: Fix compilation errors locally first
- **Environment variables**: Verify all required variables are set in Netlify

### Database Connection Issues

**Error**: "Could not connect to database"

Solutions:
1. Verify `DATABASE_URL` is correctly set in Netlify environment variables
2. Ensure database is accessible from the internet
3. Check database firewall rules allow Netlify's IP ranges
4. Verify connection string format is correct

### Functions Timeout

**Error**: "Function execution timed out"

Solutions:
1. Increase timeout in `netlify.toml`:
   ```toml
   [functions]
     timeout = 30
   ```
2. Optimize database queries
3. Consider self-hosted backend for long-running operations

## Important Notes

### Serial Port Limitations

**Serial port connections (RS-232) are NOT supported in Netlify serverless functions.**

For serial connections:
- Use a self-hosted server with physical serial port access
- Deploy backend separately on a VPS or dedicated server
- Use Netlify for frontend only
- Alternative: Use a serial-to-TCP/IP gateway device

### Connection Types Supported on Netlify

✅ **Supported**:
- TCP/IP connections to dataloggers
- HTTP/HTTPS connections
- MQTT connections
- Any network-based protocol

❌ **Not Supported**:
- Serial port (RS-232) connections
- Direct USB connections
- Hardware-dependent connections

### Scaling Considerations

**Netlify Functions Limits**:
- 10 second timeout (extendable to 26 seconds)
- Limited concurrent executions
- No persistent connections

**For large deployments (50+ stations)**:
- Consider self-hosted backend
- Use Netlify for frontend/API gateway only
- Run data collection on dedicated servers

## Alternative Deployment Options

### Option 1: Self-Hosted (Recommended for Serial Connections)

```bash
# On your server
git clone https://github.com/your-username/stratus.git
cd stratus
npm install
npm run build

# Use PM2 for process management
npm install -g pm2
pm2 start npm --name "stratus" -- start
pm2 save
pm2 startup
```

### Option 2: Docker

```bash
docker build -t stratus-weather .
docker run -p 5000:5000 \
  -e DATABASE_URL=$DATABASE_URL \
  stratus-weather
```

### Option 3: Hybrid Deployment

- **Frontend**: Netlify (automatic from GitHub)
- **Backend**: Self-hosted server (for serial connections)
- **API Gateway**: Netlify Functions (for authentication)

## Continuous Deployment

Every push to the `main` branch will trigger automatic deployment:

```bash
# Make changes
git add .
git commit -m "Update feature X"
git push origin main

# Netlify automatically deploys
```

## Rollback

If deployment fails or has issues:

### Option 1: Netlify Dashboard
1. Go to Deploys tab
2. Find previous successful deploy
3. Click "Publish deploy"

### Option 2: Git Revert
```bash
git revert HEAD
git push origin main
```

## Monitoring

### Check Deployment Status

- **Netlify Dashboard**: Real-time build logs
- **GitHub Actions**: CI/CD status (if configured)
- **Application Logs**: Netlify Functions logs

### Health Checks

```bash
# API health
curl https://your-app.netlify.app/api/stations

# Station status
curl https://your-app.netlify.app/api/campbell/stations/status
```

## Security Checklist

Before deploying to production:

- [ ] All environment variables set in Netlify (not in code)
- [ ] Database credentials secured
- [ ] HTTPS enabled (automatic with Netlify)
- [ ] Authentication configured
- [ ] Rate limiting considered
- [ ] CORS configured appropriately
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (using Drizzle ORM)

## Support

For deployment issues:
- **Netlify Support**: https://answers.netlify.com
- **GitHub Issues**: https://github.com/reuxnergy-admin1/stratus/issues
- **Documentation**: See DEPLOYMENT.md and CAMPBELL_IMPLEMENTATION.md

---

**Ready to Deploy?**

```bash
git add .
git commit -m "Add Campbell Scientific integration"
git push origin main
```

Then check your Netlify dashboard for automatic deployment!

---

**Last Updated**: December 2024  
**Version**: 1.0.0
