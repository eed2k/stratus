import { useState, useEffect, useCallback } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
}

// Desktop app - check for stored user or use default
const getStoredUser = (): AuthUser | null => {
  const setupComplete = localStorage.getItem('stratus_setup_complete');
  if (!setupComplete) {
    return null; // Need to show login/setup screen
  }
  
  const storedUser = localStorage.getItem('stratus_user');
  if (storedUser) {
    try {
      const userData = JSON.parse(storedUser);
      return {
        id: 'local-user',
        email: userData.email || 'user@localhost',
        firstName: userData.firstName || 'Local',
        lastName: userData.lastName || 'User',
        profileImageUrl: null,
      };
    } catch {
      // Fallback to default user
    }
  }
  
  return {
    id: 'local-user',
    email: 'user@localhost',
    firstName: 'Local',
    lastName: 'User',
    profileImageUrl: null,
  };
};

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    // Check if setup has been completed
    const storedUser = getStoredUser();
    if (storedUser) {
      setUser(storedUser);
      setNeedsSetup(false);
    } else {
      setUser(null);
      setNeedsSetup(true);
    }
    setIsLoading(false);
  }, []);

  const login = useCallback((userData: { email: string; firstName: string; lastName: string }) => {
    const authUser: AuthUser = {
      id: 'local-user',
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      profileImageUrl: null,
    };
    setUser(authUser);
    setNeedsSetup(false);
    localStorage.setItem('stratus_user', JSON.stringify(userData));
    localStorage.setItem('stratus_setup_complete', 'true');
  }, []);
  
  const signup = useCallback((userData: { email: string; firstName: string; lastName: string }) => {
    login(userData);
  }, [login]);
  
  const logout = useCallback(() => {
    // Clear stored user data
    localStorage.removeItem('stratus_user');
    localStorage.removeItem('stratus_setup_complete');
    setUser(null);
    setNeedsSetup(true);
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    needsSetup,
    login,
    signup,
    logout,
    error,
  };
}

