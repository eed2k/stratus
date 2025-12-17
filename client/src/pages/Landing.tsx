import { Button } from "@/components/ui/button";
import { Cloud, LogIn } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

export default function Landing() {
  const [mounted, setMounted] = useState(false);
  const { login } = useAuth();

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col bg-slate-900">
      <style>{`
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

      <video
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      >
        <source src="/videos/thunderstorm_clouds_over_horizon.mp4" type="video/mp4" />
      </video>

      <div className="absolute inset-0 bg-gradient-to-b from-slate-900/40 via-slate-900/30 to-slate-900/60" />

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
            variant="outline"
            className="bg-transparent border-2 border-white text-white hover:bg-white/10 font-semibold rounded-full"
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
            <p className={`text-xl md:text-2xl text-white/90 font-medium drop-shadow-lg mb-10 ${mounted ? 'animate-fade-in-delay-1' : ''}`}>
              Professional Weather Station Monitoring
            </p>
            <Button 
              onClick={login} 
              className="bg-transparent border border-white text-white hover:bg-white/10 font-semibold px-6 py-2 rounded-full transition-all duration-300 hover:scale-105"
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
