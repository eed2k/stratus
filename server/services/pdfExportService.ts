/**
 * Server-side PDF Export Service
 * Generates data-driven PDFs without DOM capture for better performance on Railway
 * 
 * FIXED: Proper page break handling to prevent content cutting between pages
 * - Category headers and their first row of cards stay together
 * - Full card rows are never split across pages
 * - Proper spacing calculations account for all content heights
 */

import jsPDF from 'jspdf';

// Parameter definitions (inline to avoid shared folder import issues with tsconfig)
interface DashboardParameter {
  id: string;
  name: string;
  category: string;
  unit: string;
}

// Core parameter definitions for PDF export - Extended for all 43+ parameters
const PARAMETER_CONFIG: Record<string, DashboardParameter> = {
  // Temperature parameters
  temperature: { id: 'temperature', name: 'Air Temperature', category: 'Temperature', unit: '°C' },
  temperatureMin: { id: 'temperatureMin', name: 'Min Temperature', category: 'Temperature', unit: '°C' },
  temperatureMax: { id: 'temperatureMax', name: 'Max Temperature', category: 'Temperature', unit: '°C' },
  dewPoint: { id: 'dewPoint', name: 'Dew Point', category: 'Temperature', unit: '°C' },
  heatIndex: { id: 'heatIndex', name: 'Heat Index', category: 'Temperature', unit: '°C' },
  windChill: { id: 'windChill', name: 'Wind Chill', category: 'Temperature', unit: '°C' },
  wetBulbTemp: { id: 'wetBulbTemp', name: 'Wet Bulb Temperature', category: 'Temperature', unit: '°C' },
  apparentTemp: { id: 'apparentTemp', name: 'Apparent Temperature', category: 'Temperature', unit: '°C' },
  
  // Humidity parameters
  humidity: { id: 'humidity', name: 'Relative Humidity', category: 'Humidity', unit: '%' },
  humidityMin: { id: 'humidityMin', name: 'Min Humidity', category: 'Humidity', unit: '%' },
  humidityMax: { id: 'humidityMax', name: 'Max Humidity', category: 'Humidity', unit: '%' },
  absoluteHumidity: { id: 'absoluteHumidity', name: 'Absolute Humidity', category: 'Humidity', unit: 'g/m³' },
  
  // Pressure parameters
  pressure: { id: 'pressure', name: 'Barometric Pressure', category: 'Pressure', unit: 'hPa' },
  pressureSeaLevel: { id: 'pressureSeaLevel', name: 'Sea Level Pressure', category: 'Pressure', unit: 'hPa' },
  pressureTrend: { id: 'pressureTrend', name: 'Pressure Trend', category: 'Pressure', unit: 'hPa/h' },
  
  // Wind parameters
  windSpeed: { id: 'windSpeed', name: 'Wind Speed', category: 'Wind', unit: 'km/h' },
  windDirection: { id: 'windDirection', name: 'Wind Direction', category: 'Wind', unit: '°' },
  windGust: { id: 'windGust', name: 'Wind Gust', category: 'Wind', unit: 'km/h' },
  windSpeedAvg: { id: 'windSpeedAvg', name: 'Avg Wind Speed', category: 'Wind', unit: 'km/h' },
  windChill2: { id: 'windChill2', name: 'Wind Chill', category: 'Wind', unit: '°C' },
  
  // Precipitation parameters
  rainfall: { id: 'rainfall', name: 'Rainfall', category: 'Precipitation', unit: 'mm' },
  rainfallRate: { id: 'rainfallRate', name: 'Rainfall Rate', category: 'Precipitation', unit: 'mm/h' },
  rainfallDaily: { id: 'rainfallDaily', name: 'Daily Rainfall', category: 'Precipitation', unit: 'mm' },
  rainfallMonthly: { id: 'rainfallMonthly', name: 'Monthly Rainfall', category: 'Precipitation', unit: 'mm' },
  rainfallYearly: { id: 'rainfallYearly', name: 'Yearly Rainfall', category: 'Precipitation', unit: 'mm' },
  
  // Solar parameters
  solarRadiation: { id: 'solarRadiation', name: 'Solar Radiation', category: 'Solar', unit: 'W/m²' },
  solarRadiationMax: { id: 'solarRadiationMax', name: 'Max Solar Radiation', category: 'Solar', unit: 'W/m²' },
  solarEnergy: { id: 'solarEnergy', name: 'Solar Energy', category: 'Solar', unit: 'MJ/m²' },
  
  // UV parameters
  uvIndex: { id: 'uvIndex', name: 'UV Index', category: 'UV', unit: '' },
  uvDose: { id: 'uvDose', name: 'UV Dose', category: 'UV', unit: 'MED' },
  
  // Soil parameters
  soilMoisture: { id: 'soilMoisture', name: 'Soil Moisture', category: 'Soil', unit: '%' },
  soilTemperature: { id: 'soilTemperature', name: 'Soil Temperature', category: 'Soil', unit: '°C' },
  soilMoisture10cm: { id: 'soilMoisture10cm', name: 'Soil Moisture 10cm', category: 'Soil', unit: '%' },
  soilMoisture30cm: { id: 'soilMoisture30cm', name: 'Soil Moisture 30cm', category: 'Soil', unit: '%' },
  soilMoisture50cm: { id: 'soilMoisture50cm', name: 'Soil Moisture 50cm', category: 'Soil', unit: '%' },
  soilTemperature10cm: { id: 'soilTemperature10cm', name: 'Soil Temp 10cm', category: 'Soil', unit: '°C' },
  soilTemperature30cm: { id: 'soilTemperature30cm', name: 'Soil Temp 30cm', category: 'Soil', unit: '°C' },
  
  // Air Quality parameters
  pm25: { id: 'pm25', name: 'PM2.5', category: 'Air Quality', unit: 'µg/m³' },
  pm10: { id: 'pm10', name: 'PM10', category: 'Air Quality', unit: 'µg/m³' },
  co2: { id: 'co2', name: 'CO₂', category: 'Air Quality', unit: 'ppm' },
  airQualityIndex: { id: 'airQualityIndex', name: 'Air Quality Index', category: 'Air Quality', unit: '' },
  voc: { id: 'voc', name: 'VOC', category: 'Air Quality', unit: 'ppb' },
  
  // Agricultural parameters
  leafWetness: { id: 'leafWetness', name: 'Leaf Wetness', category: 'Agricultural', unit: '%' },
  evapotranspiration: { id: 'evapotranspiration', name: 'Evapotranspiration', category: 'Agricultural', unit: 'mm' },
  growingDegreeDays: { id: 'growingDegreeDays', name: 'Growing Degree Days', category: 'Agricultural', unit: '°C·d' },
  vpd: { id: 'vpd', name: 'Vapor Pressure Deficit', category: 'Agricultural', unit: 'kPa' },
  
  // System parameters
  batteryVoltage: { id: 'batteryVoltage', name: 'Battery Voltage', category: 'System', unit: 'V' },
  panelVoltage: { id: 'panelVoltage', name: 'Panel Voltage', category: 'System', unit: 'V' },
  signalStrength: { id: 'signalStrength', name: 'Signal Strength', category: 'System', unit: 'dBm' },
  internalTemp: { id: 'internalTemp', name: 'Internal Temperature', category: 'System', unit: '°C' },
};

