import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// build output to ../recipe-editor (served by GitHub Pages)
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../recipe-editor',
    emptyOutDir: true,
    reportCompressedSize: false,
    target: 'es2020',
  },
});
