import { useState, useEffect, useCallback } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role: 'admin' | 'user';
  assignedStations?: number[]; // Station IDs user can access
}

export interface StoredUser {
  email: string;
  firstName: string;
  lastName: string;
  password?: string; // Plain password (sent to server for hashing)
  passwordHash?: string; // Hashed password (from server)
  role: 'admin' | 'user';
  assignedStations?: number[];
  createdAt: string;
  createdBy?: string;
}

// ============ API Functions - Use server endpoints instead of localStorage ============

// Get all users from server
export async function getAllUsers(): Promise<StoredUser[]> {
  try {
    const userEmail = localStorage.getItem('stratus_user_email');
    const response = await fetch('/api/users', {
      headers: {
        'X-User-Email': userEmail || ''
      }
    });
    
    if (!response.ok) {
      console.error('Failed to fetch users:', response.statusText);
      return [];
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching users:', error);
    return [];
  }
}

// Add a new user via API
export async function addUser(user: StoredUser): Promise<boolean> {
  try {
    const userEmail = localStorage.getItem('stratus_user_email');
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Email': userEmail || ''
      },
      body: JSON.stringify(user)
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to add user:', error.message);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error adding user:', error);
    return false;
  }
}

// Update an existing user via API
export async function updateUser(email: string, updates: Partial<StoredUser>): Promise<boolean> {
  try {
    const userEmail = localStorage.getItem('stratus_user_email');
    const response = await fetch(`/api/users/${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Email': userEmail || ''
      },
      body: JSON.stringify(updates)
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to update user:', error.message);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error updating user:', error);
    return false;
  }
}

// Delete a user via API
export async function deleteUser(email: string): Promise<boolean> {
  try {
    const userEmail = localStorage.getItem('stratus_user_email');
    const response = await fetch(`/api/users/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: {
        'X-User-Email': userEmail || ''
      }
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to delete user:', error.message);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting user:', error);
    return false;
  }
}

// Update user's assigned stations
export async function updateUserStations(email: string, stationIds: number[]): Promise<boolean> {
  return await updateUser(email, { assignedStations: stationIds });
}

// Desktop app - check for stored user or use default
const getStoredUser = (): AuthUser | null => {
  const userEmail = localStorage.getItem('stratus_user_email');
  const userDataStr = localStorage.getItem('stratus_user');
  
  if (!userEmail || !userDataStr) {
    return null;
  }
  
  try {
    const userData = JSON.parse(userDataStr);
    return {
      id: userData.email,
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      profileImageUrl: null,
      role: userData.role || 'admin',
      assignedStations: userData.assignedStations || [],
    };
  } catch {
    return null;
  }
};

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, _setError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    // Check if user is logged in
    const storedUser = getStoredUser();
    if (storedUser) {
      setUser(storedUser);
      setNeedsSetup(false);
      setIsLoading(false);
      return;
    }

    // Desktop mode: auto-login as the default admin user
    // The license key system already gates access to the app,
    // so requiring a separate login is unnecessary for desktop.
    const isDesktop = !!(window as any).stratusDesktop?.isDesktop;
    if (isDesktop) {
      const autoLogin = async () => {
        try {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@stratus.local', password: 'admin' })
          });
          const data = await response.json();
          if (response.ok && data.success) {
            const authUser: AuthUser = {
              id: data.user.email,
              email: data.user.email,
              firstName: data.user.firstName,
              lastName: data.user.lastName,
              profileImageUrl: null,
              role: data.user.role,
              assignedStations: data.user.assignedStations || [],
            };
            setUser(authUser);
            setNeedsSetup(false);
            localStorage.setItem('stratus_user_email', data.user.email);
            localStorage.setItem('stratus_user', JSON.stringify(data.user));
          } else {
            // Auto-login failed — show login page
            setUser(null);
            setNeedsSetup(true);
          }
        } catch {
          setUser(null);
          setNeedsSetup(true);
        }
        setIsLoading(false);
      };
      autoLogin();
      return;
    }

    // Not desktop and no stored user — show login page
    setUser(null);
    setNeedsSetup(true);
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        return { success: false, message: data.message || 'Login failed' };
      }
      
      // Store user data
      const authUser: AuthUser = {
        id: data.user.email,
        email: data.user.email,
        firstName: data.user.firstName,
        lastName: data.user.lastName,
        profileImageUrl: null,
        role: data.user.role,
        assignedStations: data.user.assignedStations || [],
      };
      
      setUser(authUser);
      setNeedsSetup(false);
      localStorage.setItem('stratus_user_email', data.user.email);
      localStorage.setItem('stratus_user', JSON.stringify(data.user));
      
      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, message: 'Network error during login' };
    }
  }, []);
  
  const signup = useCallback(async (userData: { 
    email: string; 
    firstName: string; 
    lastName: string;
    password: string;
  }): Promise<{ success: boolean; message?: string }> => {
    // For initial setup, create admin user
    try {
      const newUser: StoredUser = {
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        password: userData.password, // Send plain password - server hashes it
        role: 'admin',
        assignedStations: [],
        createdAt: new Date().toISOString()
      };
      
      const success = await addUser(newUser);
      
      if (success) {
        // Auto-login after signup
        return await login(userData.email, userData.password);
      } else {
        return { success: false, message: 'Failed to create user' };
      }
    } catch (error) {
      console.error('Signup error:', error);
      return { success: false, message: 'Signup failed' };
    }
  }, [login]);
  
  const logout = useCallback(async () => {
    try {
      const userEmail = localStorage.getItem('stratus_user_email');
      
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'X-User-Email': userEmail || ''
        }
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
    
    // Clear stored user data
    localStorage.removeItem('stratus_user_email');
    localStorage.removeItem('stratus_user');
    setUser(null);
    setNeedsSetup(true);
  }, []);

  // Check if user is admin
  const isAdmin = user?.role === 'admin';

  // Check if user can access a specific station
  const canAccessStation = useCallback((stationId: number): boolean => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.assignedStations?.includes(stationId) || false;
  }, [user]);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    needsSetup,
    isAdmin,
    canAccessStation,
    login,
    signup,
    logout,
    error,
  };
}
