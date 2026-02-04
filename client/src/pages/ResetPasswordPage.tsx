import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, Eye, EyeOff, CheckCircle, XCircle, ArrowLeft, Loader2 } from "lucide-react";

export function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const token = new URLSearchParams(search).get('token');
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [isValidToken, setIsValidToken] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Validate token on mount
  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setIsValidating(false);
        return;
      }

      try {
        const response = await fetch(`/api/auth/validate-reset-token/${token}`);
        const data = await response.json();
        
        if (response.ok && data.valid) {
          setIsValidToken(true);
          setUserEmail(data.email);
        }
      } catch (err) {
        console.error('Token validation error:', err);
      } finally {
        setIsValidating(false);
      }
    };

    validateToken();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to reset password');
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state while validating token
  if (isValidating) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-3">
              <div className="w-14 h-14 rounded-full bg-[#1e3a5f] flex items-center justify-center shadow-lg">
                <div className="w-4 h-4 rounded-full bg-white"></div>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Stratus</h1>
                <p className="text-sm text-gray-600">Weather Station Server</p>
              </div>
            </div>
          </div>

          <Card className="shadow-xl border border-gray-200 bg-white">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-4" />
              <p className="text-gray-600">Validating reset link...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Invalid or missing token
  if (!token || !isValidToken) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-3">
              <div className="w-14 h-14 rounded-full bg-[#1e3a5f] flex items-center justify-center shadow-lg">
                <div className="w-4 h-4 rounded-full bg-white"></div>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Stratus</h1>
                <p className="text-sm text-gray-600">Weather Station Server</p>
              </div>
            </div>
          </div>

          <Card className="shadow-xl border border-gray-200 bg-white">
            <CardHeader className="space-y-1 pb-4">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                  <XCircle className="w-8 h-8 text-red-600" />
                </div>
              </div>
              <CardTitle className="text-2xl text-center text-gray-900">
                Invalid Reset Link
              </CardTitle>
              <CardDescription className="text-center text-gray-600">
                This password reset link is invalid or has expired.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-500 text-center">
                Password reset links expire after 1 hour for security reasons. Please request a new link.
              </p>
              <Button 
                onClick={() => setLocation('/forgot-password')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                Request New Reset Link
              </Button>
              <Button 
                onClick={() => setLocation('/login')}
                variant="ghost"
                className="w-full"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Login
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-3">
              <div className="w-14 h-14 rounded-full bg-[#1e3a5f] flex items-center justify-center shadow-lg">
                <div className="w-4 h-4 rounded-full bg-white"></div>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Stratus</h1>
                <p className="text-sm text-gray-600">Weather Station Server</p>
              </div>
            </div>
          </div>

          <Card className="shadow-xl border border-gray-200 bg-white">
            <CardHeader className="space-y-1 pb-4">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
              </div>
              <CardTitle className="text-2xl text-center text-gray-900">
                Password Reset Successfully
              </CardTitle>
              <CardDescription className="text-center text-gray-600">
                Your password has been changed. You can now log in with your new password.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={() => setLocation('/login')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                Go to Login
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Reset password form
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <div className="w-14 h-14 rounded-full bg-[#1e3a5f] flex items-center justify-center shadow-lg">
              <div className="w-4 h-4 rounded-full bg-white"></div>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Stratus</h1>
              <p className="text-sm text-gray-600">Weather Station Server</p>
            </div>
          </div>
        </div>

        <Card className="shadow-xl border border-gray-200 bg-white">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl text-center text-gray-900">
              Reset Your Password
            </CardTitle>
            <CardDescription className="text-center text-gray-600">
              {userEmail ? `Enter a new password for ${userEmail}` : 'Enter your new password below'}
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
                <Label htmlFor="password" className="text-gray-700">New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter new password"
                    className="pl-9 pr-9 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500">Must be at least 8 characters</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-gray-700">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Confirm new password"
                    className="pl-9 pr-9 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button 
                type="submit" 
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                disabled={isLoading}
              >
                {isLoading ? "Resetting..." : "Reset Password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
