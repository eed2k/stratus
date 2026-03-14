// Stratus Weather System
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Documentation() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          About
        </h1>
      </div>

      <div className="grid gap-6">
        {/* Version Info */}
        <Card>
          <CardHeader>
            <CardTitle>About Stratus Weather Server</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="font-medium">1.2.1 (Build 19.6)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Developer</span>
                <span className="font-medium">Lukas Esterhuizen</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Contact</span>
                <a href="mailto:esterhuizen2k@proton.me" className="font-medium text-primary hover:underline">
                  esterhuizen2k@proton.me
                </a>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Licence</span>
                <span className="font-medium">Proprietary (EULA)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Copyright</span>
                <span className="font-medium">&copy; 2025-2026 Lukas Esterhuizen</span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t text-sm text-muted-foreground space-y-2">
              <p>
                Stratus would not have been possible without the incredible open-source community
                and the many talented developers behind the libraries, frameworks, and tools that
                power this platform. From React and Vite to Recharts, Leaflet, TanStack Query,
                shadcn/ui, Radix UI, Tailwind CSS, Express, Drizzle ORM, Neon Serverless Postgres,
                and countless others, each project and its contributors played an essential
                role in bringing Stratus to life. A sincere thank you to every developer, maintainer,
                and community member whose work made this possible.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
