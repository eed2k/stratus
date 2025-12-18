import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface StatPeriod {
  period: string;
  stats: {
    label: string;
    value: string | number;
    unit?: string;
  }[];
}

interface StatisticsCardProps {
  title: string;
  periods: StatPeriod[];
}

export function StatisticsCard({ title, periods }: StatisticsCardProps) {
  return (
    <Card data-testid={`card-statistics-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={periods[0]?.period} className="w-full">
          <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${periods.length}, 1fr)` }}>
            {periods.map((p) => (
              <TabsTrigger key={p.period} value={p.period} data-testid={`tab-${p.period}`}>
                {p.period}
              </TabsTrigger>
            ))}
          </TabsList>
          {periods.map((p) => (
            <TabsContent key={p.period} value={p.period} className="mt-4">
              <div className="grid grid-cols-2 gap-4">
                {p.stats.map((stat, i) => (
                  <div key={i} className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="font-mono text-xl font-bold">
                      {stat.value}
                      {stat.unit && <span className="text-sm text-muted-foreground ml-1">{stat.unit}</span>}
                    </p>
                  </div>
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
