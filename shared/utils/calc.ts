// Stratus Weather Server
// Created by Lukas Esterhuizen

import { STANDARD_AIR_DENSITY_KGM3 } from './weatherConstants';

export function convertCelsiusToFahrenheit(celsius: number): number {
    return (celsius * 9/5) + 32;
}

export function convertFahrenheitToCelsius(fahrenheit: number): number {
    return (fahrenheit - 32) * 5/9;
}

export function calculateAverage(values: number[]): number {
    const total = values.reduce((acc, value) => acc + value, 0);
    return total / values.length;
}

/**
 * Calculate Wind Chill using the North American / Environment Canada metric formula.
 * Valid when T â‰¤ 10 Â°C and wind speed â‰¥ 4.8 km/h.
 * temperature: Air temperature in Â°C
 * windSpeedMs: Wind speed in m/s
 * Returns Wind chill temperature in Â°C (or the input temperature if conditions are outside the valid range)
 */
export function calculateWindChill(temperature: number, windSpeedMs: number): number {
    const windKmh = windSpeedMs * 3.6;
    if (temperature > 10 || windKmh < 4.8) return temperature;
    return 13.12 + 0.6215 * temperature - 11.37 * Math.pow(windKmh, 0.16) + 0.3965 * temperature * Math.pow(windKmh, 0.16);
}

// Solar Position Calculations (NOAA Algorithm)

interface SolarPosition {
    elevation: number;      // degrees above horizon
    azimuth: number;        // degrees from north (clockwise)
    sunrise: Date;
    sunset: Date;
    nauticalDawn: Date;     // -12 degrees below horizon
    nauticalDusk: Date;     // -12 degrees below horizon
    civilDawn: Date;        // -6 degrees below horizon
    civilDusk: Date;        // -6 degrees below horizon
    astronomicalDawn: Date; // -18 degrees below horizon
    astronomicalDusk: Date; // -18 degrees below horizon
    solarNoon: Date;
    dayLength: number;      // minutes
}

/**
 * Calculate Julian Day from date
 */
function getJulianDay(date: Date): number {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    
    let jd = 367 * year - Math.floor(7 * (year + Math.floor((month + 9) / 12)) / 4) +
             Math.floor(275 * month / 9) + day + 1721013.5 + hour / 24;
    
    return jd;
}

/**
 * Calculate solar position for a given location and time
 * Based on NOAA Solar Calculator algorithms
 */
export function calculateSolarPosition(
    latitude: number,
    longitude: number,
    date: Date = new Date()
): SolarPosition {
    const jd = getJulianDay(date);
    const jc = (jd - 2451545) / 36525; // Julian Century
    
    // Calculate sun's geometric mean longitude (degrees)
    let sunLongMean = (280.46646 + jc * (36000.76983 + 0.0003032 * jc)) % 360;
    
    // Calculate sun's geometric mean anomaly (degrees)
    const sunAnomMean = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
    
    // Calculate earth's orbit eccentricity
    const eccentEarth = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
    
    // Calculate sun's equation of centre
    const sunEqCtr = Math.sin(sunAnomMean * Math.PI / 180) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
                     Math.sin(2 * sunAnomMean * Math.PI / 180) * (0.019993 - 0.000101 * jc) +
                     Math.sin(3 * sunAnomMean * Math.PI / 180) * 0.000289;
    
    // Calculate sun's true longitude
    const sunTrueLong = sunLongMean + sunEqCtr;
    
    // Calculate sun's apparent longitude
    const omega = 125.04 - 1934.136 * jc;
    const sunAppLong = sunTrueLong - 0.00569 - 0.00478 * Math.sin(omega * Math.PI / 180);
    
    // Calculate mean obliquity of ecliptic
    const meanObliqEcliptic = 23 + (26 + ((21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813)))) / 60) / 60;
    
    // Calculate corrected obliquity
    const obliqCorr = meanObliqEcliptic + 0.00256 * Math.cos(omega * Math.PI / 180);
    
    // Calculate sun's declination
    const sunDeclin = Math.asin(Math.sin(obliqCorr * Math.PI / 180) * Math.sin(sunAppLong * Math.PI / 180)) * 180 / Math.PI;
    
    // Calculate equation of time (minutes)
    const y = Math.tan(obliqCorr * Math.PI / 360) ** 2;
    const eqOfTime = 4 * (y * Math.sin(2 * sunLongMean * Math.PI / 180) -
                         2 * eccentEarth * Math.sin(sunAnomMean * Math.PI / 180) +
                         4 * eccentEarth * y * Math.sin(sunAnomMean * Math.PI / 180) * Math.cos(2 * sunLongMean * Math.PI / 180) -
                         0.5 * y * y * Math.sin(4 * sunLongMean * Math.PI / 180) -
                         1.25 * eccentEarth * eccentEarth * Math.sin(2 * sunAnomMean * Math.PI / 180)) * 180 / Math.PI;
    
    // Calculate hour angle
    const timezoneOffset = -date.getTimezoneOffset() / 60;
    const timeDecimal = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
    const trueSolarTime = (timeDecimal * 60 + eqOfTime + 4 * longitude - 60 * timezoneOffset) % 1440;
    
    let hourAngle: number;
    if (trueSolarTime / 4 < 0) {
        hourAngle = trueSolarTime / 4 + 180;
    } else {
        hourAngle = trueSolarTime / 4 - 180;
    }
    
    // Calculate solar zenith and elevation
    const solarZenith = Math.acos(
        Math.sin(latitude * Math.PI / 180) * Math.sin(sunDeclin * Math.PI / 180) +
        Math.cos(latitude * Math.PI / 180) * Math.cos(sunDeclin * Math.PI / 180) * Math.cos(hourAngle * Math.PI / 180)
    ) * 180 / Math.PI;
    
    const solarElevation = 90 - solarZenith;
    
    // Calculate solar azimuth
    let solarAzimuth: number;
    if (hourAngle > 0) {
        solarAzimuth = (Math.acos(
            ((Math.sin(latitude * Math.PI / 180) * Math.cos(solarZenith * Math.PI / 180)) - Math.sin(sunDeclin * Math.PI / 180)) /
            (Math.cos(latitude * Math.PI / 180) * Math.sin(solarZenith * Math.PI / 180))
        ) * 180 / Math.PI + 180) % 360;
    } else {
        solarAzimuth = (540 - Math.acos(
            ((Math.sin(latitude * Math.PI / 180) * Math.cos(solarZenith * Math.PI / 180)) - Math.sin(sunDeclin * Math.PI / 180)) /
            (Math.cos(latitude * Math.PI / 180) * Math.sin(solarZenith * Math.PI / 180))
        ) * 180 / Math.PI) % 360;
    }
    
    // Calculate sunrise/sunset and twilight times
    const calcSunriseSet = (zenithAngle: number): { rise: Date; set: Date } => {
        const ha = Math.acos(
            Math.cos(zenithAngle * Math.PI / 180) / (Math.cos(latitude * Math.PI / 180) * Math.cos(sunDeclin * Math.PI / 180)) -
            Math.tan(latitude * Math.PI / 180) * Math.tan(sunDeclin * Math.PI / 180)
        ) * 180 / Math.PI;
        
        const solarNoonMinutes = (720 - 4 * longitude - eqOfTime + timezoneOffset * 60);
        const riseMinutes = solarNoonMinutes - ha * 4;
        const setMinutes = solarNoonMinutes + ha * 4;
        
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        
        return {
            rise: new Date(startOfDay.getTime() + riseMinutes * 60000),
            set: new Date(startOfDay.getTime() + setMinutes * 60000)
        };
    };
    
    const sunrise = calcSunriseSet(90.833);   // Standard sunrise/sunset (accounting for refraction)
    const nautical = calcSunriseSet(102);      // Nautical twilight (-12 degrees)
    const civil = calcSunriseSet(96);          // Civil twilight (-6 degrees)
    const astronomical = calcSunriseSet(108);  // Astronomical twilight (-18 degrees)
    
    // Calculate solar noon
    const solarNoonMinutes = (720 - 4 * longitude - eqOfTime + timezoneOffset * 60);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const solarNoon = new Date(startOfDay.getTime() + solarNoonMinutes * 60000);
    
    // Calculate day length in minutes
    const dayLength = (sunrise.set.getTime() - sunrise.rise.getTime()) / 60000;
    
    return {
        elevation: solarElevation,
        azimuth: solarAzimuth,
        sunrise: sunrise.rise,
        sunset: sunrise.set,
        nauticalDawn: nautical.rise,
        nauticalDusk: nautical.set,
        civilDawn: civil.rise,
        civilDusk: civil.set,
        astronomicalDawn: astronomical.rise,
        astronomicalDusk: astronomical.set,
        solarNoon,
        dayLength
    };
}

// Air Density Calculations

