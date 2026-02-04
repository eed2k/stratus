import { useEffect, useRef, useState } from 'react';

// Type declarations
declare global {
  interface Window {
    StratusWidget?: {
      init: (container: HTMLElement, options: StratusWidgetOptions) => void;
    };
  }
}

interface StratusWidgetOptions {
  station: number | string;
  server: string;
  theme?: 'light' | 'dark';
  showRain?: boolean;
  showSolar?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface StratusWeatherWidgetProps {
  stationId: number | string;
  server: string;
  theme?: 'light' | 'dark';
  showRain?: boolean;
  showSolar?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
  className?: string;
}

/**
 * Stratus Weather Widget - React Component
 * 
 * Embeds a Stratus weather station widget in your React application.
 * 
 * @example
 * ```tsx
 * <StratusWeatherWidget
 *   stationId={1}
 *   server="https://stratusweather.co.za"
 *   theme="light"
 * />
 * ```
 */
export function StratusWeatherWidget({
  stationId,
  server,
  theme = 'light',
  showRain = true,
  showSolar = true,
  autoRefresh = true,
  refreshInterval = 300,
  className,
}: StratusWeatherWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if script is already loaded
    if (window.StratusWidget) {
      setLoaded(true);
      return;
    }

    // Load the widget script
    const script = document.createElement('script');
    script.src = `${server}/api/embed/widget.js`;
    script.async = true;
    
    script.onload = () => {
      setLoaded(true);
      setError(null);
    };
    
    script.onerror = () => {
      setError('Failed to load Stratus widget');
    };
    
    document.body.appendChild(script);

    return () => {
      // Don't remove the script on unmount as other widgets might use it
    };
  }, [server]);

  useEffect(() => {
    if (loaded && window.StratusWidget && containerRef.current) {
      window.StratusWidget.init(containerRef.current, {
        station: stationId,
        server: server,
        theme: theme,
        showRain: showRain,
        showSolar: showSolar,
        autoRefresh: autoRefresh,
        refreshInterval: refreshInterval,
      });
    }
  }, [loaded, stationId, server, theme, showRain, showSolar, autoRefresh, refreshInterval]);

  if (error) {
    return (
      <div className={className} style={{ 
        padding: '16px', 
        background: '#fee2e2', 
        borderRadius: '8px',
        color: '#991b1b',
        fontFamily: 'Arial, Helvetica, sans-serif'
      }}>
        {error}
      </div>
    );
  }

  return <div ref={containerRef} className={className} />;
}

// ============================================
// Alternative: Hook-based approach for custom UI
// ============================================

interface StationData {
  station: {
    id: number;
    name: string;
    latitude: number | null;
    longitude: number | null;
    altitude: number | null;
    status: string;
  };
  latest: {
    timestamp: string;
    temperature: number | null;
    humidity: number | null;
    pressure: number | null;
    windSpeed: number | null;
    windDirection: number | null;
    rainfall: number | null;
    solarRadiation: number | null;
    uvIndex: number | null;
    batteryVoltage: number | null;
  } | null;
  recordCount: number;
}

interface UseStratusDataOptions {
  stationId: number | string;
  server: string;
  refreshInterval?: number; // in seconds
}

/**
 * Hook to fetch Stratus weather data for custom UI implementations
 * 
 * @example
 * ```tsx
 * const { data, loading, error, refresh } = useStratusData({
 *   stationId: 1,
 *   server: 'https://stratusweather.co.za',
 *   refreshInterval: 300
 * });
 * 
 * if (loading) return <div>Loading...</div>;
 * if (error) return <div>Error: {error}</div>;
 * if (!data) return null;
 * 
 * return (
 *   <div>
 *     <h2>{data.station.name}</h2>
 *     <p>Temperature: {data.latest?.temperature}°C</p>
 *   </div>
 * );
 * ```
 */
export function useStratusData({ stationId, server, refreshInterval = 300 }: UseStratusDataOptions) {
  const [data, setData] = useState<StationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const response = await fetch(`${server}/api/embed/station/${stationId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    if (refreshInterval > 0) {
      const interval = setInterval(fetchData, refreshInterval * 1000);
      return () => clearInterval(interval);
    }
  }, [stationId, server, refreshInterval]);

  return { data, loading, error, refresh: fetchData };
}

/**
 * Hook to fetch historical weather data for charts
 */
export function useStratusChartData({
  stationId,
  server,
  hours = 24,
  limit = 500,
}: {
  stationId: number | string;
  server: string;
  hours?: number;
  limit?: number;
}) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const response = await fetch(
        `${server}/api/embed/station/${stationId}/data?hours=${hours}&limit=${limit}`
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const result = await response.json();
      setData(result.data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [stationId, server, hours, limit]);

  return { data, loading, error, refresh: fetchData };
}

export default StratusWeatherWidget;
