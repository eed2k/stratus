/**
 * API Client for Stratus Server
 * Handles all communication with the Railway-hosted Stratus server
 * 
 * IMPORTANT: Set the VITE_STRATUS_SERVER_URL environment variable in Netlify:
 * 1. Go to Netlify Dashboard > Site Settings > Environment Variables
 * 2. Add: VITE_STRATUS_SERVER_URL = https://stratus.up.railway.app
 */

// Get server URL from environment or use fallback
// NOTE: Update this fallback to your actual Railway URL
const STRATUS_SERVER = import.meta.env.VITE_STRATUS_SERVER_URL || 'https://stratus.up.railway.app';

// Debug: Log the server URL in development
if (import.meta.env.DEV) {
  console.log('[Stratus API] Server URL:', STRATUS_SERVER);
}

interface LoginResponse {
  success: boolean;
  user?: {
    id: string;
    email: string;
    name?: string;
    stationId?: number;
    stationName?: string;
  };
  token?: string;
  error?: string;
}

interface WeatherData {
  id: number;
  stationId: number;
  timestamp: string;
  data: Record<string, number | string | null>;
}

interface StationInfo {
  id: number;
  name: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  isActive: boolean;
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('stratus_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
}

/**
 * Enhanced fetch with better error handling
 */
async function safeFetch(url: string, options: RequestInit = {}): Promise<Response> {
  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    // Network error - server unreachable
    console.error('[Stratus API] Network error:', error);
    throw new Error(
      `Unable to connect to server. Please check:\n` +
      `1. Your internet connection\n` +
      `2. The server URL (${STRATUS_SERVER})\n` +
      `3. If the server is running`
    );
  }
}

export const api = {
  /**
   * Get the current server URL (useful for debugging)
   */
  getServerUrl(): string {
    return STRATUS_SERVER;
  },

  /**
   * Test server connectivity
   */
  async testConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      const response = await fetch(`${STRATUS_SERVER}/api/client/health`, { 
        method: 'GET',
        mode: 'cors',
        signal: AbortSignal.timeout(10000), // 10 second timeout for cold starts
      });
      return { connected: response.ok };
    } catch (error) {
      return { 
        connected: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  },

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<LoginResponse> {
    try {
      const response = await safeFetch(`${STRATUS_SERVER}/api/client/login`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      
      if (!response.ok) {
        // Handle HTTP errors
        if (response.status === 401) {
          return { success: false, error: 'Invalid email or password' };
        }
        if (response.status === 404) {
          return { success: false, error: 'Server endpoint not found. Please contact support.' };
        }
        if (response.status >= 500) {
          return { success: false, error: 'Server error. Please try again later.' };
        }
        return { success: false, error: `Login failed (${response.status})` };
      }
      
      return response.json();
    } catch (error) {
      console.error('[Stratus API] Login error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Connection failed. Check your internet connection.'
      };
    }
  },

  /**
   * Verify if token is still valid
   */
  async verifyToken(token: string): Promise<{ valid: boolean }> {
    try {
      const response = await fetch(`${STRATUS_SERVER}/api/client/verify`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return response.json();
    } catch {
      return { valid: false };
    }
  },

  /**
   * Get station info for the logged-in client
   */
  async getStation(): Promise<StationInfo | null> {
    try {
      const response = await fetch(`${STRATUS_SERVER}/api/client/station`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  },

  /**
   * Get latest weather data
   */
  async getLatestData(): Promise<WeatherData | null> {
    try {
      const response = await fetch(`${STRATUS_SERVER}/api/client/data/latest`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  },

  /**
   * Get historical weather data
   */
  async getHistoricalData(hours: number = 24): Promise<WeatherData[]> {
    try {
      const response = await fetch(`${STRATUS_SERVER}/api/client/data/history?hours=${hours}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) return [];
      return response.json();
    } catch {
      return [];
    }
  },

  /**
   * Export data as CSV
   */
  async exportCSV(startDate?: string, endDate?: string): Promise<Blob> {
    const params = new URLSearchParams();
    if (startDate) params.append('start', startDate);
    if (endDate) params.append('end', endDate);
    
    const response = await fetch(`${STRATUS_SERVER}/api/client/export/csv?${params}`, {
      headers: getAuthHeaders(),
    });
    return response.blob();
  },

  /**
   * Export data as PDF
   */
  async exportPDF(): Promise<Blob> {
    const response = await fetch(`${STRATUS_SERVER}/api/client/export/pdf`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return response.blob();
  },
};

/**
 * WebSocket connection for real-time updates
 */
export class RealtimeConnection {
  private ws: WebSocket | null = null;
  private listeners: ((data: WeatherData) => void)[] = [];
  private reconnectTimer: number | null = null;

  connect() {
    const wsUrl = import.meta.env.VITE_STRATUS_WS_URL || STRATUS_SERVER.replace('https', 'wss').replace('http', 'ws') + '/ws';
    const token = localStorage.getItem('stratus_token');
    
    this.ws = new WebSocket(`${wsUrl}?token=${token}`);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      // Subscribe to client's station
      this.ws?.send(JSON.stringify({ type: 'subscribe_client' }));
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'weather_update') {
          this.listeners.forEach(listener => listener(message.data));
        }
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      // Reconnect after 5 seconds
      this.reconnectTimer = window.setTimeout(() => this.connect(), 5000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
    this.ws = null;
  }

  onData(listener: (data: WeatherData) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
}
