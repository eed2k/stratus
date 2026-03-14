// Stratus Weather System
// Created by Lukas Esterhuizen

import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function SetupPasswordPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const token = new URLSearchParams(search).get('token');
  
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [isValidToken, setIsValidToken] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [customMessage, setCustomMessage] = useState<string | null>(null);

  // Validate token on mount
  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setIsValidating(false);
        return;
      }

      try {
        const response = await fetch(`/api/auth/validate-invitation/${token}`);
        const data = await response.json();
        
        if (response.ok && data.valid) {
          setIsValidToken(true);
          setUserEmail(data.email);
          setCustomMessage(data.customMessage);
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
      const response = await fetch('/api/auth/setup-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to set password');
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
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-gray-600">Validating invitation link...</p>
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
                  <span className="text-2xl text-red-600 font-bold">✗</span>
                </div>
              </div>
              <CardTitle className="text-2xl text-center text-gray-900">
                Invalid Invitation Link
              </CardTitle>
              <CardDescription className="text-center text-gray-600">
                This invitation link is invalid or has expired.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-500 text-center">
                Invitation links expire after 72 hours for security reasons. Please contact your administrator for a new invitation.
              </p>
              <Button 
                onClick={() => setLocation('/')}
                variant="outline"
                className="w-full"
              >
                Go to Login
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
                  <span className="text-2xl text-green-600">✓</span>
                </div>
              </div>
              <CardTitle className="text-2xl text-center text-gray-900">
                Account Activated!
              </CardTitle>
              <CardDescription className="text-center text-gray-600">
                Your account is now ready to use. You can log in with your email and password.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={() => setLocation('/')}
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

  // Setup password form
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
              Welcome to Stratus!
            </CardTitle>
            <CardDescription className="text-center text-gray-600">
              Set up your password to complete your account registration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Show user email */}
            {userEmail && (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-4">
                <span className="text-sm text-blue-800 font-medium">{userEmail}</span>
              </div>
            )}

            {/* Show custom message from admin if present */}
            {customMessage && (
              <div className="bg-gray-50 border border-gray-200 rounded-md p-3 mb-4">
                <p className="text-sm text-gray-700 italic">"{customMessage}"</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-700">Create Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                <p className="text-xs text-gray-500">Must be at least 8 characters</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-gray-700">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <Button 
                type="submit" 
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={isLoading}
              >
                {isLoading ? "Setting up..." : "Complete Setup"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-center text-xs text-gray-500">
          <p>By setting up your account, you agree to use this system responsibly.</p>
        </div>
      </div>
    </div>
  );
}
