import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/*
https: {
  key: fs.readFileSync(path.resolve(__dirname, 'certs/key.pem')),
  cert: fs.readFileSync(path.resolve(__dirname, 'certs/cert.pem')),
}, 
*/

export default defineConfig({
  // Force all React imports to resolve to the same instance
  // This fixes "Cannot read properties of null (reading 'useEffect')" errors
  // caused by libraries like @azure/msal-react bundling their own React
  resolve: {
    dedupe: ['react', 'react-dom']
  },
  plugins: [
    react(),
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
    
    // Allow ngrok host
    hmr: {
      host: 'localhost',
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
    // Enable source maps for Sentry error tracking
    sourcemap: true,
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
          // PDF libraries - loaded only when exporting
          'pdf': ['jspdf', 'jspdf-autotable'],
          // Rich text editor - loaded only when editing events
          'editor': ['react-quill-new'],
          // Authentication - needed early but can be separate chunk
          'auth': ['@azure/msal-browser', '@azure/msal-react'],
          // Core vendor libraries
          'vendor': ['react', 'react-dom', 'react-router-dom']
        }
      }
    }
  }
})