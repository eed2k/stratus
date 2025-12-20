# Quick Netlify Deployment Guide

## ✅ Your Code is Ready

Your complete backend implementation has been pushed to GitHub:
- **Repository:** https://github.com/reuxnergy-admin1/stratus.git
- **Branch:** main
- **Status:** Ready for deployment ✓

---

## 🚀 Deploy to Netlify in 5 Steps

### Step 1: Connect GitHub Repository
1. Go to https://app.netlify.com
2. Sign in with your GitHub account
3. Click **"New site from Git"**
4. Select **"GitHub"** as your Git provider
5. Find and select **reuxnergy-admin1/stratus**

### Step 2: Configure Build Settings
Netlify should auto-detect the build settings. Verify:

- **Owner:** Your Netlify team
- **Branch:** main
- **Build command:** `npm run build`
- **Publish directory:** `client/dist`
- **Node version:** 18.x or higher

### Step 3: Set Environment Variables
Click **"Site Settings"** → **"Build & Deploy"** → **"Environment"**

Add these variables:
```
VITE_API_URL=https://your-backend-domain.com
CAMPBELL_API_KEY=your-campbell-key
RIKA_API_KEY=your-rika-key
```

### Step 4: Deploy
1. Click **"Deploy site"**
2. Netlify will automatically:
   - Clone your GitHub repository
   - Install dependencies (`npm install`)
   - Build your app (`npm run build`)
   - Deploy to their CDN
3. Your frontend will be live in 2-5 minutes!

### Step 5: Configure Domain (Optional)
1. Under **"Site Settings"** → **"Domain management"**
2. Change the site name or connect a custom domain
3. Your app will be accessible at the custom domain

---

## 🔌 Backend Deployment

### Option A: Deploy to Vercel (Recommended)
```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Login to Vercel
vercel login

# 3. Deploy
vercel --prod
```

### Option B: Deploy to Railway
1. Go to https://railway.app
2. Click **"New Project"**
3. Select **"Deploy from GitHub"**
4. Select your stratus repository
5. Add PostgreSQL add-on
6. Configure environment variables
7. Deploy

### Option C: Deploy to Render
1. Go to https://render.com
2. Click **"New +"** → **"Web Service"**
3. Connect GitHub account
4. Select stratus repository
5. Choose Node environment
6. Add PostgreSQL database
7. Deploy

### Option D: Docker Deployment
```bash
# Build and deploy using the included Dockerfile
docker build -t stratus .
docker run -p 5000:5000 -e DATABASE_URL=... stratus
```

---

## 🔌 Database Setup

Your backend needs PostgreSQL. Choose one:

### Option 1: Managed PostgreSQL
- **Railway:** Includes free PostgreSQL tier
- **Render:** Free PostgreSQL instance
- **Vercel Postgres:** Integrated with Vercel
- **PlanetScale (MySQL):** Free tier available

### Option 2: Self-Hosted
- AWS RDS
- Google Cloud SQL
- DigitalOcean Managed Databases
- Supabase (PostgreSQL)

### Option 3: Local Development
```bash
# Install PostgreSQL locally
# Create database
psql -U postgres -c "CREATE DATABASE stratus_db;"

# Set connection string
$env:DATABASE_URL="postgresql://user:password@localhost:5432/stratus_db"

# Run migrations
npm run db:migrate
```

---

## 🧪 Testing Your Deployment

### Test Frontend
```bash
# After Netlify deployment, visit:
# https://your-site-name.netlify.app
```

### Test Backend
```powershell
# Replace YOUR_BACKEND_URL with your actual backend domain
$backend = "https://your-backend-domain.com"

# Test API status
curl "$backend/api/protocols/status"

# Should return:
# {"status":"ok","activeConnections":0,"protocols":[...]}
```

### Test Station Setup
```powershell
# Test validation endpoint
curl -X POST "$backend/api/station-setup/validate" `
  -H "Content-Type: application/json" `
  -d '{"connectionType":"http","config":{}}'

# Should return:
# {"valid":true,"errors":[]}
```

---

## 📊 Monitor Deployment

### Netlify Dashboard
- View build logs: **"Deploys"** tab
- Check environment: **"Build & Deploy"** → **"Environment"**
- View site analytics: **"Analytics"** tab

### Common Issues

**Build fails with "npm install error"**
- Check Node version (should be 18+)
- Clear build cache and retry

**API connection errors**
- Verify `VITE_API_URL` environment variable
- Check backend is running and accessible
- Verify CORS settings on backend

**Database connection errors**
- Test `DATABASE_URL` locally first
- Ensure database is accessible from backend server
- Check credentials in environment variables

---

## 🔐 Security Checklist

Before going live, ensure:

- [ ] API keys are in environment variables (not in code)
- [ ] HTTPS is enabled (Netlify auto-provides)
- [ ] Database password is strong (20+ characters)
- [ ] Backend validates all inputs
- [ ] CORS is properly configured
- [ ] Rate limiting is enabled
- [ ] Authentication is implemented
- [ ] Logs don't contain sensitive data

---

## 📱 How Your Users Will Use It

1. User visits your Netlify site
2. Clicks "Add Station"
3. Selects station type (Campbell, Davis, Rika, Generic)
4. Enters connection details
5. Backend validates configuration
6. Backend tests connection
7. Station saved to database
8. Real-time data flows from station to user's browser
9. Dashboard displays live weather data

---

## 🎯 What Happens After Deploy

### Automatic Deploys
- Every push to `main` branch triggers a build
- Netlify runs tests and builds
- If successful, automatically deploys
- Takes 2-5 minutes

### Manual Rollback
If something breaks:
1. Go to **"Deploys"** tab
2. Find previous working deploy
3. Click **"Trigger deploy"** on that version
4. Your site reverts instantly

### Build Performance
- First build: ~5 minutes
- Subsequent builds: ~2-3 minutes
- Cached dependencies speed up future builds

---

## 💡 Pro Tips

1. **Preview URLs:** Each deploy gets a unique preview URL before publishing
2. **Deploy previews:** PRs get automatic preview deployments
3. **Scheduled deploys:** Set up nightly rebuilds to keep dependencies fresh
4. **Notifications:** Add GitHub status checks to track deployments
5. **Analytics:** Monitor user traffic and performance metrics

---

## 🆘 Getting Help

### Documentation
- Netlify Docs: https://docs.netlify.com
- Your API Docs: See BACKEND_API_DOCUMENTATION.md
- Setup Guide: See BACKEND_SETUP_GUIDE.md

### Support
- Netlify Support: https://support.netlify.com
- GitHub Issues: Open an issue in your repo

### Monitoring
- Netlify Analytics: Monitor usage and errors
- Error logs: Check browser console and backend logs
- Uptime: Set up monitoring with UptimeRobot

---

## Next: Enable Real-Time Updates

After deployment, implement WebSocket for live data:

```typescript
// Example: Connect to live weather data
const ws = new WebSocket('wss://your-backend/ws');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('New weather data:', data.temperature, data.humidity);
  // Update UI here
};
```

---

**You're all set! Your weather station web app is ready to deploy! 🎉**