/**
 * Calculate air density using the ideal gas law with humidity correction
 * Ï = (p_d / (R_d * T)) + (p_v / (R_v * T))
 * 
 * temperature: Temperature in Celsius
 * pressure: Atmospheric pressure in hPa (mbar)
 * humidity: Relative humidity in percent (0-100)
 * Returns Air density in kg/mÂ³
 */
export function calculateAirDensity(
    temperature: number,
    pressure: number,
    humidity: number
): number {
    const T = temperature + 273.15; // Convert to Kelvin
    const p = pressure * 100;       // Convert hPa to Pa
    
    // Gas constants
    const Rd = 287.058;  // Specific gas constant for dry air (J/(kgÂ·K))
    const Rv = 461.495;  // Specific gas constant for water vapor (J/(kgÂ·K))
    
    // Calculate saturation vapor pressure (Magnus formula)
    const es = 6.1078 * Math.exp((17.27 * temperature) / (temperature + 237.3)) * 100; // Pa
    
    // Actual vapor pressure
    const e = (humidity / 100) * es;
    
    // Partial pressure of dry air
    const pd = p - e;
    
    // Air density
    const rho = (pd / (Rd * T)) + (e / (Rv * T));
    
    return rho;
}

// Barometric Pressure Calculations

/**
 * Convert station pressure to sea level pressure using the barometric formula
 * 
 * stationPressure: Station pressure in hPa (mbar)
 * altitude: Station altitude in meters
 * temperature: Temperature in Celsius
 * Returns Sea level pressure in hPa (mbar)
 */
export function calculateSeaLevelPressure(
    stationPressure: number,
    altitude: number,
    temperature: number
): number {
    // Barometric formula constants
    const g = 9.80665;     // Gravitational acceleration (m/sÂ²)
    const M = 0.0289644;   // Molar mass of air (kg/mol)
    const R = 8.31447;     // Universal gas constant (J/(molÂ·K))
    const L = 0.0065;      // Temperature lapse rate (K/m)
    
    const T = temperature + 273.15; // Convert to Kelvin
    
    // Barometric formula for sea level pressure
    const seaLevelPressure = stationPressure * Math.pow(
        1 - (L * altitude) / T,
        -(g * M) / (R * L)
    );
    
    return seaLevelPressure;
}

/**
 * Convert sea level pressure to station pressure
 * 
 * seaLevelPressure: Sea level pressure in hPa (mbar)
 * altitude: Station altitude in meters
 * temperature: Temperature in Celsius
 * Returns Station pressure in hPa (mbar)
 */
export function calculateStationPressure(
    seaLevelPressure: number,
    altitude: number,
    temperature: number
): number {
    const g = 9.80665;
    const M = 0.0289644;
    const R = 8.31447;
    const L = 0.0065;
    
    const T = temperature + 273.15;
    
    const stationPressure = seaLevelPressure * Math.pow(
        1 - (L * altitude) / T,
        (g * M) / (R * L)
    );
    
    return stationPressure;
}

/**
 * Convert pressure from hPa to mbar (they are equivalent)
 */
export function hPaToMbar(hpa: number): number {
    return hpa; // 1 hPa = 1 mbar
}

/**
 * Convert pressure from hPa to inHg
 */
export function hPaToInHg(hpa: number): number {
    return hpa * 0.02953;
}

/**
 * Convert pressure from hPa to mmHg
 */
export function hPaToMmHg(hpa: number): number {
    return hpa * 0.75006;
}

// Reference Evapotranspiration (ETo) - FAO Penman-Monteith

/**
 * Calculate Reference Evapotranspiration using FAO Penman-Monteith equation
 * This is the standard method recommended by FAO-56 for calculating ETo
 * 
 * temperature: Mean daily temperature (Â°C)
 * humidity: Relative humidity (%)
 * windSpeed: Wind speed at 2m height (m/s)
 * solarRadiation: Solar radiation (MJ/mÂ²/day)
 * altitude: Station altitude (m)
 * latitude: Station latitude (degrees)
 * dayOfYear: Day of year (1-365)
 * Returns ETo in mm/day
 */
export function calculateETo(
    temperature: number,
    humidity: number,
    windSpeed: number,
    solarRadiation: number,
    altitude: number,
    latitude: number,
    dayOfYear: number
): number {
    const T = temperature;
    const RH = humidity;
    const u2 = windSpeed;
    const Rs = solarRadiation;
    const z = altitude;
    
    // Atmospheric pressure (kPa)
    const P = 101.3 * Math.pow((293 - 0.0065 * z) / 293, 5.26);
    
    // Psychrometric constant (kPa/Â°C)
    const gamma = 0.665e-3 * P;
    
    // Slope of saturation vapor pressure curve (kPa/Â°C)
    const delta = 4098 * (0.6108 * Math.exp(17.27 * T / (T + 237.3))) / Math.pow(T + 237.3, 2);
    
    // Saturation vapor pressure (kPa)
    const es = 0.6108 * Math.exp(17.27 * T / (T + 237.3));
    
    // Actual vapor pressure (kPa)
    const ea = es * RH / 100;
    
    // Inverse relative distance Earth-Sun
    const dr = 1 + 0.033 * Math.cos(2 * Math.PI * dayOfYear / 365);
    
    // Solar declination (rad)
    const d = 0.409 * Math.sin(2 * Math.PI * dayOfYear / 365 - 1.39);
    
    // Latitude in radians
    const phi = latitude * Math.PI / 180;
    
    // Sunset hour angle (rad)
    const ws = Math.acos(-Math.tan(phi) * Math.tan(d));
    
    // Extraterrestrial radiation (MJ/mÂ²/day)
    const Ra = (24 * 60 / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.sin(ws));
    
    // Clear-sky solar radiation (MJ/mÂ²/day)
    const Rso = (0.75 + 2e-5 * z) * Ra;
    
    // Net shortwave radiation (MJ/mÂ²/day)
    const Rns = (1 - 0.23) * Rs;
    
    // Net longwave radiation (MJ/mÂ²/day)
    const Tk = T + 273.16;
    const Rnl = 4.903e-9 * Math.pow(Tk, 4) * (0.34 - 0.14 * Math.sqrt(ea)) * (1.35 * Rs / Rso - 0.35);
    
    // Net radiation (MJ/mÂ²/day)
    const Rn = Rns - Rnl;
    
    // Soil heat flux (assume G = 0 for daily calculations)
    const G = 0;
    
    // FAO Penman-Monteith equation
    const ETo = (0.408 * delta * (Rn - G) + gamma * (900 / (T + 273)) * u2 * (es - ea)) /
                (delta + gamma * (1 + 0.34 * u2));
    
    return Math.max(0, ETo);
}

/**
 * Convert solar radiation from W/mÂ² to MJ/mÂ²/day
 */
export function wattsToMJPerDay(watts: number, hours: number = 24): number {
    return watts * hours * 3600 / 1e6;
}

/**
 * Convert wind speed from km/h to m/s
 * DEPRECATED: Wind data is now stored in m/s natively. This function is kept for backward compatibility.
 */
export function kmhToMs(kmh: number): number {
    return kmh / 3.6;
}

/**
 * Calculate day of year from date
 */
export function getDayOfYear(date: Date = new Date()): number {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date.getTime() - start.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
}

// Wind Power Density

/**
 * Calculate wind power density using P = 0.5 * Ï * vÂ³
 * 
 * windSpeed: Wind speed in m/s
 * airDensity: Air density in kg/mÂ³ (default 1.225)
 * Returns Power density in W/mÂ²
 */
export function calculateWindPower(windSpeed: number, airDensity: number = STANDARD_AIR_DENSITY_KGM3): number {
    return 0.5 * airDensity * Math.pow(windSpeed, 3);
}

// Dew Point Calculation

/**
 * Calculate dew point temperature using Magnus-Tetens formula
 * 
 * temperature: Temperature in Celsius
 * humidity: Relative humidity in percent (0-100)
 * Returns Dew point temperature in Celsius
 */
export function calculateDewPoint(temperature: number, humidity: number): number {
    const a = 17.27;
    const b = 237.7;
    
    const alpha = (a * temperature) / (b + temperature) + Math.log(humidity / 100);
    const dewPoint = (b * alpha) / (a - alpha);
    
    return dewPoint;
}

// Heat Index Calculation

/**
 * Calculate heat index (feels like temperature in hot conditions)
 * 
 * temperature: Temperature in Celsius
 * humidity: Relative humidity in percent (0-100)
 * Returns Heat index in Celsius
 */
export function calculateHeatIndex(temperature: number, humidity: number): number {
    // Convert to Fahrenheit for the calculation
    const T = convertCelsiusToFahrenheit(temperature);
    const RH = humidity;
    
    // Simple formula for lower temperatures
    if (T < 80) {
        const HI_F = 0.5 * (T + 61.0 + ((T - 68.0) * 1.2) + (RH * 0.094));
        return convertFahrenheitToCelsius(HI_F);
    }
    
    // Rothfusz regression equation
    let HI = -42.379 + 2.04901523 * T + 10.14333127 * RH
           - 0.22475541 * T * RH - 0.00683783 * T * T
           - 0.05481717 * RH * RH + 0.00122874 * T * T * RH
           + 0.00085282 * T * RH * RH - 0.00000199 * T * T * RH * RH;
    
    // Adjustments
    if (RH < 13 && T >= 80 && T <= 112) {
        HI -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    } else if (RH > 85 && T >= 80 && T <= 87) {
        HI += ((RH - 85) / 10) * ((87 - T) / 5);
    }
    
    return convertFahrenheitToCelsius(HI);
}


