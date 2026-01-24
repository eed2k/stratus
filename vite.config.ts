import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    hmr: false,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:5000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // Target modern browsers for smaller bundles
    target: 'es2020',
    // Chunk splitting for better caching and parallel loading
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          // React core - cached long-term
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor';
          }
          // Recharts + D3 is large (~400kb) - separate chunk for parallel loading
          if (id.includes('node_modules/recharts/') || id.includes('node_modules/d3-')) {
            return 'charts';
          }
          // Radix UI components - used across many pages
          if (id.includes('node_modules/@radix-ui/')) {
            return 'ui-vendor';
          }
          // React Query - data fetching layer
          if (id.includes('node_modules/@tanstack/')) {
            return 'query';
          }
          // PDF/Canvas libraries - only needed for reports
          if (id.includes('node_modules/jspdf/') || id.includes('node_modules/html2canvas/')) {
            return 'pdf-export';
          }
          // Date utilities
          if (id.includes('node_modules/date-fns/')) {
            return 'date-utils';
          }
          // Lucide icons
          if (id.includes('node_modules/lucide-react/')) {
            return 'icons';
          }
        },
      },
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 500,
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss(path.resolve(__dirname, 'tailwind.config.js')),
        autoprefixer(),
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared'),
      '@assets': path.resolve(__dirname, './attached_assets'),
    },
  },
})
