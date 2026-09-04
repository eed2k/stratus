// Stratus Weather Server
// Created by Lukas Esterhuizen

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

import {
  DASHBOARD_CATEGORIES,
  UPDATE_PERIOD_OPTIONS,
  DEFAULT_DASHBOARD_CONFIG,
  DEFAULT_SECTION_VISIBILITY,
  resolveChartTimeRanges,
  type DashboardConfig,
  type DashboardCategory,
  type DashboardParameter,
  type SectionVisibility
} from "../../../../shared/dashboardConfig";

const SECTION_LABELS: Record<keyof SectionVisibility, string> = {
  primaryMetrics: 'Primary Metrics',
  barometricPressure: 'Barometric Pressure',
  rainfall: 'Rainfall',
  historicalCharts: 'Historical Charts',
  solarEtCards: 'Solar & Reference ET₀',
  waterSensors: 'Water & Sensors',
  windAnalysis: 'Wind Analysis',
  windEnergy: 'Wind Energy Assessment',
  solarRadiation: 'Solar Radiation',
  solarPosition: 'Solar Position (calculated)',
  soilEnvironment: 'Soil & Environment',
  fireDanger: 'Fire Danger Index',
  loggerBattery: 'Logger & Battery',
  mpptCharger: 'MPPT Solar Charger',
  visibilityClouds: 'Visibility & Clouds',
  airQuality: 'Air Quality (AQI)',
  atmosphericStability: 'Atmospheric Stability',
  lightning: 'Lightning Proximity',
  aviation: 'Aviation',
};

// Map derived/calculated fields to their source dependencies
// If a field's dataField isn't directly in availableFields, check these deps
const DERIVED_FIELD_DEPS: Record<string, string[]> = {
  pressureSeaLevel: ['pressure'],
  temperatureMin: ['temperature'],
  temperatureMax: ['temperature'],
  dewPoint: ['temperature', 'humidity'],
  airDensity: ['temperature', 'pressure', 'humidity'],
  windGust: ['windSpeed'],
  windGust10min: ['windSpeed'],
  windPower: ['windSpeed'],
  rainfall10min: ['rainfall'],
  rainfall24h: ['rainfall'],
  rainfall7d: ['rainfall'],
  rainfall30d: ['rainfall'],
  rainfallYearly: ['rainfall'],
  solarRadiationMax: ['solarRadiation'],
  sunAzimuth: ['solarRadiation'],
  sunElevation: ['solarRadiation'],
  eto: ['solarRadiation', 'temperature', 'humidity', 'windSpeed'],
  eto24h: ['solarRadiation', 'temperature', 'humidity', 'windSpeed'],
  eto7d: ['solarRadiation', 'temperature', 'humidity', 'windSpeed'],
  eto30d: ['solarRadiation', 'temperature', 'humidity', 'windSpeed'],
  panelTemperature: ['batteryVoltage'],
  leafWetness: ['soilMoisture'],
};

// Map sections to the availableFields they depend on
const SECTION_FIELD_DEPS: Record<keyof SectionVisibility, string[]> = {
  primaryMetrics: ['temperature', 'humidity', 'pressure', 'windSpeed', 'rainfall'],
  barometricPressure: ['pressure'],
  rainfall: ['rainfall'],
  historicalCharts: ['temperature', 'humidity', 'pressure', 'windSpeed', 'rainfall', 'solarRadiation'],
  solarEtCards: ['solarRadiation', 'temperature'],
  waterSensors: ['waterLevel', 'temperatureSwitch', 'levelSwitch', 'temperatureSwitchOutlet', 'levelSwitchStatus', 'lightning', 'chargerVoltage'],
  windAnalysis: ['windSpeed', 'windDirection'],
  windEnergy: ['windSpeed'],
  solarRadiation: ['solarRadiation'],
  solarPosition: ['solarRadiation'],
  soilEnvironment: ['soilTemperature', 'soilMoisture'],
  fireDanger: ['temperature', 'humidity', 'windSpeed'],
  loggerBattery: ['batteryVoltage'],
  mpptCharger: ['mpptSolarVoltage', 'mpptSolarCurrent', 'mpptSolarPower', 'mpptLoadVoltage', 'mpptLoadCurrent', 'mpptBatteryVoltage', 'mpptChargerState', 'mpptAbsiAvg', 'mpptBoardTemp', 'mpptMode',
    'mppt2SolarVoltage', 'mppt2SolarCurrent', 'mppt2SolarPower', 'mppt2LoadVoltage', 'mppt2LoadCurrent', 'mppt2BatteryVoltage', 'mppt2ChargerState', 'mppt2BoardTemp', 'mppt2Mode'],
  visibilityClouds: ['visibility', 'atmosphericVisibility', 'cloudBase', 'cloudCover'],
  airQuality: ['pm10', 'pm25', 'pm1', 'co2', 'tvoc'],
  atmosphericStability: ['windSpeed', 'solarRadiation'],
  lightning: ['lightningDistance', 'lightning', 'lightningEnergy'],
  aviation: ['pressure', 'temperature'],
};

