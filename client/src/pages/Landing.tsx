import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Cloud, BarChart3, Gauge, Wind, Droplets, Sun, LogIn } from "lucide-react";
import { useState, useEffect } from "react";

function AnimatedCloud({ delay, duration, top, size, opacity }: { 
  delay: number; 
  duration: number; 
  top: string; 
  size: number;
  opacity: number;
}) {
  const height = Math.round(size * 0.4);
  return (
    <div 
      className="absolute"
      style={{
        top,
        left: '-200px',
        animation: `float-cloud ${duration}s linear ${delay}s infinite`,
        opacity,
      }}
    >
      <svg 
        width={size} 
        height={height} 
        viewBox="0 0 200 80" 
        className="drop-shadow-lg"
      >
        <defs>
          <linearGradient id={`cloud-gradient-${delay}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
            <stop offset="100%" stopColor="rgba(240,248,255,0.85)" />
          </linearGradient>
        </defs>
        <ellipse cx="60" cy="50" rx="40" ry="25" fill={`url(#cloud-gradient-${delay})`} />
        <ellipse cx="100" cy="45" rx="50" ry="30" fill={`url(#cloud-gradient-${delay})`} />
        <ellipse cx="140" cy="50" rx="35" ry="22" fill={`url(#cloud-gradient-${delay})`} />
        <ellipse cx="80" cy="35" rx="30" ry="20" fill={`url(#cloud-gradient-${delay})`} />
        <ellipse cx="120" cy="35" rx="35" ry="22" fill={`url(#cloud-gradient-${delay})`} />
      </svg>
    </div>
  );
}

export default function Landing() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleLogin = () => {
    window.location.href = "/api/login";
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <style>{`
        @keyframes float-cloud {
          0% {
            transform: translateX(-200px);
          }
          100% {
            transform: translateX(calc(100vw + 400px));
          }
        }
        
        @keyframes sway-grass {
          0%, 100% {
            transform: skewX(-2deg);
          }
          50% {
            transform: skewX(2deg);
          }
        }
        
        @keyframes fade-in {
          0% {
            opacity: 0;
            transform: translateY(20px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .animate-fade-in {
          animation: fade-in 1s ease-out forwards;
        }
        
        .animate-fade-in-delay-1 {
          animation: fade-in 1s ease-out 0.2s forwards;
          opacity: 0;
        }
        
        .animate-fade-in-delay-2 {
          animation: fade-in 1s ease-out 0.4s forwards;
          opacity: 0;
        }
      `}</style>

      <div className="absolute inset-0 bg-gradient-to-b from-sky-300 via-sky-400 to-sky-200 dark:from-slate-800 dark:via-slate-700 dark:to-slate-600" />
      
      <div className="absolute bottom-0 left-0 right-0 h-[40%] bg-gradient-to-t from-green-500 via-green-400 to-emerald-300 dark:from-green-900 dark:via-green-800 dark:to-emerald-700">
        <div className="absolute inset-0 overflow-hidden">
          {mounted && [...Array(50)].map((_, i) => (
            <div
              key={i}
              className="absolute bottom-0 w-1 bg-gradient-to-t from-green-600 to-green-400 dark:from-green-700 dark:to-green-500 rounded-t-full"
              style={{
                left: `${(i * 2) + Math.random() * 2}%`,
                height: `${20 + Math.random() * 40}px`,
                animation: `sway-grass ${2 + Math.random() * 2}s ease-in-out ${Math.random() * 2}s infinite`,
              }}
            />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-green-600/30 dark:to-green-900/50" />
      </div>

      {mounted && (
        <div className="absolute inset-0 pointer-events-none">
          <AnimatedCloud delay={0} duration={45} top="5%" size={180} opacity={0.95} />
          <AnimatedCloud delay={8} duration={55} top="15%" size={220} opacity={0.9} />
          <AnimatedCloud delay={15} duration={40} top="8%" size={150} opacity={0.85} />
          <AnimatedCloud delay={25} duration={50} top="20%" size={200} opacity={0.88} />
          <AnimatedCloud delay={35} duration={48} top="12%" size={170} opacity={0.92} />
          <AnimatedCloud delay={5} duration={60} top="25%" size={140} opacity={0.75} />
          <AnimatedCloud delay={20} duration={52} top="3%" size={160} opacity={0.8} />
        </div>
      )}

      <header className="relative z-10 border-b border-white/20 backdrop-blur-md bg-white/10 dark:bg-slate-900/30">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-3">
            <Cloud className="h-8 w-8 text-white drop-shadow-lg" />
            <span className="text-2xl font-bold text-white drop-shadow-lg tracking-wide">
              STRATUS
            </span>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Button 
              onClick={handleLogin} 
              variant="secondary"
              className="bg-white/90 hover:bg-white text-sky-700 font-semibold shadow-lg"
              data-testid="button-login"
            >
              <LogIn className="h-4 w-4 mr-2" />
              Sign In
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="py-20 md:py-32">
          <div className="container mx-auto px-4 text-center">
            <h1 className={`mb-4 text-6xl md:text-8xl font-bold tracking-tight text-white drop-shadow-2xl ${mounted ? 'animate-fade-in' : ''}`}>
              STRATUS
            </h1>
            <p className={`text-xl md:text-2xl text-white/90 font-medium drop-shadow-lg mb-2 ${mounted ? 'animate-fade-in-delay-1' : ''}`}>
              Professional Weather Station Monitoring
            </p>
            <p className={`mx-auto mb-10 max-w-2xl text-lg text-white/80 drop-shadow ${mounted ? 'animate-fade-in-delay-2' : ''}`}>
              Monitor your weather stations in real-time, analyze historical data, 
              and get actionable insights for agriculture, research, and more.
            </p>
            <Button 
              size="lg" 
              onClick={handleLogin} 
              className="bg-white text-sky-700 hover:bg-white/90 font-bold text-lg px-8 py-6 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105"
              data-testid="button-get-started"
            >
              Get Started
            </Button>
          </div>
        </section>

        <section className="py-16 bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg">
          <div className="container mx-auto px-4">
            <h2 className="mb-12 text-center text-3xl font-bold text-slate-800 dark:text-white">Key Features</h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <Card className="bg-white/90 dark:bg-slate-800/90 backdrop-blur border-0 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                <CardHeader>
                  <Gauge className="h-10 w-10 text-sky-600 dark:text-sky-400 mb-2" />
                  <CardTitle className="text-slate-800 dark:text-white">Real-Time Monitoring</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-300">
                    Live weather data updates with temperature, humidity, pressure, and more
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-white/90 dark:bg-slate-800/90 backdrop-blur border-0 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                <CardHeader>
                  <BarChart3 className="h-10 w-10 text-sky-600 dark:text-sky-400 mb-2" />
                  <CardTitle className="text-slate-800 dark:text-white">Historical Analysis</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-300">
                    View trends over time with interactive charts and data export capabilities
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-white/90 dark:bg-slate-800/90 backdrop-blur border-0 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                <CardHeader>
                  <Wind className="h-10 w-10 text-sky-600 dark:text-sky-400 mb-2" />
                  <CardTitle className="text-slate-800 dark:text-white">Wind Analysis</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-300">
                    Wind rose diagrams and wind power calculations for detailed analysis
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-white/90 dark:bg-slate-800/90 backdrop-blur border-0 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                <CardHeader>
                  <Droplets className="h-10 w-10 text-sky-600 dark:text-sky-400 mb-2" />
                  <CardTitle className="text-slate-800 dark:text-white">ETo Calculation</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-300">
                    Evapotranspiration calculations for agricultural applications
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-white/90 dark:bg-slate-800/90 backdrop-blur border-0 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                <CardHeader>
                  <Sun className="h-10 w-10 text-sky-600 dark:text-sky-400 mb-2" />
                  <CardTitle className="text-slate-800 dark:text-white">Solar Radiation</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-300">
                    Track solar radiation and UV index for comprehensive weather data
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-white/90 dark:bg-slate-800/90 backdrop-blur border-0 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                <CardHeader>
                  <Cloud className="h-10 w-10 text-sky-600 dark:text-sky-400 mb-2" />
                  <CardTitle className="text-slate-800 dark:text-white">Multiple Stations</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-300">
                    Connect Campbell Scientific and Rika weather stations from a single dashboard
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        <section className="py-16 relative">
          <div className="container mx-auto px-4 text-center">
            <h2 className="mb-4 text-3xl font-bold text-white drop-shadow-lg">Ready to Get Started?</h2>
            <p className="mb-8 text-white/80 drop-shadow">
              Sign in to connect your Campbell Scientific or Rika weather stations and start monitoring.
            </p>
            <Button 
              size="lg" 
              onClick={handleLogin}
              className="bg-white text-sky-700 hover:bg-white/90 font-bold shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105"
              data-testid="button-sign-in-cta"
            >
              Sign In Now
            </Button>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/20 py-8 backdrop-blur-md bg-white/10 dark:bg-slate-900/30">
        <div className="container mx-auto px-4 text-center text-sm text-white/80">
          STRATUS - Professional Weather Station Monitoring Platform
        </div>
      </footer>
    </div>
  );
}