// Lowveld Fire Danger Index (LFDI)
//
// Official fire danger index used by the South African Weather Service (SAWS)
// and Namibia (via AFIS). National standard under the SA National Veld and
// Forest Fire Act. Also known as the SA FDI.
//
// Formula: LFDI = (BI + WF) x RCF
//   BI  = Burning Index (temperature + humidity dryness component)
//   WF  = Wind Factor (polynomial approximation of spread risk)
//   RCF = Rain Correction Factor (0.1 to 1.0, lookup from last rain amount and days since)
//
// Inputs (daily values):
//   T  = Maximum air temperature (Â°C)
//   RH = Minimum relative humidity (%)
//   WS = Wind speed (km/h)
//   P  = Rainfall from most recent event (mm)
//   D  = Days since that rain
//
// Rating categories:
//    0 - 20  Blue   SAFE            Fires unlikely to start or spread
//   21 - 45  Green  MODERATE        Care needed with burning
//   46 - 60  Yellow DANGEROUS       Controlled burning not recommended
//   61 - 75  Orange VERY DANGEROUS  Fire teams on standby
//   76+      Red    EXTREME         Total fire ban, warnings issued

// Fire Danger Rating levels
export interface FireDangerRating {
    level: 'safe' | 'moderate' | 'dangerous' | 'very-dangerous' | 'extreme';
    label: string;
    color: string;
    description: string;
    minValue: number;
    maxValue: number;
    actionAdvice: string;
}

// Fire Danger Index result
export interface FireDangerResult {
    ffdi: number;                    // LFDI value
    rating: FireDangerRating;
    burningIndex: number;            // BI component
    windFactor: number;              // WF component
    rainCorrectionFactor: number;    // RCF (0.1 to 1.0)
    fuelMoisture: number;            // Estimated fuel moisture content (%)
    spreadPotential: 'low' | 'moderate' | 'high' | 'very-high' | 'extreme';
    warningLevel: 0 | 1 | 2 | 3;
    warningMessage: string | null;
}

// LFDI colour-coded rating thresholds
export const FIRE_DANGER_RATINGS: FireDangerRating[] = [
    {
        level: 'safe',
        label: 'Safe',
        color: '#3b82f6',
        description: 'Fires unlikely to start or spread.',
        minValue: 0,
        maxValue: 20,
        actionAdvice: 'Conditions are safe. Controlled burning may be conducted with proper permits.'
    },
    {
        level: 'moderate',
        label: 'Moderate',
        color: '#22c55e',
        description: 'Low fire risk. Care needed with burning.',
        minValue: 21,
        maxValue: 45,
        actionAdvice: 'Low fire risk. Exercise care with burning operations. Ensure fires are fully extinguished.'
    },
    {
        level: 'dangerous',
        label: 'Dangerous',
        color: '#eab308',
        description: 'Controlled burning not recommended.',
        minValue: 46,
        maxValue: 60,
        actionAdvice: 'Caution advised. Avoid open fires and report any wildfires immediately.'
    },
    {
        level: 'very-dangerous',
        label: 'Very Dangerous',
        color: '#f97316',
        description: 'Fire teams on standby. No open flames.',
        minValue: 61,
        maxValue: 75,
        actionAdvice: 'Very dangerous. Fire teams on standby. No open flames. Be alert and ready to evacuate.'
    },
    {
        level: 'extreme',
        label: 'Extreme',
        color: '#dc2626',
        description: 'Total fire ban. Warnings issued.',
        minValue: 76,
        maxValue: 100,
        actionAdvice: 'EXTREME fire danger. Warnings on radio and TV. All burning prohibited. Evacuate if advised.'
    }
];

// Get fire danger rating from LFDI value
export function getFireDangerRating(fdi: number): FireDangerRating {
    for (const rating of FIRE_DANGER_RATINGS) {
        if (fdi >= rating.minValue && fdi <= rating.maxValue) {
            return rating;
        }
    }
    return FIRE_DANGER_RATINGS[FIRE_DANGER_RATINGS.length - 1];
}

// Burning Index (BI)
// Scaled Angstrom-type dryness component from temperature and humidity.
// BI = (T - 35) - (35 - T)/30 + ((100 - RH) * 0.37) + 30
// T = daily max temperature (Â°C), RH = daily min relative humidity (%)
export function calculateBurningIndex(tempC: number, rh: number): number {
    const bi = (tempC - 35) - ((35 - tempC) / 30) + ((100 - rh) * 0.37) + 30;
    return Math.max(0, bi);
}

// Wind Factor (WF)
// Polynomial approximation used in official LFDI practice.
// WF = -0.0000227*WS^4 + 0.0026348*WS^3 - 0.09087*WS^2 + 1.65*WS + 0.2
// WS = wind speed in km/h
export function calculateWindFactor(windKmh: number): number {
    const ws = Math.max(0, windKmh);
    const wf = -0.0000227 * Math.pow(ws, 4)
             +  0.0026348 * Math.pow(ws, 3)
             -  0.09087   * Math.pow(ws, 2)
             +  1.65      * ws
             +  0.2;
    return Math.max(0, wf);
}

// Rain Correction Factor (RCF)
// Lookup table based on last rainfall amount (mm) and days since that rain.
// Values range from 0.1 (heavy recent rain) to 1.0 (12+ dry days).
// Based on official DWAF/SAWS nomogram values.
export function getRainCorrectionFactor(lastRainMm: number, daysSinceRain: number): number {
    // 12+ days since rain, or no rain recorded: full dryness
    if (daysSinceRain >= 12) return 1.0;

    // Lookup table: rows = rain amount, columns = days since rain
    // Days:          0     1     2     3     4     5     6     7     8     9    10    11
    // Rain (mm):
    if (lastRainMm >= 25) {
        const rcf = [0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.95];
        return rcf[Math.min(daysSinceRain, 11)];
    }
    if (lastRainMm >= 13) {
        const rcf = [0.15, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.95, 1.00];
        return rcf[Math.min(daysSinceRain, 11)];
    }
    if (lastRainMm >= 5) {
        const rcf = [0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.95, 1.00, 1.00];
        return rcf[Math.min(daysSinceRain, 11)];
    }
    if (lastRainMm >= 2) {
        const rcf = [0.40, 0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.95, 1.00, 1.00, 1.00, 1.00];
        return rcf[Math.min(daysSinceRain, 11)];
    }
    // Less than 2mm of rain is insignificant
    return 1.0;
}

// Calculate the Lowveld Fire Danger Index.
// LFDI = (BI + WF) x RCF
//
// temperature: daily max air temperature (Â°C)
// humidity: daily min relative humidity (%)
// windSpeed: wind speed in m/s (converted internally to km/h)
// lastRainMm: rainfall from most recent event (mm)
// daysSinceRain: days since that rain event
export function calculateLFDI(
    temperature: number,
    humidity: number,
    windSpeed: number,
    lastRainMm: number = 0,
    daysSinceRain: number = 7
): { lfdi: number; bi: number; wf: number; rcf: number } {
    const windKmh = windSpeed * 3.6;
    const bi = calculateBurningIndex(temperature, humidity);
    const wf = calculateWindFactor(windKmh);
    const rcf = getRainCorrectionFactor(lastRainMm, daysSinceRain);
    const lfdi = (bi + wf) * rcf;
    return { lfdi: Math.max(0, lfdi), bi, wf, rcf };
}

// Backward-compatible aliases for old additive score API.
// These map to LFDI components so the FireDangerCard breakdown still works.
// They return rounded display values, not used in the actual calculation.
export function getTemperatureScore(tempC: number): number {
    // Portion of BI attributable to temperature: (T - 35) - (35 - T)/30 + 30
    return Math.max(0, Math.round(((tempC - 35) - ((35 - tempC) / 30) + 30) * 10) / 10);
}
export function getHumidityScore(rh: number): number {
    // Portion of BI attributable to humidity: (100 - RH) * 0.37
    return Math.max(0, Math.round(((100 - rh) * 0.37) * 10) / 10);
}
export function getWindScore(windMs: number): number {
    return Math.round(calculateWindFactor(windMs * 3.6) * 10) / 10;
}
export function getRainScore(daysSinceRain: number, rainfall7day: number, _rainfall30day: number): number {
    // Return RCF as a display value (multiplier 0-1 shown as 0-10 range for the card)
    // Use rainfall7day as a proxy for last rain amount
    const rcf = getRainCorrectionFactor(rainfall7day, daysSinceRain);
    return Math.round(rcf * 10) / 10;
}

