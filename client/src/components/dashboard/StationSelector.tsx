import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Station {
  id: string;
  name: string;
  location: string;
  isOnline: boolean;
}

interface StationSelectorProps {
  stations: Station[];
  selectedId?: string;
  onSelect: (stationId: string) => void;
}

export function StationSelector({ stations, selectedId, onSelect }: StationSelectorProps) {
  const [value, setValue] = useState(selectedId || stations[0]?.id || "");

  const handleChange = (newValue: string) => {
    setValue(newValue);
    onSelect(newValue);
  };

  const selectedStation = stations.find(s => s.id === value);

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className="w-64" data-testid="select-station">
        <SelectValue placeholder="Select a station">
          {selectedStation?.name || "Select a station"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {stations.map((station) => (
          <SelectItem
            key={station.id}
            value={station.id}
            data-testid={`select-item-station-${station.id}`}
          >
            <div className="flex items-center gap-2">
              <div
                className={`h-2 w-2 rounded-full ${
                  station.isOnline ? "bg-green-500" : "bg-gray-400"
                }`}
              />
              <div>
                <p className="font-medium">{station.name}</p>
                <p className="text-xs text-muted-foreground">{station.location}</p>
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
