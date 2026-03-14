// Stratus Weather System - Example/Template Component
// Source: Library (shadcn/ui example)

import { EToCard } from "../dashboard/EToCard";
import { ThemeProvider } from "../ThemeProvider";

export default function EToCardExample() {
  return (
    <ThemeProvider>
      <div className="p-4 bg-background">
        <EToCard
          dailyETo={4.85}
          weeklyETo={32.4}
          monthlyETo={128.5}
        />
      </div>
    </ThemeProvider>
  );
}