function getParameterById(id: string): DashboardParameter | undefined {
  return PARAMETER_CONFIG[id];
}

interface WeatherDataPoint {
  timestamp: string;
  data: Record<string, number | string | null>;
}

interface StationInfo {
  name: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
}

interface ExportRequest {
  station: StationInfo;
  latestData: WeatherDataPoint | null;
  enabledParameters: string[];
  title?: string;
}

interface PDFStyles {
  headerColor: [number, number, number];
  textColor: [number, number, number];
  mutedColor: [number, number, number];
  accentColor: [number, number, number];
  lineColor: [number, number, number];
}

const styles: PDFStyles = {
  headerColor: [30, 41, 59],     // slate-800
  textColor: [51, 65, 85],       // slate-600
  mutedColor: [148, 163, 184],   // slate-400
  accentColor: [59, 130, 246],   // blue-500
  lineColor: [226, 232, 240],    // slate-200
};

/**
 * Format a value with its unit based on parameter configuration
 */
function formatValue(parameterId: string, value: number | string | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  
  const param = getParameterById(parameterId);
  if (!param) return String(value);
  
  const numValue = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(numValue)) return String(value);
  
  // Format based on parameter type
  const precision = param.unit === '°' ? 0 : 
                    param.unit === '%' ? 1 : 
                    param.id.includes('voltage') ? 2 : 1;
  
  return `${numValue.toFixed(precision)} ${param.unit}`;
}

/**
 * Get parameter label from configuration
 */
function getParameterLabel(parameterId: string): string {
  const param = getParameterById(parameterId);
  return param?.name || parameterId;
}

/**
 * Get parameter category
 */
function getParameterCategory(parameterId: string): string {
  const param = getParameterById(parameterId);
  return param?.category || 'Other';
}

/**
 * Generate a PDF dashboard report from data
 * IMPROVED: Proper page break handling - never cuts content between pages
 */