// Estimate fuel moisture content from weather conditions
export function estimateFuelMoisture(temperature: number, humidity: number): number {
    const T = temperature;
    const RH = humidity;
    let fuelMoisture: number;
    if (RH <= 10) {
        fuelMoisture = 0.03229 + 0.281073 * RH - 0.000578 * RH * T;
    } else if (RH <= 50) {
        fuelMoisture = 2.22749 + 0.160107 * RH - 0.01478 * T;
    } else {
        fuelMoisture = 21.0606 + 0.005565 * RH * RH - 0.00035 * RH * T - 0.483199 * RH;
    }
    return Math.max(2, Math.min(35, fuelMoisture));
}

// Calculate comprehensive Fire Danger Index using the official LFDI method.
// LFDI = (BI + WF) x RCF
//
// temperature: daily max air temperature in Celsius
// humidity: daily min relative humidity in percent (0-100)
// windSpeed: wind speed in m/s
// rainfall7day: total rainfall in last 7 days (mm), used as proxy for last rain amount
// rainfall30day: unused, kept for API compatibility
// daysSinceRain: days since last significant rain
export function calculateFireDanger(
    temperature: number,
    humidity: number,
    windSpeed: number,
    rainfall7day: number = 0,
    _rainfall30day: number = 0,
    daysSinceRain: number = 7
): FireDangerResult {
    const { lfdi, bi, wf, rcf } = calculateLFDI(temperature, humidity, windSpeed, rainfall7day, daysSinceRain);
    const fuelMoisture = estimateFuelMoisture(temperature, humidity);
    const rating = getFireDangerRating(Math.round(lfdi));

    // Spread potential maps from LFDI rating thresholds
    let spreadPotential: 'low' | 'moderate' | 'high' | 'very-high' | 'extreme';
    if (lfdi <= 20) spreadPotential = 'low';
    else if (lfdi <= 45) spreadPotential = 'moderate';
    else if (lfdi <= 60) spreadPotential = 'high';
    else if (lfdi <= 75) spreadPotential = 'very-high';
    else spreadPotential = 'extreme';

    let warningLevel: 0 | 1 | 2 | 3 = 0;
    let warningMessage: string | null = null;
    if (rating.level === 'extreme') {
        warningLevel = 3;
        warningMessage = 'EXTREME: Fire warnings on radio and TV. All burning prohibited. Evacuate fire-prone areas if advised.';
    } else if (rating.level === 'very-dangerous') {
        warningLevel = 2;
        warningMessage = 'VERY DANGEROUS: Fire teams on standby. No open flames permitted.';
    } else if (rating.level === 'dangerous') {
        warningLevel = 1;
        warningMessage = 'DANGEROUS: Caution advised. Avoid open fires and stay vigilant.';
    }

    return {
        ffdi: Math.round(lfdi * 10) / 10,
        rating,
        burningIndex: Math.round(bi * 10) / 10,
        windFactor: Math.round(wf * 10) / 10,
        rainCorrectionFactor: Math.round(rcf * 100) / 100,
        fuelMoisture: Math.round(fuelMoisture * 10) / 10,
        spreadPotential,
        warningLevel,
        warningMessage
    };
}

// â”€â”€â”€ Air Quality Index (AQI) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface AQIResult {
    aqi: number;
    category: string;
    color: string;
    healthMessage: string;
    dominant: 'pm25' | 'pm10';
}

/**
 * Calculate US EPA AQI from PM2.5 and/or PM10 concentrations.
 * Returns the higher of the two sub-indices as the overall AQI.
 */
export function calculateAQI(pm25?: number | null, pm10?: number | null): AQIResult | null {
    if ((pm25 == null || pm25 < 0) && (pm10 == null || pm10 < 0)) return null;

    // EPA PM2.5 breakpoints (Âµg/mÂ³, 24-hr average) â†’ AQI
    const pm25Bp = [
        { lo: 0, hi: 12.0, aqiLo: 0, aqiHi: 50 },
        { lo: 12.1, hi: 35.4, aqiLo: 51, aqiHi: 100 },
        { lo: 35.5, hi: 55.4, aqiLo: 101, aqiHi: 150 },
        { lo: 55.5, hi: 150.4, aqiLo: 151, aqiHi: 200 },
        { lo: 150.5, hi: 250.4, aqiLo: 201, aqiHi: 300 },
        { lo: 250.5, hi: 500.4, aqiLo: 301, aqiHi: 500 },
    ];

    // EPA PM10 breakpoints (Âµg/mÂ³, 24-hr average) â†’ AQI
    const pm10Bp = [
        { lo: 0, hi: 54, aqiLo: 0, aqiHi: 50 },
        { lo: 55, hi: 154, aqiLo: 51, aqiHi: 100 },
        { lo: 155, hi: 254, aqiLo: 101, aqiHi: 150 },
        { lo: 255, hi: 354, aqiLo: 151, aqiHi: 200 },
        { lo: 355, hi: 424, aqiLo: 201, aqiHi: 300 },
        { lo: 425, hi: 604, aqiLo: 301, aqiHi: 500 },
    ];

    const calcSubIndex = (value: number, breakpoints: typeof pm25Bp): number => {
        for (const bp of breakpoints) {
            if (value <= bp.hi) {
                return ((bp.aqiHi - bp.aqiLo) / (bp.hi - bp.lo)) * (value - bp.lo) + bp.aqiLo;
            }
        }
        return 500; // Above highest breakpoint
    };

    const aqi25 = pm25 != null && pm25 >= 0 ? calcSubIndex(pm25, pm25Bp) : -1;
    const aqi10 = pm10 != null && pm10 >= 0 ? calcSubIndex(pm10, pm10Bp) : -1;

    const aqi = Math.max(aqi25, aqi10);
    const dominant: 'pm25' | 'pm10' = aqi25 >= aqi10 ? 'pm25' : 'pm10';

    const categories = [
        { max: 50, category: 'Good', color: '#22c55e', msg: 'Air quality is satisfactory.' },
        { max: 100, category: 'Moderate', color: '#eab308', msg: 'Acceptable. Sensitive groups may experience minor effects.' },
        { max: 150, category: 'Unhealthy for Sensitive Groups', color: '#f97316', msg: 'Sensitive groups should reduce prolonged outdoor exertion.' },
        { max: 200, category: 'Unhealthy', color: '#ef4444', msg: 'Everyone may begin to experience health effects.' },
        { max: 300, category: 'Very Unhealthy', color: '#7c3aed', msg: 'Health alert: everyone may experience serious effects.' },
        { max: 500, category: 'Hazardous', color: '#991b1b', msg: 'Emergency conditions. Entire population affected.' },
    ];

    const cat = categories.find(c => aqi <= c.max) || categories[categories.length - 1];
    return {
        aqi: Math.round(aqi),
        category: cat.category,
        color: cat.color,
        healthMessage: cat.msg,
        dominant,
    };
}

/** SA NAAQS PM10 daily limit (Âµg/mÂ³). Exceedance = non-compliance. */
export const SA_NAAQS_PM10_DAILY = 75;
/** SA NAAQS PM2.5 daily limit (Âµg/mÂ³). */
export const SA_NAAQS_PM25_DAILY = 40;

// â”€â”€â”€ WBGT Heat Stress â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface WBGTResult {
    wbgt: number;
    category: string;
    color: string;
    restPercentage: number;
    maxExposureMinutes: number | null;
    recommendation: string;
}

/**
 * Calculate Wet Bulb Globe Temperature using Bernard approximation.
 * Suitable for outdoor occupational screening.
 * temperature: air temperature in Â°C
 * humidity: relative humidity in % (0-100)
 * solarRadiation: solar radiation in W/mÂ² (used to estimate globe temperature)
 * windSpeed: wind speed in m/s
 */
