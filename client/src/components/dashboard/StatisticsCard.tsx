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
    <Card className="border border-gray-300 bg-white" data-testid={`card-statistics-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={periods[0]?.period} className="w-full">
          <TabsList className="grid w-full border border-black" style={{ gridTemplateColumns: `repeat(${periods.length}, 1fr)` }}>
            {periods.map((p) => (
              <TabsTrigger key={p.period} value={p.period} className="font-bold" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid={`tab-${p.period}`}>
                {p.period}
              </TabsTrigger>
            ))}
          </TabsList>
          {periods.map((p) => (
            <TabsContent key={p.period} value={p.period} className="mt-4">
              <div className="grid grid-cols-2 gap-4">
                {p.stats.map((stat, i) => (
                  <div key={i} className="rounded-lg border border-gray-300 bg-gray-50 p-3">
                    <p className="text-xs font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{stat.label}</p>
                    <p className="text-xl font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                      {stat.value}
                      {stat.unit && <span className="text-sm font-bold text-black ml-1">{stat.unit}</span>}
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
