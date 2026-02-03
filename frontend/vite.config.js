import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Use relative paths for Electron
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: './index.html',
        vnc: './vnc.html'
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react-vendor';
            }
            if (id.includes('xterm')) {
              return 'xterm-vendor';
            }
            if (id.includes('lucide')) {
              return 'lucide-vendor';
            }
            if (id.includes('@novnc')) {
              return 'novnc-vendor';
            }
            return 'vendor';
          }
        }
      }
    }
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  }
})