export function calculateWBGT(
    temperature: number,
    humidity: number,
    solarRadiation: number = 0,
    windSpeed: number = 0
): WBGTResult {
    // Natural wet bulb temperature (Stull 2011 regression)
    const Tw = temperature * Math.atan(0.151977 * Math.sqrt(humidity + 8.313659))
        + Math.atan(temperature + humidity)
        - Math.atan(humidity - 1.676331)
        + 0.00391838 * Math.pow(humidity, 1.5) * Math.atan(0.023101 * humidity)
        - 4.686035;

    // Globe temperature estimate (Liljegren simplified â€” accounts for radiation and wind)
    const Tg = 1.01 * temperature + 2.84e-2 * solarRadiation
        - 0.885 * windSpeed + 0.455;

    // Outdoor WBGT = 0.7 Tw + 0.2 Tg + 0.1 Ta
    const wbgt = 0.7 * Tw + 0.2 * Tg + 0.1 * temperature;

    // OHS Act work-rest categories (heavy work)
    let category: string, color: string, restPercentage: number, maxExposureMinutes: number | null, recommendation: string;
    if (wbgt < 26) {
        category = 'Safe'; color = '#22c55e'; restPercentage = 0; maxExposureMinutes = null;
        recommendation = 'Normal work activities. Stay hydrated.';
    } else if (wbgt < 28) {
        category = 'Caution'; color = '#eab308'; restPercentage = 0; maxExposureMinutes = 240;
        recommendation = 'Increase water intake. Monitor for heat symptoms.';
    } else if (wbgt < 30) {
        category = 'Warning'; color = '#f97316'; restPercentage = 25; maxExposureMinutes = 120;
        recommendation = '15 min rest per hour. Reduce heavy physical work.';
    } else if (wbgt < 32) {
        category = 'Danger'; color = '#ef4444'; restPercentage = 50; maxExposureMinutes = 60;
        recommendation = '30 min rest per hour. Only essential work outdoors.';
    } else if (wbgt < 34) {
        category = 'Extreme'; color = '#991b1b'; restPercentage = 75; maxExposureMinutes = 30;
        recommendation = '45 min rest per hour. Suspend non-critical outdoor work.';
    } else {
        category = 'Extreme'; color = '#991b1b'; restPercentage = 100; maxExposureMinutes = 0;
        recommendation = 'Suspend all outdoor work. Risk of heat stroke.';
    }

    return { wbgt: Math.round(wbgt * 10) / 10, category, color, restPercentage, maxExposureMinutes, recommendation };
}

// â”€â”€â”€ Atmospheric Stability (Pasquill-Gifford) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type StabilityClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface StabilityResult {
    stabilityClass: StabilityClass;
    description: string;
    color: string;
    mixingHeight: number;
    dispersionCondition: string;
    inversionDetected: boolean;
}

const STABILITY_INFO: Record<StabilityClass, { description: string; color: string; dispersion: string }> = {
    A: { description: 'Extremely Unstable', color: '#ef4444', dispersion: 'Excellent dispersion. Rapid vertical mixing.' },
    B: { description: 'Moderately Unstable', color: '#f97316', dispersion: 'Good dispersion. Strong convective mixing.' },
    C: { description: 'Slightly Unstable', color: '#eab308', dispersion: 'Fair dispersion. Moderate mixing.' },
    D: { description: 'Neutral', color: '#6b7280', dispersion: 'Moderate dispersion. Mechanical mixing dominates.' },
    E: { description: 'Slightly Stable', color: '#3b82f6', dispersion: 'Poor dispersion. Limited vertical mixing.' },
    F: { description: 'Moderately Stable', color: '#7c3aed', dispersion: 'Very poor dispersion. Pollutants may accumulate.' },
};

/**
 * Determine Pasquill-Gifford stability class from wind speed and solar radiation.
 * windSpeed: wind speed in m/s (at 10m height)
 * solarRadiation: incoming solar radiation in W/mÂ²
 * isNight: whether it is currently night-time (auto-detected from solarRadiation if not provided)
 * cloudCover: cloud cover in oktas (0-8), used for night classification
 * deltaTemperature: temperature lapse (T_8m - T_2m) in Â°C, used for direct inversion detection
 */
export function calculatePasquillGifford(
    windSpeed: number,
    solarRadiation: number,
    isNight?: boolean,
    cloudCover?: number | null,
    deltaTemperature?: number | null
): StabilityResult {
    const night = isNight !== undefined ? isNight : solarRadiation < 10;
    const ws = windSpeed;

    let stabilityClass: StabilityClass;
    if (!night) {
        // Daytime: classify by insolation strength
        const strong = solarRadiation > 700;
        const moderate = solarRadiation > 300;

        if (ws < 2) stabilityClass = strong ? 'A' : moderate ? 'A' : 'B';
        else if (ws < 3) stabilityClass = strong ? 'A' : moderate ? 'B' : 'C';
        else if (ws < 5) stabilityClass = strong ? 'B' : moderate ? 'B' : 'C';
        else if (ws < 6) stabilityClass = strong ? 'C' : moderate ? 'C' : 'D';
        else stabilityClass = 'D';
    } else {
        // Night-time: classify by cloud cover (default thin overcast = 4 oktas)
        const overcast = (cloudCover ?? 4) >= 5;
        if (ws < 2) stabilityClass = 'F';
        else if (ws < 3) stabilityClass = overcast ? 'E' : 'F';
        else if (ws < 5) stabilityClass = overcast ? 'D' : 'E';
        else stabilityClass = 'D';
    }

    // Empirical mixing height estimate (m)
    const mixingHeights: Record<StabilityClass, number> = {
        A: 1500, B: 1200, C: 900, D: 500, E: 200, F: 100,
    };
    const mixingHeight = mixingHeights[stabilityClass];

    // Inversion detection from deltaTemperature (positive = inversion)
    const inversionDetected = deltaTemperature != null && deltaTemperature > 0;

    // Override to F if strong inversion detected with light winds at night
    if (inversionDetected && night && ws < 3 && stabilityClass !== 'F') {
        stabilityClass = 'F';
    }

    const info = STABILITY_INFO[stabilityClass];
    return {
        stabilityClass,
        description: info.description,
        color: info.color,
        mixingHeight,
        dispersionCondition: inversionDetected
            ? 'Temperature inversion detected. Very poor dispersion.'
            : info.dispersion,
        inversionDetected,
    };
}

// â”€â”€â”€ Phase 2: Aviation & Transportation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// â”€â”€â”€ Density Altitude â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface DensityAltitudeResult {
    densityAltitude: number;      // feet
    pressureAltitude: number;     // feet
    isaDeviation: number;         // Â°C deviation from ISA standard temp at that altitude
    performanceImpact: string;
    color: string;
}

/**
 * Calculate density altitude using ISA formula.
 * stationPressure: station-level pressure in hPa
 * temperature: air temperature in Â°C
 * dewPoint: dew point in Â°C (for vapour pressure correction)
 * stationElevation: station elevation in metres above MSL
 */
export function calculateDensityAltitude(
    stationPressure: number,
    temperature: number,
    dewPoint: number = 0,
    stationElevation: number = 0
): DensityAltitudeResult {
    // Pressure altitude (feet) = (1013.25 - QNH) Ã- 30 + field elevation
    // More accurate: using hypsometric equation
    const pressureAltitudeFt = (1 - Math.pow(stationPressure / 1013.25, 0.190284)) * 145366.45;

    // ISA standard temperature at pressure altitude: 15 - (PA_ft Ã- 0.001981)Â°C
    const isaTemp = 15 - (pressureAltitudeFt * 0.001981);
    const isaDeviation = temperature - isaTemp;

    // Virtual temperature correction for humidity (vapour pressure effect)
    // e = 6.11 Ã- 10^(7.5 Ã- Td / (237.7 + Td))  [hPa]
    const e = 6.11 * Math.pow(10, (7.5 * dewPoint) / (237.7 + dewPoint));
    const Tv = (temperature + 273.15) / (1 - 0.378 * (e / stationPressure)) - 273.15;

    // Density altitude using virtual temperature
    const densityAltitudeFt = pressureAltitudeFt + (120 * (Tv - isaTemp));

    // Performance classification
    let performanceImpact: string, color: string;
    if (densityAltitudeFt < 2000) {
        performanceImpact = 'Normal'; color = '#22c55e';
    } else if (densityAltitudeFt < 4000) {
        performanceImpact = 'Slightly Reduced'; color = '#eab308';
    } else if (densityAltitudeFt < 6000) {
        performanceImpact = 'Reduced'; color = '#f97316';
    } else if (densityAltitudeFt < 8000) {
        performanceImpact = 'Significantly Reduced'; color = '#ef4444';
    } else {
        performanceImpact = 'Critical'; color = '#991b1b';
    }

    return {
        densityAltitude: Math.round(densityAltitudeFt),
        pressureAltitude: Math.round(pressureAltitudeFt),
        isaDeviation: Math.round(isaDeviation * 10) / 10,
        performanceImpact,
        color,
    };
}

// â”€â”€â”€ METAR Formatter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR';

export interface METARResult {
    metarString: string;
    flightCategory: FlightCategory;
    flightCategoryColor: string;
}

/**
 * Classify flight category based on visibility and cloud base.
 * visibility: in metres
 * cloudBase: in metres AGL
 */
export function classifyFlightCategory(
    visibility?: number | null,
    cloudBase?: number | null
): { category: FlightCategory; color: string } {
    // Convert visibility to statute miles (1 sm = 1609.34 m)
    const visSm = visibility != null ? visibility / 1609.34 : 999;
    // Convert cloud base to feet AGL (1 ft = 0.3048 m)
    const ceilingFt = cloudBase != null ? cloudBase / 0.3048 : 99999;

    if (visSm < 1 || ceilingFt < 500) return { category: 'LIFR', color: '#7c3aed' };
    if (visSm < 3 || ceilingFt < 1000) return { category: 'IFR', color: '#ef4444' };
    if (visSm < 5 || ceilingFt < 3000) return { category: 'MVFR', color: '#3b82f6' };
    return { category: 'VFR', color: '#22c55e' };
}

