import { WindRose } from "../charts/WindRose";
import { ThemeProvider } from "../ThemeProvider";

const mockWindData = Array.from({ length: 16 }, (_, i) => ({
  direction: i * 22.5,
  speeds: [
    Math.random() * 5,
    Math.random() * 8,
    Math.random() * 12,
    Math.random() * 6,
    Math.random() * 3,
    Math.random() * 2,
  ],
}));

mockWindData[8].speeds = [2, 8, 15, 10, 5, 2];
mockWindData[9].speeds = [3, 10, 18, 12, 6, 3];
mockWindData[10].speeds = [2, 6, 12, 8, 4, 1];

export default function WindRoseExample() {
  return (
    <ThemeProvider>
      <div className="p-4 bg-background flex justify-center">
        <WindRose data={mockWindData} title="Wind Rose (Last 24 Hours)" />
      </div>
    </ThemeProvider>
  );
}
