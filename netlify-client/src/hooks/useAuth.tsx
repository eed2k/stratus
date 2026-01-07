/**
 * Authentication Context and Hook
 * Handles email/password login with the Stratus server
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../lib/api';

interface User {
  id: string;
  email: string;
  name?: string;
  stationId?: number;
  stationName?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      const token = localStorage.getItem('stratus_token');
      const savedUser = localStorage.getItem('stratus_user');
      
      if (token && savedUser) {
        try {
          // Verify token is still valid
          const response = await api.verifyToken(token);
          if (response.valid) {
            setUser(JSON.parse(savedUser));
          } else {
            // Token expired, clear storage
            localStorage.removeItem('stratus_token');
            localStorage.removeItem('stratus_user');
          }
        } catch {
          // Token invalid, clear storage
          localStorage.removeItem('stratus_token');
          localStorage.removeItem('stratus_user');
        }
      }
      setIsLoading(false);
    };

    checkSession();
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const response = await api.login(email, password);
      
      if (response.success && response.user && response.token) {
        localStorage.setItem('stratus_token', response.token);
        localStorage.setItem('stratus_user', JSON.stringify(response.user));
        setUser(response.user);
        return { success: true };
      }
      
      return { success: false, error: response.error || 'Login failed' };
    } catch (error: any) {
      return { success: false, error: error.message || 'Network error' };
    }
  };

  const logout = () => {
    localStorage.removeItem('stratus_token');
    localStorage.removeItem('stratus_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
