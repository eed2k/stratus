import { useState, useEffect } from 'react';
import netlifyIdentity from 'netlify-identity-widget';

type NetlifyUser = netlifyIdentity.User | null;

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
}

const NETLIFY_SITE_URL = import.meta.env.VITE_NETLIFY_SITE_URL;

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (NETLIFY_SITE_URL) {
      netlifyIdentity.init({
        APIUrl: `${NETLIFY_SITE_URL}/.netlify/identity`
      });
    } else {
      netlifyIdentity.init();
    }
    
    const mapUser = (netlifyUser: NetlifyUser): AuthUser | null => {
      if (!netlifyUser) return null;
      return {
        id: netlifyUser.id,
        email: netlifyUser.email,
        firstName: netlifyUser.user_metadata?.full_name?.split(' ')[0] || null,
        lastName: netlifyUser.user_metadata?.full_name?.split(' ').slice(1).join(' ') || null,
        profileImageUrl: netlifyUser.user_metadata?.avatar_url || null,
      };
    };

    const currentUser = netlifyIdentity.currentUser();
    setUser(mapUser(currentUser));
    setIsLoading(false);

    const handleInit = (netlifyUser: NetlifyUser) => {
      setUser(mapUser(netlifyUser));
      setIsLoading(false);
    };

    const handleLogin = (netlifyUser: NetlifyUser) => {
      setUser(mapUser(netlifyUser));
      netlifyIdentity.close();
    };

    const handleLogout = () => {
      setUser(null);
    };

    const handleError = (err: Error) => {
      console.error('Netlify Identity error:', err);
      setError(err.message);
    };

    netlifyIdentity.on('init', handleInit);
    netlifyIdentity.on('login', handleLogin);
    netlifyIdentity.on('logout', handleLogout);
    netlifyIdentity.on('error', handleError);

    return () => {
      netlifyIdentity.off('init', handleInit);
      netlifyIdentity.off('login', handleLogin);
      netlifyIdentity.off('logout', handleLogout);
      netlifyIdentity.off('error', handleError);
    };
  }, []);

  const login = () => {
    if (!NETLIFY_SITE_URL) {
      alert('Netlify Identity is not configured. Please set VITE_NETLIFY_SITE_URL environment variable with your Netlify site URL.');
      return;
    }
    netlifyIdentity.open('login');
  };
  
  const signup = () => {
    if (!NETLIFY_SITE_URL) {
      alert('Netlify Identity is not configured. Please set VITE_NETLIFY_SITE_URL environment variable with your Netlify site URL.');
      return;
    }
    netlifyIdentity.open('signup');
  };
  
  const logout = () => netlifyIdentity.logout();

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    signup,
    logout,
    error,
  };
}
