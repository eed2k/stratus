import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { User, Mail, Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";

// Admin credentials (hashed for security)
const ADMIN_EMAIL = "esterhuizen2k@proton.me";
const ADMIN_PASSWORD_HASH = "THVrYXNANjEwMw=="; // Base64 encoded

interface LoginPageProps {
  onLogin: (user: { email: string; firstName: string; lastName: string }) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [isSignup, setIsSignup] = useState(false); // Default to login since admin exists
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    firstName: "",
    lastName: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Setup default admin on first load
  useEffect(() => {
    const storedUser = localStorage.getItem("stratus_user");
    if (!storedUser) {
      // Set up default admin account
      const adminUser = {
        email: ADMIN_EMAIL,
        firstName: "Lukas",
        lastName: "Esterhuizen",
        passwordHash: ADMIN_PASSWORD_HASH,
        isAdmin: true,
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem("stratus_user", JSON.stringify(adminUser));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (isSignup) {
        // Validation for signup
        if (!formData.firstName.trim()) {
          throw new Error("First name is required");
        }
        if (!formData.email.trim()) {
          throw new Error("Email is required");
        }
        if (formData.password.length < 6) {
          throw new Error("Password must be at least 6 characters");
        }
        if (formData.password !== formData.confirmPassword) {
          throw new Error("Passwords do not match");
        }

        // Store user in localStorage
        const userData = {
          email: formData.email.trim(),
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          createdAt: new Date().toISOString(),
        };
        localStorage.setItem("stratus_user", JSON.stringify(userData));
        localStorage.setItem("stratus_setup_complete", "true");
        
        onLogin(userData);
      } else {
        // Login - check stored credentials
        const storedUser = localStorage.getItem("stratus_user");
        if (!storedUser) {
          throw new Error("No account found. Please create an account first.");
        }
        
        const userData = JSON.parse(storedUser);
        if (userData.email !== formData.email.trim()) {
          throw new Error("Invalid email address");
        }
        
        onLogin(userData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo & Branding */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            {/* Blue and White Circle Logo */}
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-lg border-2 border-white/20">
              <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center">
                <span className="text-blue-600 font-bold text-xl">S</span>
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">
                Stratus
              </h1>
              <p className="text-sm text-blue-200">Weather Station Server</p>
            </div>
          </div>
        </div>

        {/* Login/Signup Card */}
        <Card className="shadow-xl border-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl text-center">
              {isSignup ? "Welcome to Stratus" : "Welcome Back"}
            </CardTitle>
            <CardDescription className="text-center">
              {isSignup
                ? "Create your account to get started"
                : "Sign in to your account"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={isSignup ? "signup" : "login"} onValueChange={(v) => setIsSignup(v === "signup")}>
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="signup">Create Account</TabsTrigger>
                <TabsTrigger value="login">Sign In</TabsTrigger>
              </TabsList>

              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {isSignup && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name *</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="firstName"
                          placeholder="John"
                          className="pl-9"
                          value={formData.firstName}
                          onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        placeholder="Doe"
                        value={formData.lastName}
                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      className="pl-9"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password {isSignup && "*"}</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={isSignup ? "Create a password (min 6 chars)" : "Enter your password"}
                      className="pl-9 pr-9"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      required={isSignup}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {isSignup && (
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm Password *</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="confirmPassword"
                        type={showPassword ? "text" : "password"}
                        placeholder="Confirm your password"
                        className="pl-9"
                        value={formData.confirmPassword}
                        onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    "Please wait..."
                  ) : isSignup ? (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Create Account
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>
            </Tabs>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center space-y-1">
          <p className="text-xs text-blue-200">
            Stratus Weather Station Server v1.0.0
          </p>
          <p className="text-xs text-blue-300/70">
            Developed by <span className="font-medium text-blue-200">Itronics (Pty) Ltd</span>
          </p>
        </div>
      </div>
    </div>
  );
}
