import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, Lock, Eye, EyeOff, Shield, Users } from "lucide-react";
import { getAllUsers, addUser, type StoredUser } from "@/hooks/useAuth";
import { verifyPassword, hashPassword, isLegacyHash } from "@/lib/passwordUtils";

// Admin credentials - will be migrated to secure hash on first login
const ADMIN_EMAIL = "esterhuizen2k@proton.me";
// Legacy hash for backward compatibility - will be replaced on first login
const ADMIN_PASSWORD_HASH_LEGACY = "THVrYXNANjEwMw=="; // Base64 - will be migrated

// Test user credentials for demo purposes
const TEST_USER_EMAIL = "testuser@stratus.app";
const TEST_USER_PASSWORD_HASH_LEGACY = "VGVzdFVzZXJAMjAyNA=="; // Base64 - will be migrated

interface LoginPageProps {
  onLogin: (user: { 
    email: string; 
    firstName: string; 
    lastName: string;
    role?: 'admin' | 'user';
    assignedStations?: number[];
  }) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [loginType, setLoginType] = useState<'admin' | 'user'>('admin');
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Setup default admin and test user on first load
  useEffect(() => {
    const setupDefaultUsers = async () => {
      const users = getAllUsers();
      const adminExists = users.some(u => u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
      const testUserExists = users.some(u => u.email.toLowerCase() === TEST_USER_EMAIL.toLowerCase());
      
      if (!adminExists) {
        // Set up default admin account with legacy hash (will be migrated on first login)
        const adminUser: StoredUser = {
          email: ADMIN_EMAIL,
          firstName: "Lukas",
          lastName: "Esterhuizen",
          passwordHash: ADMIN_PASSWORD_HASH_LEGACY,
          role: 'admin',
          assignedStations: [],
          createdAt: new Date().toISOString(),
        };
        addUser(adminUser);
      }
      
      if (!testUserExists) {
        // Set up test user account for demonstration
        const testUser: StoredUser = {
          email: TEST_USER_EMAIL,
          firstName: "Test",
          lastName: "User",
          passwordHash: TEST_USER_PASSWORD_HASH_LEGACY,
          role: 'user',
          assignedStations: [1], // Assigned to first station by default
          createdAt: new Date().toISOString(),
          createdBy: ADMIN_EMAIL,
        };
        addUser(testUser);
      }
    };
    setupDefaultUsers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (!formData.email.trim()) {
        throw new Error("Email is required");
      }
      if (!formData.password) {
        throw new Error("Password is required");
      }

      // Find user in stored users
      const users = getAllUsers();
      const user = users.find(u => u.email.toLowerCase() === formData.email.trim().toLowerCase());

      if (!user) {
        throw new Error("Invalid email or password");
      }

      // Verify password using secure async verification
      const isValid = await verifyPassword(formData.password, user.passwordHash || "");
      if (!user.passwordHash || !isValid) {
        throw new Error("Invalid email or password");
      }

      // Migrate legacy Base64 hash to secure PBKDF2 hash
      if (isLegacyHash(user.passwordHash)) {
        const secureHash = await hashPassword(formData.password);
        const updatedUser = { ...user, passwordHash: secureHash };
        addUser(updatedUser);
      }

      // Check role matches login type
      if (loginType === 'admin' && user.role !== 'admin') {
        throw new Error("This account does not have admin access. Please use 'User Login'.");
      }

      if (loginType === 'user' && user.role === 'admin') {
        throw new Error("Admin accounts should use 'Admin Login'.");
      }

      // Login successful
      onLogin({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        assignedStations: user.assignedStations || [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo & Branding */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            {/* Dark Blue Circle with White Dot Logo */}
            <div className="w-14 h-14 rounded-full bg-[#1e3a5f] flex items-center justify-center shadow-lg">
              <div className="w-4 h-4 rounded-full bg-white"></div>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Stratus
              </h1>
              <p className="text-sm text-gray-600">Weather Station Server</p>
            </div>
          </div>
        </div>

        {/* Login Type Selection */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant={loginType === 'admin' ? 'default' : 'outline'}
            className={`flex-1 ${loginType === 'admin' ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
            onClick={() => setLoginType('admin')}
          >
            <Shield className="mr-2 h-4 w-4" />
            Admin Login
          </Button>
          <Button
            type="button"
            variant={loginType === 'user' ? 'default' : 'outline'}
            className={`flex-1 ${loginType === 'user' ? 'bg-green-600 hover:bg-green-700' : ''}`}
            onClick={() => setLoginType('user')}
          >
            <Users className="mr-2 h-4 w-4" />
            User Login
          </Button>
        </div>

        {/* Login Card */}
        <Card className="shadow-xl border border-gray-200 bg-white">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl text-center text-gray-900">
              {loginType === 'admin' ? 'Administrator Access' : 'User Access'}
            </CardTitle>
            <CardDescription className="text-center text-gray-600">
              {loginType === 'admin' 
                ? 'Sign in with your admin credentials'
                : 'Sign in to view your assigned dashboards'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-700">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    className="pl-9 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-700">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    className="pl-9 pr-9 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button 
                type="submit" 
                className={`w-full text-white ${
                  loginType === 'admin' 
                    ? 'bg-blue-600 hover:bg-blue-700' 
                    : 'bg-green-600 hover:bg-green-700'
                }`} 
                disabled={isLoading}
              >
                {isLoading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Info Text */}
        <div className="text-center text-sm text-gray-500">
          {loginType === 'admin' ? (
            <p>Administrators have full access to all settings and stations.</p>
          ) : (
            <div className="space-y-2">
              <p>Users can only view dashboards assigned by an administrator.</p>
              <div className="mt-3 p-3 bg-gray-100 rounded-lg text-xs text-left">
                <p className="font-medium text-gray-700 mb-1">Demo User Credentials:</p>
                <p className="text-gray-600">Email: <span className="font-mono bg-white px-1 rounded">testuser@stratus.app</span></p>
                <p className="text-gray-600">Password: <span className="font-mono bg-white px-1 rounded">TestUser@2024</span></p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center space-y-1">
          <p className="text-xs text-gray-600">
            Stratus Weather Station Server v1.0.0
          </p>
          <p className="text-xs text-gray-500">
            Developer: <span className="font-medium text-gray-700">Lukas Esterhuizen</span> (esterhuizen2k@proton.me)
          </p>
        </div>
      </div>
    </div>
  );
}
