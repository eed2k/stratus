/**
 * Dashboard Parameter Configuration
 * Defines all available weather parameters that can be displayed on the dashboard
 * Based on Campbell Scientific datalogger capabilities
 */
export interface DashboardParameter {
    id: string;
    name: string;
    category: string;
    unit: string;
    description: string;
    dataField: string;
    chartType?: 'line' | 'bar' | 'gauge' | 'windrose' | 'none';
    defaultEnabled: boolean;
    precision?: number;
}
export interface DashboardCategory {
    id: string;
    name: string;
    icon: string;
    parameters: DashboardParameter[];
}
export declare const DASHBOARD_CATEGORIES: DashboardCategory[];
export declare const UPDATE_PERIOD_OPTIONS: {
    value: number;
    label: string;
}[];
export interface DashboardConfig {
    enabledParameters: string[];
    updatePeriod: number;
    chartTimeRange: number;
    showTrendCharts: boolean;
    showWindRose: boolean;
    compactMode: boolean;
}
export declare const DEFAULT_DASHBOARD_CONFIG: DashboardConfig;
export declare function getAllParameters(): DashboardParameter[];
export declare function getParameterById(id: string): DashboardParameter | undefined;
export declare function getParametersByCategory(categoryId: string): DashboardParameter[];