/**
 * Format current conditions as a METAR-style string.
 * All inputs are in metric units as stored in the database.
 */
export function formatMETAR(
    windDirection?: number | null,
    windSpeed?: number | null,   // m/s
    windGust?: number | null,    // m/s
    visibility?: number | null,  // metres
    cloudBase?: number | null,   // metres AGL
    cloudCover?: number | null,  // oktas (0-8)
    temperature?: number | null, // Â°C
    dewPoint?: number | null,    // Â°C
    pressure?: number | null,    // hPa (QNH)
): METARResult {
    const parts: string[] = [];

    // Wind: dddffGff KT (convert m/s to knots: Ã-1.94384)
    if (windDirection != null && windSpeed != null) {
        const dir = String(Math.round(windDirection)).padStart(3, '0');
        const spd = String(Math.round(windSpeed * 1.94384)).padStart(2, '0');
        let wind = `${dir}${spd}`;
        if (windGust != null && windGust > windSpeed * 1.2) {
            wind += `G${String(Math.round(windGust * 1.94384)).padStart(2, '0')}`;
        }
        parts.push(wind + 'KT');
    }

    // Visibility: in metres (METAR uses metres in ICAO format)
    if (visibility != null) {
        if (visibility >= 9999) parts.push('9999');
        else parts.push(String(Math.round(visibility / 100) * 100));
    }

    // Cloud: FEW/SCT/BKN/OVC + height in hundreds of feet
    if (cloudBase != null && cloudCover != null) {
        const heightHft = String(Math.round((cloudBase / 0.3048) / 100)).padStart(3, '0');
        let coverCode: string;
        if (cloudCover <= 2) coverCode = 'FEW';
        else if (cloudCover <= 4) coverCode = 'SCT';
        else if (cloudCover <= 7) coverCode = 'BKN';
        else coverCode = 'OVC';
        parts.push(`${coverCode}${heightHft}`);
    } else if (cloudCover === 0 || cloudCover == null) {
        parts.push('SKC');
    }

    // Temperature/Dew Point: MM/DD format
    if (temperature != null) {
        const t = Math.round(temperature);
        const tStr = t < 0 ? `M${String(Math.abs(t)).padStart(2, '0')}` : String(t).padStart(2, '0');
        if (dewPoint != null) {
            const d = Math.round(dewPoint);
            const dStr = d < 0 ? `M${String(Math.abs(d)).padStart(2, '0')}` : String(d).padStart(2, '0');
            parts.push(`${tStr}/${dStr}`);
        } else {
            parts.push(tStr);
        }
    }

    // Altimeter: QNH in hPa (ICAO format: Q1013)
    if (pressure != null) {
        parts.push(`Q${Math.round(pressure)}`);
    }

    const { category, color } = classifyFlightCategory(visibility, cloudBase);

    return {
        metarString: parts.join(' '),
        flightCategory: category,
        flightCategoryColor: color,
    };
}

// â”€â”€â”€ Crosswind Calculator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface CrosswindResult {
    headwind: number;     // positive = headwind, negative = tailwind (knots)
    crosswind: number;    // absolute crosswind component (knots)
    crosswindSide: 'left' | 'right';
    tailwind: boolean;
}

/**
 * Calculate headwind and crosswind components.
 * windSpeed: wind speed in m/s
 * windDirection: wind direction in degrees (where wind is FROM)
 * runwayHeading: runway magnetic heading in degrees
 */
export function calculateCrosswind(
    windSpeed: number,
    windDirection: number,
    runwayHeading: number
): CrosswindResult {
    const windKt = windSpeed * 1.94384; // m/s to knots
    const angleDeg = windDirection - runwayHeading;
    const angleRad = (angleDeg * Math.PI) / 180;

    const headwind = windKt * Math.cos(angleRad);
    const crosswind = windKt * Math.sin(angleRad);

    return {
        headwind: Math.round(headwind * 10) / 10,
        crosswind: Math.round(Math.abs(crosswind) * 10) / 10,
        crosswindSide: crosswind >= 0 ? 'right' : 'left',
        tailwind: headwind < 0,
    };
}

// â”€â”€â”€ Road Weather & Icing Risk â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface RoadWeatherResult {
    icingRisk: string;
    icingRiskColor: string;
    fogRisk: string;
    fogRiskColor: string;
    overallCondition: string;
    overallColor: string;
    roadSurfaceTemp: number;
    dewPointSpread: number;
}

/**
 * Calculate road icing risk from meteorological conditions.
 * temperature: air temperature in Â°C
 * dewPoint: dew point in Â°C
 * windSpeed: wind speed in m/s
 * humidity: relative humidity in %
 * rainfall: recent rainfall in mm (last hour or interval)
 */
export function calculateRoadWeather(
    temperature: number,
    dewPoint: number,
    windSpeed: number = 0,
    humidity: number = 50,
    rainfall: number = 0
): RoadWeatherResult {
    // Empirical road surface temperature estimate
    // Road surface is typically 1-3Â°C colder than air at night, warmer during day
    const roadSurfaceTemp = temperature - (windSpeed > 2 ? 1.5 : 0.5);

    const dewPointSpread = temperature - dewPoint;
    const wetSurface = rainfall > 0 || humidity > 90;

    // Icing risk: surface near/below 0Â°C + moisture
    let icingRisk: string, icingRiskColor: string;
    if (roadSurfaceTemp <= -2 && wetSurface) {
        icingRisk = 'High'; icingRiskColor = '#ef4444';
    } else if (roadSurfaceTemp <= 0 && wetSurface) {
        icingRisk = 'Moderate'; icingRiskColor = '#f97316';
    } else if (roadSurfaceTemp <= 3 && dewPointSpread < 2) {
        icingRisk = 'Low'; icingRiskColor = '#eab308';
    } else {
        icingRisk = 'None'; icingRiskColor = '#22c55e';
    }

    // Fog risk: dew point spread + wind + cooling rate
    let fogRisk: string, fogRiskColor: string;
    if (dewPointSpread < 1 && windSpeed < 3) {
        fogRisk = 'High'; fogRiskColor = '#ef4444';
    } else if (dewPointSpread < 2.5 && windSpeed < 5) {
        fogRisk = 'Moderate'; fogRiskColor = '#f97316';
    } else if (dewPointSpread < 4) {
        fogRisk = 'Low'; fogRiskColor = '#eab308';
    } else {
        fogRisk = 'None'; fogRiskColor = '#22c55e';
    }

    // Overall condition
    let overallCondition: string, overallColor: string;
    if (icingRisk === 'High' || fogRisk === 'High') {
        overallCondition = 'Hazardous'; overallColor = '#ef4444';
    } else if (icingRisk === 'Moderate' || fogRisk === 'Moderate') {
        overallCondition = 'Caution'; overallColor = '#f97316';
    } else if (icingRisk === 'Low' || fogRisk === 'Low') {
        overallCondition = 'Fair'; overallColor = '#eab308';
    } else {
        overallCondition = 'Good'; overallColor = '#22c55e';
    }

    return {
        icingRisk, icingRiskColor,
        fogRisk, fogRiskColor,
        overallCondition, overallColor,
        roadSurfaceTemp: Math.round(roadSurfaceTemp * 10) / 10,
        dewPointSpread: Math.round(dewPointSpread * 10) / 10,
    };
}

// â”€â”€â”€ Beaufort Scale & Sea State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface BeaufortResult {
    force: number;                // 0-12
    description: string;
    seaState: string;
    probableWaveHeight: number;   // metres
    maxWaveHeight: number;        // metres
    landEffect: string;
    color: string;
    smallCraftAdvisory: boolean;
}

