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
  passwordHash?: string;
  role: 'admin' | 'user';
  assignedStations?: number[];
  createdAt: string;
  createdBy?: string;
}

// Get all users from localStorage
export function getAllUsers(): StoredUser[] {
  const usersData = localStorage.getItem('stratus_users');
  if (usersData) {
    try {
      return JSON.parse(usersData);
    } catch {
      return [];
    }
  }
  return [];
}

// Save all users to localStorage
export function saveAllUsers(users: StoredUser[]): void {
  localStorage.setItem('stratus_users', JSON.stringify(users));
}

// Add a new user
export function addUser(user: StoredUser): void {
  const users = getAllUsers();
  // Check if user already exists
  const existingIndex = users.findIndex(u => u.email.toLowerCase() === user.email.toLowerCase());
  if (existingIndex >= 0) {
    users[existingIndex] = user;
  } else {
    users.push(user);
  }
  saveAllUsers(users);
}

// Delete a user
export function deleteUser(email: string): void {
  const users = getAllUsers().filter(u => u.email.toLowerCase() !== email.toLowerCase());
  saveAllUsers(users);
}

// Update user's assigned stations
export function updateUserStations(email: string, stationIds: number[]): void {
  const users = getAllUsers();
  const userIndex = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
  if (userIndex >= 0) {
    users[userIndex].assignedStations = stationIds;
    saveAllUsers(users);
  }
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
        id: userData.email || 'local-user',
        email: userData.email || 'user@localhost',
        firstName: userData.firstName || 'Local',
        lastName: userData.lastName || 'User',
        profileImageUrl: null,
        role: userData.role || 'admin', // Default to admin for backwards compatibility
        assignedStations: userData.assignedStations || [],
      };
    } catch {
      // Fallback to default user
    }
  }
  
  return null;
};

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, _setError] = useState<string | null>(null);
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

  const login = useCallback((userData: { 
    email: string; 
    firstName: string; 
    lastName: string;
    role?: 'admin' | 'user';
    assignedStations?: number[];
  }) => {
    const authUser: AuthUser = {
      id: userData.email,
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      profileImageUrl: null,
      role: userData.role || 'admin',
      assignedStations: userData.assignedStations || [],
    };
    setUser(authUser);
    setNeedsSetup(false);
    localStorage.setItem('stratus_user', JSON.stringify({
      ...userData,
      role: authUser.role,
      assignedStations: authUser.assignedStations,
    }));
    localStorage.setItem('stratus_setup_complete', 'true');
  }, []);
  
  const signup = useCallback((userData: { email: string; firstName: string; lastName: string }) => {
    login({ ...userData, role: 'admin' });
  }, [login]);
  
  const logout = useCallback(() => {
    // Clear stored user data
    localStorage.removeItem('stratus_user');
    localStorage.removeItem('stratus_setup_complete');
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

