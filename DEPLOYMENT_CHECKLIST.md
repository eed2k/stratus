# Deployment Checklist - Campbell Scientific Integration

Use this checklist to ensure successful deployment to GitHub and Netlify.

## Pre-Deployment Checklist

### 1. Code Quality
- [x] All TypeScript files compile without errors
- [x] Database schema is complete and tested
- [x] API routes are implemented and functional
- [x] PakBus protocol library is complete
- [x] Connection manager handles all connection types
- [x] Data collection service is operational
- [ ] Unit tests written (optional for MVP)
- [ ] Integration tests written (optional for MVP)

### 2. Dependencies
- [x] All required npm packages added to `package.json`
- [x] `serialport` for serial communication
- [x] `crc` for PakBus CRC calculation
- [x] `modbus-serial` for Modbus support
- [x] `mqtt` for MQTT protocol
- [x] `node-cron` for scheduled tasks
- [x] No missing dependencies

### 3. Configuration Files
- [x] `netlify.toml` configured correctly
- [x] `.env.example` created with all variables
- [x] `.gitignore` includes `.env` and sensitive files
- [x] `package.json` has correct build scripts
- [x] `tsconfig.json` configured properly

### 4. Database
- [x] Database schema defined in `shared/schema.ts`
- [x] Migration script ready (`npm run db:push`)
- [ ] Database URL configured (do in Netlify)
- [ ] Database is accessible from internet
- [ ] Database has sufficient storage capacity

### 5. Documentation
- [x] `CAMPBELL_IMPLEMENTATION.md` - Technical documentation
- [x] `QUICK_START.md` - User guide
- [x] `DEPLOYMENT.md` - Deployment instructions
- [x] `GITHUB_DEPLOYMENT.md` - GitHub-specific guide
- [x] `IMPLEMENTATION_SUMMARY.md` - Overview
- [x] `.env.example` - Environment variables template
- [x] API endpoints documented in code

## Deployment Steps

### Step 1: Local Verification ✓

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Verify no errors
```

**Status**: ⬜ Not Started | ⬜ In Progress | ⬜ Complete

### Step 2: Environment Variables Setup

**In Netlify Dashboard** → Site settings → Environment variables:

Required:
- [ ] `DATABASE_URL` - PostgreSQL connection string
- [ ] `NODE_ENV` - Set to "production"

Optional:
- [ ] `VITE_DEMO_MODE` - Set to "false"
- [ ] `LOG_LEVEL` - Set to "info"

**Status**: ⬜ Not Started | ⬜ In Progress | ⬜ Complete

### Step 3: Git Commit

```bash
git add .
git commit -m "Add Campbell Scientific integration with PakBus protocol, calibration tracking, and maintenance logging"
```

**Status**: ⬜ Not Started | ⬜ In Progress | ⬜ Complete

### Step 4: Push to GitHub

```bash
git push origin main
```

**Status**: ⬜ Not Started | ⬜ In Progress | ⬜ Complete

### Step 5: Monitor Netlify Deployment

- [ ] Build started successfully
- [ ] Dependencies installed
- [ ] Build completed without errors
- [ ] Functions deployed
- [ ] Site is live

**Status**: ⬜ Not Started | ⬜ In Progress | ⬜ Complete

### Step 6: Database Migration

```bash
# Run database migration
npm run db:push
```

**Status**: ⬜ Not Started | ⬜ In Progress | ⬜ Complete

### Step 7: Post-Deployment Verification

Test these endpoints:

```bash
# Health check
curl https://your-app.netlify.app/api/stations

# Campbell endpoints
curl https://your-app.netlify.app/api/campbell/stations/status

