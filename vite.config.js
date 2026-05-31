import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Get git commit hash for frontend build info
let gitCommit = 'dev';
try {
  gitCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch (e) {
  // git not available
}

/*
https: {
  key: fs.readFileSync(path.resolve(__dirname, 'certs/key.pem')),
  cert: fs.readFileSync(path.resolve(__dirname, 'certs/cert.pem')),
},
*/

export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_COMMIT__: JSON.stringify(gitCommit)
  },
  // Force all React imports to resolve to the same instance
  // This fixes "Cannot read properties of null (reading 'useEffect')" errors
  // caused by libraries bundling their own React
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-router',
      'react-router-dom'
    ]
  },
  // Pre-bundle all React-dependent libraries together to ensure single React instance
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router',
      'react-router-dom',
      '@azure/msal-react',
      '@azure/msal-browser',
      '@tanstack/react-query'
    ],
    // Removed force: true — was a debugging flag that added 10-30s to every dev start
  },
  plugins: [
    react(),
    // PWA support: manifest + service worker for mobile "Add to Home Screen"
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Use production Workbox bundles (no logger.js debug output)
        mode: 'production',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        navigateFallback: '/index.html',
        // Don't cache API calls, auth redirects, or SSE connections
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        runtimeCaching: []
      },
      manifest: {
        name: 'Temple Events Scheduler',
        short_name: 'Temple Events',
        description: 'Calendar management for Temple Emanuel',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2b579a',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }
    }),
    // Sentry plugin for source map upload (only in production builds with auth token)
    process.env.SENTRY_AUTH_TOKEN && sentryVitePlugin({
      org: process.env.SENTRY_ORG || 'your-sentry-org',
      project: process.env.SENTRY_PROJECT || 'emanuel-calendar',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        assets: './dist/**',
      },
      // Don't fail the build if source map upload fails
      errorHandler: (err) => {
        console.warn('Sentry source map upload warning:', err.message);
      }
    })
  ].filter(Boolean),
  server: {
    port: 5173, // Standard Vite development port
    
    // Enable CORS globally
    cors: {
      origin: '*',
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
      headers: ['Content-Type', 'Authorization']
    },
    
    // HMR configuration
    hmr: {
      host: 'localhost',
      overlay: true,
    },
    
    // Add headers directly
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    },
    allowedHosts: [
      'https://teal-decent-pleasantly.ngrok-free.app',
      'teal-decent-pleasantly.ngrok-free.app'
    ]
  },
  build: {
    outDir: 'dist',
    // Source maps uploaded to Sentry but not served to browsers
    sourcemap: 'hidden',
    // Remove console statements in production
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,      // Remove all console.* statements
        drop_debugger: true,     // Remove debugger statements
        pure_funcs: ['console.log', 'console.debug', 'console.info']  // Additional safety
      }
    },
    // Code splitting configuration for better caching and reduced initial load
    rollupOptions: {
      output: {
        manualChunks: {
          // Authentication - needed at boot (MSAL inits before first render),
          // separate chunk for stable long-term caching.
          'auth': ['@azure/msal-browser', '@azure/msal-react'],
          // Core vendor libraries - eager, used app-wide.
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          // React Query - data fetching library, eager (App-level provider).
          'query': ['@tanstack/react-query']
          // NOTE: jspdf/jspdf-autotable (PDF export), react-quill-new (event
          // rich-text editor), and react-datepicker (date popovers) are
          // intentionally NOT listed here. They are imported only by lazy()
          // components, but forcing them into named manualChunks caused Rollup
          // to emit <link rel="modulepreload"> for them in index.html — eagerly
          // downloading ~734KB on first paint despite the lazy boundaries.
          // Omitting them lets Vite's automatic dynamic-import splitting keep
          // them in on-demand async chunks. Verify after build: dist/index.html
          // must NOT contain modulepreload links for pdf/editor/datepicker.
        }
      }
    }
  }
})