export async function generateDashboardPDF(request: ExportRequest): Promise<Buffer> {
  const { station, latestData, enabledParameters, title } = request;
  
  // Create PDF in A4 landscape
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 297;
  const pageHeight = 210;
  const margin = 15;
  const contentWidth = pageWidth - (margin * 2);
  const headerHeight = 30; // Space for header
  const footerHeight = 15; // Space for footer
  const contentStartY = margin + headerHeight;
  const maxContentY = pageHeight - margin - footerHeight; // Bottom boundary
  
  // Card layout constants
  const numColumns = 4;
  const cardWidth = (contentWidth - ((numColumns - 1) * 5)) / numColumns; // 4 columns with 5mm gaps
  const cardHeight = 22;
  const cardGap = 5;
  const categoryHeaderHeight = 8; // Height for category header + spacing
  const categorySpacing = 6; // Extra space between categories
  const rowHeight = cardHeight + cardGap; // Height of one row of cards
  
  // Track pages for footer
  let currentPage = 1;
  
  const dateStr = new Date().toLocaleString('en-ZA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Group parameters by category
  const categoryGroups = groupParametersByCategory(enabledParameters);
  
  // Pre-calculate total pages needed for accurate page numbers
  let estimatedPages = 1;
  let tempY = contentStartY + 10; // Start after "Latest Reading" line
  
  for (const [, paramIds] of Object.entries(categoryGroups)) {
    const rowsNeeded = Math.ceil(paramIds.length / numColumns);
    const categoryTotalHeight = categoryHeaderHeight + (rowsNeeded * rowHeight) + categorySpacing;
    
    // Check if category header + at least one row fits
    if (tempY + categoryHeaderHeight + rowHeight > maxContentY) {
      estimatedPages++;
      tempY = contentStartY;
    }
    
    // Add all rows, checking for page breaks
    let remainingRows = rowsNeeded;
    tempY += categoryHeaderHeight;
    
    while (remainingRows > 0) {
      if (tempY + rowHeight > maxContentY) {
        estimatedPages++;
        tempY = contentStartY;
      }
      tempY += rowHeight;
      remainingRows--;
    }
    
    tempY += categorySpacing;
  }
  
  const totalPages = estimatedPages;

  // Add header function
  const addHeader = (pageNum: number) => {
    // Title
    pdf.setFontSize(18);
    pdf.setTextColor(...styles.headerColor);
    pdf.text(title || `${station.name} - Dashboard Report`, margin, margin + 8);
    
    // Subtitle with station info
    pdf.setFontSize(10);
    pdf.setTextColor(...styles.textColor);
    const locationStr = station.location || 
      (station.latitude && station.longitude ? 
        `${station.latitude.toFixed(4)}°, ${station.longitude.toFixed(4)}°` : 
        'Location not set');
    pdf.text(`Location: ${locationStr}`, margin, margin + 16);
    
    if (station.altitude) {
      pdf.text(`Altitude: ${station.altitude}m`, margin + 80, margin + 16);
    }
    
    // Date and page number
    pdf.setFontSize(9);
    pdf.setTextColor(...styles.mutedColor);
    pdf.text(`Generated: ${dateStr}`, pageWidth - margin - 60, margin + 8);
    pdf.text(`Page ${pageNum} of ${totalPages}`, pageWidth - margin - 25, margin + 16);
    
    // Horizontal line
    pdf.setDrawColor(...styles.lineColor);
    pdf.setLineWidth(0.5);
    pdf.line(margin, margin + 22, pageWidth - margin, margin + 22);
  };

  // Add footer function
  const addFooter = () => {
    pdf.setFontSize(8);
    pdf.setTextColor(...styles.mutedColor);
    pdf.text(
      'Stratus Weather Server - Generated Report',
      pageWidth / 2,
      pageHeight - 8,
      { align: 'center' }
    );
  };

  // Helper to add a new page
  const addNewPage = () => {
    pdf.addPage();
    currentPage++;
    addHeader(currentPage);
    addFooter();
    return contentStartY;
  };

  // Helper to check if we need a new page and add one if needed
  const ensureSpace = (currentY: number, neededHeight: number): number => {
    if (currentY + neededHeight > maxContentY) {
      return addNewPage();
    }
    return currentY;
  };

  // Draw a parameter card at the specified position
  const drawCard = (paramId: string, x: number, y: number) => {
    const value = latestData?.data?.[paramId];
    const displayValue = formatValue(paramId, value);
    const label = getParameterLabel(paramId);

    // Card background with rounded corners
    pdf.setFillColor(249, 250, 251); // gray-50
    pdf.setDrawColor(...styles.lineColor);
    pdf.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');

    // Parameter label (top of card)
    pdf.setFontSize(9);
    pdf.setTextColor(...styles.mutedColor);
    pdf.text(label, x + 4, y + 6);

    // Parameter value (center of card, larger font)
    pdf.setFontSize(14);
    pdf.setTextColor(...styles.headerColor);
    pdf.setFont('helvetica', 'bold');
    
    // Truncate value if too long for card width
    const maxValueWidth = cardWidth - 8;
    let displayText = displayValue;
    while (pdf.getTextWidth(displayText) > maxValueWidth && displayText.length > 5) {
      displayText = displayText.slice(0, -4) + '...';
    }
    pdf.text(displayText, x + 4, y + 16);
    pdf.setFont('helvetica', 'normal');
  };

  // Initialize first page
  addHeader(currentPage);
  addFooter();
  
  let currentY = contentStartY;

  // Add latest data timestamp if available
  if (latestData?.timestamp) {
    pdf.setFontSize(10);
    pdf.setTextColor(...styles.accentColor);
    const dataTime = new Date(latestData.timestamp).toLocaleString('en-ZA');
    pdf.text(`Latest Reading: ${dataTime}`, margin, currentY);
    currentY += 10;
  }

  // Render parameters by category with proper page break handling
  for (const [category, paramIds] of Object.entries(categoryGroups)) {
    const rowsInCategory = Math.ceil(paramIds.length / numColumns);
    const firstRowHeight = categoryHeaderHeight + rowHeight; // Category header + first row must stay together
    
    // CRITICAL: Ensure category header + at least first row fits on current page
    // If not, start the entire category on a new page
    currentY = ensureSpace(currentY, firstRowHeight);

    // Draw category header
    pdf.setFontSize(11);
    pdf.setTextColor(...styles.headerColor);
    pdf.setFont('helvetica', 'bold');
    pdf.text(category, margin, currentY);
    pdf.setFont('helvetica', 'normal');
    currentY += categoryHeaderHeight;
    
    // Process parameters in rows of 4
    for (let rowIndex = 0; rowIndex < rowsInCategory; rowIndex++) {
      // CRITICAL: Check if this complete row fits before drawing any cards
      // This ensures no row is split across pages
      currentY = ensureSpace(currentY, rowHeight);
      
      // Draw up to 4 cards in this row
      for (let colIndex = 0; colIndex < numColumns; colIndex++) {
        const paramIndex = rowIndex * numColumns + colIndex;
        if (paramIndex >= paramIds.length) break;
        
        const paramId = paramIds[paramIndex];
        const cardX = margin + colIndex * (cardWidth + 5);
        drawCard(paramId, cardX, currentY);
      }
      
      currentY += rowHeight;
    }
    
    // Add spacing between categories
    currentY += categorySpacing;
  }

  // Add summary section on last page if there's room
  const summaryHeight = 25;
  if (currentY + summaryHeight <= maxContentY) {
    currentY += 5;
    pdf.setDrawColor(...styles.lineColor);
    pdf.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 8;

    pdf.setFontSize(10);
    pdf.setTextColor(...styles.textColor);
    pdf.text(`Total Parameters: ${enabledParameters.length}`, margin, currentY);
    pdf.text(`Station: ${station.name}`, margin + 80, currentY);
    
    if (latestData?.timestamp) {
      const dataAge = Math.round((Date.now() - new Date(latestData.timestamp).getTime()) / 60000);
      pdf.text(`Data Age: ${dataAge} minutes`, margin + 160, currentY);
    }
  }

  // Return as buffer
  return Buffer.from(pdf.output('arraybuffer'));
}

/**
 * Group parameters by their category for organized display
 */
function groupParametersByCategory(parameterIds: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  
  for (const paramId of parameterIds) {
    const category = getParameterCategory(paramId);
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(paramId);
  }
  
  // Sort categories in a logical order
  const categoryOrder = [
    'Temperature',
    'Humidity',
    'Pressure',
    'Wind',
    'Precipitation',
    'Solar',
    'UV',
    'Soil',
    'Air Quality',
    'Agricultural',
    'System',
    'Other',
  ];
  
  const sortedGroups: Record<string, string[]> = {};
  for (const cat of categoryOrder) {
    if (groups[cat]) {
      sortedGroups[cat] = groups[cat];
    }
  }
  
  // Add any remaining categories not in the order list
  for (const cat of Object.keys(groups)) {
    if (!sortedGroups[cat]) {
      sortedGroups[cat] = groups[cat];
    }
  }
  
  return sortedGroups;
}

/**
 * Generate a simple CSV export
 */
export function generateCSV(
  station: StationInfo,
  data: WeatherDataPoint[],
  parameters: string[]
): string {
  const headers = ['Timestamp', ...parameters.map(p => getParameterLabel(p))];
  const rows = data.map(point => {
    const values = [point.timestamp];
    for (const param of parameters) {
      const value = point.data?.[param];
      values.push(value !== null && value !== undefined ? String(value) : '');
    }
    return values.join(',');
  });
  
  return [headers.join(','), ...rows].join('\n');
}
