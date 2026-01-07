/**
 * API Client for Stratus Server
 * Handles all communication with the Railway-hosted Stratus server
 */

const STRATUS_SERVER = import.meta.env.VITE_STRATUS_SERVER_URL || 'https://stratus.railway.app';

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

export const api = {
  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await fetch(`${STRATUS_SERVER}/api/client/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return response.json();
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
    const response = await fetch(`${STRATUS_SERVER}/api/client/station`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) return null;
    return response.json();
  },

  /**
   * Get latest weather data
   */
  async getLatestData(): Promise<WeatherData | null> {
    const response = await fetch(`${STRATUS_SERVER}/api/client/data/latest`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) return null;
    return response.json();
  },

  /**
   * Get historical weather data
   */
  async getHistoricalData(hours: number = 24): Promise<WeatherData[]> {
    const response = await fetch(`${STRATUS_SERVER}/api/client/data/history?hours=${hours}`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) return [];
    return response.json();
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
