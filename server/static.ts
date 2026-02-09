import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // Cloud/Docker: Server runs from /app/dist/server/, client at /app/client/dist/
  // Electron: Server runs from resources/app/dist/server/, client at resources/app/client/dist/
  // __dirname in compiled server: /app/dist/server (Docker) or .../dist/server (Electron)
  
  const possiblePaths = [
    path.resolve(__dirname, "..", "..", "client", "dist"),  // Docker: /app/dist/server -> /app/client/dist
    path.resolve(process.cwd(), "client", "dist"),          // CWD/client/dist (fallback)
    path.resolve(__dirname, "..", "client", "dist"),        // Alternative layout
  ];
  
  // Electron packaged app: check relative to app root (asar)
  if (process.env.STRATUS_DESKTOP === 'true') {
    // In Electron asar: __dirname = .../app.asar/dist/server
    // So app root = __dirname/../../ => .../app.asar/
    // Client dist = .../app.asar/client/dist
    const electronAppRoot = path.resolve(__dirname, "..", "..");
    possiblePaths.unshift(path.resolve(electronAppRoot, "client", "dist"));
    console.log(`[Desktop] Electron app root: ${electronAppRoot}`);
  }
  
  let distPath: string | null = null;
  for (const p of possiblePaths) {
    console.log(`Checking for client dist at: ${p}`);
    if (fs.existsSync(p)) {
      const indexPath = path.join(p, "index.html");
      if (fs.existsSync(indexPath)) {
        distPath = p;
        console.log(`Found client dist at: ${p}`);
        break;
      } else {
        console.log(`Found directory but no index.html at: ${p}`);
      }
    }
  }
  
  if (!distPath) {
    console.error("Could not find client dist directory. Tried:", possiblePaths);
    console.error("Current __dirname:", __dirname);
    console.error("Current cwd:", process.cwd());
    // List what's in the current directory for debugging
    try {
      const cwdContents = fs.readdirSync(process.cwd());
      console.error("CWD contents:", cwdContents);
      if (fs.existsSync(path.join(process.cwd(), 'client'))) {
        const clientContents = fs.readdirSync(path.join(process.cwd(), 'client'));
        console.error("Client folder contents:", clientContents);
      }
    } catch (e) {
      console.error("Error listing directories:", e);
    }
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
