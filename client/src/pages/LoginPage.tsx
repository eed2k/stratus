import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Lock, Eye, EyeOff, Shield, User } from "lucide-react";

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
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

      // Call the login function from useAuth
      const result = await onLogin(formData.email.trim(), formData.password);
      
      if (!result.success) {
        throw new Error(result.message || "Login failed");
      }

      // Login successful - onLogin will handle navigation
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
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

        {/* Login Card */}
        <Card className="shadow-xl border border-gray-200 bg-white">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl text-center text-gray-900">
              Welcome Back
            </CardTitle>
            <CardDescription className="text-center text-gray-600">
              Sign in to access your weather dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Login Type Tabs */}
            <Tabs value={loginType} onValueChange={(v) => setLoginType(v as 'admin' | 'user')} className="mb-6">
              <TabsList className="grid w-full grid-cols-2 bg-gray-100 p-1 h-12">
                <TabsTrigger 
                  value="admin" 
                  className="flex items-center gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white h-10 font-medium"
                >
                  <Shield className="h-4 w-4" />
                  Admin Login
                </TabsTrigger>
                <TabsTrigger 
                  value="user" 
                  className="flex items-center gap-2 data-[state=active]:bg-emerald-600 data-[state=active]:text-white h-10 font-medium"
                >
                  <User className="h-4 w-4" />
                  User Login
                </TabsTrigger>
              </TabsList>
              <TabsContent value="admin" className="mt-4">
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <p className="text-sm text-blue-800 text-center font-medium">
                    Administrator Access
                  </p>
                  <p className="text-xs text-blue-600 text-center mt-1">
                    Full access to all stations, settings, and user management
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="user" className="mt-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3">
                  <p className="text-sm text-emerald-800 text-center font-medium">
                    User Access
                  </p>
                  <p className="text-xs text-emerald-600 text-center mt-1">
                    View data from your assigned weather stations
                  </p>
                </div>
              </TabsContent>
            </Tabs>

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
                className={`w-full text-white ${loginType === 'admin' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                disabled={isLoading}
              >
                {isLoading ? "Signing in..." : `Sign In as ${loginType === 'admin' ? 'Admin' : 'User'}`}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Info Text */}
        <div className="text-center text-sm text-gray-500 space-y-2">
          <p>
            <strong>Admins:</strong> Full access to all settings, stations, and user management.
          </p>
          <p>
            <strong>Users:</strong> Can view data from assigned stations only.
          </p>
        </div>

        {/* Footer */}
        <div className="text-center space-y-1">
          <p className="text-xs text-gray-600">
            Stratus Weather Station Server v1.0.0
          </p>
          <p className="text-xs text-gray-500">
            Developer: <span className="font-medium text-gray-700">Lukas Esterhuizen</span>
          </p>
        </div>
      </div>
    </div>
  );
}
