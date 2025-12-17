# Deployment Guide - Campbell Scientific Integration

## Pre-Deployment Checklist

### 1. Install Dependencies

```bash
npm install
```

This installs all required packages including:
- `serialport` - Serial port communication
- `@serialport/parser-readline` - Serial data parsing
- `crc` - CRC calculation for PakBus
- `modbus-serial` - Modbus protocol support
- `mqtt` - MQTT protocol support
- `node-cron` - Scheduled tasks

### 2. Environment Variables

Create a `.env` file in the root directory:

```env
# Database Configuration
DATABASE_URL=postgresql://username:password@host:5432/database_name

# Server Configuration
PORT=5000
NODE_ENV=production

# Optional: Demo Mode (bypasses authentication)
VITE_DEMO_MODE=false

# Netlify Identity (if using)
# These are automatically provided by Netlify
NETLIFY_SITE_ID=your-site-id
```

### 3. Database Migration

Run the database migration to create all tables:

```bash
npm run db:push
```

This creates:
- Extended `weather_stations` table
- `sensors` table
- `calibration_records` table
- `maintenance_events` table
- `configuration_changes` table
- `data_quality_flags` table
- `alarms` table
- `alarm_events` table
- `datalogger_programs` table
- `station_groups` table
- `station_group_members` table

## Netlify Deployment

### Step 1: Configure Netlify Environment Variables

In your Netlify dashboard, go to **Site settings > Environment variables** and add:

```
DATABASE_URL=postgresql://username:password@host:5432/database_name
NODE_ENV=production
```

**IMPORTANT**: Do NOT commit database credentials to GitHub. Always use Netlify environment variables.

### Step 2: Build Configuration

The project is already configured with `netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "18"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Step 3: Deploy to GitHub

```bash
# Stage all changes
git add .

# Commit with descriptive message
git commit -m "Add Campbell Scientific integration with PakBus protocol, calibration tracking, and maintenance logging"

# Push to GitHub
git push origin main
```

### Step 4: Automatic Deployment

Netlify will automatically:
1. Detect the push to GitHub
2. Run `npm install`
3. Run `npm run build`
4. Deploy the built application
5. Make it available at your Netlify URL

### Step 5: Verify Deployment

1. Check Netlify dashboard for build status
2. Review build logs for any errors
3. Test the deployed application
4. Verify API endpoints are working

## Database Setup for Production

### Option 1: Neon (Recommended for Netlify)

1. Create account at https://neon.tech
2. Create a new project
3. Copy the connection string
4. Add to Netlify environment variables as `DATABASE_URL`

### Option 2: Supabase

1. Create account at https://supabase.com
2. Create a new project
3. Get the connection string from Settings > Database
4. Add to Netlify environment variables as `DATABASE_URL`

### Option 3: Railway

1. Create account at https://railway.app
2. Create a new PostgreSQL database
3. Copy the connection string
4. Add to Netlify environment variables as `DATABASE_URL`

### Option 4: Self-Hosted PostgreSQL

Ensure your PostgreSQL server:
- Is accessible from the internet
- Has proper firewall rules
- Uses SSL/TLS for connections
- Has sufficient storage for time-series data

## Post-Deployment Steps

### 1. Run Database Migration

After first deployment, run migration:

```bash
# Using Netlify CLI
netlify dev
npm run db:push