const BEAUFORT_TABLE: {
    force: number; maxMs: number; description: string; seaState: string;
    waveProb: number; waveMax: number; land: string; color: string;
}[] = [
    { force: 0, maxMs: 0.3, description: 'Calm', seaState: 'Glassy', waveProb: 0, waveMax: 0, land: 'Smoke rises vertically', color: '#e0f2fe' },
    { force: 1, maxMs: 1.6, description: 'Light Air', seaState: 'Rippled', waveProb: 0.1, waveMax: 0.1, land: 'Direction shown by smoke drift', color: '#bae6fd' },
    { force: 2, maxMs: 3.4, description: 'Light Breeze', seaState: 'Wavelets', waveProb: 0.2, waveMax: 0.3, land: 'Wind felt on face, leaves rustle', color: '#7dd3fc' },
    { force: 3, maxMs: 5.5, description: 'Gentle Breeze', seaState: 'Slight', waveProb: 0.6, waveMax: 1.0, land: 'Leaves and small twigs in motion', color: '#38bdf8' },
    { force: 4, maxMs: 8.0, description: 'Moderate Breeze', seaState: 'Slightâ€“Moderate', waveProb: 1.0, waveMax: 1.5, land: 'Raises dust and loose paper', color: '#0ea5e9' },
    { force: 5, maxMs: 10.8, description: 'Fresh Breeze', seaState: 'Moderate', waveProb: 2.0, waveMax: 2.5, land: 'Small trees begin to sway', color: '#22c55e' },
    { force: 6, maxMs: 13.9, description: 'Strong Breeze', seaState: 'Rough', waveProb: 3.0, waveMax: 4.0, land: 'Large branches in motion', color: '#84cc16' },
    { force: 7, maxMs: 17.2, description: 'Near Gale', seaState: 'Roughâ€“High', waveProb: 4.0, waveMax: 5.5, land: 'Whole trees in motion', color: '#eab308' },
    { force: 8, maxMs: 20.8, description: 'Gale', seaState: 'High', waveProb: 5.5, waveMax: 7.5, land: 'Twigs break off trees', color: '#f97316' },
    { force: 9, maxMs: 24.5, description: 'Strong Gale', seaState: 'Very High', waveProb: 7.0, waveMax: 10.0, land: 'Slight structural damage', color: '#ef4444' },
    { force: 10, maxMs: 28.5, description: 'Storm', seaState: 'Very Highâ€“Phenomenal', waveProb: 9.0, waveMax: 12.5, land: 'Trees uprooted', color: '#dc2626' },
    { force: 11, maxMs: 32.7, description: 'Violent Storm', seaState: 'Phenomenal', waveProb: 11.5, waveMax: 16.0, land: 'Widespread damage', color: '#b91c1c' },
    { force: 12, maxMs: Infinity, description: 'Hurricane', seaState: 'Phenomenal', waveProb: 14.0, waveMax: 16.0, land: 'Devastating damage', color: '#7f1d1d' },
];

/**
 * Get Beaufort scale details from wind speed.
 * windSpeedMs: wind speed in m/s
 */
export function getBeaufortScale(windSpeedMs: number): BeaufortResult {
    const entry = BEAUFORT_TABLE.find(b => windSpeedMs < b.maxMs) || BEAUFORT_TABLE[12];
    return {
        force: entry.force,
        description: entry.description,
        seaState: entry.seaState,
        probableWaveHeight: entry.waveProb,
        maxWaveHeight: entry.waveMax,
        landEffect: entry.land,
        color: entry.color,
        smallCraftAdvisory: entry.force >= 6,
    };
}

// â”€â”€â”€ Growing Degree Days & Chill Units â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface GDDResult {
    gdd: number;           // single-day GDD
    cumulativeGDD: number; // running total
    tBase: number;
    tCap: number;
}

/**
 * Calculate Growing Degree Days for a single day using the averaging method.
 * dailyMin: minimum temperature Â°C
 * dailyMax: maximum temperature Â°C
 * tBase: base temperature Â°C (default 10 for most crops)
 * tCap: upper cap Â°C (default 30 â€” temps above this don't add more GDD)
 */
export function calculateGDD(
    dailyMin: number,
    dailyMax: number,
    tBase: number = 10,
    tCap: number = 30
): number {
    const cappedMax = Math.min(dailyMax, tCap);
    const cappedMin = Math.max(dailyMin, tBase);
    const avg = (cappedMax + cappedMin) / 2;
    return Math.max(avg - tBase, 0);
}

/**
 * Accumulate GDD over an array of daily min/max readings.
 * Returns cumulative GDD array (same length as input).
 */
export function accumulateGDD(
    dailyData: { min: number; max: number }[],
    tBase: number = 10,
    tCap: number = 30
): number[] {
    let cumulative = 0;
    return dailyData.map(d => {
        cumulative += calculateGDD(d.min, d.max, tBase, tCap);
        return Math.round(cumulative * 10) / 10;
    });
}

/**
 * Calculate Chill Units using the Infruitec model (South African standard for stone fruit).
 * Positive contribution between 2.5â€“9Â°C, negative above 16Â°C.
 * hourlyTemp: temperature in Â°C
 */
export function calculateChillUnit(hourlyTemp: number): number {
    if (hourlyTemp <= 1.4) return 0;
    if (hourlyTemp <= 2.4) return 0.5;
    if (hourlyTemp <= 9.1) return 1.0;
    if (hourlyTemp <= 12.4) return 0.5;
    if (hourlyTemp <= 15.9) return 0;
    if (hourlyTemp <= 18.0) return -0.5;
    return -1.0;
}

/**
 * Accumulate chill units over hourly temperature readings (Infruitec model).
 */
export function accumulateChillUnits(hourlyTemps: number[]): number {
    return hourlyTemps.reduce((sum, t) => sum + calculateChillUnit(t), 0);
}

// ─── Weibull Distribution (Wind Energy) ──────────────────────────────────────

export interface WeibullResult {
    k: number;            // shape parameter
    c: number;            // scale parameter (m/s)
    meanSpeed: number;    // m/s
    meanPowerDensity: number; // W/m²
    windResourceClass: string; // IEC I-IV
    histogram: { bin: number; count: number; weibullPdf: number }[];
}

/**
 * Fit Weibull distribution to wind speed data using the Justus method (empirical MLE).
 * windSpeeds: array of wind speed values in m/s
 * binWidth: histogram bin width in m/s (default 1)
 */
export function fitWeibull(windSpeeds: number[], binWidth: number = 1): WeibullResult {
    const valid = windSpeeds.filter(v => v >= 0 && isFinite(v));
    if (valid.length < 10) {
        return { k: 2, c: 5, meanSpeed: 0, meanPowerDensity: 0, windResourceClass: 'IV', histogram: [] };
    }

    const n = valid.length;
    const mean = valid.reduce((a, b) => a + b, 0) / n;
    const variance = valid.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1);
    const stdDev = Math.sqrt(variance);

    // Justus approximation for k
    const k = Math.max(0.5, Math.min(10, Math.pow(stdDev / mean, -1.086)));
    // c from mean and k using Gamma function approximation
    const gamma1k = gammaApprox(1 + 1 / k);
    const c = Math.max(0.1, mean / gamma1k);

    // Mean power density (W/m²) = 0.5 * ρ * mean(v³)
    const airDensity = 1.225; // kg/m³ standard
    const meanCubed = valid.reduce((a, b) => a + Math.pow(b, 3), 0) / n;
    const meanPowerDensity = Math.round(0.5 * airDensity * meanCubed * 10) / 10;

    // IEC wind resource class
    let windResourceClass: string;
    if (mean >= 10) windResourceClass = 'I (High)';
    else if (mean >= 8.5) windResourceClass = 'II (Medium)';
    else if (mean >= 7.5) windResourceClass = 'III (Low)';
    else windResourceClass = 'IV (Very Low)';

    // Build histogram
    const maxBin = Math.ceil(Math.max(...valid) / binWidth) * binWidth;
    const bins: { bin: number; count: number; weibullPdf: number }[] = [];
    for (let b = 0; b <= maxBin; b += binWidth) {
        const count = valid.filter(v => v >= b && v < b + binWidth).length;
        const midpoint = b + binWidth / 2;
        const pdf = (k / c) * Math.pow(midpoint / c, k - 1) * Math.exp(-Math.pow(midpoint / c, k));
        bins.push({ bin: b, count, weibullPdf: Math.round(pdf * n * binWidth * 100) / 100 });
    }

    return {
        k: Math.round(k * 100) / 100,
        c: Math.round(c * 100) / 100,
        meanSpeed: Math.round(mean * 100) / 100,
        meanPowerDensity,
        windResourceClass,
        histogram: bins,
    };
}

/** Stirling's Gamma function approximation */
function gammaApprox(z: number): number {
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaApprox(1 - z));
    z -= 1;
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

export interface AEPResult {
    aep: number;           // kWh/year
    capacityFactor: number; // 0-1
    equivalentHours: number; // hours/year at full capacity
}

/**
 * Estimate Annual Energy Production from Weibull parameters and turbine specs.
 * k, c: Weibull shape and scale
 * capacity: turbine rated capacity in kW
 * cutIn: cut-in wind speed m/s
 * cutOut: cut-out wind speed m/s
 * ratedSpeed: rated wind speed m/s
 */
export function calculateAEP(
    k: number, c: number,
    capacity: number, cutIn: number, cutOut: number, ratedSpeed: number
): AEPResult {
    const hoursPerYear = 8760;
    let totalEnergy = 0;

    // Numerical integration over wind speed bins (0.5 m/s steps)
    for (let v = 0; v <= 40; v += 0.5) {
        const pdf = (k / c) * Math.pow(v / c, k - 1) * Math.exp(-Math.pow(v / c, k));
        let power = 0;
        if (v >= cutIn && v < ratedSpeed) {
            // Cubic power curve between cut-in and rated
            power = capacity * ((Math.pow(v, 3) - Math.pow(cutIn, 3)) / (Math.pow(ratedSpeed, 3) - Math.pow(cutIn, 3)));
        } else if (v >= ratedSpeed && v <= cutOut) {
            power = capacity;
        }
        totalEnergy += power * pdf * 0.5 * hoursPerYear;
    }

    const aep = Math.round(totalEnergy);
    const capacityFactor = Math.round((totalEnergy / (capacity * hoursPerYear)) * 1000) / 1000;
    const equivalentHours = Math.round(capacityFactor * hoursPerYear);

    return { aep, capacityFactor, equivalentHours };
}

