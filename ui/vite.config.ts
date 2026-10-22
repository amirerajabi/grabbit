import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The UI talks to the engine over HTTP + WebSocket: in Electron the preload bridge passes the address and token, in a
// browser (npm run dev) VITE_ENGINE_URL / VITE_ENGINE_TOKEN, defaulting to the dev engine on 7310 with token "dev".
export default defineConfig({
  // Relative asset URLs: the Electron build is loaded from disk.
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true, fs: { allow: ['..'] } },
  build: { target: 'es2022' },
});
