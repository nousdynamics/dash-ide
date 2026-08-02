import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

/**
 * O build sai direto em `public/`, que é o diretório de assets do Worker
 * (wrangler.jsonc). O resultado é commitado porque o Workers Builds roda
 * `npx wrangler deploy` e não executa o build do Vite — versionar o bundle é o
 * que mantém o deploy automático funcionando sem mudar o CI.
 */
export default defineConfig({
  root: 'app',
  plugins: [react(), tailwind()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    // Sem hash no nome: o Access serve por domínio próprio e o cache é curto;
    // nome estável mantém o diff do commit legível.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
        /*
         * Sem manualChunks de propósito. Forçar Recharts num chunk próprio criou
         * dependência cruzada com o chunk de vendor, que é carregado sempre —
         * o resultado foi Recharts virar import estático da entrada e ser
         * baixado até por quem abria Conversas. O splitting automático segue as
         * fronteiras dos `lazy()` e resolve isso sozinho.
         */
      },
    },
  },
  server: {
    port: 5173,
    // Em desenvolvimento o Vite serve a UI e repassa a API para o Worker local.
    proxy: {
      '/api': 'http://localhost:8790',
      '/health': 'http://localhost:8790',
    },
  },
});
