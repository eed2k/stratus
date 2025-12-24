import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // Client builds to client/dist, server builds to dist/server
  // __dirname is dist/server in compiled output
  const possiblePaths = [
    path.resolve(__dirname, "..", "..", "client", "dist"),  // dist/server/../../client/dist
    path.resolve(process.cwd(), "client", "dist"),          // CWD/client/dist
    path.resolve(__dirname, "..", "client", "dist"),        // dist/server/../client/dist 
    path.resolve(process.cwd(), "dist"),                    // CWD/dist (packaged app)
  ];
  
  let distPath: string | null = null;
  for (const p of possiblePaths) {
    console.log(`Checking for dist at: ${p}`);
    if (fs.existsSync(p) && fs.existsSync(path.join(p, "index.html"))) {
      distPath = p;
      console.log(`Found dist at: ${p}`);
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
