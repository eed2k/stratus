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

export function calculateWindChill(temperature: number, windSpeed: number): number {
    return 35.74 + 0.6215 * temperature - 35.75 * Math.pow(windSpeed, 0.16) + 0.4275 * temperature * Math.pow(windSpeed, 0.16);
}

// ============================================================================
// Solar Position Calculations (NOAA Algorithm)
// ============================================================================

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
    
    // Calculate sun's equation of center
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

// ============================================================================
// Air Density Calculations
// ============================================================================

/**
 * Calculate air density using the ideal gas law with humidity correction
 * ρ = (p_d / (R_d * T)) + (p_v / (R_v * T))
 * 
 * @param temperature Temperature in Celsius
 * @param pressure Atmospheric pressure in hPa (mbar)
 * @param humidity Relative humidity in percent (0-100)
 * @returns Air density in kg/m³
 */
export function calculateAirDensity(
    temperature: number,
    pressure: number,
    humidity: number
): number {
    const T = temperature + 273.15; // Convert to Kelvin
    const p = pressure * 100;       // Convert hPa to Pa
    
    // Gas constants
    const Rd = 287.058;  // Specific gas constant for dry air (J/(kg·K))
    const Rv = 461.495;  // Specific gas constant for water vapor (J/(kg·K))
    
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

// ============================================================================
// Barometric Pressure Calculations
// ============================================================================

/**
 * Convert station pressure to sea level pressure using the barometric formula
 * 
 * @param stationPressure Station pressure in hPa (mbar)
 * @param altitude Station altitude in meters
 * @param temperature Temperature in Celsius
 * @returns Sea level pressure in hPa (mbar)
 */
export function calculateSeaLevelPressure(
    stationPressure: number,
    altitude: number,
    temperature: number
): number {
    // Barometric formula constants
    const g = 9.80665;     // Gravitational acceleration (m/s²)
    const M = 0.0289644;   // Molar mass of air (kg/mol)
    const R = 8.31447;     // Universal gas constant (J/(mol·K))
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
 * @param seaLevelPressure Sea level pressure in hPa (mbar)
 * @param altitude Station altitude in meters
 * @param temperature Temperature in Celsius
 * @returns Station pressure in hPa (mbar)
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

// ============================================================================
// Reference Evapotranspiration (ETo) - FAO Penman-Monteith
// ============================================================================

/**
 * Calculate Reference Evapotranspiration using FAO Penman-Monteith equation
 * This is the standard method recommended by FAO-56 for calculating ETo
 * 
 * @param temperature Mean daily temperature (°C)
 * @param humidity Relative humidity (%)
 * @param windSpeed Wind speed at 2m height (m/s)
 * @param solarRadiation Solar radiation (MJ/m²/day)
 * @param altitude Station altitude (m)
 * @param latitude Station latitude (degrees)
 * @param dayOfYear Day of year (1-365)
 * @returns ETo in mm/day
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
    
    // Psychrometric constant (kPa/°C)
    const gamma = 0.665e-3 * P;
    
    // Slope of saturation vapor pressure curve (kPa/°C)
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
    
    // Extraterrestrial radiation (MJ/m²/day)
    const Ra = (24 * 60 / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.sin(ws));
    
    // Clear-sky solar radiation (MJ/m²/day)
    const Rso = (0.75 + 2e-5 * z) * Ra;
    
    // Net shortwave radiation (MJ/m²/day)
    const Rns = (1 - 0.23) * Rs;
    
    // Net longwave radiation (MJ/m²/day)
    const Tk = T + 273.16;
    const Rnl = 4.903e-9 * Math.pow(Tk, 4) * (0.34 - 0.14 * Math.sqrt(ea)) * (1.35 * Rs / Rso - 0.35);
    
    // Net radiation (MJ/m²/day)
    const Rn = Rns - Rnl;
    
    // Soil heat flux (assume G = 0 for daily calculations)
    const G = 0;
    
    // FAO Penman-Monteith equation
    const ETo = (0.408 * delta * (Rn - G) + gamma * (900 / (T + 273)) * u2 * (es - ea)) /
                (delta + gamma * (1 + 0.34 * u2));
    
    return Math.max(0, ETo);
}

/**
 * Convert solar radiation from W/m² to MJ/m²/day
 */
export function wattsToMJPerDay(watts: number, hours: number = 24): number {
    return watts * hours * 3600 / 1e6;
}

/**
 * Convert wind speed from km/h to m/s
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

// ============================================================================
// Wind Power Density
// ============================================================================

/**
 * Calculate wind power density using P = 0.5 * ρ * v³
 * 
 * @param windSpeed Wind speed in m/s
 * @param airDensity Air density in kg/m³ (default 1.225)
 * @returns Power density in W/m²
 */
export function calculateWindPower(windSpeed: number, airDensity: number = 1.225): number {
    return 0.5 * airDensity * Math.pow(windSpeed, 3);
}

// ============================================================================
// Dew Point Calculation
// ============================================================================

/**
 * Calculate dew point temperature using Magnus-Tetens formula
 * 
 * @param temperature Temperature in Celsius
 * @param humidity Relative humidity in percent (0-100)
 * @returns Dew point temperature in Celsius
 */
export function calculateDewPoint(temperature: number, humidity: number): number {
    const a = 17.27;
    const b = 237.7;
    
    const alpha = (a * temperature) / (b + temperature) + Math.log(humidity / 100);
    const dewPoint = (b * alpha) / (a - alpha);
    
    return dewPoint;
}

// ============================================================================
// Heat Index Calculation
// ============================================================================

/**
 * Calculate heat index (feels like temperature in hot conditions)
 * 
 * @param temperature Temperature in Celsius
 * @param humidity Relative humidity in percent (0-100)
 * @returns Heat index in Celsius
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

// ============================================================================
// Fire Danger Index Calculations
// McArthur Forest Fire Danger Index (FFDI) - Australian Standard
// ============================================================================

/**
 * Fire Danger Rating levels based on FFDI value
 */
export interface FireDangerRating {
    level: 'low-moderate' | 'high' | 'very-high' | 'severe' | 'extreme' | 'catastrophic';
    label: string;
    color: string;
    description: string;
    minValue: number;
    maxValue: number;
    actionAdvice: string;
}

/**
 * Fire Danger Index result
 */
export interface FireDangerResult {
    ffdi: number;                    // Forest Fire Danger Index value
    rating: FireDangerRating;        // Current danger rating
    grasslandFDI: number;            // Grassland Fire Danger Index
    keetchByramIndex: number;        // Drought index approximation
    fuelMoisture: number;            // Estimated fuel moisture content (%)
    spreadPotential: 'low' | 'moderate' | 'high' | 'very-high' | 'extreme';
    warningLevel: 0 | 1 | 2 | 3;     // 0=none, 1=watch, 2=warning, 3=emergency
    warningMessage: string | null;
}

/**
 * Fire danger rating thresholds and definitions
 * Based on Australian Fire Danger Rating System (AFDRS)
 */
export const FIRE_DANGER_RATINGS: FireDangerRating[] = [
    {
        level: 'low-moderate',
        label: 'Low-Moderate',
        color: '#22c55e', // green
        description: 'Plan and prepare',
        minValue: 0,
        maxValue: 11,
        actionAdvice: 'Be aware of fire conditions. Have a fire plan ready.'
    },
    {
        level: 'high',
        label: 'High',
        color: '#eab308', // yellow
        description: 'Be ready to act',
        minValue: 12,
        maxValue: 24,
        actionAdvice: 'Be ready to act. Fires may be difficult to control.'
    },
    {
        level: 'very-high',
        label: 'Very High',
        color: '#f97316', // orange
        description: 'Take action now to protect life and property',
        minValue: 25,
        maxValue: 49,
        actionAdvice: 'Take action now. Fires will spread quickly and be difficult to control.'
    },
    {
        level: 'severe',
        label: 'Severe',
        color: '#ef4444', // red
        description: 'For your survival, leave bushfire risk areas',
        minValue: 50,
        maxValue: 74,
        actionAdvice: 'Leave bushfire risk areas early. Fires will be uncontrollable and fast-moving.'
    },
    {
        level: 'extreme',
        label: 'Extreme',
        color: '#dc2626', // dark red
        description: 'For your survival, leave bushfire risk areas',
        minValue: 75,
        maxValue: 99,
        actionAdvice: 'Leaving early is the only safe option. Fires will be extremely dangerous.'
    },
    {
        level: 'catastrophic',
        label: 'Catastrophic',
        color: '#7f1d1d', // darkest red / maroon
        description: 'For your survival, leave bushfire risk areas',
        minValue: 100,
        maxValue: Infinity,
        actionAdvice: 'These are the most dangerous conditions. If fire starts, lives and homes will be at risk.'
    }
];

/**
 * Get fire danger rating from FFDI value
 */
export function getFireDangerRating(ffdi: number): FireDangerRating {
    for (const rating of FIRE_DANGER_RATINGS) {
        if (ffdi >= rating.minValue && ffdi <= rating.maxValue) {
            return rating;
        }
    }
    return FIRE_DANGER_RATINGS[FIRE_DANGER_RATINGS.length - 1]; // Catastrophic
}

/**
 * Estimate Drought Factor (DF) from recent rainfall data
 * DF ranges from 0 (wet) to 10 (extreme drought)
 * 
 * @param rainfall7day Total rainfall in last 7 days (mm)
 * @param rainfall30day Total rainfall in last 30 days (mm)
 * @param daysSinceRain Days since last significant rain (>2mm)
 * @returns Drought factor (0-10)
 */
export function estimateDroughtFactor(
    rainfall7day: number = 0,
    rainfall30day: number = 0,
    daysSinceRain: number = 7
): number {
    // Simplified drought factor estimation
    // In production, this would use Keetch-Byram Drought Index (KBDI) or Mount's Soil Dryness Index
    
    let df = 10; // Start at maximum drought
    
    // Reduce DF based on recent rainfall
    if (rainfall7day > 25) df -= 4;
    else if (rainfall7day > 10) df -= 3;
    else if (rainfall7day > 5) df -= 2;
    else if (rainfall7day > 2) df -= 1;
    
    if (rainfall30day > 100) df -= 3;
    else if (rainfall30day > 50) df -= 2;
    else if (rainfall30day > 25) df -= 1;
    
    // Increase DF based on days since rain
    if (daysSinceRain > 14) df += 1;
    if (daysSinceRain > 30) df += 1;
    
    // Clamp to valid range
    return Math.max(0, Math.min(10, df));
}

/**
 * Calculate McArthur Forest Fire Danger Index (FFDI)
 * 
 * Formula: FFDI = 2 × exp(-0.45 + 0.987×ln(DF) - 0.0345×RH + 0.0338×T + 0.0234×V)
 * 
 * Reference: McArthur, A.G. (1967). Fire Behaviour in Eucalypt Forests
 * 
 * @param temperature Air temperature in Celsius
 * @param humidity Relative humidity in percent (0-100)
 * @param windSpeed Wind speed in km/h
 * @param droughtFactor Drought factor (0-10), default 5 if not provided
 * @returns Forest Fire Danger Index (0-150+)
 */
export function calculateFFDI(
    temperature: number,
    humidity: number,
    windSpeed: number,
    droughtFactor: number = 5
): number {
    // Clamp inputs to valid ranges
    const T = Math.max(-10, Math.min(50, temperature));
    const RH = Math.max(1, Math.min(100, humidity)); // Avoid log(0) issues
    const V = Math.max(0, windSpeed);
    const DF = Math.max(0.1, Math.min(10, droughtFactor)); // Avoid log(0)
    
    // McArthur Mark 5 Forest Fire Danger Meter equation
    const ffdi = 2 * Math.exp(
        -0.45 + 
        0.987 * Math.log(DF) - 
        0.0345 * RH + 
        0.0338 * T + 
        0.0234 * V
    );
    
    return Math.max(0, ffdi);
}

/**
 * Calculate Grassland Fire Danger Index (GFDI)
 * Simplified Mark 4 equation for grassland fires
 * 
 * @param temperature Air temperature in Celsius
 * @param humidity Relative humidity in percent (0-100)
 * @param windSpeed Wind speed in km/h
 * @param curing Grass curing percentage (0-100), default 80%
 * @returns Grassland Fire Danger Index
 */
export function calculateGFDI(
    temperature: number,
    humidity: number,
    windSpeed: number,
    curing: number = 80
): number {
    const T = Math.max(-10, Math.min(50, temperature));
    const RH = Math.max(1, Math.min(100, humidity));
    const V = Math.max(0, windSpeed);
    const C = Math.max(0, Math.min(100, curing));
    
    // Mark 4 Grassland Fire Danger equation (simplified)
    const gfdi = 2 * Math.exp(
        -0.906 + 
        0.0275 * T - 
        0.0239 * RH + 
        0.0234 * V + 
        0.0063 * C
    );
    
    return Math.max(0, gfdi);
}

/**
 * Estimate fuel moisture content from weather conditions
 * 
 * @param temperature Air temperature in Celsius
 * @param humidity Relative humidity in percent
 * @returns Estimated fine fuel moisture content (%)
 */
export function estimateFuelMoisture(temperature: number, humidity: number): number {
    // Simplified fuel moisture estimation based on equilibrium moisture content
    // Reference: Simard, A.J. (1968)
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

/**
 * Calculate comprehensive Fire Danger Index with all parameters
 * 
 * @param temperature Air temperature in Celsius
 * @param humidity Relative humidity in percent (0-100)
 * @param windSpeed Wind speed in km/h
 * @param rainfall7day Total rainfall in last 7 days (mm), optional
 * @param rainfall30day Total rainfall in last 30 days (mm), optional
 * @param daysSinceRain Days since last significant rain, optional
 * @returns Complete fire danger assessment
 */
export function calculateFireDanger(
    temperature: number,
    humidity: number,
    windSpeed: number,
    rainfall7day: number = 0,
    rainfall30day: number = 0,
    daysSinceRain: number = 7
): FireDangerResult {
    // Estimate drought factor from rainfall
    const droughtFactor = estimateDroughtFactor(rainfall7day, rainfall30day, daysSinceRain);
    
    // Calculate main indices
    const ffdi = calculateFFDI(temperature, humidity, windSpeed, droughtFactor);
    const grasslandFDI = calculateGFDI(temperature, humidity, windSpeed);
    const fuelMoisture = estimateFuelMoisture(temperature, humidity);
    
    // Get rating based on FFDI
    const rating = getFireDangerRating(ffdi);
    
    // Estimate Keetch-Byram Index (simplified approximation)
    const keetchByramIndex = Math.min(800, droughtFactor * 80);
    
    // Determine spread potential
    let spreadPotential: 'low' | 'moderate' | 'high' | 'very-high' | 'extreme';
    if (ffdi < 12) spreadPotential = 'low';
    else if (ffdi < 25) spreadPotential = 'moderate';
    else if (ffdi < 50) spreadPotential = 'high';
    else if (ffdi < 75) spreadPotential = 'very-high';
    else spreadPotential = 'extreme';
    
    // Determine warning level and message
    let warningLevel: 0 | 1 | 2 | 3 = 0;
    let warningMessage: string | null = null;
    
    if (rating.level === 'catastrophic') {
        warningLevel = 3;
        warningMessage = 'EMERGENCY: Catastrophic fire danger. Leave bushfire risk areas immediately.';
    } else if (rating.level === 'extreme') {
        warningLevel = 3;
        warningMessage = 'EMERGENCY: Extreme fire danger conditions. Leaving early is the only safe option.';
    } else if (rating.level === 'severe') {
        warningLevel = 2;
        warningMessage = 'WARNING: Severe fire danger. For your survival, leave bushfire risk areas.';
    } else if (rating.level === 'very-high') {
        warningLevel = 1;
        warningMessage = 'WATCH: Very high fire danger. Be prepared to take action.';
    } else if (rating.level === 'high') {
        warningLevel = 1;
        warningMessage = 'WATCH: High fire danger conditions. Stay alert.';
    }
    
    return {
        ffdi: Math.round(ffdi * 10) / 10,
        rating,
        grasslandFDI: Math.round(grasslandFDI * 10) / 10,
        keetchByramIndex: Math.round(keetchByramIndex),
        fuelMoisture: Math.round(fuelMoisture * 10) / 10,
        spreadPotential,
        warningLevel,
        warningMessage
    };
}