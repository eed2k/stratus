// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { calculateAQI, SA_NAAQS_PM10_DAILY, SA_NAAQS_PM25_DAILY, type AQIResult } from "@shared/utils/calc";

interface AirQualityCardProps {
  pm25?: number | null;
  pm10?: number | null;
  pm1?: number | null;
  co2?: number | null;
  tvoc?: number | null;
}

export function AirQualityCard({ pm25, pm10, pm1, co2, tvoc }: AirQualityCardProps) {
  const aqiResult: AQIResult | null = calculateAQI(pm25, pm10);

  // SA NAAQS exceedance checks
  const pm10Exceedance = pm10 != null && pm10 > SA_NAAQS_PM10_DAILY;
  const pm25Exceedance = pm25 != null && pm25 > SA_NAAQS_PM25_DAILY;

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-air-quality">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Air Quality
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* AQI gauge */}
          {aqiResult && (
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {aqiResult.aqi}
                </span>
                <span className="text-sm font-normal text-gray-500">AQI</span>
              </div>
              <span
                className="text-xs px-2 py-1 rounded-full font-medium"
                style={{ backgroundColor: aqiResult.color + '20', color: aqiResult.color }}
              >
                {aqiResult.category}
              </span>
            </div>
          )}

          {/* AQI colour bar */}
          {aqiResult && (
            <div className="space-y-1">
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, (aqiResult.aqi / 500) * 100)}%`,
                    backgroundColor: aqiResult.color,
                  }}
                />
              </div>
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {aqiResult.healthMessage}
              </p>
            </div>
          )}

          {/* PM breakdown */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
            {pm25 != null && (
              <div className="text-center">
                <p className="text-xs text-gray-500">PM2.5</p>
                <p className={`text-sm font-normal ${pm25Exceedance ? 'text-red-500' : 'text-black'}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(pm25, 1)} µg/m³
                </p>
                {pm25Exceedance && (
                  <p className="text-[10px] text-red-500">Exceeds NAAQS ({SA_NAAQS_PM25_DAILY})</p>
                )}
              </div>
            )}
            {pm10 != null && (
              <div className="text-center">
                <p className="text-xs text-gray-500">PM10</p>
                <p className={`text-sm font-normal ${pm10Exceedance ? 'text-red-500' : 'text-black'}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(pm10, 1)} µg/m³
                </p>
                {pm10Exceedance && (
                  <p className="text-[10px] text-red-500">Exceeds NAAQS ({SA_NAAQS_PM10_DAILY})</p>
                )}
              </div>
            )}
            {pm1 != null && (
              <div className="text-center">
                <p className="text-xs text-gray-500">PM1</p>
                <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(pm1, 1)} µg/m³
                </p>
              </div>
            )}
          </div>

          {/* CO2 / TVOC if available */}
          {(co2 != null || tvoc != null) && (
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
              {co2 != null && (
                <div className="text-center">
                  <p className="text-xs text-gray-500">CO₂</p>
                  <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                    {safeFixed(co2, 0)} ppm
                  </p>
                </div>
              )}
              {tvoc != null && (
                <div className="text-center">
                  <p className="text-xs text-gray-500">TVOC</p>
                  <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                    {safeFixed(tvoc, 0)} ppb
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Dominant pollutant */}
          {aqiResult && (
            <p className="text-xs text-gray-400 italic pt-2 border-t border-gray-200" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              Dominant: {aqiResult.dominant === 'pm25' ? 'PM2.5' : 'PM10'} · SA NAAQS limits: PM10 {SA_NAAQS_PM10_DAILY} µg/m³, PM2.5 {SA_NAAQS_PM25_DAILY} µg/m³ (24-hr)
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
