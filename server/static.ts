import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // In packaged Electron app (asar disabled):
  // - Server runs from: resources/app/dist/server/
  // - Client is at: resources/app/client/dist/
  // __dirname in compiled server: .../dist/server
  
  const possiblePaths = [
    path.resolve(__dirname, "..", "..", "client", "dist"),  // Packaged: dist/server/../../client/dist
    path.resolve(__dirname, "..", "client", "dist"),        // Alternative
    path.resolve(process.cwd(), "client", "dist"),          // CWD/client/dist
  ];
  
  let distPath: string | null = null;
  for (const p of possiblePaths) {
    console.log(`Checking for client dist at: ${p}`);
    if (fs.existsSync(p) && fs.existsSync(path.join(p, "index.html"))) {
      distPath = p;
      console.log(`Found client dist at: ${p}`);
      break;
    }
  }
  
  if (!distPath) {
    console.error("Could not find client dist directory. Tried:", possiblePaths);
    throw new Error(
      `Could not find the build directory, make sure to build the client first`,
    );
  }
  
  console.log(`Serving static files from: ${distPath}`);

  app.use(express.static(distPath));

  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath!, "index.html"));
  });
}
