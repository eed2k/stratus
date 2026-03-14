// Stratus Weather System
// Created by Lukas Esterhuizen

import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // Cloud/Docker: Server runs from /app/dist/server/, client at /app/client/dist/
  // __dirname in compiled server: /app/dist/server (Docker)
  
  const possiblePaths = [
    path.resolve(__dirname, "..", "..", "client", "dist"),  // Docker: /app/dist/server -> /app/client/dist
    path.resolve(process.cwd(), "client", "dist"),          // CWD/client/dist (fallback)
    path.resolve(__dirname, "..", "client", "dist"),        // Alternative layout
  ];
  
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

  // Cache hashed assets (JS/CSS with content hashes) for 1 year
  app.use("/assets", express.static(path.join(distPath, "assets"), {
    maxAge: "1y",
    immutable: true,
  }));

  // Serve other static files with no-cache
  app.use(express.static(distPath, {
    maxAge: 0,
    etag: false,
  }));

  app.use("*", (_req, res) => {
    // Always send fresh index.html (no browser caching)
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.sendFile(path.resolve(distPath!, "index.html"));
  });
}
