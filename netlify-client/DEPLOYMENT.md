# Netlify Client Dashboard - Deployment Guide

## Build Configuration

### Build Script
The build uses Vite alone, which handles TypeScript compilation internally:

```json
"build": "vite build"
```

**Why no separate TypeScript compilation?**
- Vite's esbuild-based build system compiles TypeScript automatically
- Removes the permission issues with running `tsc` on Netlify
- Faster build times (esbuild is much faster than tsc)
- For type-checking during development, use: `npm run typecheck`

### Build Issues & Solutions

#### Previous "tsc: Permission denied" Error
**RESOLVED** - Removed the separate TypeScript compilation step. Vite handles all TypeScript compilation during the build process.

### Chunk Size Warning

You may see a warning about chunk sizes:

```
(!) Some chunks are larger than 500 kB after minification.
```

**This is NOT an error** - the build completes successfully. This is just a Vite warning suggesting code-splitting optimizations. The application will work perfectly fine.

## Environment Variables

Set the following in Netlify Dashboard → Site Settings → Environment Variables:

- `VITE_STRATUS_SERVER_URL` = Your Railway server URL (e.g., `https://stratus-production.up.railway.app`)

## Features

### Video Background
The Netlify login page features:
- **Thunderstorm video background** with dark overlay
- **White text and borders** for high contrast
- **Glass-morphism effects** (frosted glass blur)
- **Auto-playing looping video** with fallback sources

### Differences from Main App
- **Main Railway App**: Clean white background, Admin/User toggle
- **Netlify Client**: Dramatic video background, view-only access
- **Windows EXE**: Same as Railway app (no video)

## Build Commands

```bash
# Development
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

## Video Sources

The background uses free-to-use videos from Pixabay:
- Primary: Thunderstorm with lightning (41932-432041624)
- Fallback: Storm clouds (84335-585473793)

Both videos are served via CDN for optimal performance.

## Browser Support

The video background requires:
- Modern browsers with HTML5 video support
- Autoplay support (enabled on most desktop browsers)
- Falls back gracefully if video fails to load

## Performance

- Video loads asynchronously
- Backdrop blur and overlays ensure text readability
- Optimized for both mobile and desktop
