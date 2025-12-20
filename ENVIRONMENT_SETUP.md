# Quick Environment Setup Guide

## For Windows Development

### Prerequisites Check
```powershell
# Check Node.js installation
node --version    # Should be v16+ (target v18 LTS)
npm --version     # Should be v7+

# If not installed:
# Download from https://nodejs.org/ (LTS version recommended)
# Or use Windows Package Manager:
winget install OpenJS.NodeJS
```

### Step 1: Install Dependencies
```powershell
cd "c:\Users\eed2k\Downloads\New folder\stratus"

# Install npm packages
npm install

# Install protocol-specific packages
npm install axios mqtt serialport noble

# Install optional packages (for specific protocols)
npm install modbus-serial dnp3
npm install body-parser cors express-ws
npm install dotenv

# For development
npm install --save-dev nodemon ts-node
```

### Step 2: Create Environment Configuration
```powershell
# Create .env file in root directory
$env:CAMPBELL_API_KEY = "your-campbell-api-key"
$env:RIKA_API_KEY = "your-rika-api-key"
$env:DATABASE_URL = "postgresql://user:pass@localhost/stratus_db"
$env:PORT = "5000"
$env:NODE_ENV = "development"

# Create .env.local for local overrides (not committed to git)
# .env.local content:
# CAMPBELL_API_KEY=test-key-local
# RIKA_API_KEY=test-key-local
```

### Step 3: Setup Database (PostgreSQL)
```powershell
# Install PostgreSQL if not present
winget install PostgreSQL.PostgreSQL

# Or use Docker
docker run --name stratus-db -e POSTGRES_DB=stratus_db -p 5432:5432 -d postgres:15

# Create database
psql -U postgres -c "CREATE DATABASE stratus_db;"

# Run migrations (if needed)
npm run db:migrate
```

### Step 4: Start Development Server
```powershell
# Option 1: Standard development
npm run dev
# Server running on http://localhost:5000

# Option 2: With file watching (auto-restart on changes)
npm run dev:watch

# Option 3: Production build + run
npm run build
npm run start
```

### Step 5: Verify Installation
```powershell
# Test API is running
curl http://localhost:5000/api/protocols/status

# Should return: {"status":"ok","activeConnections":0,"protocols":[...]}

# Test validation endpoint
curl -X POST http://localhost:5000/api/station-setup/validate `
  -H "Content-Type: application/json" `
  -d '{
    "type": "http",
    "url": "https://api.example.com/weather",
    "refreshInterval": 300
  }'
```

---

## Quick Test Scripts

### Test Campbell Scientific Detection
```powershell
# Save as test-campbell.ps1
$body = @{
    url = "https://campbell.apiserver.com/stationdata/v1"
    apiKey = "your-test-key"
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:5000/api/station-setup/detect-service" `
  -Method POST `
  -Body $body `
  -ContentType "application/json"
