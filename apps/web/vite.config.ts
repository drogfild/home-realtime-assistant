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
    https: (() => {
      const certsDir = path.resolve(__dirname, '../../infra/dev-certs');
      const keyPath = path.join(certsDir, 'dev-key.pem');
      const certPath = path.join(certsDir, 'dev-cert.pem');

      if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        return {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        };
      }

      return undefined;
    })(),
  },
});
