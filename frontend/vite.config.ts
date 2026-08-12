import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  loadEnv(mode, '.', '');
  console.log('🔧 Vite Config - Loading environment variables');
  console.log('📝 Mode:', mode);

  return {
    base: '/', // Serve from root
    server: {
      port: 3005,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          ws: true, // proxy the secure voice WebSocket relay in local dev
        },
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      // Copy index.html and other files
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
