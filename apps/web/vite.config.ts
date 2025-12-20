import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 4173,
    host: true,
    https: {
      key: fs.readFileSync(path.resolve(__dirname, '../../infra/dev-certs/dev-key.pem')),
      cert: fs.readFileSync(path.resolve(__dirname, '../../infra/dev-certs/dev-cert.pem')),
    },
  },
});