# Or connect to your database directly
psql $DATABASE_URL < migration.sql
```

### 2. Configure First Station

Use the API to add your first weather station:

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

### 3. Start Data Collection

```bash
curl -X POST https://your-app.netlify.app/api/campbell/stations/1/start
```

### 4. Monitor Status

```bash
curl https://your-app.netlify.app/api/campbell/stations/1/status
```

## Troubleshooting Deployment

### Build Fails

**Check build logs in Netlify dashboard**

Common issues:
- Missing dependencies: Run `npm install` locally first
- TypeScript errors: Fix compilation errors
- Environment variables: Ensure all required vars are set

### Database Connection Issues

**Error**: "Could not connect to database"

Solutions:
1. Verify `DATABASE_URL` is set in Netlify
2. Check database is accessible from internet
3. Verify connection string format
4. Check database firewall rules

### Functions Timeout

**Error**: "Function execution timed out"

Solutions:
1. Increase function timeout in `netlify.toml`:
   ```toml
   [functions]
     timeout = 30
   ```
2. Optimize database queries
3. Add connection pooling

### Serial Port Not Working

**Note**: Serial port connections (RS-232) are **not supported** in Netlify serverless functions.

For serial connections, you need:
1. Self-hosted server (VPS, dedicated server)
2. Physical access to serial ports
3. Use Netlify for frontend only
4. Run backend separately with serial support

Alternative: Use a gateway device that converts serial to TCP/IP.

## Production Considerations

### 1. Connection Limits

Netlify Functions have limits:
- 10 second timeout (can extend to 26 seconds)
- Limited concurrent executions
- No persistent connections

For production with many stations:
- Consider self-hosted backend
- Use serverless for API only
- Run data collection on dedicated server

### 2. Database Performance

For large deployments:
- Use TimescaleDB for time-series optimization
- Add proper indexes (already included in schema)
- Implement data archiving strategy
- Monitor query performance

### 3. Monitoring

Set up monitoring:
- Netlify Analytics for traffic
- Database monitoring (query performance)
- Error tracking (Sentry, LogRocket)
- Uptime monitoring (UptimeRobot, Pingdom)

### 4. Backups

Implement backup strategy:
- Automated database backups (daily)
- Configuration backups
- Calibration certificate backups
- Maintenance photo backups

### 5. Security

Security checklist:
- ✅ Use HTTPS (automatic with Netlify)
- ✅ Environment variables for secrets
- ✅ Authentication required for write operations
- ✅ Input validation on all endpoints
- ✅ SQL injection prevention (using Drizzle ORM)
- ✅ Rate limiting (consider adding)
- ✅ CORS configuration (configure as needed)

## Scaling Considerations

### Small Deployment (1-10 stations)
- Netlify Functions: ✅ Suitable
- Database: Neon/Supabase free tier
- Storage: Netlify included storage

### Medium Deployment (10-50 stations)
- Netlify Functions: ⚠️ May need optimization
- Database: Paid tier with more connections
- Storage: Consider S3 for photos/certificates

### Large Deployment (50+ stations)
- Netlify Functions: ❌ Not recommended
- Self-hosted backend: ✅ Required
- Database: Dedicated PostgreSQL/TimescaleDB
- Storage: S3 or similar object storage
- Load balancing: Consider multiple servers

## Alternative Deployment Options

### Option 1: Docker Deployment

```dockerfile
# Dockerfile already included in project
docker build -t stratus-weather .
docker run -p 5000:5000 -e DATABASE_URL=$DATABASE_URL stratus-weather
```

### Option 2: VPS Deployment (DigitalOcean, Linode, etc.)

```bash
# On your VPS
git clone https://github.com/your-username/stratus.git
cd stratus
npm install
npm run build
npm start

# Use PM2 for process management
npm install -g pm2
pm2 start npm --name "stratus" -- start
pm2 save
pm2 startup
```

### Option 3: Kubernetes Deployment

```yaml
# kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stratus-weather
spec:
  replicas: 3
  selector:
    matchLabels:
      app: stratus-weather
  template:
    metadata:
      labels:
        app: stratus-weather
    spec:
      containers:
      - name: stratus
        image: your-registry/stratus-weather:latest
        ports:
        - containerPort: 5000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: stratus-secrets
              key: database-url
```

## Monitoring & Maintenance

### Health Check Endpoint

```bash
# Check if server is running
curl https://your-app.netlify.app/api/health
```

### Station Status Check

```bash
# Check all stations
curl https://your-app.netlify.app/api/campbell/stations/status
```

### Database Health

```bash
# Check database connection
curl https://your-app.netlify.app/api/db/health
```

### Logs

View logs in Netlify dashboard:
1. Go to Functions tab
2. Select function
3. View real-time logs

## Rollback Procedure

If deployment fails:

1. **Netlify Dashboard**: Click "Deploys" > Select previous deploy > "Publish deploy"

2. **Git**: Revert commit and push
   ```bash
   git revert HEAD
   git push origin main
   ```

3. **Database**: Restore from backup if schema changed
   ```bash
   psql $DATABASE_URL < backup.sql
   ```

## Support

For deployment issues:
- Netlify Support: https://answers.netlify.com
- GitHub Issues: https://github.com/reuxnergy-admin1/stratus/issues
- Documentation: See CAMPBELL_IMPLEMENTATION.md

---

**Last Updated**: December 2024  
**Version**: 1.0.0
