import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  Settings2
} from "lucide-react";
import {
  DASHBOARD_CATEGORIES,
  UPDATE_PERIOD_OPTIONS,
  DEFAULT_DASHBOARD_CONFIG,
  type DashboardConfig,
  type DashboardCategory,
  type DashboardParameter
} from "../../../../shared/dashboardConfig";

const CHART_TIME_RANGE_OPTIONS = [
  { value: 6, label: '6 hours' },
  { value: 12, label: '12 hours' },
  { value: 24, label: '24 hours' },
  { value: 48, label: '48 hours' },
  { value: 72, label: '3 days' },
  { value: 168, label: '7 days' },
  { value: 336, label: '14 days' },
  { value: 720, label: '30 days' },
  { value: 744, label: '31 days' },
];

interface DashboardConfigPanelProps {
  config: DashboardConfig;
  onConfigChange: (config: DashboardConfig) => void;
  onRefresh?: () => void;
}

export function DashboardConfigPanel({ config, onConfigChange }: DashboardConfigPanelProps) {
  const [localConfig, setLocalConfig] = useState<DashboardConfig>(config);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleParameterToggle = (parameterId: string, enabled: boolean) => {
    setLocalConfig((prev: DashboardConfig) => ({
      ...prev,
      enabledParameters: enabled
        ? [...prev.enabledParameters, parameterId]
        : prev.enabledParameters.filter((p: string) => p !== parameterId)
    }));
  };

  const handleCategoryToggleAll = (category: DashboardCategory, enabled: boolean) => {
    const categoryParamIds = category.parameters.map((p: DashboardParameter) => p.id);
    setLocalConfig((prev: DashboardConfig) => ({
      ...prev,
      enabledParameters: enabled
        ? [...new Set([...prev.enabledParameters, ...categoryParamIds])]
        : prev.enabledParameters.filter((p: string) => !categoryParamIds.includes(p))
    }));
  };

  const handleSave = () => {
    onConfigChange(localConfig);
    setIsOpen(false);
  };

  const handleReset = () => {
    setLocalConfig(DEFAULT_DASHBOARD_CONFIG);
  };

  const enabledCount = localConfig.enabledParameters.length;
  const totalCount = DASHBOARD_CATEGORIES.reduce((sum: number, cat: DashboardCategory) => sum + cat.parameters.length, 0);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="h-4 w-4 mr-2" />
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
                        {CHART_TIME_RANGE_OPTIONS.map(opt => (
                          <SelectItem key={opt.value} value={String(opt.value)}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="showTrendCharts">Show Trend Charts</Label>
                    <Switch
                      id="showTrendCharts"
                      checked={localConfig.showTrendCharts}
                      onCheckedChange={(v) => setLocalConfig((prev: DashboardConfig) => ({ ...prev, showTrendCharts: v }))}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="showWindRose">Show Wind Rose</Label>
                    <Switch
                      id="showWindRose"
                      checked={localConfig.showWindRose}
                      onCheckedChange={(v) => setLocalConfig((prev: DashboardConfig) => ({ ...prev, showWindRose: v }))}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="compactMode">Compact Mode</Label>
                    <Switch
                      id="compactMode"
                      checked={localConfig.compactMode}
                      onCheckedChange={(v) => setLocalConfig((prev: DashboardConfig) => ({ ...prev, compactMode: v }))}
                    />
                  </div>
                </div>
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
                  {DASHBOARD_CATEGORIES.map((category: DashboardCategory) => {
                    const enabledInCategory = category.parameters.filter(
                      (p: DashboardParameter) => localConfig.enabledParameters.includes(p.id)
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
                                  checked={localConfig.enabledParameters.includes(param.id)}
                                  onCheckedChange={(checked) => 
                                    handleParameterToggle(param.id, checked as boolean)
                                  }
                                />
                                <div className="grid gap-0.5 leading-none">
                                  <Label htmlFor={param.id} className="text-sm cursor-pointer">
                                    {param.name}
                                    <span className="text-muted-foreground ml-1">({param.unit})</span>
                                  </Label>
                                  <p className="text-xs text-muted-foreground">
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
