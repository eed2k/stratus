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

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    netlifyIdentity.init();
    
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

    netlifyIdentity.on('init', handleInit);
    netlifyIdentity.on('login', handleLogin);
    netlifyIdentity.on('logout', handleLogout);

    return () => {
      netlifyIdentity.off('init', handleInit);
      netlifyIdentity.off('login', handleLogin);
      netlifyIdentity.off('logout', handleLogout);
    };
  }, []);

  const login = () => netlifyIdentity.open('login');
  const signup = () => netlifyIdentity.open('signup');
  const logout = () => netlifyIdentity.logout();

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    signup,
    logout,
  };
}