```

### Test Generic HTTP Service
```powershell
# Save as test-generic.ps1
$body = @{
    type = "http"
    url = "https://api.openweathermap.org/data/2.5/weather"
    params = @{
        lat = "-34.0"
        lon = "18.8"
        appid = "your-openweather-key"
    }
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:5000/api/station-setup/validate" `
  -Method POST `
  -Body $body `
  -ContentType "application/json"
```

### Test WebSocket Real-time Updates
```powershell
# Install ws CLI tool
npm install -g ws

# Connect to WebSocket
wsc ws://localhost:5000/ws/protocols/http

# Will receive real-time data like:
# {"stationId":"123","data":{"temperature":23.5,"humidity":65,...}}
```

---

## Troubleshooting

### Port Already in Use
```powershell
# Find process using port 5000
netstat -ano | findstr :5000

# Kill the process
taskkill /PID <PID> /F

# Or change port in .env
$env:PORT = "5001"
npm run dev
```

### NPM Package Installation Issues
```powershell
# Clear npm cache
npm cache clean --force

# Remove node_modules and reinstall
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
```

### Database Connection Failed
```powershell
# Check PostgreSQL is running
Get-Process postgres

# Or with Docker
docker ps | findstr postgres

# Test connection manually
psql -U postgres -d stratus_db -c "SELECT version();"
```

### BLE Adapter Issues (Windows)
```powershell
# Ensure Bluetooth is enabled
# Settings > Devices > Bluetooth & other devices

# Install node-gyp for native compilation
npm install -g windows-build-tools

# Reinstall serialport/noble with native modules
npm rebuild
```

### Serial Port Issues (for Modbus/GSM)
```powershell
# List available COM ports
[System.IO.Ports.SerialPort]::GetPortNames()

# Update .env with correct port
$env:MODBUS_PORT = "COM3"
$env:GSM_PORT = "COM4"
```

---

## Development Tips

### Use VS Code REST Client Extension
```
Install: REST Client extension in VS Code

Create file: .http or .rest

Content:
### Validate Station Config
POST http://localhost:5000/api/station-setup/validate HTTP/1.1
Content-Type: application/json

{
  "type": "http",
  "url": "https://api.weather.service.com/data",
  "refreshInterval": 300
}

### List Providers
GET http://localhost:5000/api/station-setup/providers HTTP/1.1

### Test Connection
POST http://localhost:5000/api/station-setup/test HTTP/1.1
Content-Type: application/json

{
  "type": "http",
  "url": "https://api.openweathermap.org/data/2.5/weather",
  "params": {"lat": "-34", "lon": "18", "appid": "key"}
}

Then press "Send Request" to test directly in VS Code
```

### Enable Debug Logging
```powershell
# Set debug environment variable
$env:DEBUG = "stratus:*"

# Or for specific module
$env:DEBUG = "stratus:protocols:*"

npm run dev
```

### Monitor Real-time Connections
```powershell
# Open second terminal tab and watch active connections
while ($true) {
    Clear-Host
    $response = Invoke-WebRequest -Uri "http://localhost:5000/api/protocols/status" -UseBasicParsing
    Write-Host $response.Content
    Start-Sleep -Seconds 2
}
```

---

## Docker Setup (Optional but Recommended)

### Docker Development Environment
```dockerfile
# Create Dockerfile.dev in root directory
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5000
CMD ["npm", "run", "dev"]
```

### Docker Compose
```yaml
# Create docker-compose.dev.yml
version: '3.8'
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.dev
    ports:
      - "5000:5000"
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/stratus_db
      - CAMPBELL_API_KEY=${CAMPBELL_API_KEY}
      - RIKA_API_KEY=${RIKA_API_KEY}
    depends_on:
      - db
    volumes:
      - .:/app
      - /app/node_modules

  db:
    image: postgres:15
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=stratus_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### Run with Docker Compose
```powershell
docker-compose -f docker-compose.dev.yml up

# Or with detached mode
docker-compose -f docker-compose.dev.yml up -d

# View logs
docker-compose -f docker-compose.dev.yml logs -f app

# Stop services
docker-compose -f docker-compose.dev.yml down
```

---

## Recommended VS Code Extensions

### Essential Extensions
- **TypeScript Vue Plugin** - TypeScript support for Vue
- **Prettier** - Code formatter
- **ESLint** - Linter
- **Thunder Client** or **REST Client** - API testing
- **PostgreSQL** - Database client
- **Docker** - Docker support

### Install Extensions
```powershell
code --install-extension vscode.typescript-vue-plugin
code --install-extension esbenp.prettier-vscode
code --install-extension dbaeumer.vscode-eslint
code --install-extension rangav.vscode-thunder-client
code --install-extension ckolkman.vscode-postgres
code --install-extension ms-azuretools.vscode-docker
```

### VS Code Settings
```json
// .vscode/settings.json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "search.exclude": {
    "node_modules": true,
    "dist": true,
    ".git": true
  }
}
```

---

## Production Checklist

Before deploying to production:

- [ ] Set all environment variables in production
- [ ] Enable HTTPS/TLS for all connections
- [ ] Set up proper logging and monitoring
- [ ] Configure database backups
- [ ] Test all protocol adapters with real devices
- [ ] Set up rate limiting and CORS
- [ ] Enable database connection pooling
- [ ] Configure CI/CD pipeline
- [ ] Set up error tracking (Sentry/similar)
- [ ] Configure load balancer for API layer
- [ ] Set up Redis cache (optional but recommended)
- [ ] Test disaster recovery procedures
- [ ] Configure automated database migrations
- [ ] Set up health check endpoints
- [ ] Enable request logging for debugging

---

## Support Resources

### Documentation Files
- **BACKEND_SETUP_GUIDE.md** - Detailed integration guide
- **BACKEND_API_DOCUMENTATION.md** - Complete API reference
- **BACKEND_API_QUICK_REFERENCE.md** - Quick endpoint lookup
- **BACKEND_ARCHITECTURE.md** - System architecture diagrams
- **BACKEND_COMPLETE_STATUS.md** - Project completion summary

### Quick Links
- API Server: http://localhost:5000
- API Status: http://localhost:5000/api/protocols/status
- WebSocket: ws://localhost:5000/ws/protocols/{type}

### Common Commands
```powershell
npm run dev              # Start development server
npm run build            # Build TypeScript
npm run start            # Start production server
npm run db:migrate       # Run database migrations
npm run db:reset         # Reset database
npm test                 # Run tests
npm run lint             # Run linter
npm run format           # Format code
npm run type-check       # Check TypeScript types
```

---

*Setup Complete - Ready to Start Development*
