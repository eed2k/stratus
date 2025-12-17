# How to See Demo Station Data - Quick Guide

## 3 Simple Steps

### Step 1: Update Your .env File

1. Open `.env` in your project root
2. Go to Netlify Dashboard → Site settings → Environment variables
3. Copy the value of `SUPABASE_DATABASE_URL`
4. Replace line 3 in `.env`:

```env
DATABASE_URL=postgresql://postgres.xxxxx:your-password@aws-0-region.pooler.supabase.com:6543/postgres
```

### Step 2: Run Migration & Start Server

```bash
# Create database tables
npm run db:push

# Start development server
npm run dev
```

### Step 3: Initialize Demo Station

In a new terminal:

```bash
# Option 1: Use the script
node scripts/init-demo.js

# Option 2: Use curl
curl -X POST http://localhost:5000/api/demo/initialize

# Option 3: Use PowerShell
Invoke-WebRequest -Uri http://localhost:5000/api/demo/initialize -Method POST
```

## View Demo Data

1. Open http://localhost:5000 in your browser
2. Log in with your Netlify Identity account
3. Click **"Campbell Scientific"** in the sidebar
4. You'll see the demo station dashboard with:
   - Real-time weather data
   - Temperature, humidity, pressure, wind, solar, rain
   - Station status and battery voltage
   - Last update timestamp

## What You'll See

**Demo Station**: Pretoria, South Africa  
**Data**: 30 days of realistic weather patterns  
**Sensors**: 7 sensors with calibration records  
**Updates**: Dashboard refreshes every 10 seconds

## Troubleshooting

**"Cannot connect to database"**  
→ Check your DATABASE_URL in `.env` file

**"Table does not exist"**  
→ Run `npm run db:push`

**"Demo station already exists"**  
→ Demo can only be created once (it's already there!)

**No data showing**  
→ Check browser console (F12) for errors  
→ Verify server is running on http://localhost:5000

## Next: Continue Building Components

Once demo data is showing, we'll continue with:
- ✅ Dark blue theme (done)
- ✅ Station dashboard (done)
- ⏳ 2D wind rose visualization
- ⏳ 3D wind rose with Three.js
- ⏳ Calibration tracking UI
- ⏳ Maintenance logging interface
- ⏳ Alarm management dashboard

---

**Need Help?** Check `DEMO_STATION_SETUP.md` for detailed troubleshooting.
