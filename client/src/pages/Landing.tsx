import { Button } from "@/components/ui/button";
import { Cloud, LogIn } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

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
  const { login } = useAuth();

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col">
      <style>{`
        @keyframes float-cloud {
          0% {
            transform: translateX(-200px);
          }
          100% {
            transform: translateX(calc(100vw + 400px));
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

      <div className="absolute inset-0 bg-gradient-to-b from-sky-400 via-sky-500 to-sky-400" />

      {mounted && (
        <div className="absolute inset-0 pointer-events-none">
          <AnimatedCloud delay={0} duration={45} top="10%" size={180} opacity={0.95} />
          <AnimatedCloud delay={8} duration={55} top="25%" size={220} opacity={0.9} />
          <AnimatedCloud delay={15} duration={40} top="15%" size={150} opacity={0.85} />
          <AnimatedCloud delay={25} duration={50} top="35%" size={200} opacity={0.88} />
          <AnimatedCloud delay={35} duration={48} top="20%" size={170} opacity={0.92} />
          <AnimatedCloud delay={5} duration={60} top="45%" size={140} opacity={0.75} />
          <AnimatedCloud delay={20} duration={52} top="8%" size={160} opacity={0.8} />
          <AnimatedCloud delay={40} duration={50} top="55%" size={190} opacity={0.82} />
          <AnimatedCloud delay={12} duration={48} top="65%" size={165} opacity={0.78} />
        </div>
      )}

      <header className="relative z-10">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-3">
            <Cloud className="h-8 w-8 text-white drop-shadow-lg" />
            <span className="text-2xl font-bold text-white drop-shadow-lg tracking-wide">
              STRATUS
            </span>
          </div>
          <Button 
            onClick={login} 
            variant="secondary"
            className="bg-white hover:bg-white/90 text-blue-900 font-semibold shadow-lg"
            data-testid="button-login"
          >
            <LogIn className="h-4 w-4 mr-2" />
            Sign In
          </Button>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center">
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
              onClick={login} 
              className="bg-white text-blue-900 hover:bg-white/90 font-bold text-lg px-8 py-6 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105"
              data-testid="button-get-started"
            >
              Get Started
            </Button>
          </div>
        </section>
      </main>

      <footer className="relative z-10 py-4">
        <div className="container mx-auto px-4 text-center text-sm text-white/70">
          Credit: Lukas Esterhuizen 2025
        </div>
      </footer>
    </div>
  );
}
