// Stratus Weather System - Example/Template Component
// Source: Library (shadcn/ui example)

import { LoginForm } from "../auth/LoginForm";
import { ThemeProvider } from "../ThemeProvider";

export default function LoginFormExample() {
  return (
    <ThemeProvider>
      <div className="flex min-h-[400px] items-center justify-center bg-background p-8">
        <LoginForm
          onLogin={(email, pwd) => console.log("Login:", email, pwd)}
          onSocialLogin={(provider) => console.log("Social:", provider)}
          onSignUp={() => console.log("Signup clicked")}
        />
      </div>
    </ThemeProvider>
  );
}
