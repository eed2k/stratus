// Stratus Weather System
// Created by Lukas Esterhuizen

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Check } from "lucide-react";

interface RefreshIndicatorProps {
  lastUpdate: Date;
  autoRefresh: boolean;
  interval: number;
  onRefresh: () => void;
  onIntervalChange: (interval: number) => void;
  onAutoRefreshChange: (enabled: boolean) => void;
}

const intervals = [
  { value: 60, label: "1 min" },
  { value: 120, label: "2 min" },
  { value: 300, label: "5 min" },
  { value: 600, label: "10 min" },
];

export function RefreshIndicator({
  lastUpdate,
  autoRefresh,
  interval,
  onRefresh,
  onIntervalChange,
  onAutoRefreshChange,
}: RefreshIndicatorProps) {
  const [timeAgo, setTimeAgo] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const updateTimeAgo = () => {
      const seconds = Math.floor((Date.now() - lastUpdate.getTime()) / 1000);
      if (seconds < 60) {
        setTimeAgo(`${seconds}s ago`);
      } else {
        setTimeAgo(`${Math.floor(seconds / 60)}m ago`);
      }
    };

    updateTimeAgo();
    const timer = setInterval(updateTimeAgo, 1000);
    return () => clearInterval(timer);
  }, [lastUpdate]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await new Promise(r => setTimeout(r, 500));
    onRefresh();
    setIsRefreshing(false);
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {autoRefresh && <Check className="h-4 w-4 text-green-500" />}
        <span>Updated {timeAgo}</span>
      </div>

      <Select
        value={interval.toString()}
        onValueChange={(v) => {
          onIntervalChange(Number(v));
          onAutoRefreshChange(true);
        }}
      >
        <SelectTrigger className="w-24" data-testid="select-refresh-interval">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {intervals.map((i) => (
            <SelectItem key={i.value} value={i.value.toString()}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="icon"
        onClick={handleRefresh}
        disabled={isRefreshing}
        data-testid="button-refresh"
        aria-label="Refresh data"
      >
        <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}
