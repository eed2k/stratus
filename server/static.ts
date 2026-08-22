// Stratus Weather Server
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

  /**
   * Refuse anything that looks like a request for application source.
   *
   * Only the built bundle is ever served from disk, so these paths cannot
   * resolve to real files. Without this guard the SPA fallback answers them
   * with index.html, which makes probing look like it half worked; an explicit
   * 404 is both honest and stops a Vite-style path (/@fs/, /src/) from ever
   * being interpreted should the dev middleware be mounted by mistake.
   */
  // Path prefixes that only exist in the source tree or in Vite's dev server.
  // Note the deliberate omission of "shared": public share links live at
  // /shared/{token}, so blocking that prefix would take every shared dashboard
  // offline.
  const SOURCE_PREFIXES = /^\/(?:src|server|scripts|node_modules|@fs|@vite|@id)\//i;
  // Extensions that are never part of a built client bundle.
  const SOURCE_EXTENSIONS = /\.(?:ts|tsx|jsx|map|env|log|sql|py|sh)$/i;
  // Hidden paths, except the ACME challenge directory a certificate issuer needs.
  const HIDDEN_PATH = /^\/\.(?!well-known\/)/;

  // Note: the X-Robots-Tag noindex header is set globally in server/index.ts so
  // it also covers API responses and shared dashboard links.
  app.use((req, res, next) => {
    const p = req.path;
    if (SOURCE_PREFIXES.test(p) || SOURCE_EXTENSIONS.test(p) || HIDDEN_PATH.test(p)) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    next();
  });

  // Cache hashed assets (JS/CSS with content hashes) for 1 year
  app.use("/assets", express.static(path.join(distPath, "assets"), {
    maxAge: "1y",
    immutable: true,
    dotfiles: "deny",
    index: false,
  }));

  // Serve other static files with no-cache. Disable index serving so
  // requests for "/" (and any other path resolving to a directory) fall
  // through to the SPA wildcard handler below, which sets strict no-cache
  // headers on index.html. Without this the browser can serve a stale
  // index.html (and therefore an old bundle hash) for hours after deploy.
  app.use(express.static(distPath, {
    maxAge: 0,
    etag: false,
    index: false,
    dotfiles: "deny",
  }));

  app.use("*", (_req, res) => {
    // Always send fresh index.html (no browser caching)
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.sendFile(path.resolve(distPath!, "index.html"));
  });
}
