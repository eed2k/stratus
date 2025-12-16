import { WindPowerCard } from "../dashboard/WindPowerCard";
import { ThemeProvider } from "../ThemeProvider";

export default function WindPowerCardExample() {
  return (
    <ThemeProvider>
      <div className="p-4 bg-background">
        <WindPowerCard
          currentPower={45.2}
          gustPower={128.5}
          airDensity={1.225}
          avgSpeed={18.5}
          avgPower={52.3}
        />
      </div>
    </ThemeProvider>
  );
}
