// Stratus Weather System - Example/Template Component
// Source: Library (shadcn/ui example)

import { SignupForm } from "../auth/SignupForm";
import { ThemeProvider } from "../ThemeProvider";

export default function SignupFormExample() {
  return (
    <ThemeProvider>
      <div className="flex min-h-[500px] items-center justify-center bg-background p-8">
        <SignupForm
          onSignup={(name, email, pwd) => console.log("Signup:", name, email, pwd)}
          onSocialSignup={(provider) => console.log("Social:", provider)}
          onLogin={() => console.log("Login clicked")}
        />
      </div>
    </ThemeProvider>
  );
}
