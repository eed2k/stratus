import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Cloud, BarChart3, Gauge, Wind, Droplets, Sun } from "lucide-react";

export default function Landing() {
  const handleLogin = () => {
    window.location.href = "/api/login";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2">
            <Cloud className="h-6 w-6 text-primary" />
            <span className="text-xl font-semibold">WeatherView Pro</span>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Button onClick={handleLogin} data-testid="button-login">
              Sign In
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="py-20">
          <div className="container mx-auto px-4 text-center">
            <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl">
              Professional Weather Station Monitoring
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">
              Monitor your weather stations in real-time, analyze historical data, 
              and get actionable insights for agriculture, research, and more.
            </p>
            <Button size="lg" onClick={handleLogin} data-testid="button-get-started">
              Get Started
            </Button>
          </div>
        </section>

        <section className="py-16 bg-muted/50">
          <div className="container mx-auto px-4">
            <h2 className="mb-12 text-center text-3xl font-bold">Key Features</h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <Gauge className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>Real-Time Monitoring</CardTitle>
                  <CardDescription>
                    Live weather data updates with temperature, humidity, pressure, and more
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <BarChart3 className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>Historical Analysis</CardTitle>
                  <CardDescription>
                    View trends over time with interactive charts and data export capabilities
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <Wind className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>Wind Analysis</CardTitle>
                  <CardDescription>
                    Wind rose diagrams and wind power calculations for detailed analysis
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <Droplets className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>ETo Calculation</CardTitle>
                  <CardDescription>
                    Evapotranspiration calculations for agricultural applications
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <Sun className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>Solar Radiation</CardTitle>
                  <CardDescription>
                    Track solar radiation and UV index for comprehensive weather data
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <Cloud className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>Multiple Stations</CardTitle>
                  <CardDescription>
                    Connect and manage multiple weather stations from a single dashboard
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container mx-auto px-4 text-center">
            <h2 className="mb-4 text-3xl font-bold">Ready to Get Started?</h2>
            <p className="mb-8 text-muted-foreground">
              Sign in to connect your weather stations and start monitoring.
            </p>
            <Button size="lg" onClick={handleLogin} data-testid="button-sign-in-cta">
              Sign In Now
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          WeatherView Pro - Professional Weather Station Monitoring
        </div>
      </footer>
    </div>
  );
}
