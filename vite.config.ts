import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Relative base so the built app works on any host path, including
  // GitHub Pages project subpaths like https://user.github.io/repo/.
  base: './',
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Core React runtime — always needed, load first
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
            return 'vendor-react';
          }
          // Router
          if (id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run/router')) {
            return 'vendor-router';
          }
          // Radix UI + Lucide icons — needed for homepage but large
          if (id.includes('node_modules/@radix-ui/') || id.includes('node_modules/lucide-react')) {
            return 'vendor-ui';
          }
          // EPUB / ZIP — only needed when generating
          if (id.includes('node_modules/epubjs') || id.includes('node_modules/jszip') || id.includes('node_modules/xmldom') || id.includes('node_modules/@xmldom')) {
            return 'vendor-epub';
          }
          // Supabase SDK — only needed for library/auth features
          if (id.includes('node_modules/@supabase/') || id.includes('node_modules/supabase')) {
            return 'vendor-supabase';
          }
          // React Query
          if (id.includes('node_modules/@tanstack/')) {
            return 'vendor-query';
          }
        },
      },
    },
    // Raise the warning threshold so the build doesn't spam warnings
    chunkSizeWarningLimit: 600,
  },
}));