/** Check if a parameter is available based on available fields */
function isParamAvailable(param: DashboardParameter, availableFields: Record<string, boolean>): boolean {
  // Direct match
  if (availableFields[param.dataField] === true) return true;
  // Check derived field dependencies - all deps must be available
  const deps = DERIVED_FIELD_DEPS[param.dataField];
  if (deps && deps.length > 0) {
    return deps.every(dep => availableFields[dep] === true);
  }
  return false;
}

const CHART_TIME_RANGE_OPTIONS = [
  { value: 1, label: '1 hour' },
  { value: 6, label: '6 hours' },
  { value: 12, label: '12 hours' },
  { value: 24, label: '24 hours' },
  { value: 48, label: '48 hours' },
  { value: 168, label: '7 days' },
  { value: 720, label: '30 days' },
];

interface DashboardConfigPanelProps {
  config: DashboardConfig;
  onConfigChange: (config: DashboardConfig) => void;
  onRefresh?: () => void;
  availableFields?: Record<string, boolean>;
}

export function DashboardConfigPanel({ config, onConfigChange, availableFields }: DashboardConfigPanelProps) {
  // Normalize any partial/legacy config so array fields are always defined.
  const normalize = (c: DashboardConfig): DashboardConfig => ({
    ...DEFAULT_DASHBOARD_CONFIG,
    ...c,
    enabledParameters: Array.isArray(c?.enabledParameters)
      ? c.enabledParameters
      : (DEFAULT_DASHBOARD_CONFIG.enabledParameters ?? []),
    sectionVisibility: {
      ...(DEFAULT_DASHBOARD_CONFIG.sectionVisibility ?? {}),
      ...(c?.sectionVisibility ?? {}),
    },
  });
  const [localConfig, setLocalConfig] = useState<DashboardConfig>(() => normalize(config));
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setLocalConfig(normalize(config));
  }, [config]);

  // Windows this station offers. Unrestricted stations get the full set, so this
  // is a no-op for everything except a deliberately limited dashboard.
  const offeredRanges = resolveChartTimeRanges(localConfig.allowedChartTimeRanges);

  const handleParameterToggle = (parameterId: string, enabled: boolean) => {
    setLocalConfig((prev: DashboardConfig) => {
      const current = Array.isArray(prev.enabledParameters) ? prev.enabledParameters : [];
      return {
        ...prev,
        enabledParameters: enabled
          ? [...current, parameterId]
          : current.filter((p: string) => p !== parameterId)
      };
    });
  };

  const handleCategoryToggleAll = (category: DashboardCategory, enabled: boolean) => {
    // Only toggle parameters that are available
    const availableParamIds = category.parameters
      .filter((p: DashboardParameter) => !availableFields || isParamAvailable(p, availableFields))
      .map((p: DashboardParameter) => p.id);
    setLocalConfig((prev: DashboardConfig) => {
      const current = Array.isArray(prev.enabledParameters) ? prev.enabledParameters : [];
      return {
        ...prev,
        enabledParameters: enabled
          ? [...new Set([...current, ...availableParamIds])]
          : current.filter((p: string) => !availableParamIds.includes(p))
      };
    });
  };

  const handleSave = () => {
    onConfigChange(localConfig);
    setIsOpen(false);
  };

  const handleReset = () => {
    setLocalConfig(DEFAULT_DASHBOARD_CONFIG);
  };

  // Filter categories and parameters to only show available data
  const filteredCategories = availableFields
    ? DASHBOARD_CATEGORIES
        .map(cat => ({
          ...cat,
          parameters: cat.parameters.filter(p => isParamAvailable(p, availableFields))
        }))
        .filter(cat => cat.parameters.length > 0)
    : DASHBOARD_CATEGORIES;

  // Filter section visibility toggles to only show sections with available data
  const availableSections = availableFields
    ? (Object.keys(SECTION_LABELS) as (keyof SectionVisibility)[]).filter(key => {
        const deps = SECTION_FIELD_DEPS[key];
        return deps.some(field => availableFields[field] === true);
      })
    : (Object.keys(SECTION_LABELS) as (keyof SectionVisibility)[]);

  const enabledParams = Array.isArray(localConfig.enabledParameters) ? localConfig.enabledParameters : [];
  const enabledCount = enabledParams.filter(id =>
    filteredCategories.some(cat => cat.parameters.some(p => p.id === id))
  ).length;
  const totalCount = filteredCategories.reduce((sum: number, cat: DashboardCategory) => sum + cat.parameters.length, 0);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          Configure
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px] sm:max-w-none">
        <SheetHeader>
          <SheetTitle>Dashboard Configuration</SheetTitle>
          <SheetDescription>
            Configure which parameters to display and set the update frequency.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-200px)] mt-6 pr-4">
          <div className="space-y-6">
            {/* Update Settings */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  Update Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="updatePeriod">Update Period</Label>
                    <Select
                      value={String(localConfig.updatePeriod)}
                      onValueChange={(v) => setLocalConfig((prev: DashboardConfig) => ({ ...prev, updatePeriod: parseInt(v) }))}
                    >
                      <SelectTrigger id="updatePeriod">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UPDATE_PERIOD_OPTIONS.map(opt => (
                          <SelectItem key={opt.value} value={String(opt.value)}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="chartTimeRange">Chart Time Range</Label>
                    <Select
                      value={String(localConfig.chartTimeRange)}
                      onValueChange={(v) => setLocalConfig((prev: DashboardConfig) => ({ ...prev, chartTimeRange: parseInt(v) }))}
                    >
                      <SelectTrigger id="chartTimeRange">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {/* Restricted to what this station offers, so the panel
                            cannot select a window the dashboard will not show. */}
                        {CHART_TIME_RANGE_OPTIONS
                          .filter(opt => offeredRanges.includes(opt.value))
                          .map(opt => (
                          <SelectItem key={opt.value} value={String(opt.value)}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

              </CardContent>
            </Card>

            {/* Section Visibility */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  Dashboard Sections
                </CardTitle>
                <CardDescription>
                  Toggle which sections are visible on the dashboard
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {availableSections.map((key) => (
                  <div key={key} className="flex items-center gap-3">
                    <Checkbox
                      id={`section-${key}`}
                      checked={(localConfig.sectionVisibility ?? DEFAULT_SECTION_VISIBILITY)[key]}
                      onCheckedChange={(checked) => setLocalConfig((prev: DashboardConfig) => ({
                        ...prev,
                        sectionVisibility: {
                          ...(prev.sectionVisibility ?? DEFAULT_SECTION_VISIBILITY),
                          [key]: checked as boolean
                        }
                      }))}
                    />
                    <Label htmlFor={`section-${key}`} className="cursor-pointer">{SECTION_LABELS[key]}</Label>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Parameter Selection */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Display Parameters</CardTitle>
                  <Badge variant="secondary">{enabledCount} / {totalCount}</Badge>
                </div>
                <CardDescription>
                  Select which weather parameters to display on the dashboard
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Accordion type="multiple" defaultValue={['temperature', 'wind', 'precipitation']}>
                  {filteredCategories.map((category: DashboardCategory) => {
                    const enabledInCategory = category.parameters.filter(
                      (p: DashboardParameter) => enabledParams.includes(p.id)
                    ).length;
                    const allEnabled = enabledInCategory === category.parameters.length;
                    const someEnabled = enabledInCategory > 0 && !allEnabled;

                    return (
                      <AccordionItem key={category.id} value={category.id}>
                        <AccordionTrigger className="hover:no-underline">
                          <div className="flex items-center gap-3 flex-1">
                            <span className="font-medium">{category.name}</span>
                            <Badge variant="outline" className="ml-auto mr-2">
                              {enabledInCategory}/{category.parameters.length}
                            </Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pt-2">
                            <div className="flex items-center gap-2 pb-2 border-b">
                              <Checkbox
                                id={`${category.id}-all`}
                                checked={allEnabled}
                                onCheckedChange={(checked) => 
                                  handleCategoryToggleAll(category, checked as boolean)
                                }
                                className={someEnabled ? "data-[state=checked]:bg-primary/50" : ""}
                              />
                              <Label htmlFor={`${category.id}-all`} className="text-sm font-medium cursor-pointer">
                                Select All
                              </Label>
                            </div>
                            
                            {category.parameters.map((param: DashboardParameter) => (
                              <div key={param.id} className="flex items-start gap-3 pl-2">
                                <Checkbox
                                  id={param.id}
                                  checked={enabledParams.includes(param.id)}
                                  onCheckedChange={(checked) => 
                                    handleParameterToggle(param.id, checked as boolean)
                                  }
                                />
                                <div className="grid gap-0.5 leading-none">
                                  <Label htmlFor={param.id} className="text-sm cursor-pointer">
                                    {param.name}
                                    <span className="text-black ml-1">({param.unit})</span>
                                  </Label>
                                  <p className="text-xs text-black">
                                    {param.description}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>

        <SheetFooter className="mt-4">
          <Button variant="outline" onClick={handleReset}>
            Reset to Default
          </Button>
          <Button onClick={handleSave}>
            Save Configuration
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