# Create test station
curl -X POST https://your-app.netlify.app/api/stations \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Station","stationType":"campbell_scientific"}'
```

**Checklist**:
- [ ] API responds successfully
- [ ] Database connection works
- [ ] Authentication works (if enabled)
- [ ] WebSocket connections work
- [ ] No console errors in browser

**Status**: ⬜ Not Started | ⬜ In Progress | ⬜ Complete

## Post-Deployment Tasks

### Immediate Tasks (Day 1)
- [ ] Configure first weather station
- [ ] Add sensors to station
- [ ] Create calibration records
- [ ] Set up basic alarms
- [ ] Test data collection
- [ ] Verify data appears in database

### Short-term Tasks (Week 1)
- [ ] Add all weather stations
- [ ] Complete sensor inventory
- [ ] Upload calibration certificates
- [ ] Configure all alarms
- [ ] Set up maintenance schedule
- [ ] Train users on system

### Medium-term Tasks (Month 1)
- [ ] Monitor system performance
- [ ] Optimize database queries
- [ ] Review alarm effectiveness
- [ ] Collect user feedback
- [ ] Plan frontend enhancements
- [ ] Document any issues

## Known Limitations

### Netlify Serverless Limitations
- ⚠️ **Serial port connections NOT supported** - Use self-hosted server
- ⚠️ **10-26 second function timeout** - Long operations may timeout
- ⚠️ **No persistent connections** - Each request is stateless
- ⚠️ **Limited concurrent executions** - May need scaling for many stations

### Workarounds
- **Serial connections**: Deploy backend on VPS with serial port access
- **Long operations**: Use background jobs or separate worker
- **Many stations**: Consider self-hosted backend
- **Real-time updates**: Use WebSocket with connection pooling

## Rollback Plan

If deployment fails:

### Option 1: Netlify Dashboard Rollback
1. Go to Deploys tab
2. Find previous working deploy
3. Click "Publish deploy"

### Option 2: Git Revert
```bash
git revert HEAD
git push origin main
```

### Option 3: Database Rollback
```bash
# Restore from backup
psql $DATABASE_URL < backup.sql
```

## Success Criteria

Deployment is successful when:
- [x] Code is pushed to GitHub
- [ ] Netlify build completes successfully
- [ ] Application is accessible at Netlify URL
- [ ] Database connection works
- [ ] API endpoints respond correctly
- [ ] Can create and manage stations
- [ ] Can add sensors and calibrations
- [ ] Can configure alarms
- [ ] Data collection works (for network-based connections)
- [ ] No critical errors in logs

## Support Resources

- **Technical Documentation**: `CAMPBELL_IMPLEMENTATION.md`
- **Quick Start Guide**: `QUICK_START.md`
- **Deployment Guide**: `DEPLOYMENT.md`
- **GitHub Guide**: `GITHUB_DEPLOYMENT.md`
- **Netlify Support**: https://answers.netlify.com
- **GitHub Issues**: https://github.com/reuxnergy-admin1/stratus/issues

## Next Steps After Deployment

### Phase 2: Frontend Components
- [ ] Station configuration UI
- [ ] Sensor management interface
- [ ] Calibration tracking dashboard
- [ ] Maintenance logging forms
- [ ] Alarm management UI
- [ ] Data quality interface

### Phase 3: Advanced Features
- [ ] 3D wind roses (Three.js)
- [ ] Advanced statistical charts
- [ ] Heat maps and contour plots
- [ ] Multi-station comparison views
- [ ] Custom report generation
- [ ] Data export functionality

### Phase 4: Additional Protocols
- [ ] Modbus RTU/TCP implementation
- [ ] DNP3 protocol support
- [ ] LoRa/LoRaWAN connectivity
- [ ] Satellite communication

## Notes

**Date Started**: _________________

**Deployed By**: _________________

**Deployment URL**: _________________

**Database Provider**: _________________

**Issues Encountered**:
- 
- 
- 

**Resolution**:
- 
- 
- 

---

**Deployment Status**: ⬜ Not Started | ⬜ In Progress | ⬜ Complete | ⬜ Failed

**Last Updated**: December 2024
