import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: process.cwd(),
  server: {
    port: 5173,
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
    sourcemap: false,
    minify: 'esbuild',
    // Chunk splitting for better caching and parallel loading
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React core - cached long-term
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor';
          }
          // Recharts is large (~300kb) - separate chunk for parallel loading
          if (id.includes('node_modules/recharts/') || id.includes('node_modules/d3-')) {
            return 'charts';
          }
          // Radix UI components
          if (id.includes('node_modules/@radix-ui/')) {
            return 'ui-vendor';
          }
          // React Query
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
    // Target modern browsers for smaller bundles
    target: 'es2020',
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 500,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
})
