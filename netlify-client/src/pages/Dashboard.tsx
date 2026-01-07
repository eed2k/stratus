import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { api, RealtimeConnection } from '../lib/api';
import {
  Cloud,
  Thermometer,
  Droplets,
  Wind,
  Gauge,
  Sun,
  CloudRain,
  LogOut,
  Download,
  RefreshCw,
  MapPin,
  Activity,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import jsPDF from 'jspdf';

interface WeatherData {
  timestamp: string;
  data: Record<string, number | string | null>;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [realtimeData, setRealtimeData] = useState<WeatherData | null>(null);

  // Fetch station info
  const { data: station } = useQuery({
    queryKey: ['station'],
    queryFn: () => api.getStation(),
  });

  // Fetch latest data
  const { data: latestData, refetch: refetchLatest } = useQuery({
    queryKey: ['latestData'],
    queryFn: () => api.getLatestData(),
    refetchInterval: 60000,
  });

  // Fetch historical data for charts
  const { data: historicalData } = useQuery({
    queryKey: ['historicalData'],
    queryFn: () => api.getHistoricalData(24),
    refetchInterval: 300000,
  });

  // Setup realtime connection
  useEffect(() => {
    const connection = new RealtimeConnection();
    connection.connect();
    
    const unsubscribe = connection.onData((data) => {
      setRealtimeData(data);
    });

    return () => {
      unsubscribe();
      connection.disconnect();
    };
  }, []);

  // Use realtime data if available, otherwise latest from API
  const currentData = realtimeData || latestData;
  const values = currentData?.data || {};

  const formatValue = (value: any, decimals: number = 1): string => {
    if (value === null || value === undefined) return '--';
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    return isNaN(num) ? '--' : num.toFixed(decimals);
  };

  const handleExportCSV = async () => {
    try {
      const blob = await api.exportCSV();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `weather_data_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export CSV');
    }
  };

  const handleExportPDF = async () => {
    try {
      // Generate PDF client-side from current data
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = 210;
      const margin = 20;

      // Header
      pdf.setFontSize(20);
      pdf.setTextColor(30, 41, 59);
      pdf.text(station?.name || 'Weather Station', margin, 25);

      pdf.setFontSize(10);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Report generated: ${new Date().toLocaleString()}`, margin, 33);
      pdf.text(`Location: ${station?.location || 'Not set'}`, margin, 39);

      // Line
      pdf.setDrawColor(226, 232, 240);
      pdf.line(margin, 45, pageWidth - margin, 45);

      // Current Conditions
      pdf.setFontSize(14);
      pdf.setTextColor(30, 41, 59);
      pdf.text('Current Conditions', margin, 55);

      const metrics = [
        { label: 'Temperature', value: `${formatValue(values.temperature)} °C` },
        { label: 'Humidity', value: `${formatValue(values.humidity)} %` },
        { label: 'Pressure', value: `${formatValue(values.pressure)} hPa` },
        { label: 'Wind Speed', value: `${formatValue(values.windSpeed)} km/h` },
        { label: 'Wind Direction', value: `${formatValue(values.windDirection, 0)} °` },
        { label: 'Solar Radiation', value: `${formatValue(values.solarRadiation)} W/m²` },
        { label: 'Rainfall', value: `${formatValue(values.rainfall)} mm` },
        { label: 'UV Index', value: formatValue(values.uvIndex) },
      ];

      let y = 65;
      pdf.setFontSize(10);
      
      metrics.forEach((metric, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = margin + col * 85;
        const yPos = y + row * 12;

        pdf.setTextColor(100, 116, 139);
        pdf.text(metric.label, x, yPos);
        pdf.setTextColor(30, 41, 59);
        pdf.text(metric.value, x + 50, yPos);
      });

      // Footer
      pdf.setFontSize(8);
      pdf.setTextColor(148, 163, 184);
      pdf.text('Stratus Weather Server', pageWidth / 2, 285, { align: 'center' });

      pdf.save(`${station?.name || 'weather'}_report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error('PDF export failed:', error);
      alert('Failed to generate PDF');
    }
  };

  // Prepare chart data
  const chartData = (historicalData || []).map((d: WeatherData) => ({
    time: new Date(d.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    temperature: d.data.temperature || 0,
    humidity: d.data.humidity || 0,
  })).reverse();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <Cloud className="h-8 w-8 text-primary-600" />
              <div>
                <h1 className="text-lg font-semibold text-gray-900">{station?.name || 'Weather Dashboard'}</h1>
                {station?.location && (
                  <p className="text-sm text-gray-500 flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {station.location}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{user?.email}</span>
              <button
                onClick={logout}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <LogOut className="h-5 w-5" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Status Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-green-500" />
            <span className="text-sm text-gray-600">
              Last update: {currentData?.timestamp ? new Date(currentData.timestamp).toLocaleString() : 'No data'}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => refetchLatest()}
              className="btn btn-secondary flex items-center gap-2 text-sm"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={handleExportCSV}
              className="btn btn-secondary flex items-center gap-2 text-sm"
            >
              <Download className="h-4 w-4" />
              CSV
            </button>
            <button
              onClick={handleExportPDF}
              className="btn btn-primary flex items-center gap-2 text-sm"
            >
              <Download className="h-4 w-4" />
              PDF
            </button>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MetricCard
            icon={<Thermometer className="h-6 w-6 text-red-500" />}
            label="Temperature"
            value={formatValue(values.temperature)}
            unit="°C"
          />
          <MetricCard
            icon={<Droplets className="h-6 w-6 text-blue-500" />}
            label="Humidity"
            value={formatValue(values.humidity)}
            unit="%"
          />
          <MetricCard
            icon={<Gauge className="h-6 w-6 text-purple-500" />}
            label="Pressure"
            value={formatValue(values.pressure)}
            unit="hPa"
          />
          <MetricCard
            icon={<Wind className="h-6 w-6 text-teal-500" />}
            label="Wind Speed"
            value={formatValue(values.windSpeed)}
            unit="km/h"
          />
          <MetricCard
            icon={<Wind className="h-6 w-6 text-teal-400" />}
            label="Wind Direction"
            value={formatValue(values.windDirection, 0)}
            unit="°"
          />
          <MetricCard
            icon={<Sun className="h-6 w-6 text-yellow-500" />}
            label="Solar Radiation"
            value={formatValue(values.solarRadiation)}
            unit="W/m²"
          />
          <MetricCard
            icon={<CloudRain className="h-6 w-6 text-blue-400" />}
            label="Rainfall"
            value={formatValue(values.rainfall)}
            unit="mm"
          />
          <MetricCard
            icon={<Sun className="h-6 w-6 text-orange-500" />}
            label="UV Index"
            value={formatValue(values.uvIndex)}
            unit=""
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Temperature Chart */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-gray-900">Temperature (24h)</h3>
            </div>
            <div className="card-content">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="temperature"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Humidity Chart */}
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold text-gray-900">Humidity (24h)</h3>
            </div>
            <div className="card-content">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="humidity"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        {/* Station Info */}
        {station && (
          <div className="mt-6 card">
            <div className="card-header">
              <h3 className="font-semibold text-gray-900">Station Information</h3>
            </div>
            <div className="card-content">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Station Name</span>
                  <p className="font-medium">{station.name}</p>
                </div>
                <div>
                  <span className="text-gray-500">Location</span>
                  <p className="font-medium">{station.location || 'Not set'}</p>
                </div>
                <div>
                  <span className="text-gray-500">Coordinates</span>
                  <p className="font-medium">
                    {station.latitude && station.longitude
                      ? `${station.latitude.toFixed(4)}°, ${station.longitude.toFixed(4)}°`
                      : 'Not set'}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Altitude</span>
                  <p className="font-medium">{station.altitude ? `${station.altitude}m` : 'Not set'}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-center text-sm text-gray-500">
            Stratus Weather Server v1.0.0 • © 2026 Lukas Esterhuizen
          </p>
        </div>
      </footer>
    </div>
  );
}

function MetricCard({ icon, label, value, unit }: { icon: React.ReactNode; label: string; value: string; unit: string }) {
  return (
    <div className="metric-card">
      <div className="flex items-center gap-3 mb-2">
        {icon}
        <span className="metric-label">{label}</span>
      </div>
      <div className="metric-value">
        {value} <span className="text-lg font-normal text-gray-500">{unit}</span>
      </div>
    </div>
  );
}
