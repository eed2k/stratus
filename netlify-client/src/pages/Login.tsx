import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';

// SVG Icons (inline to avoid dependencies)
const MailIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="16" x="2" y="4" rx="2"></rect>
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
  </svg>
);

const LockIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
  </svg>
);

const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
);

const EyeOffIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path>
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path>
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path>
    <line x1="2" x2="22" y1="2" y2="22"></line>
  </svg>
);

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  // Check server connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      const result = await api.testConnection();
      setConnectionStatus(result.connected ? 'connected' : 'error');
      if (!result.connected && import.meta.env.DEV) {
        console.warn('[Stratus] Server connection failed:', result.error);
        console.warn('[Stratus] Server URL:', api.getServerUrl());
      }
    };
    checkConnection();
  }, []);

  // Handle video loading with timeout fallback
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      // Set a timeout - if video doesn't load in 5 seconds, show fallback
      const timeout = setTimeout(() => {
        if (!videoLoaded) {
          console.warn('[Stratus] Video load timeout - using fallback background');
          setVideoError(true);
        }
      }, 5000);

      const handleCanPlay = () => {
        clearTimeout(timeout);
        setVideoLoaded(true);
        video.play().catch(() => {
          // Autoplay was prevented, video will remain paused
          console.warn('[Stratus] Video autoplay prevented by browser');
        });
      };
      const handleError = () => {
        clearTimeout(timeout);
        setVideoError(true);
        console.warn('[Stratus] Video failed to load');
      };
      
      video.addEventListener('canplaythrough', handleCanPlay);
      video.addEventListener('error', handleError);
      
      return () => {
        clearTimeout(timeout);
        video.removeEventListener('canplaythrough', handleCanPlay);
        video.removeEventListener('error', handleError);
      };
    }
  }, [videoLoaded]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await login(email, password);
    
    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.error || 'Login failed');
    }
    
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden">
      {/* Animated Gradient Fallback Background (always visible as base) */}
      <div 
        className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800"
        style={{
          backgroundSize: '400% 400%',
          animation: 'gradientShift 15s ease infinite',
        }}
      />
      
      {/* Lightning/Storm animated overlay when video fails */}
      {videoError && (
        <div className="absolute inset-0 overflow-hidden">
          {/* Animated rain effect */}
          <div className="absolute inset-0 opacity-20" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath d='M0 0 L2 10 L0 10' fill='%23fff' opacity='0.3'/%3E%3C/svg%3E")`,
            backgroundSize: '50px 50px',
            animation: 'rain 0.5s linear infinite',
          }} />
          {/* Cloud shadows */}
          <div className="absolute top-0 left-1/4 w-96 h-32 bg-white/5 rounded-full blur-3xl animate-pulse" />
          <div className="absolute top-10 right-1/4 w-80 h-28 bg-blue-300/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>
      )}
      
      {/* Thunderstorm Video Background */}
      {!videoError && (
        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${videoLoaded ? 'opacity-100' : 'opacity-0'}`}
        >
          {/* Primary: Pexels CDN storm video - no auth required */}
          <source
            src="https://videos.pexels.com/video-files/2491284/2491284-uhd_2560_1440_24fps.mp4"
            type="video/mp4"
          />
          {/* Fallback 1: Pexels lightning */}
          <source
            src="https://videos.pexels.com/video-files/857074/857074-hd_1920_1080_30fps.mp4"
            type="video/mp4"
          />
          {/* Fallback 2: Pexels clouds/storm */}
          <source
            src="https://videos.pexels.com/video-files/856356/856356-hd_1920_1080_25fps.mp4"
            type="video/mp4"
          />
        </video>
      )}
      
      {/* Dark overlay for better text readability */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"></div>
      
      {/* CSS Animation Keyframes */}
      <style>{`
        @keyframes gradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes rain {
          0% { background-position: 0 0; }
          100% { background-position: 50px 50px; }
        }
      `}</style>
      
      {/* Content */}
      <div className="relative z-10 w-full max-w-md space-y-6">
        {/* Logo & Branding */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            {/* Dark Blue Circle with White Dot Logo - matches Railway deployment */}
            <div className="w-14 h-14 rounded-full bg-[#1e3a5f] flex items-center justify-center shadow-2xl border-2 border-white/30">
              <div className="w-4 h-4 rounded-full bg-white"></div>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white drop-shadow-lg">
                Stratus
              </h1>
              <p className="text-sm text-white/90 drop-shadow-md">Weather Dashboard</p>
            </div>
          </div>
        </div>

        {/* Connection Status Warning */}
        {connectionStatus === 'error' && (
          <div className="p-3 bg-red-900/40 backdrop-blur-sm border-2 border-white/80 rounded-lg text-white text-sm shadow-xl">
            <p className="font-medium">⚠️ Server Connection Issue</p>
            <p className="text-xs mt-1 text-white/90">Unable to reach the server. Login may fail.</p>
          </div>
        )}

        {/* Login Card */}
        <div className="bg-black/30 backdrop-blur-md rounded-xl shadow-2xl border-2 border-white/80 overflow-hidden">
          <div className="p-6 pb-4 space-y-1 text-center">
            <h2 className="text-2xl font-semibold text-white drop-shadow-lg">
              View-Only Access
            </h2>
            <p className="text-white/90 text-sm drop-shadow-md">
              Sign in to view your assigned weather dashboard
            </p>
          </div>
          
          <div className="p-6 pt-0">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 bg-red-900/40 backdrop-blur-sm border-2 border-white/80 rounded-lg text-white text-sm shadow-xl">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium text-white drop-shadow-md">
                  Email
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-2.5 text-white/80">
                    <MailIcon />
                  </div>
                  <input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 bg-white/10 backdrop-blur-sm border-2 border-white/80 rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-white text-white placeholder-white/60 shadow-xl"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-medium text-white drop-shadow-md">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-2.5 text-white/80">
                    <LockIcon />
                  </div>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-9 pr-10 py-2.5 bg-white/10 backdrop-blur-sm border-2 border-white/80 rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-white text-white placeholder-white/60 shadow-xl"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-2.5 text-white/80 hover:text-white transition-colors"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || connectionStatus === 'checking'}
                className="w-full bg-white/20 backdrop-blur-sm hover:bg-white/30 text-white border-2 border-white/80 font-semibold py-2.5 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl hover:shadow-2xl"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Signing in...
                  </span>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Info Text */}
        <div className="text-center text-sm text-white/90 drop-shadow-md">
          <p>View-only access to your assigned weather dashboard.</p>
          <p className="mt-1">Contact your administrator for login credentials.</p>
        </div>

        {/* Footer */}
        <div className="text-center space-y-1">
          <p className="text-xs text-white/90 drop-shadow-md">
            Stratus Weather Station Server v1.0.0
          </p>
          <p className="text-xs text-white/80 drop-shadow-md">
            Developer: <span className="font-medium text-white">Lukas Esterhuizen</span> (esterhuizen2k@proton.me)
          </p>
        </div>
      </div>
    </div>
  );
}
