# Weather Station App

## Overview
The Weather Station App is a comprehensive solution for collecting, processing, and visualizing weather data from various research-grade weather stations. It integrates with multiple communication protocols including RF, LoRa, and GSM to ensure reliable data acquisition.

## Features
- Real-time weather data collection
- Historical data retrieval
- 2D and 3D wind rose visualizations
- User-friendly dashboard for monitoring weather conditions
- Configuration options for weather stations
- API for external integrations

## Project Structure
```
weather-station-app
├── backend                # Backend application
│   ├── src               # Source code for the backend
│   ├── package.json      # Backend dependencies and scripts
│   └── tsconfig.json     # TypeScript configuration for the backend
├── frontend               # Frontend application
│   ├── src               # Source code for the frontend
│   ├── package.json      # Frontend dependencies and scripts
│   └── tsconfig.json     # TypeScript configuration for the frontend
├── shared                 # Shared code between frontend and backend
│   ├── types             # Shared TypeScript types
│   └── utils             # Shared utility functions
├── docker-compose.yml     # Docker configuration for the application
├── Dockerfile             # Dockerfile for building the application image
├── package.json           # Root project dependencies and scripts
└── tsconfig.json          # Root TypeScript configuration
```

## Installation
1. Clone the repository:
   ```
   git clone <repository-url>
   cd weather-station-app
   ```

2. Install dependencies for the backend:
   ```
   cd backend
   npm install
   ```

3. Install dependencies for the frontend:
   ```
   cd ../frontend
   npm install
   ```

4. Run the application using Docker:
   ```
   docker-compose up
   ```

## Usage
- Access the frontend application at `http://localhost:3000`.
- The backend API is available at `http://localhost:5000/api`.

## Contribution
Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License
This project is licensed under the MIT License. See the LICENSE file for details.