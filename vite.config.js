import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
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
  plugins: [react()],
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
    // Remove console statements in production
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,      // Remove all console.* statements
        drop_debugger: true,     // Remove debugger statements
        pure_funcs: ['console.log', 'console.debug', 'console.info']  // Additional safety
      }
    }
  }
})