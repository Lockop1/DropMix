import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Listen on every interface so a phone on the LAN (or a tunnel) can reach the dev server.
    host: true,
    // Accept any Host header: quick tunnels (e.g. cloudflared) use random hostnames.
    allowedHosts: true,
    // Rooms spike (0D): one origin for phones. `/rooms-api/*` (HTTP + WebSocket) → wrangler dev.
    proxy: {
      '/rooms-api': {
        target: 'http://localhost:8787',
        ws: true,
        rewrite: (path) => path.replace(/^\/rooms-api/, ''),
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
    allowedHosts: true,
  },
});
