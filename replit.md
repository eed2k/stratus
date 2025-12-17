# STRATUS (WeatherView Pro)

## Overview

STRATUS is a professional weather station monitoring platform designed for real-time data visualization and analytics. The application enables users to manage Campbell Scientific and Rika weather stations, view current conditions, analyze historical data through interactive charts (including wind roses), and generate reports. It's built for agriculture, research, and professional weather monitoring use cases.

## Recent Changes (December 2025)
- Fixed React version compatibility (downgraded to React 18.3.1)
- Configured Tailwind CSS processing in Vite for proper styling
- Landing page features animated clouds floating over a sky-blue gradient with grass field
- Simplified landing page to show only hero section with "Credit: Lukas Esterhuizen 2025" footer
- Switched from Replit Auth to Netlify Identity authentication
- Added Campbell Scientific station configuration (Serial RS232, LoRa, GSM connections)
- Added Rika station configuration (IP-based HTTP/REST API)

The platform follows a full-stack architecture with a React frontend, Express backend, and PostgreSQL database, utilizing Netlify Identity for user management.

## Development

- Run the app: The workflow "Start application" runs `npx tsx server/index.ts` which starts the Express server on port 5000
- The server handles both the API and serves the Vite dev server in development mode
- Database: PostgreSQL with Drizzle ORM. Push schema changes with `npx drizzle-kit push --dialect=postgresql --schema=shared/schema.ts --url="$DATABASE_URL"`

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state, React hooks for local state
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Charts**: Recharts for data visualization, custom SVG-based WindRose component
- **Build Tool**: Vite with hot module replacement

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Style**: RESTful endpoints under `/api/*`
- **Real-time Updates**: WebSocket server for live weather data streaming
- **Authentication**: Netlify Identity with JWT tokens (see note below)
- **Session Management**: express-session with PostgreSQL store (connect-pg-simple)

**Authentication Note**: Netlify Identity does not expose JWT signing keys on free plans. For production, consider:
1. Deploying to Netlify and using Netlify Functions (auto-verifies tokens)
2. Upgrading to Netlify Business plan for custom JWT secret
3. Using an alternative auth provider (Auth0, Clerk, Firebase)

### Data Storage
- **Database**: PostgreSQL via Drizzle ORM
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Key Tables**:
  - `users` - User accounts (Replit Auth managed)
  - `sessions` - Session storage for authentication
  - `weatherStations` - Station metadata (name, location, coordinates, API keys)
  - `weatherData` - Time-series weather measurements
  - `userStations` - Many-to-many user-station associations
  - `userPreferences` - User settings (units, timezone, notifications)

### Authentication Flow
- Replit OIDC handles login/signup via `/api/login`
- Sessions persisted in PostgreSQL with 1-week TTL
- Protected routes check authentication via `isAuthenticated` middleware
- User data accessible via `/api/auth/user` endpoint

### Real-time Data Flow
- WebSocket endpoint at `/ws` for live updates
- Clients subscribe to specific station IDs
- Server broadcasts weather data updates to subscribed clients
- Automatic reconnection handling on client side

### Project Structure
```
├── client/src/          # React frontend
│   ├── components/      # UI components (dashboard, charts, auth)
│   ├── pages/          # Route pages (Dashboard, Stations, History, etc.)
│   ├── hooks/          # Custom React hooks
│   └── lib/            # Utilities and query client
├── server/             # Express backend
│   ├── routes.ts       # API route definitions
│   ├── storage.ts      # Database operations (IStorage interface)
│   ├── db.ts           # Drizzle database connection
│   └── replitAuth.ts   # Authentication setup
├── shared/             # Shared code between client/server
│   └── schema.ts       # Drizzle schema definitions
└── migrations/         # Database migrations (drizzle-kit)
```

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable
- **Drizzle ORM**: Type-safe database queries and schema management
- **drizzle-kit**: Migration tool (`npm run db:push` to sync schema)

### Authentication
- **Replit OIDC**: OAuth provider at `https://replit.com/oidc`
- Required environment variables:
  - `REPL_ID` - Replit project identifier
  - `SESSION_SECRET` - Session encryption key
  - `ISSUER_URL` - OIDC issuer (defaults to Replit)

### Frontend Libraries
- **@tanstack/react-query**: Server state management and caching
- **recharts**: Interactive chart library for weather data visualization
- **Radix UI**: Accessible component primitives (dialogs, dropdowns, tabs, etc.)
- **lucide-react**: Icon library
- **react-icons**: Additional social icons (Google, GitHub, Apple)
- **date-fns**: Date formatting and manipulation
- **wouter**: Client-side routing
- **vaul**: Drawer component for mobile interfaces

### Build & Development
- **Vite**: Development server and production bundler
- **esbuild**: Server-side bundling for production
- **TypeScript**: Type checking across the entire codebase
- **Tailwind CSS**: Utility-first styling with PostCSS

### Weather Data Integration
The platform is designed to receive data from Campbell Scientific dataloggers via multiple communication protocols (RS232, RF Telemetry, GSM, LoRa) as documented in `attached_assets/`. Weather stations can be configured with API keys and endpoints for data ingestion.