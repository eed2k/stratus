import { AppSidebar } from "../AppSidebar";
import { ThemeProvider } from "../ThemeProvider";
import { SidebarProvider } from "@/components/ui/sidebar";

export default function AppSidebarExample() {
  return (
    <ThemeProvider>
      <SidebarProvider>
        <div className="flex h-[500px] w-full bg-background">
          <AppSidebar
            user={{
              name: "John Doe",
              email: "john@example.com",
            }}
            onLogout={() => console.log("Logout clicked")}
          />
          <div className="flex-1 p-6">
            <p className="text-muted-foreground">Main content area</p>
          </div>
        </div>
      </SidebarProvider>
    </ThemeProvider>
  );
}
