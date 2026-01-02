import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database } from "lucide-react";
import { ReactNode } from "react";

interface NoDataWrapperProps {
  /** The data value to check - if null/undefined, shows no data state */
  data: any;
  /** Title for the card when showing no data */
  title: string;
  /** Icon component to display (optional) */
  icon?: ReactNode;
  /** The content to render when data is available */
  children: ReactNode;
  /** Whether to hide the entire component when no data (vs showing "No Data" message) */
  hideWhenNoData?: boolean;
  /** Custom message to show when no data */
  noDataMessage?: string;
  /** Custom description for no data state */
  noDataDescription?: string;
}

/**
 * Wrapper component that handles "No Data" states for dashboard cards.
 * When connecting a weather station via serial or modem, if a data type
 * is not included, this wrapper will show "No Data" or hide the block.
 */
export function NoDataWrapper({
  data,
  title,
  icon,
  children,
  hideWhenNoData = false,
  noDataMessage = "No Data",
  noDataDescription = "This data is not available for this station",
}: NoDataWrapperProps) {
  // Check if data is available
  const hasData = data !== null && data !== undefined && 
    !(typeof data === 'number' && isNaN(data)) &&
    !(Array.isArray(data) && data.length === 0);

  // If no data and should hide, return null
  if (!hasData && hideWhenNoData) {
    return null;
  }

  // If no data, show the no data state
  if (!hasData) {
    return (
      <Card className="border border-gray-300 bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-normal text-black flex items-center gap-2" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            {icon}
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Database className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">{noDataMessage}</p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-[200px]">
              {noDataDescription}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Data is available, render children
  return <>{children}</>;
}

/**
 * Helper function to check if a value represents "no data"
 */
export function hasValidData(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number' && isNaN(value)) return false;
  if (typeof value === 'number' && value === -9999) return false; // Common no-data sentinel
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/**
 * Utility to check multiple data fields
 */
export function hasAnyValidData(...values: any[]): boolean {
  return values.some(v => hasValidData(v));
}

/**
 * Utility to check all data fields
 */
export function hasAllValidData(...values: any[]): boolean {
  return values.every(v => hasValidData(v));
}
