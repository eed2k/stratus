/**
 * Server-side PDF Export Service
 * Generates data-driven PDFs without DOM capture for better performance on Railway
 */

import jsPDF from 'jspdf';
import { getAllParameters, getParameterById, type DashboardParameter } from '../../shared/dashboardConfig';

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
  
  // Track pages for footer
  let currentPage = 1;
  let totalPages = 1;
  
  const dateStr = new Date().toLocaleString('en-ZA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Calculate total pages needed
  const categoryGroups = groupParametersByCategory(enabledParameters);
  const totalParams = enabledParameters.length;
  const paramsPerPage = 24; // 4 columns x 6 rows approximately
  totalPages = Math.max(1, Math.ceil(totalParams / paramsPerPage));

  // Add header
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

  // Add footer
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

  // Add first page header/footer
  addHeader(currentPage);
  addFooter();

  // Starting position after header
  let currentY = margin + 30;
  const cardWidth = (contentWidth - 15) / 4; // 4 columns with gaps
  const cardHeight = 22;
  const cardGap = 5;
  let currentX = margin;
  let columnIndex = 0;

  // Add latest data timestamp if available
  if (latestData?.timestamp) {
    pdf.setFontSize(10);
    pdf.setTextColor(...styles.accentColor);
    const dataTime = new Date(latestData.timestamp).toLocaleString('en-ZA');
    pdf.text(`Latest Reading: ${dataTime}`, margin, currentY);
    currentY += 10;
  }

  // Render parameters by category
  for (const [category, paramIds] of Object.entries(categoryGroups)) {
    // Check if we need a new page
    if (currentY > pageHeight - margin - 35) {
      pdf.addPage();
      currentPage++;
      addHeader(currentPage);
      addFooter();
      currentY = margin + 30;
      columnIndex = 0;
      currentX = margin;
    }

    // Category header
    pdf.setFontSize(11);
    pdf.setTextColor(...styles.headerColor);
    pdf.setFont('helvetica', 'bold');
    pdf.text(category, margin, currentY);
    pdf.setFont('helvetica', 'normal');
    currentY += 6;
    
    // Reset to first column after category header
    columnIndex = 0;
    currentX = margin;

    // Render parameter cards
    for (const paramId of paramIds) {
      // Check if we need a new page
      if (currentY + cardHeight > pageHeight - margin - 15) {
        pdf.addPage();
        currentPage++;
        addHeader(currentPage);
        addFooter();
        currentY = margin + 30;
        columnIndex = 0;
        currentX = margin;
      }

      // Get value from latest data
      const value = latestData?.data?.[paramId];
      const displayValue = formatValue(paramId, value);
      const label = getParameterLabel(paramId);

      // Draw card background
      pdf.setFillColor(249, 250, 251); // gray-50
      pdf.setDrawColor(...styles.lineColor);
      pdf.roundedRect(currentX, currentY, cardWidth, cardHeight, 2, 2, 'FD');

      // Card content
      pdf.setFontSize(9);
      pdf.setTextColor(...styles.mutedColor);
      pdf.text(label, currentX + 4, currentY + 6);

      pdf.setFontSize(14);
      pdf.setTextColor(...styles.headerColor);
      pdf.setFont('helvetica', 'bold');
      
      // Truncate value if too long
      const maxValueWidth = cardWidth - 8;
      let displayText = displayValue;
      while (pdf.getTextWidth(displayText) > maxValueWidth && displayText.length > 5) {
        displayText = displayText.slice(0, -4) + '...';
      }
      pdf.text(displayText, currentX + 4, currentY + 16);
      pdf.setFont('helvetica', 'normal');

      // Move to next column
      columnIndex++;
      if (columnIndex >= 4) {
        columnIndex = 0;
        currentX = margin;
        currentY += cardHeight + cardGap;
      } else {
        currentX += cardWidth + 5;
      }
    }

    // After each category, move to next row and add spacing
    if (columnIndex !== 0) {
      currentY += cardHeight + cardGap;
      columnIndex = 0;
      currentX = margin;
    }
    currentY += 5; // Extra space between categories
  }

  // Add summary section on last page if there's room
  if (currentY < pageHeight - margin - 50) {
    currentY += 10;
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
