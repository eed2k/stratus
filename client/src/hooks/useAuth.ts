import { useState, useEffect } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
}

// Desktop app - single user mode, always authenticated
const LOCAL_USER: AuthUser = {
  id: 'local-user',
  email: 'user@localhost',
  firstName: 'Local',
  lastName: 'User',
  profileImageUrl: null,
};

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(LOCAL_USER);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Desktop app - automatically logged in
    setUser(LOCAL_USER);
    setIsLoading(false);
  }, []);

  const login = () => {
    setUser(LOCAL_USER);
  };
  
  const signup = () => {
    setUser(LOCAL_USER);
  };
  
  const logout = () => {
    // In desktop mode, logout just resets to local user
    setUser(LOCAL_USER);
  };

  return {
    user,
    isLoading,
    isAuthenticated: true, // Always authenticated in desktop mode
    login,
    signup,
    logout,
    error,
  };
}
