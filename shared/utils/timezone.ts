/**
 * Timezone utilities for weather stations
 */

interface TimezoneInfo {
  name: string;
  offset: number; // offset in hours
  abbreviation: string;
}

/**
 * Get timezone based on station coordinates
 * Uses simple geographic bounds for common South African and regional timezones
 */
export function getTimezoneFromCoordinates(latitude: number, longitude: number): TimezoneInfo {
  // South Africa: SAST (UTC+2) - covers most of southern Africa
  // Bounds: roughly -22° to -35° lat, 16° to 33° lon
  if (latitude >= -35 && latitude <= -22 && longitude >= 16 && longitude <= 33) {
    return {
      name: 'Africa/Johannesburg',
      offset: 2,
      abbreviation: 'SAST'
    };
  }
  
  // East Africa: EAT (UTC+3) - Kenya, Tanzania, Uganda, etc.
  if (latitude >= -12 && latitude <= 5 && longitude >= 29 && longitude <= 42) {
    return {
      name: 'Africa/Nairobi',
      offset: 3,
      abbreviation: 'EAT'
    };
  }
  
  // West Africa: WAT (UTC+1) - Nigeria, Ghana, Cameroon, etc.
  if (latitude >= -5 && latitude <= 13 && longitude >= -5 && longitude <= 15) {
    return {
      name: 'Africa/Lagos',
      offset: 1,
      abbreviation: 'WAT'
    };
  }
  
  // Central Africa: CAT (UTC+2) - Zimbabwe, Zambia, Botswana, Namibia
  if (latitude >= -22 && latitude <= -8 && longitude >= 12 && longitude <= 36) {
    return {
      name: 'Africa/Harare',
      offset: 2,
      abbreviation: 'CAT'
    };
  }
  
  // Default to SAST if coordinates are not set or unknown
  return {
    name: 'Africa/Johannesburg',
    offset: 2,
    abbreviation: 'SAST'
  };
}

/**
 * Format a date to local time string based on timezone
 */
export function formatLocalTime(date: Date, timezoneInfo: TimezoneInfo): string {
  try {
    // Use Intl.DateTimeFormat for proper timezone formatting
    const formatter = new Intl.DateTimeFormat('en-ZA', {
      timeZone: timezoneInfo.name,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(date);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    const hour = parts.find(p => p.type === 'hour')?.value;
    const minute = parts.find(p => p.type === 'minute')?.value;
    const second = parts.find(p => p.type === 'second')?.value;
    
    return `${year}-${month}-${day} ${hour}:${minute}:${second} ${timezoneInfo.abbreviation}`;
  } catch (error) {
    // Fallback to manual offset calculation
    const utcTime = date.getTime();
    const localTime = new Date(utcTime + timezoneInfo.offset * 3600000);
    return localTime.toISOString().replace('T', ' ').substring(0, 19) + ` ${timezoneInfo.abbreviation}`;
  }
}

/**
 * Get current time in station's local timezone
 */
export function getCurrentLocalTime(latitude: number, longitude: number): string {
  const timezone = getTimezoneFromCoordinates(latitude, longitude);
  return formatLocalTime(new Date(), timezone);
}
