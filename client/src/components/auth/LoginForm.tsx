import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SiGoogle, SiGithub, SiApple } from "react-icons/si";
import { Mail, Lock, Cloud } from "lucide-react";

interface LoginFormProps {
  onLogin?: (email: string, password: string) => void;
  onSocialLogin?: (provider: string) => void;
  onSignUp?: () => void;
}

export function LoginForm({ onLogin, onSocialLogin, onSignUp }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    await new Promise(r => setTimeout(r, 500));
    onLogin?.(email, password);
    setIsLoading(false);
  };

  const handleSocialLogin = (provider: string) => {
    console.log(`${provider} login triggered`);
    onSocialLogin?.(provider);
  };

  return (
    <Card className="w-full max-w-md" data-testid="card-login">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Cloud className="h-8 w-8 text-primary" />
        </div>
        <CardTitle className="text-2xl font-semibold">WeatherView Pro</CardTitle>
        <CardDescription>Sign in to access your weather stations</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <Button
            variant="outline"
            onClick={() => handleSocialLogin("google")}
            data-testid="button-login-google"
          >
            <SiGoogle className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSocialLogin("github")}
            data-testid="button-login-github"
          >
            <SiGithub className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSocialLogin("apple")}
            data-testid="button-login-apple"
          >
            <SiApple className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <Separator />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or continue with email</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10"
                data-testid="input-email"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Button variant="ghost" className="h-auto p-0 text-xs" data-testid="link-forgot-password">
                Forgot password?
              </Button>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10"
                data-testid="input-password"
                required
              />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-login-submit">
            {isLoading ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Button variant="ghost" className="h-auto p-0" onClick={onSignUp} data-testid="link-signup">
            Sign up
          </Button>
        </p>
      </CardContent>
    </Card>
  );
}
