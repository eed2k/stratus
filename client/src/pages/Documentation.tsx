// Stratus Weather System
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Documentation() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          About Stratus
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
                <span className="font-medium">1.3.1</span>
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
                <span className="font-medium">&copy; Lukas Esterhuizen</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