// ─── Turbulence Intensity ────────────────────────────────────────────────────

export interface TurbulenceResult {
    ti: number;             // turbulence intensity (0-1)
    tiPercent: number;      // as percentage
    iecCategory: string;    // A, B, C or S
    iecColor: string;
    classification: string; // e.g. "Low turbulence"
}

/**
 * Calculate Turbulence Intensity per IEC 61400-1.
 * stdDev: standard deviation of wind speed over averaging period (m/s)
 * meanSpeed: mean wind speed over same period (m/s)
 */
export function calculateTurbulenceIntensity(stdDev: number, meanSpeed: number): TurbulenceResult {
    if (meanSpeed < 0.5) {
        return { ti: 0, tiPercent: 0, iecCategory: '-', iecColor: '#6b7280', classification: 'Calm - TI undefined' };
    }

    const ti = stdDev / meanSpeed;
    const tiPercent = Math.round(ti * 1000) / 10;

    // IEC 61400-1 Ed.3 reference TI at 15 m/s: A=0.16, B=0.14, C=0.12
    // But applies at any speed - classify based on ratio
    let iecCategory: string;
    let iecColor: string;
    let classification: string;

    if (ti > 0.16) {
        iecCategory = 'A+';
        iecColor = '#dc2626';
        classification = 'Very high turbulence';
    } else if (ti > 0.14) {
        iecCategory = 'A';
        iecColor = '#f97316';
        classification = 'High turbulence';
    } else if (ti > 0.12) {
        iecCategory = 'B';
        iecColor = '#f59e0b';
        classification = 'Medium turbulence';
    } else if (ti > 0.08) {
        iecCategory = 'C';
        iecColor = '#22c55e';
        classification = 'Low turbulence';
    } else {
        iecCategory = 'C';
        iecColor = '#22c55e';
        classification = 'Very low turbulence';
    }

    return { ti: Math.round(ti * 1000) / 1000, tiPercent, iecCategory, iecColor, classification };
}

// ─── Feels Like Temperature ──────────────────────────────────────────────────

export interface FeelsLikeResult {
    feelsLike: number;     // °C
    method: string;        // 'Heat Index', 'Wind Chill', or 'Actual'
    color: string;
}

/**
 * Calculate "Feels Like" temperature.
 * Uses heat index when temp >27°C, wind chill when temp <10°C, actual temp otherwise.
 */
export function calculateFeelsLike(
    temperature: number,
    humidity: number,
    windSpeedMs: number
): FeelsLikeResult {
    if (temperature >= 27 && humidity >= 40) {
        const hi = calculateHeatIndex(temperature, humidity);
        return {
            feelsLike: Math.round(hi * 10) / 10,
            method: 'Heat Index',
            color: hi >= 40 ? '#dc2626' : hi >= 33 ? '#f97316' : '#f59e0b',
        };
    }
    if (temperature <= 10 && windSpeedMs >= 1.3) {
        const wc = calculateWindChill(temperature, windSpeedMs);
        return {
            feelsLike: Math.round(wc * 10) / 10,
            method: 'Wind Chill',
            color: wc <= -20 ? '#7f1d1d' : wc <= -10 ? '#dc2626' : wc <= 0 ? '#3b82f6' : '#6b7280',
        };
    }
    return {
        feelsLike: Math.round(temperature * 10) / 10,
        method: 'Actual',
        color: '#6b7280',
    };
}

// ─── Weather Trend Nowcasting ────────────────────────────────────────────────

export type WeatherTrend = 'Storm approaching' | 'Cold front expected' | 'Deteriorating' | 'Stable' | 'Clearing' | 'Fair weather';

export interface WeatherTrendResult {
    trend: WeatherTrend;
    color: string;
    pressureChange3h: number;  // hPa
    pressureChange6h: number;  // hPa
    icon: string;              // emoji-style descriptor
}

/**
 * Classify weather trend from barometric pressure changes.
 * pressureNow: current pressure in hPa
 * pressure3hAgo: pressure 3 hours ago in hPa
 * pressure6hAgo: pressure 6 hours ago in hPa (optional - improves accuracy)
 */
export function calculateWeatherTrend(
    pressureNow: number,
    pressure3hAgo: number,
    pressure6hAgo?: number
): WeatherTrendResult {
    const change3h = Math.round((pressureNow - pressure3hAgo) * 10) / 10;
    const change6h = pressure6hAgo != null ? Math.round((pressureNow - pressure6hAgo) * 10) / 10 : change3h * 2;

    let trend: WeatherTrend;
    let color: string;
    let icon: string;

    if (change3h <= -3) {
        trend = 'Storm approaching';
        color = '#dc2626';
        icon = '⛈';
    } else if (change3h <= -1.5) {
        trend = 'Cold front expected';
        color = '#f97316';
        icon = '🌧';
    } else if (change3h <= -0.5) {
        trend = 'Deteriorating';
        color = '#f59e0b';
        icon = '☁';
    } else if (change3h >= 2) {
        trend = 'Fair weather';
        color = '#22c55e';
        icon = '☀';
    } else if (change3h >= 0.5) {
        trend = 'Clearing';
        color = '#3b82f6';
        icon = '🌤';
    } else {
        trend = 'Stable';
        color = '#6b7280';
        icon = '⛅';
    }

    return { trend, color, pressureChange3h: change3h, pressureChange6h: change6h, icon };
}

// ─── Rainfall Intensity & Water Balance ──────────────────────────────────────

export type RainfallIntensityClass = 'None' | 'Light' | 'Moderate' | 'Heavy' | 'Extreme';

export interface RainfallIntensityResult {
    ratePerHour: number;             // mm/hr
    classification: RainfallIntensityClass;
    color: string;
}

/**
 * Classify rainfall intensity.
 * mmPerInterval: rainfall in mm over the interval
 * intervalMinutes: duration of interval in minutes
 */
export function calculateRainfallIntensity(
    mmPerInterval: number,
    intervalMinutes: number
): RainfallIntensityResult {
    const ratePerHour = intervalMinutes > 0 ? Math.round((mmPerInterval / intervalMinutes) * 60 * 100) / 100 : 0;

    let classification: RainfallIntensityClass;
    let color: string;

    if (ratePerHour <= 0) { classification = 'None'; color = '#6b7280'; }
    else if (ratePerHour < 2.5) { classification = 'Light'; color = '#22c55e'; }
    else if (ratePerHour < 7.6) { classification = 'Moderate'; color = '#f59e0b'; }
    else if (ratePerHour < 50)  { classification = 'Heavy'; color = '#f97316'; }
    else { classification = 'Extreme'; color = '#dc2626'; }

    return { ratePerHour, classification, color };
}

export interface WaterBalanceResult {
    balance: number;        // mm (positive = surplus, negative = deficit)
    status: string;
    color: string;
}

/**
 * Calculate water balance: rainfall minus evapotranspiration.
 * rainfall: total rainfall in mm
 * eto: reference evapotranspiration in mm
 */
export function calculateWaterBalance(rainfall: number, eto: number): WaterBalanceResult {
    const balance = Math.round((rainfall - eto) * 10) / 10;

    let status: string;
    let color: string;

    if (balance > 20) { status = 'Surplus'; color = '#22c55e'; }
    else if (balance > 0) { status = 'Slight Surplus'; color = '#86efac'; }
    else if (balance > -10) { status = 'Slight Deficit'; color = '#fbbf24'; }
    else if (balance > -30) { status = 'Deficit'; color = '#f97316'; }
    else { status = 'Severe Deficit'; color = '#dc2626'; }

    return { balance, status, color };
}

// ─── Data Completeness ───────────────────────────────────────────────────────

export interface DataCompletenessResult {
    overallPercent: number;
    expectedReadings: number;
    actualReadings: number;
    gapCount: number;
    longestGapMinutes: number;
}

/**
 * Calculate data completeness for a period.
 * actualCount: number of readings received
 * expectedCount: expected readings (period / sync_interval)
 * gaps: array of gap durations in minutes
 */
export function calculateDataCompleteness(
    actualCount: number,
    expectedCount: number,
    gaps: number[] = []
): DataCompletenessResult {
    const overallPercent = expectedCount > 0 ? Math.round((actualCount / expectedCount) * 1000) / 10 : 0;
    const longestGapMinutes = gaps.length > 0 ? Math.max(...gaps) : 0;

    return {
        overallPercent: Math.min(100, overallPercent),
        expectedReadings: expectedCount,
        actualReadings: actualCount,
        gapCount: gaps.length,
        longestGapMinutes,
    };
}
