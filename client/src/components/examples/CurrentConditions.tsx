import { CurrentConditions } from "../dashboard/CurrentConditions";
import { ThemeProvider } from "../ThemeProvider";

export default function CurrentConditionsExample() {
  return (
    <ThemeProvider>
      <div className="p-4 bg-background">
        <CurrentConditions
          stationName="Kommetjie Weather Station"
          lastUpdate="2 minutes ago"
          temperature={23.5}
          humidity={68}
          pressure={1013.25}
          windSpeed={15}
          windGust={22}
          windDirection={225}
          solarRadiation={456}
          rainfall={2.4}
          dewPoint={16.8}
          isOnline={true}
        />
      </div>
    </ThemeProvider>
  );
}
