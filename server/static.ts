import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // In Electron packaged app, dist is relative to __dirname
  // Try multiple possible paths
  const possiblePaths = [
    path.resolve(__dirname, "..", "dist"),           // Development: server/../dist
    path.resolve(__dirname, "..", "client", "dist"), // Alternative dev path
    path.resolve(__dirname, "..", "..", "dist"),     // Packaged: resources/app/dist
    path.resolve(process.cwd(), "dist"),             // Current working directory
  ];
  
  let distPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, "index.html"))) {
      distPath = p;
      break;
    }
  }
  
  if (!distPath) {
    console.error("Could not find dist directory. Tried:", possiblePaths);
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
