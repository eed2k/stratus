# Stratus Client Dashboard

A read-only weather dashboard for clients, designed to be hosted on Netlify.

## Features

- **Email/password login** - Secure authentication
- **Read-only dashboard** - View weather data without editing
- **Real-time updates** - Live data via WebSocket
- **Export** - Download data as CSV or PDF
- **Charts** - Temperature and humidity trends

## Setup

### 1. Install dependencies

```bash
cd netlify-client
npm install
```

### 2. Configure environment

Create a `.env` file:

```env
VITE_STRATUS_SERVER_URL=https://your-stratus-server.railway.app
VITE_STRATUS_WS_URL=wss://your-stratus-server.railway.app/ws
```

### 3. Development

```bash
npm run dev
```

### 4. Deploy to Netlify

1. Push this folder to a GitHub repository
2. Connect the repository to Netlify
3. Set the build command: `npm run build`
4. Set the publish directory: `dist`
5. Add environment variables in Netlify dashboard

## Client Accounts

### Demo Account
- Email: `demo@stratus.app`
- Password: `demo123`

### Creating Client Accounts

Use the admin API endpoint on your Stratus server:

```bash
curl -X POST https://your-stratus-server.railway.app/api/client/admin/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "client@example.com",
    "password": "secure-password",
    "name": "Client Name",
    "stationId": 1
  }'
```

## API Endpoints

The Netlify client connects to these endpoints on your Stratus server:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/client/login` | POST | Authenticate with email/password |
| `/api/client/verify` | GET | Verify token validity |
| `/api/client/station` | GET | Get station info |
| `/api/client/data/latest` | GET | Get latest weather data |
| `/api/client/data/history` | GET | Get historical data |
| `/api/client/export/csv` | GET | Export data as CSV |
| `/api/client/export/pdf` | POST | Export data as PDF |

## Architecture

```
┌─────────────────┐     HTTPS     ┌─────────────────┐
│  Netlify Client │◄────────────►│  Railway Server │
│  (React SPA)    │               │  (Stratus API)  │
└─────────────────┘               └─────────────────┘
       │                                   │
       │ User Login                        │ Weather Data
       │ View Dashboard                    │ from Campbell
       │ Export Data                       │ Loggers
       ▼                                   ▼
┌─────────────────┐               ┌─────────────────┐
│     Client      │               │    Stations     │
│    Browser      │               │   (CR1000X)     │
└─────────────────┘               └─────────────────┘
```

## License

MIT - Lukas Esterhuizen
