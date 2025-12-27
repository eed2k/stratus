import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { SiGoogle, SiGithub, SiApple } from "react-icons/si";
import { Mail, Lock, User, Cloud } from "lucide-react";

interface SignupFormProps {
  onSignup?: (name: string, email: string, password: string) => void;
  onSocialSignup?: (provider: string) => void;
  onLogin?: () => void;
}

export function SignupForm({ onSignup, onSocialSignup, onLogin }: SignupFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) return;
    setIsLoading(true);
    await new Promise(r => setTimeout(r, 500));
    onSignup?.(name, email, password);
    setIsLoading(false);
  };

  const handleSocialSignup = (provider: string) => {
    onSocialSignup?.(provider);
  };

  return (
    <Card className="w-full max-w-md" data-testid="card-signup">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Cloud className="h-8 w-8 text-primary" />
        </div>
        <CardTitle className="text-2xl font-semibold">Create Account</CardTitle>
        <CardDescription>Start monitoring your weather stations today</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <Button
            variant="outline"
            onClick={() => handleSocialSignup("google")}
            data-testid="button-signup-google"
          >
            <SiGoogle className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSocialSignup("github")}
            data-testid="button-signup-github"
          >
            <SiGithub className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSocialSignup("apple")}
            data-testid="button-signup-apple"
          >
            <SiApple className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <Separator />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or register with email</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full Name</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="name"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="pl-10"
                data-testid="input-name"
                required
              />
            </div>
          </div>

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
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                placeholder="Create a password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10"
                data-testid="input-password"
                required
                minLength={8}
              />
            </div>
            <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="terms"
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked === true)}
              data-testid="checkbox-terms"
            />
            <Label htmlFor="terms" className="text-xs leading-tight text-muted-foreground">
              I agree to the Terms of Service and Privacy Policy
            </Label>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || !agreed}
            data-testid="button-signup-submit"
          >
            {isLoading ? "Creating account..." : "Create Account"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Button variant="ghost" className="h-auto p-0" onClick={onLogin} data-testid="link-login">
            Sign in
          </Button>
        </p>
      </CardContent>
    </Card>
  );
}
