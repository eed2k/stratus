// Stratus Weather System - Example/Template Component
// Source: Library (shadcn/ui example)

import { StationSelector } from "../dashboard/StationSelector";
import { ThemeProvider } from "../ThemeProvider";

const mockStations = [
  { id: "1", name: "Demo Weather Station", location: "Local", isOnline: true },
  { id: "2", name: "Field Station 1", location: "Farm Site A", isOnline: true },
  { id: "3", name: "Remote Station", location: "Mountain Site", isOnline: false },
];

export default function StationSelectorExample() {
  return (
    <ThemeProvider>
      <div className="p-4 bg-background">
        <StationSelector
          stations={mockStations}
          selectedId="1"
          onSelect={(id) => console.log("Selected station:", id)}
        />
      </div>
    </ThemeProvider>
  );
}
