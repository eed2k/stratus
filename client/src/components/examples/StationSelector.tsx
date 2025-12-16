import { StationSelector } from "../dashboard/StationSelector";
import { ThemeProvider } from "../ThemeProvider";

const mockStations = [
  { id: "1", name: "Kommetjie Weather", location: "Cape Town, South Africa", isOnline: true },
  { id: "2", name: "Table Mountain", location: "Cape Town, South Africa", isOnline: true },
  { id: "3", name: "Stellenbosch", location: "Western Cape, South Africa", isOnline: false },
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
