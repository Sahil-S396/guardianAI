import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(ROOT_DIR, 'index.html'),
        checkin: resolve(ROOT_DIR, 'checkin.html'),
        qrGenerator: resolve(ROOT_DIR, 'qr-generator.html'),
      },
    },
  },
});
