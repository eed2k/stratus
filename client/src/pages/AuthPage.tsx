import { useState } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { SignupForm } from "@/components/auth/SignupForm";

interface AuthPageProps {
  onAuthenticate?: () => void;
}

export default function AuthPage({ onAuthenticate }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);

  const handleLogin = (_email: string, _password: string) => {
    // Authentication handled
    onAuthenticate?.();
  };

  const handleSignup = (_name: string, _email: string, _password: string) => {
    // Signup handled
    onAuthenticate?.();
  };

  const handleSocialAuth = (_provider: string) => {
    // Social auth handled
    onAuthenticate?.();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {isLogin ? (
          <LoginForm
            onLogin={handleLogin}
            onSocialLogin={handleSocialAuth}
            onSignUp={() => setIsLogin(false)}
          />
        ) : (
          <SignupForm
            onSignup={handleSignup}
            onSocialSignup={handleSocialAuth}
            onLogin={() => setIsLogin(true)}
          />
        )}
      </div>
    </div>
  );
}
